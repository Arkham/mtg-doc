import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BRACKETS, assessBracket, comboViolates, flagsFor } from "../../server/analysis/bracket.ts";
import { simulate } from "../../server/analysis/simulate.ts";
import type { BracketEstimate, ClassifiedCombo } from "../../server/sources/spellbook.ts";
import { card, spell, testDeck } from "../support/cards.ts";

const combo = (extra: Partial<ClassifiedCombo> = {}): ClassifiedCombo => ({
  id: "x",
  cards: ["Piece A", "Piece B"],
  produces: ["Infinite mana"],
  definitelyTwoCard: true,
  arguablyTwoCard: false,
  relevant: true,
  lock: false,
  extraTurn: false,
  massLandDenial: false,
  tag: "S",
  url: "https://commanderspellbook.com/combo/x/",
  ...extra,
});

const estimate = (
  flags: Record<string, Partial<ReturnType<typeof flagsFor>>>,
  combos: ClassifiedCombo[] = [],
  tag = "C",
): BracketEstimate => ({
  tag,
  cards: new Map(
    Object.entries(flags).map(([name, f]) => [
      name,
      { gameChanger: false, massLandDenial: false, extraTurn: false, banned: false, ...f },
    ]),
  ),
  combos,
});

describe("bracket rules table", () => {
  test("matches the official Commander Brackets", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((b) => BRACKETS[b].gameChangers),
      [0, 0, 3, Infinity, Infinity],
    );
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((b) => BRACKETS[b].minTurns),
      [9, 8, 6, 4, 1],
    );
    assert.equal(BRACKETS[3].massLandDenial, false);
    assert.equal(BRACKETS[4].massLandDenial, true);
  });
});

describe("comboViolates", () => {
  test("brackets 1-2 allow no two-card combos", () => {
    assert.equal(comboViolates(combo(), 1, 0), true);
    assert.equal(
      comboViolates(combo({ definitelyTwoCard: false, arguablyTwoCard: true }), 2, 0),
      true,
    );
  });
  test("bracket 3 allows late, non-ruthless two-card combos", () => {
    assert.equal(comboViolates(combo(), 3, 5), false);
    assert.equal(comboViolates(combo(), 3, 40), true, "too early");
    assert.equal(comboViolates(combo({ tag: "R" }), 3, 0), true, "ruthless");
    assert.equal(comboViolates(combo({ extraTurn: true }), 3, 0), true, "infinite turns");
    assert.equal(comboViolates(combo({ lock: true }), 3, 0), true, "locks");
  });
  test("bracket 4+ allows anything", () => {
    assert.equal(comboViolates(combo({ tag: "R" }), 4, 90), false);
  });
  test("irrelevant or 3+ card combos only matter when they lock", () => {
    assert.equal(comboViolates(combo({ relevant: false }), 2, 0), false);
    assert.equal(comboViolates(combo({ definitelyTwoCard: false }), 2, 0), false);
    assert.equal(comboViolates(combo({ definitelyTwoCard: false, lock: true }), 2, 0), true);
  });
});

describe("flagsFor", () => {
  test("merges Scryfall's game_changer flag with Spellbook flags by front-face name", () => {
    const gc = card({ name: "Demonic Tutor", gameChanger: true });
    assert.equal(flagsFor(gc, null).gameChanger, true);
    const mdfc = card({ name: "Front // Back" });
    assert.equal(flagsFor(mdfc, estimate({ Front: { extraTurn: true } })).extraTurn, true);
  });
});

describe("assessBracket", () => {
  test("a plain deck is bracket 2 (bracket 1 is about intent, never inferred)", () => {
    const deck = testDeck(37);
    const a = assessBracket(deck, estimate({}), simulate(deck, 500), null);
    assert.equal(a.bracket, 2);
    assert.ok(a.checks.every((c) => c.ok));
  });

  test("Game Changers set the bracket: 1-3 is bracket 3, 4+ is bracket 4", () => {
    const gcs = (n: number) =>
      Array.from({ length: n }, (_, i) => spell(`GC ${i}`, { gameChanger: true }));
    assert.equal(assessBracket(testDeck(37, gcs(2)), estimate({}), null, null).bracket, 3);
    const four = assessBracket(testDeck(37, gcs(4)), estimate({}), null, 3);
    assert.equal(four.bracket, 4);
    assert.equal(four.checks.find((c) => c.label === "Game Changers")!.ok, false);
    assert.equal(four.gameChangers.length, 4);
  });

  test("mass land denial and chained extra turns push to bracket 4", () => {
    const deck = testDeck(37, [
      spell("Armageddon"),
      spell("Time Warp"),
      spell("Temporal Manipulation"),
    ]);
    const a = assessBracket(
      deck,
      estimate({
        Armageddon: { massLandDenial: true },
        "Time Warp": { extraTurn: true },
        "Temporal Manipulation": { extraTurn: true },
      }),
      null,
      3,
    );
    assert.equal(a.bracket, 4);
    assert.deepEqual(a.massLandDenial, ["Armageddon"]);
    assert.equal(a.extraTurns.length, 2);
  });

  test("two-card combos use the simulator's early-assembly odds", () => {
    const deck = testDeck(37, [spell("Piece A"), spell("Piece B")]);
    const sim = simulate(deck, 2000, 1, [["Piece A", "Piece B"]]);
    const a = assessBracket(deck, estimate({}, [combo()]), sim, 3);
    assert.equal(a.combos.length, 1);
    assert.equal(a.combos[0].twoCard, true);
    assert.equal(typeof a.combos[0].earlyPct, "number");
    assert.ok(a.bracket >= 3, "a two-card combo can't be bracket 2");
  });

  test("Spellbook's overall tag is a floor", () => {
    const a = assessBracket(testDeck(37), estimate({}, [], "R"), null, null);
    assert.equal(a.bracket, 4);
    assert.equal(a.spellbookTag, "R");
  });

  test("reports power and position within the target bracket", () => {
    const a = assessBracket(testDeck(37), estimate({}), null, 4);
    assert.ok(a.power >= 0 && a.power <= 100);
    assert.equal(a.position, "low", "a pile of 2-drops is low for bracket 4");
  });
});
