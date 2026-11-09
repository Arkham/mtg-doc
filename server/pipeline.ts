import { randomUUID } from "node:crypto";
import type {
  BracketReport,
  Card,
  DeckSnapshot,
  Job,
  JobStep,
  OptimizeOptions,
  Report,
  Research,
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
import { buildSolverContext, solve, trimToBudget } from "./analysis/search.ts";
import { simulate } from "./analysis/simulate.ts";
import { config, llmEnabled } from "./config.ts";
import { parseDecklist } from "./decklist.ts";
import { renderMarkdown } from "./report.ts";
import { BRACKET_PAGE, getCommanderData } from "./sources/edhrec.ts";
import { researchCommander } from "./sources/research.ts";
import { lookupExact, lookupFuzzy } from "./sources/scryfall.ts";
import { type BracketEstimate, estimateBracket, findCombos } from "./sources/spellbook.ts";
import { readInitial, readMeta, writeResults } from "./storage.ts";

const jobs = new Map<string, Job>();

export const getJob = (id: string) => jobs.get(id);

const STEPS = [
  "Load card data",
  "Find combos & check bracket",
  "Analyze mana base & simulate",
  "Fetch EDHREC recommendations",
  "Web research",
  "Search for upgrades",
  "Review swaps",
  "Fix mana base & verify bracket",
  "Write report",
] as const;

export function startOptimize(slug: string): Job {
  const job: Job = {
    id: randomUUID(),
    slug,
    status: "running",
    steps: STEPS.map((label) => ({ label, status: "pending" })),
  };
  jobs.set(job.id, job);
  run(job).catch((err) => {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    const running = job.steps.find((s) => s.status === "running");
    if (running) running.status = "error";
    console.error(`[job ${job.id}]`, err);
  });
  return job;
}

async function step<T>(job: Job, index: number, fn: (s: JobStep) => Promise<T>): Promise<T> {
  const s = job.steps[index];
  s.status = "running";
  const result = await fn(s);
  if (s.status === "running") s.status = "done";
  return result;
}

const twoCardCombos = (est: BracketEstimate | null) =>
  (est?.combos ?? []).filter(isTwoCard).map((c) => c.cards);

function snapshot(
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

async function loadDeck(slug: string): Promise<{ deck: Deck; warnings: string[] }> {
  const parsed = parseDecklist(await readInitial(slug));
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

async function run(job: Job) {
  const meta = await readMeta(job.slug);
  const options: OptimizeOptions = {
    ...meta.options,
    tone: meta.options.tone ?? "max",
    budgetTotal: meta.options.budgetTotal ?? null,
  };
  const isCommander = meta.format === "commander";
  const warnings: string[] = [];

  const deck = await step(job, 0, async (s) => {
    const { deck, warnings: w } = await loadDeck(job.slug);
    warnings.push(...w);
    s.detail = `${totalCards(deck)} cards`;
    return deck;
  });
  const identity = identityOf(deck.commanders);
  const commanderNames = deck.commanders.map((c) => c.name);
  const legalMain = (d: Deck) =>
    d.slots
      .filter((x) => x.card.colorIdentity.every((c) => identity.includes(c)))
      .map((x) => x.card.name);
  const estimate = (d: Deck) =>
    estimateBracket(commanderNames, legalMain(d)).catch((e) => {
      warnings.push(`Commander Spellbook bracket check failed: ${e}`);
      return null;
    });

  const { combos, estBefore } = await step(job, 1, async (s) => {
    const [combos, estBefore] = await Promise.all([
      findCombos(commanderNames, legalMain(deck), identity).catch((e) => {
        warnings.push(`Commander Spellbook lookup failed: ${e}`);
        return { present: [], oneAway: [] };
      }),
      isCommander ? estimate(deck) : Promise.resolve(null),
    ]);
    s.detail = `${combos.present.length} combos in deck, ${combos.oneAway.length} one card away`;
    return { combos, estBefore };
  });

  const { before, assessBefore, target } = await step(job, 2, async (s) => {
    const before = snapshot(deck, null, isCommander, twoCardCombos(estBefore));
    const current = assessBracket(deck, estBefore, before.sim, null);
    const target = options.bracket ?? current.bracket;
    const assessBefore = assessBracket(deck, estBefore, before.sim, target);
    s.detail = `${before.mana.landCount} lands · currently bracket ${current.bracket} (${BRACKETS[current.bracket].name})`;
    return { before, assessBefore, target };
  });
  const rules = BRACKETS[target];

  const { edhAll, edhBracket } = await step(job, 3, async (s) => {
    if (!isCommander || !commanderNames.length) {
      s.status = "skipped";
      return { edhAll: null, edhBracket: null };
    }
    const fail = (e: unknown) => {
      warnings.push(`EDHREC lookup failed: ${e}`);
      return null;
    };
    const [edhAll, edhBracket] = await Promise.all([
      getCommanderData(commanderNames).catch(fail),
      getCommanderData(commanderNames, BRACKET_PAGE[target]).catch(() => null),
    ]);
    s.detail = edhAll
      ? `${edhAll.numDecks ?? "?"} decks overall, ${edhBracket?.numDecks ?? 0} at bracket ${target}`
      : "commander not found";
    return { edhAll, edhBracket };
  });
  // Recompute the mana baseline now that EDHREC's average land count is known.
  before.mana = analyzeMana(deck, edhAll?.avgLands ?? null);

  const research: Research | null = await step(job, 4, async (s) => {
    if (
      !options.webResearch ||
      !llmEnabled() ||
      !config.llm.webSearch ||
      !commanderNames.length
    ) {
      s.status = "skipped";
      s.detail = !config.llm.webSearch ? "web search disabled (LLM_WEB_SEARCH=false)" : undefined;
      return null;
    }
    const r = await researchCommander(commanderNames).catch((e) => {
      warnings.push(`Web research failed: ${e}`);
      return null;
    });
    s.detail = r
      ? `${r.sources.length} sources, ${r.cardsMentioned.length} cards mentioned`
      : "failed";
    return r;
  });

  const { ctx, solver } = await step(job, 5, async (s) => {
    const ctx = await buildSolverContext({
      deck,
      identity,
      target,
      options,
      edhAll,
      edhBracket,
      combosPresent: combos.present,
      oneAway: combos.oneAway,
      researchCards: research?.cardsMentioned ?? [],
      flagsFor: (c) => flagsFor(c, estBefore),
      classifyNames: async (names) =>
        (await estimateBracket(commanderNames, names.slice(0, 250))).cards,
    });
    // Combos that already break the target bracket must lose a piece.
    const locked = new Set([...options.locked, ...commanderNames]);
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
  });

  const { plan, model } = await step(job, 6, async (s) => {
    const input = {
      deck,
      identity,
      scored: ctx.scored,
      candidates: ctx.candidates,
      solver,
      target,
      rules,
      combosPresent: combos.present,
      oneAway: combos.oneAway,
      mana: before.mana,
      roles: before.roles,
      research,
      edhrecThemes: edhAll?.themes ?? [],
      options,
    };
    let plan: Plan;
    let model: string | null = null;
    if (llmEnabled()) {
      try {
        plan = await planWithLlm(input);
        model = config.llm.model;
      } catch (e) {
        warnings.push(`LLM review failed, using the solver's swaps: ${e}`);
        plan = planHeuristic(input);
      }
    } else {
      plan = planHeuristic(input);
      s.detail = "no LLM configured";
    }
    if (model) s.detail = `${plan.swaps.length} swaps kept (${model})`;
    return { plan, model };
  });

  const { finalDeck, swaps, after, assessAfter } = await step(job, 7, async (s) => {
    const alternatives = new Map(solver.swaps.map((p) => [p.out.name, [p.in, ...p.alternatives]]));
    const applied = await applyPlan(
      deck,
      plan,
      identity,
      ctx.candidates,
      options,
      ctx.violation,
      alternatives,
    );
    warnings.push(...applied.warnings);
    const locked = new Set([...options.locked, ...commanderNames]);
    const landFix = isCommander
      ? await fixLandCount(
          applied.deck,
          identity,
          ctx.scored,
          ctx.candidates,
          edhAll?.avgLands ?? null,
          locked,
          new Set(applied.swaps.map((x) => x.in)),
          options.maxSwaps - applied.swaps.length,
          ctx.violation,
        )
      : { deck: applied.deck, swaps: [] };
    const rebalanced = isCommander
      ? await rebalanceBasics(landFix.deck, identity, edhAll?.avgLands ?? null, locked)
      : { deck: landFix.deck, swaps: [] };
    let finalDeck = rebalanced.deck;
    let swaps: Swap[] = mergeSwaps([...applied.swaps, ...landFix.swaps, ...rebalanced.swaps]);

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
          reason: `${t.out.name} is ${t.forced}; ${t.in.name} is the best cheaper replacement.`,
          outCard: t.out,
          inCard: t.in,
        })),
      ]);
      if (totalPrice(finalDeck) > options.budgetTotal) {
        warnings.push(
          `Couldn't get under the $${options.budgetTotal} budget (deck is $${totalPrice(finalDeck)}); locked or irreplaceable cards are too expensive.`,
        );
      }
    }

    // Verify with Commander Spellbook; undo swaps that introduced a combo the bracket forbids.
    let estAfter = isCommander ? await estimate(finalDeck) : null;
    let after = snapshot(finalDeck, edhAll?.avgLands ?? null, isCommander, twoCardCombos(estAfter));
    let assessAfter = assessBracket(finalDeck, estAfter, after.sim, target);
    for (let i = 0; i < 3 && isCommander && assessAfter.bracket > target; i++) {
      const added = new Set(swaps.map((x) => x.in));
      const offending = (estAfter?.combos ?? []).filter((c) => {
        const sim = after.sim.combos?.find((x) => x.cards.join("|") === c.cards.join("|"));
        return (
          c.relevant &&
          comboViolates(c, target, sim?.byTurn[Math.min(8, rules.minTurns - 1)] ?? null)
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
        warnings.push(
          `Reverted ${r.out} → ${r.in}: it created a combo bracket ${target} doesn't allow.`,
        );
      }
      swaps = swaps.filter((x) => !revert.includes(x));
      estAfter = await estimate(finalDeck);
      after = snapshot(finalDeck, edhAll?.avgLands ?? null, isCommander, twoCardCombos(estAfter));
      assessAfter = assessBracket(finalDeck, estAfter, after.sim, target);
    }
    if (isCommander && assessAfter.bracket > target) {
      warnings.push(
        `The deck still reads as bracket ${assessAfter.bracket}; see the bracket checks.`,
      );
    }
    s.detail = `${swaps.length} swaps · bracket ${assessAfter.bracket} verified`;
    return { finalDeck, swaps, after, assessAfter };
  });

  await step(job, 8, async () => {
    const bracket: BracketReport | undefined = isCommander
      ? {
          target,
          name: rules.name,
          minTurns: rules.minTurns,
          tone: options.tone,
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
    const report: Report = {
      slug: job.slug,
      commanders: commanderNames,
      commanderCards: deck.commanders,
      generatedAt: new Date().toISOString(),
      model,
      strategy: plan.strategy,
      themes: plan.themes,
      swaps,
      manaNotes: plan.manaNotes,
      before,
      after,
      combosPresent: combos.present,
      combosOneAway: combos.oneAway.slice(0, 20),
      research,
      edhrec: edhAll
        ? {
            url: edhBracket?.url ?? edhAll.url,
            numDecks: edhAll.numDecks,
            avgLands: edhAll.avgLands,
          }
        : null,
      warnings,
      options,
      bracket,
      decklist: toDecklist(finalDeck, deck),
    };
    await writeResults(
      job.slug,
      report,
      { commanders: commanderNames, entries: toEntries(finalDeck) },
      renderMarkdown(report),
    );
  });
  job.status = "done";
}
