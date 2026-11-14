import type { DeckSummary } from "../shared/types.ts";

export interface CardHit {
  name: string;
  decks: DeckSummary[];
}

/** Case, accents and punctuation don't matter: "lim dul" finds "Lim-Dûl's Vault". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Below this many characters a query matches too much to be useful. */
export const MIN_QUERY = 2;

/**
 * Cards whose name contains the query, with the decks that run them: exact names first, then
 * names starting with it, then the most widely played.
 */
export function searchCards(
  decks: DeckSummary[],
  query: string,
  limit = 8,
): { hits: CardHit[]; total: number } {
  const q = fold(query);
  if (q.length < MIN_QUERY) return { hits: [], total: 0 };
  const byName = new Map<string, DeckSummary[]>();
  for (const d of decks)
    for (const name of d.cards)
      if (fold(name).includes(q)) byName.set(name, [...(byName.get(name) ?? []), d]);
  const rank = (name: string) => {
    const f = fold(name);
    return f === q ? 0 : f.startsWith(q) || f.includes(` ${q}`) ? 1 : 2;
  };
  const hits = [...byName]
    .map(([name, decks]) => ({ name, decks }))
    .sort(
      (a, b) =>
        rank(a.name) - rank(b.name) ||
        b.decks.length - a.decks.length ||
        a.name.localeCompare(b.name),
    );
  return { hits: hits.slice(0, limit), total: hits.length };
}
