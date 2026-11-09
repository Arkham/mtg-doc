import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  analyzeMana,
  landColors,
  pipsOf,
  recommendedLandCount,
} from "../../server/analysis/mana.ts";
import { card, commander, forest, spell, swamp, testDeck } from "../support/cards.ts";

describe("pipsOf", () => {
  test("counts plain, hybrid, phyrexian and twobrid symbols", () => {
    assert.deepEqual(pipsOf("{2}{W}{W}{U/B}{G/P}"), { W: 2, U: 0.5, B: 0.5, R: 0, G: 0.5 });
    assert.deepEqual(pipsOf("{2/R}{X}{C}"), { W: 0, U: 0, B: 0, R: 0.5, G: 0 });
    assert.deepEqual(pipsOf(""), { W: 0, U: 0, B: 0, R: 0, G: 0 });
  });
});

describe("landColors", () => {
  test("uses produced mana filtered to the color identity", () => {
    const tower = card({
      name: "Command Tower",
      isLand: true,
      producedMana: ["W", "U", "B", "R", "G"],
    });
    assert.deepEqual(landColors(tower, ["B", "G"]), ["B", "G"]);
  });

  test("fetch lands produce what they can find", () => {
    const wilds = card({
      name: "Evolving Wilds",
      isLand: true,
      oracleText:
        "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped.",
    });
    assert.deepEqual(landColors(wilds, ["B", "G"]), ["B", "G"]);
    const catacombs = card({
      name: "Verdant Catacombs",
      isLand: true,
      oracleText:
        "{T}, Pay 1 life, Sacrifice Verdant Catacombs: Search your library for a Swamp or Forest card, put it onto the battlefield.",
    });
    assert.deepEqual(landColors(catacombs, ["W", "B", "G"]).sort(), ["B", "G"]);
  });

  test("colorless utility lands produce nothing in-identity", () => {
    const passage = card({ name: "Rogue's Passage", isLand: true, producedMana: ["C"] });
    assert.deepEqual(landColors(passage, ["B", "G"]), []);
  });
});

describe("recommendedLandCount", () => {
  test("follows the curve and cheap acceleration, clamped to sane bounds", () => {
    assert.ok(recommendedLandCount(2.5, 12, null) < recommendedLandCount(4, 4, null));
    assert.equal(recommendedLandCount(0, 60, null), 30);
    assert.equal(recommendedLandCount(9, 0, null), 42);
  });

  test("blends with EDHREC's average when available", () => {
    const solo = recommendedLandCount(3.5, 8, null);
    assert.equal(
      recommendedLandCount(3.5, 8, 30),
      Math.round((31.42 + 3.13 * 3.5 - 0.28 * 8 + 30) / 2),
    );
    assert.ok(recommendedLandCount(3.5, 8, 30) < solo);
  });
});

describe("analyzeMana", () => {
  test("flags short land counts and low ramp", () => {
    const mana = analyzeMana(testDeck(30), null);
    assert.equal(mana.landCount, 30);
    assert.ok(mana.issues.some((i) => i.startsWith("Only 30 lands")));
    assert.ok(mana.issues.some((i) => i.includes("ramp")));
  });

  test("tracks color sources, tapped and colorless lands", () => {
    const tapped = card({
      name: "Golgari Guildgate",
      isLand: true,
      entersTapped: true,
      producedMana: ["B", "G"],
    });
    const passage = card({ name: "Rogue's Passage", isLand: true, producedMana: ["C"] });
    const deck = testDeck(35, [tapped, passage]);
    const mana = analyzeMana(deck, null);
    assert.equal(mana.landCount, 37);
    assert.deepEqual(mana.tappedLands, ["Golgari Guildgate"]);
    assert.deepEqual(mana.colorlessLands, ["Rogue's Passage"]);
    const g = mana.colors.find((c) => c.color === "G")!;
    assert.equal(g.landSources, 18 + 1);
    assert.ok(g.pipShare > 0.5, "filler spells are all green");
    assert.equal(mana.basics.Forest, 18);
    assert.equal(mana.basics.Swamp, 17);
  });

  test("counts MDFC lands as half a land", () => {
    const mdfc = spell("Turntimber Symbiosis", { isMdfcLand: true, cmc: 7 });
    const mana = analyzeMana(
      {
        commanders: [commander],
        slots: [
          { card: forest, qty: 18 },
          { card: swamp, qty: 17 },
          { card: mdfc, qty: 1 },
        ],
      },
      null,
    );
    assert.equal(mana.mdfcLands, 1);
  });
});
