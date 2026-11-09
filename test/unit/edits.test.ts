import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DeckChange } from "../../shared/types.ts";
import {
  applyChanges,
  joinCommaNames,
  matchInDeck,
  parseCommand,
  structuralProblem,
} from "../../server/analysis/edits.ts";
import { commander, forest, spell, testDeck } from "../support/cards.ts";

const strip = (cs: ReturnType<typeof parseCommand>) =>
  cs?.map(({ action, name, qty }) => ({ action, name, qty }));

describe("parseCommand", () => {
  test("add, remove and quantities", () => {
    assert.deepEqual(strip(parseCommand("add Arcane Signet")), [
      { action: "add", name: "Arcane Signet", qty: 1 },
    ]);
    assert.deepEqual(strip(parseCommand("remove 2 Forest")), [
      { action: "remove", name: "Forest", qty: 2 },
    ]);
    assert.deepEqual(strip(parseCommand("cut Sol Ring, Mind Stone and the Fellwar Stone.")), [
      { action: "remove", name: "Sol Ring", qty: 1 },
      { action: "remove", name: "Mind Stone", qty: 1 },
      { action: "remove", name: "Fellwar Stone", qty: 1 },
    ]);
  });

  test("swaps and multiple clauses", () => {
    assert.deepEqual(strip(parseCommand("swap Sol Ring for Mind Stone")), [
      { action: "remove", name: "Sol Ring", qty: 1 },
      { action: "add", name: "Mind Stone", qty: 1 },
    ]);
    assert.deepEqual(strip(parseCommand("replace Island with Swamp; add Counterspell")), [
      { action: "remove", name: "Island", qty: 1 },
      { action: "add", name: "Swamp", qty: 1 },
      { action: "add", name: "Counterspell", qty: 1 },
    ]);
    assert.deepEqual(strip(parseCommand("Add Swords to Plowshares and cut Temple Bell")), [
      { action: "add", name: "Swords to Plowshares", qty: 1 },
      { action: "remove", name: "Temple Bell", qty: 1 },
    ]);
  });

  test("returns null for questions and free text", () => {
    assert.equal(parseCommand("How does this deck win?"), null);
    assert.equal(parseCommand("make it better"), null);
    assert.equal(parseCommand(""), null);
  });
});

const ok = (action: "add" | "remove", card: ReturnType<typeof spell>, qty = 1): DeckChange => ({
  action,
  name: card.name,
  qty,
  reason: "",
  ok: true,
  card,
});

describe("applyChanges", () => {
  test("removes first, then adds, and skips invalid changes", () => {
    const deck = testDeck(37, [spell("Old")]);
    const next = applyChanges(deck, [
      ok("add", spell("New")),
      ok("remove", spell("Old")),
      { ...ok("add", spell("Rejected")), ok: false, problem: "nope" },
      ok("remove", forest, 2),
    ]);
    const names = next.slots.map((s) => s.card.name);
    assert.ok(names.includes("New") && !names.includes("Old") && !names.includes("Rejected"));
    assert.equal(next.slots.find((s) => s.card.name === "Forest")!.qty, 17);
    assert.ok(
      deck.slots.some((s) => s.card.name === "Old"),
      "input deck is not mutated",
    );
  });

  test("adding a basic you already run increases its quantity", () => {
    const next = applyChanges(testDeck(37), [ok("add", forest, 3)]);
    assert.equal(next.slots.find((s) => s.card.name === "Forest")!.qty, 22);
  });
});

describe("structuralProblem", () => {
  test("enforces legality, color identity, singleton and the commander", () => {
    const deck = testDeck(37, [spell("Owned")]);
    assert.match(
      structuralProblem(spell("Blue", { colorIdentity: ["U"] }), deck, ["B", "G"])!,
      /color identity/,
    );
    assert.match(
      structuralProblem(spell("Banned", { legalCommander: false }), deck, ["B", "G"])!,
      /not legal/,
    );
    assert.match(structuralProblem(spell("Owned"), deck, ["B", "G"])!, /singleton/);
    assert.match(structuralProblem(commander, deck, ["B", "G"])!, /your commander/);
    assert.equal(structuralProblem(forest, deck, ["B", "G"]), null, "basics can repeat");
    assert.equal(structuralProblem(spell("Fresh"), deck, ["B", "G"]), null);
  });
});

describe("matchInDeck", () => {
  test("matches names in the deck only, tolerating case, punctuation, faces and small typos", () => {
    const deck = testDeck(37, [
      spell("Sol Ring"),
      spell("Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun"),
    ]);
    assert.equal(matchInDeck("sol ring", deck)?.name, "Sol Ring");
    assert.equal(matchInDeck("Sol Rnig", deck)?.name, "Sol Ring");
    assert.equal(
      matchInDeck("Growing Rites of Itlimoc", deck)?.name,
      "Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun",
    );
    assert.equal(matchInDeck("Definitely Not A Card", deck), null);
    assert.equal(matchInDeck("Mana Crypt", deck), null, "a real card that isn't in the deck");
  });
});

describe("joinCommaNames", () => {
  test("re-joins comma-split names only when the joined name is a real card", () => {
    const parsed = parseCommand("add Lathril, Blade of the Elves, Sol Ring and Mind Stone")!;
    const real = new Set(["Lathril, Blade of the Elves"]);
    const joined = joinCommaNames(parsed, (name) => real.has(name));
    assert.deepEqual(
      joined.map((c) => c.name),
      ["Lathril, Blade of the Elves", "Sol Ring", "Mind Stone"],
    );
    assert.ok(joined.every((c) => !("afterComma" in c)));
  });
});
