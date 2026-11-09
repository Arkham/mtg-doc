import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Combo } from "../../shared/types.ts";
import { byManaValue } from "../../src/cards.ts";
import { symbolUrl } from "../../src/mana-symbols.ts";
import { asOriginal, deckHash } from "../../src/views.ts";
import type { Report } from "../../shared/types.ts";
import { comboOutcome, groupByMissing } from "../../src/combos.ts";

const combo = (id: string, cards: string[], missing: string, produces: string[]): Combo => ({
  id,
  cards,
  missing: [missing],
  produces,
  description: "",
  bracketTag: null,
  url: `https://example.test/${id}`,
});

describe("comboOutcome", () => {
  test("picks the result that matters most", () => {
    assert.equal(
      comboOutcome([
        "Infinite +1/+1 counters on a creature",
        "Near-infinite card draw for target opponent",
        "Near-infinite damage",
        "Target opponent loses the game",
      ]),
      "Kills an opponent",
    );
    assert.equal(
      comboOutcome(["Infinite colorless mana", "Infinite storm count"]),
      "Infinite mana",
    );
    assert.equal(
      comboOutcome(["Near-infinite lifeloss", "Near-infinite card draw"]),
      "Near-infinite damage",
    );
    assert.equal(comboOutcome(["Infinite card draw", "Infinite draw triggers"]), "Infinite draw");
    assert.equal(comboOutcome(["Exile your library"]), "Exile your library");
  });
});

describe("groupByMissing", () => {
  test("shows each missing card once, with its partners, most combos first", () => {
    const groups = groupByMissing([
      combo("1", ["Hullbreaker Horror", "Sol Ring"], "Hullbreaker Horror", [
        "Infinite colorless mana",
      ]),
      combo("2", ["Orcish Bowmasters", "Peer into the Abyss"], "Peer into the Abyss", [
        "Near-infinite damage",
      ]),
      combo("3", ["Peer into the Abyss", "Underworld Dreams"], "Peer into the Abyss", [
        "Target opponent loses the game",
      ]),
      combo("4", ["Nekusar", "Psychosis Crawler", "Curiosity"], "Curiosity", [
        "Infinite card draw",
      ]),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.name, g.combos.length, g.best]),
      [
        ["Peer into the Abyss", 2, "Kills an opponent"],
        ["Hullbreaker Horror", 1, "Infinite mana"],
        ["Curiosity", 1, "Infinite draw"],
      ],
    );
    assert.deepEqual(
      groups[0].combos.map((c) => c.partners),
      [["Underworld Dreams"], ["Orcish Bowmasters"]],
      "partners exclude the missing card; strongest combo first",
    );
    assert.deepEqual(groups[2].combos[0].partners, ["Nekusar", "Psychosis Crawler"]);
  });
});

describe("byManaValue", () => {
  test("sorts by mana value, then name; unknown cards count as zero", () => {
    const rows = [
      { name: "Wrath", card: { cmc: 4 } },
      { name: "Sol Ring", card: { cmc: 1 } },
      { name: "Arcane Signet", card: { cmc: 2 } },
      { name: "Mind Stone", card: { cmc: 2 } },
      { name: "Typo", card: null },
    ];
    assert.deepEqual(
      rows.sort(byManaValue).map((r) => r.name),
      ["Typo", "Sol Ring", "Arcane Signet", "Mind Stone", "Wrath"],
    );
  });
});

describe("symbolUrl", () => {
  test("serves bundled symbols, including ones whose file name differs from the symbol", () => {
    assert.match(symbolUrl("G"), /^\/?\.?\/?symbols\/G\.svg$/);
    assert.match(symbolUrl("2/W"), /symbols\/2W\.svg$/);
    assert.match(symbolUrl("½"), /symbols\/HALF\.svg$/);
    assert.match(symbolUrl("∞"), /symbols\/INFINITY\.svg$/);
  });

  test("falls back to Scryfall for symbols not bundled yet", () => {
    assert.equal(symbolUrl("Z/Q"), "https://svgs.scryfall.io/card-symbols/ZQ.svg");
  });
});

describe("asOriginal", () => {
  const snap = (n: number) => ({ totalCards: n }) as unknown as Report["before"];
  const report = {
    before: snap(99),
    after: snap(100),
    swaps: [{ out: "Old", in: "New" }],
    decklist: [{ name: "New" }],
    original: {
      decklist: [{ name: "Old" }, { name: "Keep" }],
      combosPresent: [],
      combosOneAway: [],
    },
    combosPresent: [{ id: "x" }],
    combosOneAway: [],
    synergies: [
      { title: "kept", cards: ["Old", "Keep"], explanation: "" },
      { title: "needs new card", cards: ["New", "Keep"], explanation: "" },
    ],
    bracket: { before: { bracket: 4 }, after: { bracket: 3 }, excluded: [{ name: "X" }] },
  } as unknown as Report;

  test("shows the submitted deck with nothing to compare", () => {
    const o = asOriginal(report);
    assert.equal(o.after, o.before, "same snapshot: components drop before/after columns");
    assert.deepEqual(o.swaps, []);
    assert.deepEqual(
      o.decklist!.map((c) => c.name),
      ["Old", "Keep"],
    );
    assert.deepEqual(o.combosPresent, []);
    assert.deepEqual(
      o.synergies!.map((s) => s.title),
      ["kept"],
    );
    assert.equal(o.bracket!.after.bracket, 4);
    assert.deepEqual(o.bracket!.excluded, []);
  });

  test("reports without the original deck stay as they are", () => {
    const old = { ...report, original: undefined };
    assert.equal(asOriginal(old), old);
  });

  test("routes for each view", () => {
    assert.equal(deckHash("x", "current"), "#/deck/x");
    assert.equal(deckHash("x", "optimized"), "#/deck/x/optimized");
    assert.equal(deckHash("x", "optimized", "rule0"), "#/deck/x/optimized/rule0");
  });
});
