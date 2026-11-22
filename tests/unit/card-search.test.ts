import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeckSummary } from "../../src/shared/types.ts";
import { searchCards } from "../../src/web/card-search.ts";

const deck = (slug: string, cards: string[]): DeckSummary => ({
  slug,
  commanders: [cards[0]],
  colorIdentity: null,
  format: "commander",
  createdAt: "",
  hasReport: true,
  image: null,
  cards,
});
const decks = [
  deck("a", ["Atraxa, Praetors' Voice", "Sol Ring", "Lim-Dûl's Vault", "Solemn Simulacrum"]),
  deck("b", ["Lathril, Blade of the Elves", "Sol Ring", "Arcane Signet"]),
  deck("c", ["Nekusar, the Mindrazer", "Arcane Signet", "Sol Ring", "Ring of Valkas"]),
];
const names = (q: string) => searchCards(decks, q).hits.map((h) => h.name);

test("finds the decks that run a card", () => {
  const [hit] = searchCards(decks, "arcane signet").hits;
  assert.deepEqual(
    hit.decks.map((d) => d.slug),
    ["b", "c"],
  );
});

test("exact names first, then words starting with the query, then the most played", () => {
  assert.deepEqual(names("sol ring"), ["Sol Ring"]);
  assert.deepEqual(names("sol"), ["Sol Ring", "Solemn Simulacrum"]);
  assert.deepEqual(names("ring"), ["Sol Ring", "Ring of Valkas"]);
  assert.deepEqual(names("lkas"), ["Ring of Valkas"]);
  assert.deepEqual(names("vault"), ["Lim-Dûl's Vault"]);
});

test("ignores case, accents and punctuation", () => {
  assert.deepEqual(names("lim dul"), ["Lim-Dûl's Vault"]);
  assert.deepEqual(names("PRAETORS VOICE"), ["Atraxa, Praetors' Voice"]);
});

test("short queries match nothing, and results are capped with the total", () => {
  assert.deepEqual(searchCards(decks, "s"), { hits: [], total: 0 });
  const capped = searchCards(decks, "ra", 1);
  assert.equal(capped.hits.length, 1);
  assert.equal(capped.total, 2);
});
