import { randomUUID } from "node:crypto";
import type { Card, DeckSnapshot, Job, JobStep, Report, Research } from "../shared/types.ts";
import { findAddCandidates, scoreDeckCards } from "./analysis/candidates.ts";
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
import { simulate } from "./analysis/simulate.ts";
import { config, llmEnabled } from "./config.ts";
import { parseDecklist } from "./decklist.ts";
import { renderMarkdown } from "./report.ts";
import { type EdhrecData, getCommanderData } from "./sources/edhrec.ts";
import { researchCommander } from "./sources/research.ts";
import { lookupExact, lookupFuzzy } from "./sources/scryfall.ts";
import { findCombos } from "./sources/spellbook.ts";
import { readInitial, readMeta, writeResults } from "./storage.ts";

const jobs = new Map<string, Job>();

export const getJob = (id: string) => jobs.get(id);

const STEPS = [
  "Load card data",
  "Fetch EDHREC recommendations",
  "Find combos (Commander Spellbook)",
  "Web research",
  "Analyze mana base & simulate",
  "Choose swaps",
  "Optimize mana base & re-simulate",
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

function snapshot(deck: Deck, edhrecAvgLands: number | null, isCommander: boolean): DeckSnapshot {
  return {
    mana: analyzeMana(deck, edhrecAvgLands),
    sim: simulate(deck),
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
  const options = meta.options;
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

  const edhrec: EdhrecData | null = await step(job, 1, async (s) => {
    if (!isCommander || !commanderNames.length) {
      s.status = "skipped";
      return null;
    }
    const data = await getCommanderData(commanderNames).catch((e) => {
      warnings.push(`EDHREC lookup failed: ${e}`);
      return null;
    });
    s.detail = data
      ? `${data.cards.size} cards from ${data.numDecks ?? "?"} decks`
      : "commander not found";
    return data;
  });

  const combos = await step(job, 2, async (s) => {
    const legalMain = deck.slots.filter((x) =>
      x.card.colorIdentity.every((c) => identity.includes(c)),
    );
    const result = await findCombos(
      commanderNames,
      legalMain.map((x) => x.card.name),
      identity,
    ).catch((e) => {
      warnings.push(`Commander Spellbook lookup failed: ${e}`);
      return { present: [], oneAway: [] };
    });
    s.detail = `${result.present.length} in deck, ${result.oneAway.length} one card away`;
    return result;
  });

  const research: Research | null = await step(job, 3, async (s) => {
    if (
      !options.webResearch ||
      !llmEnabled() ||
      !config.llm.searchModel ||
      !commanderNames.length
    ) {
      s.status = "skipped";
      s.detail = !config.llm.searchModel ? "LLM_SEARCH_MODEL not set" : undefined;
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

  const before = await step(job, 4, async (s) => {
    const snap = snapshot(deck, edhrec?.avgLands ?? null, isCommander);
    s.detail = `${snap.mana.landCount} lands, ${snap.mana.issues.length} issues`;
    return snap;
  });

  const { plan, candidates, scored, model } = await step(job, 5, async (s) => {
    const scored = scoreDeckCards(deck, identity, edhrec, combos.present, before.roles);
    const candidates = await findAddCandidates({
      deck,
      identity,
      edhrec,
      oneAway: combos.oneAway,
      researchCards: research?.cardsMentioned ?? [],
      roles: before.roles,
      budgetPerCard: options.budgetPerCard,
    });
    const input = {
      deck,
      identity,
      scored,
      candidates,
      combosPresent: combos.present,
      oneAway: combos.oneAway,
      mana: before.mana,
      roles: before.roles,
      research,
      edhrecThemes: edhrec?.themes ?? [],
      options,
    };
    let plan: Plan;
    let model: string | null = null;
    if (llmEnabled()) {
      try {
        plan = await planWithLlm(input);
        model = config.llm.model;
      } catch (e) {
        warnings.push(`LLM planning failed, fell back to data-only swaps: ${e}`);
        plan = planHeuristic(input);
      }
    } else {
      plan = planHeuristic(input);
    }
    s.detail = `${plan.swaps.length} proposed from ${candidates.length} candidates${model ? ` (${model})` : ""}`;
    return { plan, candidates, scored, model };
  });

  const { finalDeck, swaps } = await step(job, 6, async (s) => {
    const applied = await applyPlan(deck, plan, identity, candidates, options);
    warnings.push(...applied.warnings);
    const locked = new Set([...options.locked, ...commanderNames]);
    const landFix = isCommander
      ? await fixLandCount(
          applied.deck,
          identity,
          scored,
          candidates,
          edhrec?.avgLands ?? null,
          locked,
          new Set(applied.swaps.map((x) => x.in)),
          options.maxSwaps - applied.swaps.length,
        )
      : { deck: applied.deck, swaps: [] };
    const rebalanced = isCommander
      ? await rebalanceBasics(landFix.deck, identity, edhrec?.avgLands ?? null, locked)
      : { deck: landFix.deck, swaps: [] };
    const swaps = mergeSwaps([...applied.swaps, ...landFix.swaps, ...rebalanced.swaps]);
    s.detail = `${applied.swaps.length} swaps applied, ${landFix.swaps.length + rebalanced.swaps.length} mana base fixes`;
    return { finalDeck: rebalanced.deck, swaps };
  });
  const after = snapshot(finalDeck, edhrec?.avgLands ?? null, isCommander);

  await step(job, 7, async () => {
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
      edhrec: edhrec
        ? { url: edhrec.url, numDecks: edhrec.numDecks, avgLands: edhrec.avgLands }
        : null,
      warnings,
      options,
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
