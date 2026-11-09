import type { Card, Color } from "../../shared/types.ts";
import type { Deck } from "../../server/analysis/deck.ts";
import { classifyRoles } from "../../server/analysis/roles.ts";
import type { SolverCard } from "../../server/analysis/search.ts";

export function card(partial: Partial<Card> & { name: string }): Card {
  const c: Card = {
    oracleId: partial.name,
    manaCost: "",
    cmc: 0,
    typeLine: "Creature",
    oracleText: "",
    colors: [],
    colorIdentity: [],
    producedMana: [],
    isLand: false,
    isMdfcLand: false,
    entersTapped: false,
    legalCommander: true,
    canBeCommander: false,
    gameChanger: false,
    priceUsd: null,
    image: null,
    imageArt: null,
    scryfallUri: "",
    roles: [],
    ...partial,
  };
  if (!partial.roles) c.roles = classifyRoles(c);
  return c;
}

export const forest = card({
  name: "Forest",
  isLand: true,
  typeLine: "Basic Land — Forest",
  producedMana: ["G"],
  colorIdentity: ["G"],
});
export const swamp = card({
  name: "Swamp",
  isLand: true,
  typeLine: "Basic Land — Swamp",
  producedMana: ["B"],
  colorIdentity: ["B"],
});
export const commander = card({
  name: "Cmdr",
  manaCost: "{2}{B}{G}",
  cmc: 4,
  colorIdentity: ["B", "G"],
  typeLine: "Legendary Creature — Elf",
  canBeCommander: true,
});

export const spell = (name: string, extra: Partial<Card> = {}) =>
  card({ name, manaCost: "{1}{G}", cmc: 2, colorIdentity: ["G"] as Color[], ...extra });

/** A legal 100-card B/G deck: commander, `lands` basics and filler spells. */
export function testDeck(lands = 37, spells: Card[] = []): Deck {
  const fillers = 99 - lands - spells.length;
  return {
    commanders: [commander],
    slots: [
      { card: forest, qty: Math.ceil(lands / 2) },
      { card: swamp, qty: Math.floor(lands / 2) },
      ...spells.map((c) => ({ card: c, qty: 1 })),
      ...Array.from({ length: fillers }, (_, i) => ({ card: spell(`Filler ${i}`), qty: 1 })),
    ],
  };
}

export const NO_FLAGS = {
  gameChanger: false,
  massLandDenial: false,
  extraTurn: false,
  banned: false,
};

export function solverCard(
  c: Card,
  score: number,
  flags: Partial<typeof NO_FLAGS> = {},
): SolverCard {
  return {
    card: c,
    score,
    inclusion: 0.3,
    synergy: 0.1,
    comboPiece: false,
    offIdentity: false,
    source: [],
    flags: { ...NO_FLAGS, ...flags },
  };
}
