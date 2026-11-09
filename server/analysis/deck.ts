import type { Card, Color, DeckEntry, DecklistCard, Role, RoleCount } from "../../shared/types.ts";
import { COLORS } from "../../shared/types.ts";
import { ROLE_TARGETS } from "./roles.ts";

export interface DeckSlot {
  card: Card;
  qty: number;
}

export interface Deck {
  commanders: Card[];
  slots: DeckSlot[];
}

export const identityOf = (commanders: Card[]): Color[] => {
  const set = new Set(commanders.flatMap((c) => c.colorIdentity));
  return COLORS.filter((c) => set.has(c));
};

export const totalCards = (deck: Deck) =>
  deck.commanders.length + deck.slots.reduce((n, s) => n + s.qty, 0);

export const totalPrice = (deck: Deck) =>
  Math.round(
    [...deck.commanders.map((card) => ({ card, qty: 1 })), ...deck.slots].reduce(
      (n, s) => n + (s.card.priceUsd ?? 0) * s.qty,
      0,
    ) * 100,
  ) / 100;

export const toEntries = (deck: Deck): DeckEntry[] =>
  deck.slots.map((s) => ({ name: s.card.name, qty: s.qty }));

export function cloneDeck(deck: Deck): Deck {
  return { commanders: [...deck.commanders], slots: deck.slots.map((s) => ({ ...s })) };
}

export function countRoles(deck: Deck, isCommander: boolean): RoleCount[] {
  const counts = new Map<Role, number>();
  for (const s of deck.slots)
    for (const r of s.card.roles) counts.set(r, (counts.get(r) ?? 0) + s.qty);
  const roles: Role[] = [
    "land",
    "ramp",
    "draw",
    "removal",
    "wipe",
    "counter",
    "tutor",
    "protection",
    "recursion",
    "wincon",
    "other",
  ];
  return roles.map((role) => ({
    role,
    count: counts.get(role) ?? 0,
    target: isCommander ? (ROLE_TARGETS[role] ?? null) : null,
  }));
}

const GROUPS = [
  "Creature",
  "Planeswalker",
  "Battle",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
];

export function typeGroup(card: Card): string {
  const front = card.typeLine.split(" // ")[0];
  return GROUPS.find((g) => new RegExp(`\\b${g}\\b`).test(front)) ?? "Other";
}

export function toDecklist(deck: Deck, initial: Deck): DecklistCard[] {
  const before = new Map(initial.slots.map((s) => [s.card.name, s.qty]));
  const all = [
    ...deck.commanders.map((card) => ({ card, qty: 1, group: "Commander" })),
    ...deck.slots.map((s) => ({ ...s, group: typeGroup(s.card) })),
  ];
  return all.map(({ card, qty, group }) => ({
    name: card.name,
    manaCost: card.manaCost,
    qty,
    group,
    cmc: card.cmc,
    image: card.image,
    scryfallUri: card.scryfallUri,
    priceUsd: card.priceUsd,
    isNew: group !== "Commander" && !before.has(card.name),
    delta: group === "Commander" ? 0 : qty - (before.get(card.name) ?? 0),
  }));
}
