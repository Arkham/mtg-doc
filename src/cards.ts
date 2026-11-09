/** Cheapest first, like a mana curve; cards without data (unrecognized) sort as zero, then by name. */
export function byManaValue(
  a: { name: string; card?: { cmc: number } | null },
  b: { name: string; card?: { cmc: number } | null },
): number {
  return (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0) || a.name.localeCompare(b.name);
}
