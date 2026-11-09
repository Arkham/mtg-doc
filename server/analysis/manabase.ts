/** Finds land swaps that fix color shortfalls and replace tapped or colorless lands. */
import type { Card, Color } from "../../shared/types.ts";
import { isBasicLand } from "../sources/scryfall.ts";
import { type Deck, cloneDeck } from "./deck.ts";
import { analyzeMana, landColors } from "./mana.ts";

/** Rules-text lines that are only about producing mana or how the land enters. */
const MANA_ONLY_LINE = [
  /^\(?[^:]*\{T\}[^:]*: Add\b/i,
  /^Add \{/i,
  /enters( the battlefield)? tapped/i,
  /^As .* enters, you may (pay|reveal)/i,
  /^When .* enters, (you gain \d+ life|scry \d+|return a land you control to its owner's hand)/i,
  /search(es)? (your|their) library for (a|an|up to \w+) (basic )?(land|plains|island|swamp|mountain|forest)/i,
  /^Cycling \{/i,
  /deals \d+ damage to you\.?$/i,
  /^\(.*\)$/,
];

/**
 * A land that does something besides making mana (draws cards, removes hand size limits, exiles
 * graveyards...). The fixer never cuts these: they're often the point of the deck.
 */
export function isUtilityLand(card: Card): boolean {
  if (!card.isLand || isBasicLand(card.name)) return false;
  const lines = card.oracleText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.some((line) => !MANA_ONLY_LINE.some((re) => re.test(line)));
}

export interface ManaFix {
  out: Card;
  in: Card;
  reason: string;
}

/** How far the mana base is from ideal: missing color sources, plus tapped and colorless lands. */
export function manaDeficit(deck: Deck, identity: Color[], avgLands: number | null): number {
  const mana = analyzeMana(deck, avgLands);
  const shortfall = mana.colors.reduce(
    (n, c) => n + Math.max(0, c.targetSources - c.landSources),
    0,
  );
  const tapped = deck.slots
    .filter((s) => s.card.isLand && s.card.entersTapped)
    .reduce((n, s) => n + s.qty, 0);
  const colorless =
    identity.length >= 3
      ? deck.slots
          .filter((s) => s.card.isLand && landColors(s.card, identity).length === 0)
          .reduce((n, s) => n + s.qty, 0)
      : 0;
  return shortfall + 0.6 * tapped + 0.5 * colorless;
}

const COLOR_WORD: Record<Color, string> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

function swap(deck: Deck, out: Card, inCard: Card): Deck {
  const next = cloneDeck(deck);
  const slot = next.slots.find((s) => s.card.name === out.name)!;
  slot.qty--;
  if (slot.qty === 0) next.slots.splice(next.slots.indexOf(slot), 1);
  const existing = next.slots.find((s) => s.card.name === inCard.name);
  if (existing) existing.qty++;
  else next.slots.push({ card: inCard, qty: 1 });
  return next;
}

function explain(
  deck: Deck,
  identity: Color[],
  avgLands: number | null,
  out: Card,
  inCard: Card,
): string {
  const mana = analyzeMana(deck, avgLands);
  const inColors = landColors(inCard, identity);
  const short = mana.colors.filter(
    (c) => c.landSources < c.targetSources && inColors.includes(c.color),
  );
  const why: string[] = [];
  if (out.entersTapped) why.push(`${out.name} always enters tapped`);
  else if (landColors(out, identity).length === 0)
    why.push(`${out.name} only makes colorless mana`);
  else if (isBasicLand(out.name))
    why.push(
      `you have plenty of ${landColors(out, identity)
        .map((c) => COLOR_WORD[c])
        .join("/")} sources`,
    );
  const makes = inColors.map((c) => COLOR_WORD[c]).join(" and ");
  const gain = short.length
    ? `, helping ${short.map((c) => COLOR_WORD[c.color]).join(" and ")}, which ${short.length > 1 ? "are" : "is"} short`
    : "";
  const text = `${why.length ? `${why[0]}; ` : ""}${inCard.name} makes ${makes}${inCard.entersTapped ? "" : " untapped"}${gain}.`;
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * Greedy search over land-for-land swaps: each step takes the pair that most reduces the deficit,
 * minus the synergy value lost by cutting a useful land. Stops after `max` swaps or when nothing helps.
 */
export function planManaFixes(opts: {
  deck: Deck;
  identity: Color[];
  avgLands: number | null;
  candidates: Card[];
  value?: Map<string, number>;
  violation?: (card: Card, deck: Deck, out?: Card) => string | null;
  locked?: Set<string>;
  max: number;
}): { deck: Deck; fixes: ManaFix[] } {
  const {
    identity,
    avgLands,
    value = new Map(),
    violation = () => null,
    locked = new Set(),
  } = opts;
  let deck = opts.deck;
  const fixes: ManaFix[] = [];
  const added = new Set<string>();
  const pool = opts.candidates.filter(
    (c) =>
      c.isLand &&
      !c.entersTapped &&
      c.legalCommander &&
      c.colorIdentity.every((x) => identity.includes(x)) &&
      landColors(c, identity).length > 0,
  );
  for (let i = 0; i < opts.max; i++) {
    const current = manaDeficit(deck, identity, avgLands);
    if (current <= 0) break;
    const inDeck = new Set(deck.slots.map((s) => s.card.name));
    const outs = deck.slots
      .map((s) => s.card)
      .filter((c) => c.isLand && !isUtilityLand(c) && !locked.has(c.name) && !added.has(c.name));
    let best: { out: Card; in: Card; gain: number } | null = null;
    for (const out of outs) {
      for (const inCard of pool) {
        if (inDeck.has(inCard.name) || violation(inCard, deck, out)) continue;
        const after = manaDeficit(swap(deck, out, inCard), identity, avgLands);
        const lostValue = Math.max(0, (value.get(out.name) ?? 0) - (value.get(inCard.name) ?? 0));
        const gain = current - after - 2 * lostValue;
        if (gain > 0.5 && (!best || gain > best.gain)) best = { out, in: inCard, gain };
      }
    }
    if (!best) break;
    fixes.push({
      out: best.out,
      in: best.in,
      reason: explain(deck, identity, avgLands, best.out, best.in),
    });
    deck = swap(deck, best.out, best.in);
    added.add(best.in.name);
  }
  return { deck, fixes };
}
