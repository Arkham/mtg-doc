import { randomUUID } from "node:crypto";
import type {
  BracketReport,
  Card,
  Color,
  Combo,
  DeckSnapshot,
  Job,
  JobStep,
  OptimizeOptions,
  Report,
  Swap,
} from "../shared/types.ts";
import { BRACKETS, assessBracket, comboViolates, flagsFor, isTwoCard } from "./analysis/bracket.ts";
import {
  type Deck,
  countRoles,
  identityOf,
  toDecklist,
  toEntries,
  totalCards,
  totalPrice,
} from "./analysis/deck.ts";
import { analyzeMana } from "./analysis/mana.ts";
import {
  type Plan,
  applyPlan,
  fixLandCount,
  mergeSwaps,
  planHeuristic,
  planWithLlm,
  rebalanceBasics,
} from "./analysis/optimizer.ts";
import { planManaFixes } from "./analysis/manabase.ts";
import {
  dropOwnedAlternatives,
  fallbackCombos,
  pinEdits,
  reconcileSwaps,
} from "./analysis/reconcile.ts";
import {
  CANDIDATE_CLASSIFIED,
  CANDIDATE_LOOKUPS,
  type SolverContext,
  type SolverResult,
  buildSolverContext,
  edhrecSuggestions,
  eligibleCandidates,
  solve,
  trimToBudget,
  upgradePool,
  wantsGameChangers,
} from "./analysis/search.ts";
import { simulate } from "./analysis/simulate.ts";
import { config, llmEnabled } from "./config.ts";
import { parseDecklist } from "./decklist.ts";
import { buildCardIndex } from "./card-index.ts";
import { landCandidates, toSuggestion } from "./mana-advice.ts";
import { checkContradictions } from "./contradictions.ts";
import { writeGuides } from "./play-guide.ts";
import { ref } from "../shared/card-refs.ts";
import { cancelDebounced, enqueueEdit } from "./edit-queue.ts";
import { findSynergies } from "./synergies.ts";
import { BRACKET_PAGE, getCommanderData } from "./sources/edhrec.ts";
import { researchCommander } from "./sources/research.ts";
import { lookupExact, lookupFuzzy, searchCards } from "./sources/scryfall.ts";
import {
  type BracketEstimate,
  type CardFlags,
  estimateBracket,
  findCombos,
} from "./sources/spellbook.ts";
import { TaskGraph } from "./task-graph.ts";
import { type TaskCopy, Tracer, traceFetch } from "./trace.ts";

traceFetch();
import {
  clearPendingRefresh,
  readDeckFile,
  readInitial,
  readMeta,
  readReport,
  writeRun,
  writeResults,
} from "./storage.ts";

const jobs = new Map<string, Job>();
const tracers = new Map<string, Tracer>();

/** A job as it stands, with what it's doing so far. */
export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  const tracer = tracers.get(id);
  return job && tracer ? { ...job, trace: tracer.snapshot() } : job;
}

/** Calls `listener` whenever a job's trace changes, until the returned function is called. */
export const watchJob = (id: string, listener: () => void) =>
  tracers.get(id)?.onChange(listener) ?? (() => {});

/** Land swaps the optimizer applies on its own to fix the mana base, beyond the spell swaps. */
const MANA_FIXES = 4;
/** Land-count fixes a re-run that keeps the user's edits may make beyond the swap cap. */
const LAND_REPAIRS = 4;

/** What a run reports doing, in the order the progress page lists it. */
export enum Step {
  LoadCards = "Load card data",
  Combos = "Find combos & check bracket",
  Mana = "Analyze mana base & simulate",
  Edhrec = "Fetch EDHREC recommendations",
  Research = "Web research",
  Upgrades = "Search for upgrades",
  Review = "Review swaps",
  Verify = "Fix mana base & verify bracket",
  Synergies = "Find synergies",
  Guides = "Write how-to-play guides",
  Contradictions = "Check for contradictions",
  Save = "Write report",
}

const STEPS = Object.values(Step);

export function startOptimize(slug: string, opts: RunOptions = {}): Job {
  const job: Job = {
    id: randomUUID(),
    slug,
    status: "running",
    steps: STEPS.map((label) => ({ label, status: "pending" })),
  };
  jobs.set(job.id, job);
  // In the deck's edit queue, so a run never writes the report while an edit does.
  enqueueEdit(slug, "Optimize", () => run(job, opts)).done.catch((err) => {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    const running = job.steps.find((s) => s.status === "running");
    if (running) running.status = "error";
    tracers.get(job.id)?.touch();
    console.error(`[job ${job.id}]`, err);
  });
  return job;
}

const stepOf = (job: Job, step: Step) => job.steps[STEPS.indexOf(step)];

/** Marks a step as running, for steps whose work starts before the task that finishes them. */
function begin(job: Job, step: Step) {
  stepOf(job, step).status = "running";
}

/** Runs `fn` as a step: running while it works, done once it's done (unless it said otherwise). */
async function inStep<T>(job: Job, step: Step, fn: (s: JobStep) => Promise<T>): Promise<T> {
  const s = stepOf(job, step);
  s.status = "running";
  const result = await fn(s);
  if (s.status === "running") s.status = "done";
  return result;
}

export const twoCardCombos = (est: BracketEstimate | null) =>
  (est?.combos ?? []).filter(isTwoCard).map((c) => c.cards);

export function snapshot(
  deck: Deck,
  edhrecAvgLands: number | null,
  isCommander: boolean,
  combos: string[][] = [],
): DeckSnapshot {
  return {
    mana: analyzeMana(deck, edhrecAvgLands),
    sim: simulate(deck, 10_000, 42, combos),
    roles: countRoles(deck, isCommander),
    totalCards: totalCards(deck),
    totalPriceUsd: totalPrice(deck),
  };
}

export async function loadDeck(
  slug: string,
  file: "initial.txt" | "optimized.txt" = "initial.txt",
): Promise<{ deck: Deck; warnings: string[] }> {
  const parsed = parseDecklist(
    file === "initial.txt" ? await readInitial(slug) : await readDeckFile(slug, file),
  );
  const names = [...parsed.commanders, ...parsed.entries.map((e) => e.name)];
  const found = await lookupExact(names);
  const warnings: string[] = [];
  const get = async (n: string): Promise<Card | null> => {
    const hit = found.get(n) ?? (await lookupFuzzy(n));
    if (!hit) warnings.push(`Unknown card "${n}" was ignored.`);
    return hit;
  };
  const commanders: Card[] = [];
  for (const n of parsed.commanders) {
    const c = await get(n);
    if (c) commanders.push(c);
  }
  const slots: Deck["slots"] = [];
  for (const e of parsed.entries) {
    const card = await get(e.name);
    if (!card) continue;
    const existing = slots.find((s) => s.card.name === card.name);
    if (existing) existing.qty += e.qty;
    else slots.push({ card, qty: e.qty });
  }
  return { deck: { commanders, slots }, warnings };
}

interface RunOptions {
  /** Optimize from the current suggestions with the user's chat edits kept, not from scratch. */
  keepEdits?: boolean;
}

/** The submitted list with the user's chat edits on the suggestions applied, and those edits. */
async function pinnedStart(slug: string, submitted: Deck) {
  const previous = await readReport(slug);
  if (!previous) return null;
  const chatEdits = (previous.edits ?? []).filter((e) => e.target !== "original");
  const { deck: current } = await loadDeck(slug, "optimized.txt");
  const cards = new Map(current.slots.map((s) => [s.card.name, s.card]));
  return {
    ...pinEdits(submitted, previous.swaps, cards, chatEdits),
    chatEdits,
    edits: previous.edits ?? [],
  };
}

/** The graph's tasks. Each is named for what it produces. */
enum Task {
  /** The deck to optimize, and the settings for this run. */
  Start = "start",
  /** Commander Spellbook: the deck's combos and bracket estimate. */
  Spellbook = "spellbook",
  /** Stats, simulation and bracket of the deck as it is, and the bracket to aim for. */
  Baseline = "baseline",
  Edhrec = "edhrec",
  /** The baseline's mana analysis with EDHREC's average land count. */
  BaselineMana = "baseline mana",
  Research = "research",
  /** Lands to consider for the mana base, looked up while the rest runs. */
  LandPool = "land pool",
  GameChangers = "game changers",
  /** Upgrade candidates from EDHREC and combos, looked up and classified. */
  KnownUpgrades = "known upgrades",
  /** All candidates (web research and Game Changers added), scored and solved. */
  Upgrades = "upgrades",
  Review = "review",
  /** The final deck: swaps applied, mana fixed, bracket verified, combos found. */
  Verified = "verified",
  /** Commander Spellbook on the deck as submitted, when the run started from the user's edits. */
  SubmittedChecks = "submitted checks",
  Synergies = "synergies",
  Draft = "draft",
  Checked = "checked",
  Saved = "saved",
}

/** Each task, for the reader: what it is, and what it's doing while it runs. */
const TASK_COPY: Record<Task, (commander: string) => TaskCopy> = {
  [Task.Start]: () => ({ label: "Load the deck", doing: "reading your list from Scryfall" }),
  [Task.Spellbook]: () => ({
    label: "Combos & bracket",
    doing: "asking Commander Spellbook for combos and a bracket",
  }),
  [Task.Baseline]: () => ({ label: "Goldfish", doing: "playing 10,000 solo games" }),
  [Task.Edhrec]: (c) => ({ label: "EDHREC", doing: `reading what EDHREC players put in ${c}` }),
  [Task.BaselineMana]: () => ({ label: "Mana base", doing: "weighing the mana base" }),
  [Task.Research]: (c) => ({
    label: "Web research",
    doing: `searching the web for how people build ${c}`,
  }),
  [Task.LandPool]: () => ({ label: "Land options", doing: "finding lands in your colors" }),
  [Task.GameChangers]: () => ({ label: "Game Changers", doing: "listing Game Changers" }),
  [Task.KnownUpgrades]: () => ({
    label: "Look up candidates",
    doing: "looking up the cards EDHREC and combos suggest",
  }),
  [Task.Upgrades]: () => ({
    label: "Find upgrades",
    doing: "scoring every candidate and solving for the best swaps",
  }),
  [Task.Review]: () => ({ label: "Review swaps", doing: "reviewing the swaps" }),
  [Task.Verified]: () => ({
    label: "Fix mana & verify",
    doing: "fixing the mana base and checking the bracket again",
  }),
  [Task.SubmittedChecks]: () => ({
    label: "Your list as submitted",
    doing: "checking your list as you submitted it",
  }),
  [Task.Synergies]: () => ({ label: "Synergies", doing: "finding synergies" }),
  [Task.Draft]: () => ({ label: "How-to-play guides", doing: "writing the how-to-play guides" }),
  [Task.Checked]: () => ({
    label: "Contradictions",
    doing: "checking what the report says against the facts",
  }),
  [Task.Saved]: () => ({ label: "Save", doing: "saving the report" }),
};

async function run(job: Job, opts: RunOptions) {
  const meta = await readMeta(job.slug);
  const settings: OptimizeOptions = {
    ...meta.options,
    tone: meta.options.tone ?? "max",
    budgetTotal: meta.options.budgetTotal ?? null,
  };
  const isCommander = meta.format === "commander";
  // Kept by step, so the report lists them in step order whatever finishes first.
  const warned = new Map<Step, string[]>();
  const warn = (at: Step, message: string) => warned.set(at, [...(warned.get(at) ?? []), message]);
  const warnings = () => STEPS.flatMap((label) => warned.get(label) ?? []);

  const commander = meta.commanders.join(" + ") || "this deck";
  const tracer = new Tracer((task) => TASK_COPY[task as Task](commander));
  tracers.set(job.id, tracer);
  const graph = new TaskGraph(tracer)
    .task(Task.Start, [], () =>
      inStep(job, Step.LoadCards, async (s) => {
        const { deck: submitted, warnings: w } = await loadDeck(job.slug);
        for (const m of w) warn(Step.LoadCards, m);
        s.detail = `${totalCards(submitted)} cards`;
        const pinned = opts.keepEdits ? await pinnedStart(job.slug, submitted) : null;
        const deck = pinned?.deck ?? submitted;
        const options: OptimizeOptions = pinned
          ? {
              ...settings,
              locked: [...new Set([...settings.locked, ...pinned.added])],
              excluded: pinned.removed,
            }
          : { ...settings };
        const identity = identityOf(deck.commanders);
        const commanderNames = deck.commanders.map((c) => c.name);
        const legalMain = (d: Deck) =>
          d.slots
            .filter((x) => x.card.colorIdentity.every((c) => identity.includes(c)))
            .map((x) => x.card.name);
        const estimate = (at: Step, d: Deck) =>
          estimateBracket(commanderNames, legalMain(d)).catch((e) => {
            warn(at, `Commander Spellbook bracket check failed: ${e}`);
            return null;
          });
        return { submitted, pinned, deck, options, identity, commanderNames, legalMain, estimate };
      }),
    )
    .task(Task.Spellbook, [Task.Start], ({ [Task.Start]: start }) =>
      inStep(job, Step.Combos, async (s) => {
        const [combos, estBefore] = await Promise.all([
          findCombos(start.commanderNames, start.legalMain(start.deck), start.identity).catch(
            (e) => {
              warn(Step.Combos, `Commander Spellbook lookup failed: ${e}`);
              return { present: [], oneAway: [] };
            },
          ),
          isCommander ? start.estimate(Step.Combos, start.deck) : null,
        ]);
        s.detail = `${combos.present.length} combos in deck, ${combos.oneAway.length} one card away`;
        return { combos, estBefore };
      }),
    )
    .task(Task.Baseline, [Task.Start, Task.Spellbook], (done) =>
      inStep(job, Step.Mana, async (s) => {
        const { deck, options } = done[Task.Start];
        const { estBefore } = done[Task.Spellbook];
        const before = snapshot(deck, null, isCommander, twoCardCombos(estBefore));
        const current = assessBracket(deck, estBefore, before.sim, null);
        const target = options.bracket ?? current.bracket;
        s.detail = `${before.mana.landCount} lands · currently bracket ${current.bracket} (${BRACKETS[current.bracket].name})`;
        return {
          before,
          target,
          rules: BRACKETS[target],
          assessBefore: assessBracket(deck, estBefore, before.sim, target),
        };
      }),
    )
    .task(Task.Edhrec, [Task.Start, Task.Baseline], (done) =>
      inStep(job, Step.Edhrec, async (s) => {
        const { commanderNames } = done[Task.Start];
        if (!isCommander || !commanderNames.length) {
          s.status = "skipped";
          return { edhAll: null, edhBracket: null };
        }
        const [edhAll, edhBracket] = await Promise.all([
          getCommanderData(commanderNames).catch((e) => {
            warn(Step.Edhrec, `EDHREC lookup failed: ${e}`);
            return null;
          }),
          getCommanderData(commanderNames, BRACKET_PAGE[done[Task.Baseline].target]).catch(
            () => null,
          ),
        ]);
        s.detail = edhAll
          ? `${edhAll.numDecks ?? "?"} decks overall, ${edhBracket?.numDecks ?? 0} at bracket ${done[Task.Baseline].target}`
          : "commander not found";
        return { edhAll, edhBracket };
      }),
    )
    .task(Task.BaselineMana, [Task.Start, Task.Baseline, Task.Edhrec], (done) => ({
      ...done[Task.Baseline].before,
      mana: analyzeMana(done[Task.Start].deck, done[Task.Edhrec].edhAll?.avgLands ?? null),
    }))
    .task(Task.Research, [Task.Start], ({ [Task.Start]: start }) =>
      inStep(job, Step.Research, async (s) => {
        if (
          !start.options.webResearch ||
          !llmEnabled() ||
          !config.llm.webSearch ||
          !start.commanderNames.length
        ) {
          s.status = "skipped";
          s.detail = !config.llm.webSearch
            ? "web search disabled (LLM_WEB_SEARCH=false)"
            : undefined;
          return null;
        }
        const r = await researchCommander(start.commanderNames).catch((e) => {
          warn(Step.Research, `Web research failed: ${e}`);
          return null;
        });
        s.detail = r
          ? `${r.sources.length} sources, ${r.cardsMentioned.length} cards mentioned`
          : "failed";
        return r;
      }),
    )
    .task(Task.LandPool, [Task.Start], ({ [Task.Start]: start }) =>
      isCommander ? landCandidates(start.identity, start.options.budgetPerCard) : [],
    )
    .task(Task.GameChangers, [Task.Start, Task.Baseline], (done) => {
      const { identity, options } = done[Task.Start];
      return wantsGameChangers(done[Task.Baseline].target, options.tone ?? "max")
        ? searchCards(`is:gamechanger id<=${identity.join("") || "c"} legal:commander`)
        : [];
    })
    .task(Task.KnownUpgrades, [Task.Start, Task.Spellbook, Task.Edhrec], async (done) => {
      begin(job, Step.Upgrades);
      const { deck, identity, options } = done[Task.Start];
      const { edhAll, edhBracket } = done[Task.Edhrec];
      const pool = upgradePool(deck, [
        ...edhrecSuggestions(edhBracket, edhAll),
        ...done[Task.Spellbook].combos.oneAway
          .slice(0, 40)
          .map((c): [string, string] => [c.missing[0], "combo"]),
      ]);
      const cards = await lookupExact([...pool.keys()].slice(0, CANDIDATE_LOOKUPS));
      const eligible = eligibleCandidates([...cards.values()], deck, identity, options);
      return {
        pool,
        cards,
        flags: await classify(done[Task.Start], eligible.slice(0, CANDIDATE_CLASSIFIED)),
      };
    })
    .task(
      Task.Upgrades,
      [
        Task.Start,
        Task.Spellbook,
        Task.Baseline,
        Task.Edhrec,
        Task.Research,
        Task.GameChangers,
        Task.KnownUpgrades,
      ],
      (done) =>
        inStep(job, Step.Upgrades, async (s) => {
          const start = done[Task.Start];
          const { deck, identity, options } = start;
          const { combos, estBefore } = done[Task.Spellbook];
          const { before, target, rules } = done[Task.Baseline];
          const known = done[Task.KnownUpgrades];
          // Web research and Game Changers come after EDHREC and combos, as they always did.
          const pool = upgradePool(
            deck,
            [
              ...(done[Task.Research]?.cardsMentioned ?? []).map((n): [string, string] => [
                n,
                "web-research",
              ]),
              ...done[Task.GameChangers].map((c): [string, string] => [c.name, "game-changer"]),
            ],
            known.pool,
          );
          const more = [...pool.keys()]
            .slice(0, CANDIDATE_LOOKUPS)
            .filter((n) => !known.pool.has(n));
          const cards = new Map([...known.cards, ...(more.length ? await lookupExact(more) : [])]);
          const candidates = eligibleCandidates([...cards.values()], deck, identity, options);
          const unclassified = candidates
            .slice(0, CANDIDATE_CLASSIFIED)
            .filter((c) => !known.flags.has(c.name));
          const flags = new Map([...known.flags, ...(await classify(start, unclassified))]);
          const ctx = buildSolverContext({
            deck,
            identity,
            target,
            options,
            edhAll: done[Task.Edhrec].edhAll,
            edhBracket: done[Task.Edhrec].edhBracket,
            combosPresent: combos.present,
            oneAway: combos.oneAway,
            candidates,
            sources: pool,
            spellbookFlags: flags,
            flagsFor: (c) => flagsFor(c, estBefore),
          });
          // Combos that already break the target bracket must lose a piece.
          const locked = new Set([...options.locked, ...start.commanderNames]);
          const forcedCombo = (estBefore?.combos ?? [])
            .filter((c) => c.relevant)
            .filter((c) => {
              const sim = before.sim.combos?.find((x) => x.cards.join("|") === c.cards.join("|"));
              return comboViolates(c, target, sim?.byTurn[Math.min(8, rules.minTurns - 1)] ?? null);
            })
            .flatMap((c) => {
              const piece = ctx.scored
                .filter((x) => c.cards.includes(x.card.name) && !locked.has(x.card.name))
                .sort((a, b) => a.score - b.score)[0];
              return piece
                ? [
                    {
                      card: piece.card,
                      reason: `half of ${c.cards.join(" + ")}, a combo bracket ${target} doesn't allow`,
                    },
                  ]
                : [];
            });
          const solver = solve(ctx, options, before.roles, forcedCombo);
          s.detail = `${solver.swaps.length} upgrades from ${ctx.candidates.length} candidates`;
          return { ctx, solver };
        }),
    )
    .task(
      Task.Review,
      [
        Task.Start,
        Task.Spellbook,
        Task.Baseline,
        Task.BaselineMana,
        Task.Edhrec,
        Task.Research,
        Task.Upgrades,
      ],
      (done) =>
        inStep(job, Step.Review, async (s) => {
          const { deck, identity, options } = done[Task.Start];
          const { combos } = done[Task.Spellbook];
          const { ctx, solver } = done[Task.Upgrades];
          const input = {
            deck,
            identity,
            scored: ctx.scored,
            candidates: ctx.candidates,
            solver,
            target: done[Task.Baseline].target,
            rules: done[Task.Baseline].rules,
            combosPresent: combos.present,
            oneAway: combos.oneAway,
            mana: done[Task.BaselineMana].mana,
            roles: done[Task.Baseline].before.roles,
            research: done[Task.Research],
            edhrecThemes: done[Task.Edhrec].edhAll?.themes ?? [],
            options,
          };
          let plan: Plan;
          let model: string | null = null;
          if (llmEnabled()) {
            try {
              plan = await planWithLlm(input);
              model = config.llm.model ?? null;
            } catch (e) {
              warn(Step.Review, `LLM review failed, using the solver's swaps: ${e}`);
              plan = planHeuristic(input);
            }
          } else {
            plan = planHeuristic(input);
            s.detail = "no LLM configured";
          }
          if (model) s.detail = `${plan.swaps.length} swaps kept (${model})`;
          return { plan, model };
        }),
    )
    .task(
      Task.Verified,
      [
        Task.Start,
        Task.Spellbook,
        Task.Baseline,
        Task.Edhrec,
        Task.LandPool,
        Task.Upgrades,
        Task.Review,
      ],
      (done) =>
        inStep(job, Step.Verify, (s) =>
          fixAndVerify(s, {
            start: done[Task.Start],
            combos: done[Task.Spellbook].combos,
            baseline: done[Task.Baseline],
            avgLands: done[Task.Edhrec].edhAll?.avgLands ?? null,
            landPool: done[Task.LandPool],
            upgrades: done[Task.Upgrades],
            plan: done[Task.Review].plan,
            isCommander,
            pinned: Boolean(done[Task.Start].pinned),
            warn: (m) => warn(Step.Verify, m),
          }),
        ),
    )
    .task(Task.SubmittedChecks, [Task.Start], async ({ [Task.Start]: start }) => {
      if (!start.pinned) return null;
      const d = start.submitted;
      const [est, found] = await Promise.all([
        isCommander ? start.estimate(Step.Guides, d) : null,
        findCombos(start.commanderNames, start.legalMain(d), start.identity).catch(() => null),
      ]);
      return { est, found };
    })
    .task(Task.Synergies, [Task.Verified], ({ [Task.Verified]: verified }) =>
      inStep(job, Step.Synergies, async (s) => {
        if (!llmEnabled() || !isCommander) {
          s.status = "skipped";
          return undefined;
        }
        const found = await findSynergies(verified.finalDeck, verified.finalCombos.present).catch(
          (e) => {
            warn(Step.Synergies, `Synergy search failed: ${e}`);
            return undefined;
          },
        );
        s.detail = found ? `${found.length} found` : "failed";
        return found;
      }),
    )
    .task(
      Task.Draft,
      [
        Task.Start,
        Task.Spellbook,
        Task.Baseline,
        Task.BaselineMana,
        Task.Edhrec,
        Task.Research,
        Task.Upgrades,
        Task.Review,
        Task.Verified,
        Task.SubmittedChecks,
        Task.Synergies,
      ],
      (done) =>
        inStep(job, Step.Guides, async (s) => {
          const { submitted, pinned, deck, commanderNames } = done[Task.Start];
          const { combos } = done[Task.Spellbook];
          const { target, rules, assessBefore } = done[Task.Baseline];
          const { edhAll, edhBracket } = done[Task.Edhrec];
          const { solver } = done[Task.Upgrades];
          const { plan, model } = done[Task.Review];
          const { finalDeck, swaps, after, assessAfter, finalCombos, manaSuggestions } =
            done[Task.Verified];
          const avgLands = edhAll?.avgLands ?? null;
          const bracket: BracketReport | undefined = isCommander
            ? {
                target,
                name: rules.name,
                minTurns: rules.minTurns,
                tone: settings.tone,
                before: assessBefore,
                after: assessAfter,
                gameChangerLimit: rules.gameChangers === Infinity ? null : rules.gameChangers,
                gameChangerOptions: solver.gameChangerOptions.map((g) => ({
                  ...g,
                  inDeck: finalDeck.slots.some((x) => x.card.name === g.name),
                })),
                excluded: solver.excluded,
              }
            : undefined;
          // The report compares against the list as submitted, even when the run started from edits.
          const checks = done[Task.SubmittedChecks];
          const baseline =
            checks &&
            submittedBaseline(submitted, checks, { avgLands, isCommander, target }, finalCombos);
          if (bracket && baseline) bracket.before = baseline.assessed;
          const report: Report = {
            slug: job.slug,
            commanders: commanderNames,
            commanderCards: deck.commanders,
            generatedAt: new Date().toISOString(),
            model,
            strategy: plan.strategy,
            themes: plan.themes,
            swaps: pinned ? reconcileSwaps(swaps, submitted, finalDeck, pinned.chatEdits) : swaps,
            before: baseline?.snapshot ?? done[Task.BaselineMana],
            after,
            combosPresent: finalCombos.present,
            combosOneAway: finalCombos.oneAway.slice(0, 20),
            research: done[Task.Research],
            edhrec: edhAll
              ? {
                  url: edhBracket?.url ?? edhAll.url,
                  numDecks: edhAll.numDecks,
                  avgLands: edhAll.avgLands,
                }
              : null,
            warnings: warnings(),
            options: settings,
            bracket,
            decklist: toDecklist(finalDeck, submitted),
            original: {
              decklist: toDecklist(submitted, submitted),
              combosPresent: (baseline?.combos ?? combos).present,
              combosOneAway: (baseline?.combos ?? combos).oneAway.slice(0, 20),
            },
            manaSuggestions,
            synergies: done[Task.Synergies],
            ...(pinned?.edits.length ? { edits: pinned.edits } : {}),
          };
          if (!llmEnabled() || !isCommander) {
            s.status = "skipped";
            return report;
          }
          const howToPlay = await writeGuides(report, {
            original: submitted,
            optimized: finalDeck,
          });
          s.detail = howToPlay ? "written" : "failed";
          return howToPlay ? { ...report, howToPlay } : report;
        }),
    )
    .task(Task.Checked, [Task.Draft], ({ [Task.Draft]: draft }) =>
      inStep(job, Step.Contradictions, async (s) => {
        if (!llmEnabled()) {
          s.status = "skipped";
          return draft;
        }
        const checked = await checkContradictions(draft).catch((e) => {
          warn(Step.Contradictions, `Contradiction check failed: ${e}`);
          return null;
        });
        s.detail = checked
          ? checked.fixes.length
            ? `${checked.fixes.length} fixed`
            : "none found"
          : "failed";
        // Its own warning, if any, joins the others.
        return { ...(checked?.report ?? draft), warnings: warnings() };
      }),
    )
    .task(Task.Saved, [Task.Start, Task.Upgrades, Task.Verified, Task.Checked], (done) =>
      inStep(job, Step.Save, async () => {
        const { submitted, deck, commanderNames } = done[Task.Start];
        const { finalDeck } = done[Task.Verified];
        const report = done[Task.Checked];
        report.cardIndex = await buildCardIndex(report, [
          ...submitted.slots.map((x) => x.card),
          ...deck.slots.map((x) => x.card),
          ...finalDeck.slots.map((x) => x.card),
          ...done[Task.Upgrades].ctx.candidates.map((c) => c.card),
        ]);
        await writeResults(job.slug, report, {
          commanders: commanderNames,
          entries: toEntries(finalDeck),
        });
        // A run works out everything afresh, so edits still waiting for a refresh are covered.
        cancelDebounced(job.slug);
        await clearPendingRefresh(job.slug);
      }),
    );
  try {
    await graph.all();
    job.status = "done";
  } finally {
    // Saved as it went, done or not, so it can be replayed.
    await writeRun(job.slug, {
      startedAt: tracer.startedAt,
      status: job.status === "done" ? "done" : "error",
      trace: tracer.snapshot(),
    }).catch((err) => console.error(`[job ${job.id}] couldn't save the run`, err));
    tracer.touch();
  }
}

type Start = {
  submitted: Deck;
  pinned: Awaited<ReturnType<typeof pinnedStart>>;
  deck: Deck;
  options: OptimizeOptions;
  identity: Color[];
  commanderNames: string[];
  legalMain: (d: Deck) => string[];
  estimate: (at: Step, d: Deck) => Promise<BracketEstimate | null>;
};

/** Commander Spellbook's flags for upgrade candidates, by name (none if it can't be reached). */
async function classify(start: Start, cards: Card[]) {
  if (!cards.length) return new Map<string, CardFlags>();
  return estimateBracket(
    start.commanderNames,
    cards.map((c) => c.name),
  ).then(
    (est) => est.cards,
    () => new Map<string, CardFlags>(),
  );
}

/** The deck as submitted, for a run that started from the user's edits: its stats, bracket, combos. */
function submittedBaseline(
  d: Deck,
  checks: { est: BracketEstimate | null; found: { present: Combo[]; oneAway: Combo[] } | null },
  context: { avgLands: number | null; isCommander: boolean; target: number },
  fallback: { present: Combo[]; oneAway: Combo[] },
) {
  const snap = snapshot(d, context.avgLands, context.isCommander, twoCardCombos(checks.est));
  return {
    snapshot: snap,
    assessed: assessBracket(d, checks.est, snap.sim, context.target),
    combos: checks.found ?? fallbackCombos(fallback, d, []),
  };
}

/**
 * Makes the reviewed plan's swaps, fixes the land count and mana base, keeps the deck within budget,
 * and checks the result with Commander Spellbook, undoing swaps that made a combo the bracket
 * doesn't allow.
 */
async function fixAndVerify(
  s: JobStep,
  opts: {
    start: Start;
    combos: { present: Combo[]; oneAway: Combo[] };
    baseline: { before: DeckSnapshot; target: number; rules: (typeof BRACKETS)[number] };
    avgLands: number | null;
    landPool: Card[];
    upgrades: { ctx: SolverContext; solver: SolverResult };
    plan: Plan;
    isCommander: boolean;
    pinned: boolean;
    warn: (message: string) => void;
  },
) {
  const { start, combos, avgLands, landPool, plan, isCommander, pinned, warn } = opts;
  const { deck, options, identity, commanderNames, legalMain, estimate } = start;
  const { before, target, rules } = opts.baseline;
  const { ctx, solver } = opts.upgrades;

  const alternatives = new Map(solver.swaps.map((p) => [p.out.name, [p.in, ...p.alternatives]]));
  // Required bracket/budget fixes may exceed maxSwaps; never let the cap drop them.
  const swapLimit = Math.max(options.maxSwaps, solver.swaps.length);
  const applied = await applyPlan(
    deck,
    plan,
    identity,
    ctx.candidates,
    { ...options, maxSwaps: swapLimit },
    ctx.violation,
    alternatives,
  );
  for (const m of applied.warnings) warn(m);
  const locked = new Set([...options.locked, ...commanderNames]);
  const landFix = isCommander
    ? await fixLandCount(
        applied.deck,
        identity,
        ctx.scored,
        ctx.candidates,
        avgLands,
        locked,
        new Set(applied.swaps.map((x) => x.in)),
        // Lands the user's own edits cut are repairs, not suggestions, so the cap doesn't apply.
        pinned ? LAND_REPAIRS : options.maxSwaps - applied.swaps.length,
        ctx.violation,
      )
    : { deck: applied.deck, swaps: [] };
  const rebalanced = isCommander
    ? await rebalanceBasics(landFix.deck, identity, avgLands, locked)
    : { deck: landFix.deck, swaps: [] };
  // Replace tapped/colorless lands and fix color shortfalls with better lands, then keep a few
  // more improvements as suggestions the user can apply.
  const lands = isCommander ? [...ctx.candidates.map((c) => c.card), ...landPool] : [];
  const value = new Map([...ctx.scored, ...ctx.candidates].map((c) => [c.card.name, c.score]));
  const manaFixed = isCommander
    ? planManaFixes({
        deck: rebalanced.deck,
        identity,
        avgLands: avgLands,
        candidates: lands,
        value,
        violation: ctx.violation,
        locked,
        max: MANA_FIXES,
      })
    : { deck: rebalanced.deck, fixes: [] };
  const manaSuggestions = isCommander
    ? planManaFixes({
        deck: manaFixed.deck,
        identity,
        avgLands: avgLands,
        candidates: lands,
        value,
        violation: ctx.violation,
        locked,
        max: 3,
      }).fixes.map(toSuggestion)
    : [];
  let finalDeck = manaFixed.deck;
  let swaps: Swap[] = mergeSwaps([
    ...applied.swaps,
    ...landFix.swaps,
    ...rebalanced.swaps,
    ...manaFixed.fixes.map((f) => ({
      out: f.out.name,
      in: f.in.name,
      category: "mana" as const,
      reason: f.reason,
      outCard: f.out,
      inCard: f.in,
    })),
  ]);

  // The LLM may drop the solver's budget trims; enforce the cap on the final list.
  if (options.budgetTotal !== null && totalPrice(finalDeck) > options.budgetTotal) {
    const trims = trimToBudget(
      ctx,
      finalDeck,
      locked,
      before.roles,
      new Set(swaps.map((x) => x.in)),
    );
    swaps = mergeSwaps([
      ...swaps,
      ...trims.map((t) => ({
        out: t.out.name,
        in: t.in.name,
        category: "other" as const,
        reason: `${ref(t.out.name)} is ${t.forced}; ${ref(t.in.name)} is the best cheaper replacement.`,
        outCard: t.out,
        inCard: t.in,
      })),
    ]);
    if (totalPrice(finalDeck) > options.budgetTotal) {
      warn(
        `Couldn't get under the $${options.budgetTotal} budget (deck is $${totalPrice(finalDeck)}); locked or irreplaceable cards are too expensive.`,
      );
    }
  }

  // Verify with Commander Spellbook; undo swaps that introduced a combo the bracket forbids.
  // The bracket estimate and combo search of the final deck run together; the combos are searched
  // again only if a swap has to be undone.
  const combosOf = (d: Deck) =>
    findCombos(commanderNames, legalMain(d), identity).catch(() => null);
  let found = isCommander ? combosOf(finalDeck) : Promise.resolve(null);
  let estAfter = isCommander ? await estimate(Step.Verify, finalDeck) : null;
  let after = snapshot(finalDeck, avgLands, isCommander, twoCardCombos(estAfter));
  let assessAfter = assessBracket(finalDeck, estAfter, after.sim, target);
  for (let i = 0; i < 3 && isCommander && assessAfter.bracket > target; i++) {
    const added = new Set(swaps.map((x) => x.in));
    const offending = (estAfter?.combos ?? []).filter((c) => {
      const sim = after.sim.combos?.find((x) => x.cards.join("|") === c.cards.join("|"));
      return (
        c.relevant && comboViolates(c, target, sim?.byTurn[Math.min(8, rules.minTurns - 1)] ?? null)
      );
    });
    const revert = swaps.filter(
      (x) => offending.some((c) => c.cards.includes(x.in)) && added.has(x.in),
    );
    if (!revert.length) break;
    for (const r of revert) {
      const slot = finalDeck.slots.find((x) => x.card.name === r.in);
      if (!slot || !r.outCard) continue;
      slot.qty--;
      if (slot.qty === 0) finalDeck.slots.splice(finalDeck.slots.indexOf(slot), 1);
      finalDeck.slots.push({ card: r.outCard, qty: 1 });
      warn(`Reverted ${r.out} → ${r.in}: it created a combo bracket ${target} doesn't allow.`);
    }
    swaps = swaps.filter((x) => !revert.includes(x));
    found = combosOf(finalDeck);
    estAfter = await estimate(Step.Verify, finalDeck);
    after = snapshot(finalDeck, avgLands, isCommander, twoCardCombos(estAfter));
    assessAfter = assessBracket(finalDeck, estAfter, after.sim, target);
  }
  if (isCommander && assessAfter.bracket > target) {
    warn(`The deck still reads as bracket ${assessAfter.bracket}; see the bracket checks.`);
  }
  s.detail = `${swaps.length} swaps · bracket ${assessAfter.bracket} verified`;
  // Combos shown in the report must match the final deck, not the starting one.
  const finalCombos = isCommander
    ? ((await found) ?? fallbackCombos(combos, finalDeck, assessAfter.combos))
    : combos;
  return {
    finalDeck,
    swaps: dropOwnedAlternatives(swaps, finalDeck),
    after,
    assessAfter,
    finalCombos,
    manaSuggestions,
  };
}
