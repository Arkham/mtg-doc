import type { Report } from "../shared/types.ts";

export type DeckView = "current" | "optimized";

export const deckHash = (slug: string, view: DeckView, page?: "rule0") =>
  `#/deck/${slug}${view === "optimized" ? "/optimized" : ""}${page ? `/${page}` : ""}`;

/** Reports made before the original deck was stored can only show the optimized view. */
export const hasOriginal = (r: Report) => Boolean(r.original);

/**
 * The report as it applies to the deck the user submitted: its own stats, list, bracket and combos,
 * with nothing about swaps. `after === before` tells components there's nothing to compare.
 */
export function asOriginal(r: Report): Report {
  const o = r.original;
  if (!o) return r;
  const names = new Set(o.decklist.map((c) => c.name));
  return {
    ...r,
    after: r.before,
    swaps: [],
    edits: [],
    manaSuggestions: [],
    decklist: o.decklist,
    combosPresent: o.combosPresent,
    combosOneAway: o.combosOneAway,
    synergies: r.synergies?.filter((s) => s.cards.every((n) => names.has(n))),
    bracket: r.bracket ? { ...r.bracket, after: r.bracket.before, excluded: [] } : r.bracket,
  };
}
