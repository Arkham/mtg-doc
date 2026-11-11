/**
 * Keeps the parts of a report that name cards consistent with the deck after chat edits: the swap
 * list must describe exactly how the current list differs from the submitted one.
 */
import type {
  BracketCombo,
  BracketReport,
  Card,
  Combo,
  DeckEdit,
  Swap,
} from "../../shared/types.ts";
import { isBasicLand } from "../sources/scryfall.ts";
import { type Deck, cloneDeck } from "./deck.ts";

const counts = (deck: Deck) => {
  const m = new Map<string, number>();
  for (const s of deck.slots) m.set(s.card.name, (m.get(s.card.name) ?? 0) + s.qty);
  return m;
};

/** Cards in `a` beyond what `b` has, one entry per copy, in `a`'s order. */
function minus(a: Deck, b: Deck): string[] {
  const have = counts(b);
  const out: string[] = [];
  for (const [name, qty] of counts(a)) {
    for (let i = have.get(name) ?? 0; i < qty; i++) out.push(name);
  }
  return out;
}

const take = (pool: string[], name: string) => {
  const i = pool.indexOf(name);
  if (i < 0) return false;
  pool.splice(i, 1);
  return true;
};

/** Swaps without "also consider" picks that are already in the deck (often another swap's add). */
export function dropOwnedAlternatives(swaps: Swap[], deck: Deck): Swap[] {
  const inDeck = new Set(deck.slots.map((s) => s.card.name));
  return swaps.map((s) =>
    s.alternatives ? { ...s, alternatives: s.alternatives.filter((a) => !inDeck.has(a.name)) } : s,
  );
}

/**
 * Rebuilds the swap list after chat edits so its cuts and adds are exactly the net difference
 * between the submitted and current lists. Swaps that still hold are kept as they are. When an edit
 * breaks one (a cut card came back, or an added card went out), the half that still stands is
 * paired with a change from the edit that broke it, then the remaining chat changes pair up within
 * their own edits. Re-paired swaps take their reason from chat, newest first, since the optimizer's
 * reason was about the old pairing.
 */
export function reconcileSwaps(
  swaps: Swap[],
  initial: Deck,
  current: Deck,
  edits: DeckEdit[],
): Swap[] {
  const cuts = minus(initial, current);
  const adds = minus(current, initial);
  const cardOf = new Map<string, Card>(
    [...initial.slots, ...current.slots].map((s) => [s.card.name, s.card]),
  );

  const kept: Swap[] = [];
  const broken: Swap[] = [];
  for (const s of dropOwnedAlternatives(swaps, current)) {
    if (cuts.includes(s.out) && adds.includes(s.in)) {
      take(cuts, s.out);
      take(adds, s.in);
      kept.push(s);
    } else broken.push(s);
  }

  const reasonFor = (action: "add" | "remove", name: string) => {
    for (const e of [...edits].reverse()) {
      const c = e.changes.find((x) => x.action === action && x.name === name && x.reason);
      if (c) return c.reason;
    }
    return null;
  };
  const lastEditWith = (action: "add" | "remove", name: string) =>
    [...edits].reverse().find((e) => e.changes.some((c) => c.action === action && c.name === name));
  const namesIn = (edit: DeckEdit | undefined, action: "add" | "remove") =>
    edit?.changes.filter((c) => c.action === action).map((c) => c.name) ?? [];

  const repaired: Swap[] = [];
  const pair = (out: string, add: string) => {
    take(cuts, out);
    take(adds, add);
    const outCard = cardOf.get(out);
    const inCard = cardOf.get(add);
    repaired.push({
      out,
      in: add,
      category: outCard?.isLand && inCard?.isLand ? "mana" : "other",
      reason: reasonFor("add", add) ?? reasonFor("remove", out) ?? "Changed through chat.",
      ...(outCard ? { outCard } : {}),
      ...(inCard ? { inCard } : {}),
      fromChat: true,
    });
  };

  for (const s of broken) {
    if (adds.includes(s.in)) {
      // The cut card came back; whatever the same edit cut makes room for the added one instead.
      const edit = lastEditWith("add", s.out);
      const partner = namesIn(edit, "remove").find((n) => cuts.includes(n)) ?? cuts[0];
      if (partner) pair(partner, s.in);
    } else if (cuts.includes(s.out)) {
      // The added card went out again; the same edit's addition fills the slot.
      const edit = lastEditWith("remove", s.in);
      const partner = namesIn(edit, "add").find((n) => adds.includes(n)) ?? adds[0];
      if (partner) pair(s.out, partner);
    }
  }
  for (const e of edits) {
    const outs = namesIn(e, "remove").filter((n) => cuts.includes(n));
    const ins = namesIn(e, "add").filter((n) => adds.includes(n));
    for (let i = 0; i < Math.min(outs.length, ins.length); i++) pair(outs[i], ins[i]);
  }
  while (cuts.length && adds.length) pair(cuts[0], adds[0]);
  return [...kept, ...repaired];
}

/**
 * The suggested deck for an edited submitted list: the list with every swap that still applies (its
 * cut is still there and its add isn't yet). A card the user replaced themselves drops the swap that
 * cut it, and a card they added drops the swap that would have added it.
 */
export function rebaseSwaps(
  initial: Deck,
  swaps: Swap[],
  cards: Map<string, Card>,
): { deck: Deck; swaps: Swap[] } {
  const deck = cloneDeck(initial);
  const kept: Swap[] = [];
  for (const s of swaps) {
    const out = deck.slots.find((x) => x.card.name === s.out);
    const has = deck.slots.find((x) => x.card.name === s.in);
    const card = s.inCard ?? cards.get(s.in);
    if (!out || !card || (has && !isBasicLand(s.in))) continue;
    if (--out.qty === 0) deck.slots.splice(deck.slots.indexOf(out), 1);
    if (has) has.qty++;
    else deck.slots.push({ card, qty: 1 });
    kept.push(s);
  }
  return { deck, swaps: kept };
}

/** Bracket lists that say whether a card is in the deck, brought up to date with the list. */
export function refreshBracketLists(bracket: BracketReport, current: Deck): BracketReport {
  const names = new Set(
    [...current.commanders, ...current.slots.map((s) => s.card)].map((c) => c.name),
  );
  return {
    ...bracket,
    gameChangerOptions: bracket.gameChangerOptions.map((g) => ({
      ...g,
      inDeck: names.has(g.name),
    })),
    // A skipped card the user added anyway isn't skipped any more; the bracket check covers it.
    excluded: bracket.excluded.filter((e) => !names.has(e.name)),
  };
}

const comboKey = (cards: string[]) => [...cards].sort().join("|");

/**
 * Combo lists for a deck when Commander Spellbook's combo search failed: the previous lists, kept
 * only where they still hold for this deck, plus any combo the bracket estimate found in it.
 */
export function fallbackCombos(
  previous: { present: Combo[]; oneAway: Combo[] },
  deck: Deck,
  bracketCombos: BracketCombo[] = [],
): { present: Combo[]; oneAway: Combo[] } {
  const names = new Set([...deck.commanders, ...deck.slots.map((s) => s.card)].map((c) => c.name));
  const present = previous.present.filter((c) => c.cards.every((n) => names.has(n)));
  const seen = new Set(present.map((c) => comboKey(c.cards)));
  for (const b of bracketCombos) {
    if (seen.has(comboKey(b.cards)) || !b.cards.every((n) => names.has(n))) continue;
    seen.add(comboKey(b.cards));
    present.push({
      id: b.url,
      cards: b.cards,
      missing: [],
      produces: b.produces,
      description: "",
      bracketTag: b.tag,
      url: b.url,
    });
  }
  const oneAway = previous.oneAway.filter(
    (c) =>
      c.missing.every((n) => !names.has(n)) &&
      c.cards.every((n) => c.missing.includes(n) || names.has(n)),
  );
  return { present, oneAway };
}
