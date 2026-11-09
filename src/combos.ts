import type { Combo } from "../shared/types.ts";

const OUTCOMES: [RegExp, string][] = [
  [/each opponent loses the game|you win the game/i, "Wins the game"],
  [/(target|one) (opponent|player) loses the game/i, "Kills an opponent"],
  [/^infinite (damage|lifeloss|life loss)/i, "Infinite damage"],
  [/^near-infinite (damage|lifeloss|life loss)/i, "Near-infinite damage"],
  [/^lock$|can't (draw|cast|untap)/i, "Lock"],
  [/infinite .*mana/i, "Infinite mana"],
  [/^infinite card draw/i, "Infinite draw"],
  [/^near-infinite card draw(?! for)/i, "Near-infinite draw"],
  [/infinite .*(tokens|counters|turns)/i, "Infinite value"],
];

/** The one result that matters most, in plain words (Spellbook lists every side effect). */
export function comboOutcome(produces: string[]): string {
  for (const [re, label] of OUTCOMES) if (produces.some((p) => re.test(p))) return label;
  return produces[0] ?? "Combo";
}

const rank = (outcome: string) => {
  const i = OUTCOMES.findIndex(([, label]) => label === outcome);
  return i === -1 ? OUTCOMES.length : i;
};

export interface MissingPiece {
  name: string;
  combos: { combo: Combo; partners: string[]; outcome: string }[];
  /** Strongest outcome among its combos. */
  best: string;
}

/**
 * Groups "one card away" combos by the card you'd add, so a card that completes several combos
 * shows once. Cards completing more combos come first; ties keep Spellbook's popularity order.
 */
export function groupByMissing(combos: Combo[]): MissingPiece[] {
  const groups = new Map<string, MissingPiece>();
  for (const combo of combos) {
    const name = combo.missing[0];
    if (!name) continue;
    const outcome = comboOutcome(combo.produces);
    const group = groups.get(name) ?? { name, combos: [], best: outcome };
    group.combos.push({ combo, partners: combo.cards.filter((c) => c !== name), outcome });
    if (rank(outcome) < rank(group.best)) group.best = outcome;
    groups.set(name, group);
  }
  const list = [...groups.values()];
  for (const g of list) g.combos.sort((a, b) => rank(a.outcome) - rank(b.outcome));
  return list
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.combos.length - a.g.combos.length || a.i - b.i)
    .map(({ g }) => g);
}
