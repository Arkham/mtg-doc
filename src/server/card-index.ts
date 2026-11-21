import { indexResolver, proseRefs } from "./analysis/prose.ts";
import type { Card, CardPreview, Report } from "../shared/types.ts";
import { lookupExact } from "./sources/scryfall.ts";

/** Every card name a report mentions, wherever it's displayed. */
export function referencedNames(r: Report): string[] {
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
  for (const g of [r.howToPlay?.original, r.howToPlay?.optimized])
    g?.keyCards.forEach((k) => names.add(k.name));
  for (const m of r.manaSuggestions ?? []) m.changes.forEach((c) => names.add(c.name));
  for (const syn of r.synergies ?? []) syn.cards.forEach((n) => names.add(n));
  r.research?.cardsMentioned.forEach((n) => names.add(n));
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
  const names = referencedNames(report);
  const listed = new Set(names);
  // Earlier entries only for cards the report still lists; copy's references are checked afresh.
  const index: Record<string, CardPreview> = Object.fromEntries(
    Object.entries(report.cardIndex ?? {}).filter(([n]) => listed.has(n)),
  );
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
  const missing = names.filter((n) => !index[n]);
  if (missing.length) {
    const found = await lookupExact(missing).catch(() => new Map<string, Card>());
    for (const [name, card] of found) {
      if (card.image) index[name] = preview(card);
    }
  }
  // Copy can name cards beyond the report's own lists. Those must be real Commander cards named in
  // full: a nickname ("Rift" for Cyclonic Rift) would otherwise find an unrelated card by that name.
  const inIndex = indexResolver(index);
  const around = [...names, ...proseRefs(report)];
  const extra = [...new Set(proseRefs(report))].filter(
    (n) => !inIndex(n) && !looksLikeNickname(n, around),
  );
  const accepted = new Set<string>();
  if (extra.length) {
    const found = await lookupExact(extra).catch(() => new Map<string, Card>());
    for (const [name, card] of found)
      if (card.image && isNamedCard(card, name)) {
        index[card.name] = preview(card);
        accepted.add(card.name);
      }
  }
  // Only what the report shows stays, so a reference that no longer resolves can't linger.
  const keep = new Set([...names, ...accepted]);
  for (const name of new Set(proseRefs(report))) {
    const hit = inIndex(name);
    if (hit) keep.add(hit);
  }
  return Object.fromEntries(Object.entries(index).filter(([n]) => keep.has(n)));
}

/**
 * Whether copy naming `name` means this card: a Commander-legal card whose full name, or a
 * double-faced card's front, is exactly that. "Call" isn't Beck // Call; "Rift" isn't a playtest
 * card nobody can play.
 */
export const isNamedCard = (card: Card, name: string) =>
  card.legalCommander &&
  [card.name, card.name.split(" // ")[0]].some((n) => n.toLowerCase() === name.toLowerCase());

const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/**
 * Whether a name is most likely a nickname for one of `others`, the cards around it: its words
 * appear, in order, inside a longer one's ("Lich" in Underrealm Lich, "Rift" in Cyclonic Rift).
 * Such a reference isn't trusted to mean the card that happens to have that short name.
 */
export function looksLikeNickname(name: string, others: Iterable<string>): boolean {
  const short = wordsOf(name);
  if (!short.length) return false;
  for (const other of others) {
    const long = wordsOf(other);
    if (long.length <= short.length) continue;
    for (let i = 0; i + short.length <= long.length; i++)
      if (short.every((w, j) => long[i + j] === w)) return true;
  }
  return false;
}
