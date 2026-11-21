import { z } from "zod";
import { plainText, refsIn, resolveRefs } from "../../shared/card-refs.ts";
import type { PlayGuide, Report } from "../../shared/types.ts";

/** How every prompt that writes copy must name cards (see src/shared/card-refs.ts). */
export const CARD_REFS_RULE =
  'Write every Magic card you name as [[Exact Card Name]], like "[[Sol Ring]] ramps into [[Lathril, Blade of the Elves]]". Mark card names only: never numbers, turns, card types, mechanics or other words, even ones that share a name with a card.';

/**
 * A field the model must fill with a plain card name. Prompts that include CARD_REFS_RULE make the
 * model mark names everywhere, so markers that slip into these fields are taken out.
 */
export const CardNameSchema = z.string().transform((s) => plainText(s).trim());

const mapGuide = (g: PlayGuide, fn: (t: string) => string): PlayGuide => ({
  summary: fn(g.summary),
  early: g.early.map(fn),
  mid: g.mid.map(fn),
  late: g.late.map(fn),
  winConditions: g.winConditions.map(fn),
  keyCards: g.keyCards.map((k) => ({ ...k, why: fn(k.why) })),
  mulligan: fn(g.mulligan),
  watchOut: g.watchOut.map(fn),
});

/** The report with `fn` applied to every text that can reference cards. */
export function mapProse(r: Report, fn: (text: string) => string): Report {
  return {
    ...r,
    strategy: fn(r.strategy),
    swaps: r.swaps.map((s) => ({ ...s, reason: fn(s.reason) })),
    ...(r.synergies && {
      synergies: r.synergies.map((s) => ({ ...s, explanation: fn(s.explanation) })),
    }),
    ...(r.manaSuggestions && {
      manaSuggestions: r.manaSuggestions.map((m) => ({
        ...m,
        reason: fn(m.reason),
        changes: m.changes.map((c) => ({ ...c, reason: fn(c.reason) })),
      })),
    }),
    ...(r.howToPlay && {
      howToPlay: {
        ...(r.howToPlay.original && { original: mapGuide(r.howToPlay.original, fn) }),
        ...(r.howToPlay.optimized && { optimized: mapGuide(r.howToPlay.optimized, fn) }),
      },
    }),
    ...(r.research && { research: { ...r.research, summary: fn(r.research.summary) } }),
  };
}

/** Every card the report's copy references. */
export function proseRefs(r: Report): string[] {
  const out: string[] = [];
  mapProse(r, (t) => {
    out.push(...refsIn(t));
    return t;
  });
  return out;
}

/** Resolves names to the report's card index: exact, any case, or a double-faced card's front. */
export function indexResolver(index: Record<string, unknown>) {
  const byKey = new Map<string, string>();
  for (const name of Object.keys(index)) {
    byKey.set(name.toLowerCase(), name);
    const front = name.split(" // ")[0].toLowerCase();
    if (!byKey.has(front)) byKey.set(front, name);
  }
  return (name: string) => byKey.get(name.toLowerCase()) ?? null;
}

/**
 * Every reference in the report's copy points at a card in its index, spelled as the index has it;
 * the rest become plain words, so a reader never sees a card where there isn't one.
 */
export const settleRefs = (r: Report): Report =>
  mapProse(r, (t) => resolveRefs(t, indexResolver(r.cardIndex ?? {})));
