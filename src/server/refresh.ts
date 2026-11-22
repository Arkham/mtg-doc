/**
 * The slower half of an edit. An edit updates the list and everything that follows from it at
 * once (see `applyDeckChanges`); what needs Commander Spellbook, Scryfall searches or the model
 * (bracket estimate, combos, land suggestions, synergies, guides, the contradiction check) waits
 * until the edits stop for a while, so a run of changes is worked out once, not once per change.
 */
import { randomUUID } from "node:crypto";
import type { ChatAnswer, DeckChange, DeckChanges, Report } from "../shared/types.ts";
import { BRACKETS, assessBracket, flagsFor } from "./analysis/bracket.ts";
import { type Deck, identityOf, toDecklist, toEntries } from "./analysis/deck.ts";
import {
  applicableManaSuggestions,
  fallbackCombos,
  refreshBracketLists,
} from "./analysis/reconcile.ts";
import { optimizationGaps, worsenedSince } from "./analysis/reoptimize.ts";
import { makeViolation } from "./analysis/search.ts";
import { buildCardIndex } from "./card-index.ts";
import { updateChat } from "./chat-history.ts";
import { config, llmEnabled } from "./config.ts";
import { checkContradictions } from "./contradictions.ts";
import { debounce, debouncedAt, debouncedRunning, enqueueEdit } from "./edit-queue.ts";
import { decide } from "./llm.ts";
import { suggestManaFixes } from "./mana-advice.ts";
import { loadDeck, snapshot, twoCardCombos } from "./pipeline.ts";
import { keepGuidesTo, writeGuides } from "./play-guide.ts";
import { type BracketEstimate, estimateBracket, findCombos } from "./sources/spellbook.ts";
import { findSynergies, keepPresentSynergies } from "./synergies.ts";
import {
  type PendingRefresh,
  clearPendingRefresh,
  decksWithPendingRefresh,
  readMeta,
  readPendingRefresh,
  readReport,
  reportSavedAt,
  writePendingRefresh,
  writeResults,
} from "./storage.ts";

/** What one edit leaves for the refresh. */
interface EditBatch {
  droppedSwaps: number;
  added: string[];
  original: boolean;
  changes: DeckChange[];
}

/**
 * Notes an edit for the next refresh and (re)starts the wait: each edit pushes the refresh back,
 * so it runs once the edits stop. `before` is the report as it was before this edit.
 */
export async function scheduleRefresh(slug: string, before: Report, batch: EditBatch) {
  const previous = await readPendingRefresh(slug);
  const delay = config.refreshDelayMs;
  const pending: PendingRefresh = {
    version: (previous?.version ?? 0) + 1,
    due: Date.now() + delay,
    // What the edits made worse counts from before the first of them.
    gaps: previous?.gaps ?? optimizationGaps(before),
    droppedSwaps: (previous?.droppedSwaps ?? 0) + batch.droppedSwaps,
    added: [...new Set([...(previous?.added ?? []), ...batch.added])],
    original: Boolean(previous?.original) || batch.original,
    changes: [
      ...(previous?.changes ?? []),
      ...batch.changes.map((c) => ({ action: c.action, name: c.name, qty: c.qty })),
    ],
  };
  await writePendingRefresh(slug, pending);
  debounce(slug, delay, () => refresh(slug));
}

/** Refreshes left waiting by a restart, at the time they were due (or now). */
export async function resumeRefreshes() {
  for (const slug of await decksWithPendingRefresh()) {
    const pending = await readPendingRefresh(slug);
    if (pending) debounce(slug, Math.max(0, pending.due - Date.now()), () => refresh(slug));
  }
}

/** Where a deck's refresh stands, for the UI: how long until it starts, or that it's running. */
export function refreshStatus(slug: string): DeckChanges {
  const at = debouncedAt(slug);
  if (at !== null) return { kind: "waiting", refreshInMs: Math.max(0, at - Date.now()) };
  return debouncedRunning(slug) ? { kind: "refreshing" } : { kind: "settled" };
}

/**
 * Works out what the pending edits changed and saves it. The work runs outside the deck's queue,
 * so edits made meanwhile don't wait; its results are saved only if none came in (the newer
 * edit's own refresh covers them) and nothing else rewrote the report.
 */
async function refresh(slug: string) {
  const pending = await readPendingRefresh(slug);
  if (!pending) return;
  // Read in the queue, so no edit is half-written.
  const state = await enqueueEdit(slug, "Read the deck", async () => ({
    meta: await readMeta(slug),
    report: await readReport(slug),
    deck: (await loadDeck(slug, "optimized.txt")).deck,
    submitted: (await loadDeck(slug, "initial.txt")).deck,
    savedAt: await reportSavedAt(slug),
  })).done;
  if (!state.report) return clearPendingRefresh(slug);
  const updated = await refreshed(state.report, state.deck, state.submitted, state.meta, pending);
  const saved = await enqueueEdit(slug, "Update the report", async () => {
    const now = await readPendingRefresh(slug);
    if (now?.version !== pending.version) return false;
    if ((await reportSavedAt(slug)) !== state.savedAt) {
      // Something other than an edit (a synergy search) saved the report: start over from it.
      debounce(slug, 0, () => refresh(slug));
      return false;
    }
    await writeResults(slug, updated, {
      commanders: state.deck.commanders.map((c) => c.name),
      entries: toEntries(state.deck),
    });
    await clearPendingRefresh(slug);
    return true;
  }).done;
  if (!saved) return;
  const reason = await reoptimizeReason(
    pending.gaps,
    updated,
    pending.droppedSwaps,
    pending.changes,
  );
  if (reason) await offerRerun(slug, reason);
}

/** The report with everything the edits changed worked out from the lists as they now are. */
async function refreshed(
  report: Report,
  next: Deck,
  initial: Deck,
  meta: Awaited<ReturnType<typeof readMeta>>,
  pending: PendingRefresh,
): Promise<Report> {
  const commanders = next.commanders.map((c) => c.name);
  const identity = identityOf(next.commanders);
  const legalMain = (d: Deck) =>
    d.slots
      .filter((s) => s.card.colorIdentity.every((c) => identity.includes(c)))
      .map((s) => s.card.name);
  const isCommander = meta.format === "commander";
  const avgLands = report.edhrec?.avgLands ?? null;
  const editedOriginal = pending.original;
  const [est, found, originalEst, originalFound] = await Promise.all([
    estimateBracket(commanders, legalMain(next)).catch(() => null),
    findCombos(commanders, legalMain(next), identity).catch(() => null),
    editedOriginal ? estimateBracket(commanders, legalMain(initial)).catch(() => null) : null,
    editedOriginal ? findCombos(commanders, legalMain(initial), identity).catch(() => null) : null,
  ]);
  const before = editedOriginal
    ? originalStats(report, initial, isCommander, originalEst, originalFound)
    : null;
  const after = snapshot(next, avgLands, isCommander, twoCardCombos(est));
  const assessed = report.bracket && assessBracket(next, est, after.sim, report.bracket.target);
  const combos =
    found ??
    fallbackCombos(
      { present: report.combosPresent, oneAway: report.combosOneAway },
      next,
      assessed?.combos,
    );
  const bracketTarget = report.bracket?.target ?? 4;
  const manaSuggestions = isCommander
    ? await suggestManaFixes({
        deck: next,
        identity,
        avgLands,
        budgetPerCard: meta.options.budgetPerCard ?? null,
        violation: makeViolation({
          rules: BRACKETS[bracketTarget],
          target: bracketTarget,
          flagOf: (c) => flagsFor(c, est),
          budgetTotal: meta.options.budgetTotal ?? null,
        }),
        locked: new Set([...meta.options.locked, ...commanders]),
      }).catch(() => applicableManaSuggestions(report.manaSuggestions, next) ?? [])
    : [];
  const present = keepPresentSynergies(report.synergies, next);
  const inDeck = new Set(next.slots.map((s) => s.card.name));
  const added = pending.added.filter((n) => inDeck.has(n));
  const newSynergies =
    llmEnabled() && added.length && present
      ? await findSynergies(next, combos.present, present, added).catch(() => [])
      : [];
  const bracket = report.bracket && {
    ...report.bracket,
    ...(before ? { before: before.bracket! } : {}),
    after: assessed!,
  };
  const draft: Report = {
    ...report,
    ...(before ? { before: before.snapshot, original: before.original } : {}),
    after,
    combosPresent: combos.present,
    combosOneAway: combos.oneAway.slice(0, 20),
    bracket: bracket && refreshBracketLists(bracket, next),
    manaSuggestions,
    synergies: present && [...present, ...newSynergies],
  };
  // The guides follow the lists they describe: an edit to the submitted list rebuilds both.
  draft.howToPlay = llmEnabled()
    ? await writeGuides(
        draft,
        { original: initial, optimized: next },
        pending.original ? ["original", "optimized"] : ["optimized"],
      )
    : keepGuidesTo(report.howToPlay, { original: initial, optimized: next });
  const checked = llmEnabled() ? await checkContradictions(draft).catch(() => null) : null;
  const final = checked?.report ?? draft;
  final.cardIndex = await buildCardIndex(final);
  return final;
}

/**
 * Stats, bracket and combos of an edited submitted list. Without a bracket estimate or combo
 * search (right after an edit), the last ones stand in where the list still matches them.
 */
export function originalStats(
  report: Report,
  initial: Deck,
  isCommander: boolean,
  est: BracketEstimate | null,
  found: ReturnType<typeof fallbackCombos> | null,
) {
  const snap = snapshot(initial, report.edhrec?.avgLands ?? null, isCommander, twoCardCombos(est));
  const bracket = report.bracket
    ? assessBracket(initial, est, snap.sim, report.bracket.target)
    : undefined;
  const o = report.original;
  const combos =
    found ??
    fallbackCombos(
      { present: o.combosPresent, oneAway: o.combosOneAway },
      initial,
      bracket?.combos,
    );
  return {
    snapshot: snap,
    bracket,
    original: {
      decklist: toDecklist(initial, initial),
      combosPresent: combos.present,
      combosOneAway: combos.oneAway.slice(0, 20),
    },
  };
}

const offerRerun = (slug: string, reason: string) =>
  updateChat(slug, (ms) => [...ms, rerunProposal(reason)]);

/** A probability the change warrants a fresh run must clear before the doc offers one. */
const REOPTIMIZE_THRESHOLD = 0.6;

/**
 * Why the doc should offer to re-optimize after changes, or null when it shouldn't. Only gaps the
 * changes opened count (against `before`, the gaps the deck had before them); the decision model
 * then judges whether they matter enough to be worth a fresh run. Without an LLM, any is enough.
 */
async function reoptimizeReason(
  before: PendingRefresh["gaps"],
  after: Report,
  droppedSwaps: number,
  changes: Pick<DeckChange, "action" | "name" | "qty">[],
): Promise<string | null> {
  const reasons = worsenedSince(before, after).map((g) => g.text);
  if (droppedSwaps > 0)
    reasons.push(
      `${droppedSwaps} of the doc's suggested ${droppedSwaps === 1 ? "swap no longer applies" : "swaps no longer apply"}`,
    );
  if (!reasons.length) return null;
  if (llmEnabled()) {
    const m = after.after.mana;
    const context = [
      `A Commander deck (${after.commanders.join(" + ")}) was just changed: ${changes.map((c) => `${c.action} ${c.qty > 1 ? `${c.qty} ` : ""}${c.name}`).join(", ")}.`,
      `What the change made worse: ${reasons.join("; ")}.`,
      `The deck now: ${m.landCount} lands (recommended ${m.recommendedLands}), average mana value ${m.avgCmc}, roles ${after.after.roles.map((r) => `${r.role} ${r.count}${r.target !== null ? `/${r.target}` : ""}`).join(", ")}${after.bracket ? `, target bracket ${after.bracket.target} (${after.bracket.after.checks.every((c) => c.ok) ? "all checks pass" : "some checks fail"})` : ""}.`,
    ].join("\n");
    const answers = await decide(
      context,
      [],
      [
        {
          name: "reoptimize",
          instructions:
            "Re-running the deck optimizer now, keeping the user's changes, would clearly improve how this deck plays: what the change made worse matters in games, rather than being a small or deliberate trade-off.",
        },
      ],
    ).catch(() => null);
    const p = answers?.get("reoptimize");
    if (p !== undefined && p < REOPTIMIZE_THRESHOLD) return null;
  }
  return reasons.join("; ");
}

/** The doc's offer to re-optimize, keeping the user's edits; it starts only once they confirm. */
function rerunProposal(reason: string): ChatAnswer {
  return {
    id: randomUUID(),
    role: "assistant",
    content: `That change left the deck with ${reason}. I can re-run the optimizer to rebalance the rest of the deck around your changes, keeping your edits. Want me to?`,
    at: new Date().toISOString(),
    rerun: { options: {}, summary: "the current settings, keeping your edits", keepEdits: true },
  };
}
