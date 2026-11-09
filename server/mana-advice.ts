import { randomUUID } from "node:crypto";
import type { Card, Color, ManaSuggestion } from "../shared/types.ts";
import type { Deck } from "./analysis/deck.ts";
import { type ManaFix, planManaFixes } from "./analysis/manabase.ts";
import { landsForColor } from "./sources/scryfall.ts";

type Violation = (card: Card, deck: Deck, out?: Card) => string | null;

/** Popular untapped-capable lands for each color of the deck, within the per-card budget. */
export async function landCandidates(
  identity: Color[],
  budgetPerCard: number | null,
): Promise<Card[]> {
  const byName = new Map<string, Card>();
  for (const color of identity) {
    for (const card of await landsForColor(identity, color).catch(() => [])) {
      if (budgetPerCard !== null && (card.priceUsd ?? 0) > budgetPerCard) continue;
      if (!byName.has(card.name)) byName.set(card.name, card);
    }
  }
  return [...byName.values()];
}

export const toSuggestion = (fix: ManaFix): ManaSuggestion => ({
  id: randomUUID(),
  reason: fix.reason,
  changes: [
    { action: "remove", name: fix.out.name, qty: 1, reason: fix.reason, ok: true, card: fix.out },
    { action: "add", name: fix.in.name, qty: 1, reason: fix.reason, ok: true, card: fix.in },
  ],
});

/** Land swaps that would still improve the deck's mana, without changing it. */
export async function suggestManaFixes(opts: {
  deck: Deck;
  identity: Color[];
  avgLands: number | null;
  budgetPerCard: number | null;
  violation: Violation;
  locked: Set<string>;
  extraCandidates?: Card[];
  value?: Map<string, number>;
  max?: number;
}): Promise<ManaSuggestion[]> {
  const candidates = [
    ...(opts.extraCandidates ?? []),
    ...(await landCandidates(opts.identity, opts.budgetPerCard)),
  ];
  const { fixes } = planManaFixes({ ...opts, candidates, max: opts.max ?? 3 });
  return fixes.map(toSuggestion);
}
