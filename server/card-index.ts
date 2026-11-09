import type { Card, CardPreview, Report } from "../shared/types.ts";
import { lookupExact } from "./sources/scryfall.ts";

/** Every card name a report mentions, wherever it's displayed. */
function referencedNames(r: Report): string[] {
  const names = new Set<string>(r.commanders);
  for (const s of r.swaps) {
    names.add(s.out);
    names.add(s.in);
    for (const a of s.alternatives ?? []) names.add(a.name);
  }
  for (const c of [...(r.decklist ?? []), ...(r.original?.decklist ?? [])]) names.add(c.name);
  for (const combo of [
    ...r.combosPresent,
    ...r.combosOneAway,
    ...(r.original?.combosPresent ?? []),
    ...(r.original?.combosOneAway ?? []),
  ])
    combo.cards.forEach((n) => names.add(n));
  for (const snap of [r.before, r.after]) {
    snap.mana.tappedLands.forEach((n) => names.add(n));
    snap.mana.colorlessLands.forEach((n) => names.add(n));
    snap.mana.colors.forEach((c) => c.heaviestCard && names.add(c.heaviestCard.name));
  }
  const b = r.bracket;
  if (b) {
    for (const a of [b.before, b.after]) {
      [...a.gameChangers, ...a.massLandDenial, ...a.extraTurns].forEach((n) => names.add(n));
      a.combos.forEach((c) => c.cards.forEach((n) => names.add(n)));
    }
    b.gameChangerOptions.forEach((g) => names.add(g.name));
    b.excluded.forEach((e) => names.add(e.name));
  }
  for (const e of r.edits ?? []) e.changes.forEach((c) => names.add(c.name));
  for (const m of r.manaSuggestions ?? []) m.changes.forEach((c) => names.add(c.name));
  for (const syn of r.synergies ?? []) syn.cards.forEach((n) => names.add(n));
  return [...names];
}

const preview = (
  c: Pick<Card, "image" | "scryfallUri"> & { priceUsd?: number | null },
): CardPreview => ({
  image: c.image,
  scryfallUri: c.scryfallUri,
  priceUsd: c.priceUsd ?? null,
});

/**
 * Builds preview data for every card in the report, reusing card data already in hand and looking
 * up the rest in one batch, so every card name in the UI can show its image.
 */
export async function buildCardIndex(
  report: Report,
  known: Card[] = [],
): Promise<Record<string, CardPreview>> {
  const index: Record<string, CardPreview> = { ...report.cardIndex };
  const add = (
    c: (Pick<Card, "name" | "image" | "scryfallUri"> & { priceUsd?: number | null }) | undefined,
  ) => {
    // Entries without price data (swap alternatives) are looked up instead, so prices show too.
    if (c?.image && c.priceUsd !== undefined && !index[c.name]) index[c.name] = preview(c);
  };
  known.forEach(add);
  report.commanderCards.forEach(add);
  for (const s of report.swaps) {
    add(s.outCard);
    add(s.inCard);
    s.alternatives?.forEach((a) => add({ ...a }));
  }
  report.decklist?.forEach((c) => add(c));
  report.original?.decklist.forEach((c) => add(c));
  const missing = referencedNames(report).filter((n) => !index[n]);
  if (missing.length) {
    const found = await lookupExact(missing).catch(() => new Map<string, Card>());
    for (const [name, card] of found) {
      if (card.image) index[name] = preview(card);
    }
  }
  return index;
}
