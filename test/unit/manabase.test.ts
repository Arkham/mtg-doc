import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isUtilityLand, manaDeficit, planManaFixes } from "../../server/analysis/manabase.ts";
import { card, commander, forest, spell, swamp } from "../support/cards.ts";
import type { Deck } from "../../server/analysis/deck.ts";

const land = (name: string, oracleText: string, producedMana: string[], extra = {}) =>
  card({ name, isLand: true, typeLine: "Land", oracleText, producedMana, ...extra });

const guildgate = land(
  "Golgari Guildgate",
  "Golgari Guildgate enters tapped.\n{T}: Add {B} or {G}.",
  ["B", "G"],
  {
    entersTapped: true,
    colorIdentity: ["B", "G"],
  },
);
const temple = land(
  "Temple of the False God",
  "{T}: Add {C}{C}. Activate only if you control five or more lands.",
  ["C"],
);
const tower = land("Reliquary Tower", "You have no maximum hand size.\n{T}: Add {C}.", ["C"]);
const shock = land(
  "Overgrown Tomb",
  "({T}: Add {B} or {G}.)\nAs Overgrown Tomb enters, you may pay 2 life. If you don't, it enters tapped.",
  ["B", "G"],
  { colorIdentity: ["B", "G"] },
);

/** B/G deck that leans hard on black but has few black lands, plus weak lands to cut. */
function weakManaDeck(): Deck {
  const black = Array.from({ length: 40 }, (_, i) =>
    spell(`Black ${i}`, { manaCost: "{B}{B}{B}", cmc: 3, colorIdentity: ["B"] }),
  );
  return {
    commanders: [commander],
    slots: [
      { card: forest, qty: 24 },
      { card: swamp, qty: 8 },
      { card: guildgate, qty: 1 },
      { card: temple, qty: 1 },
      { card: tower, qty: 1 },
      ...black.map((c) => ({ card: c, qty: 1 })),
      ...Array.from({ length: 24 }, (_, i) => ({ card: spell(`Green ${i}`), qty: 1 })),
    ],
  };
}

describe("isUtilityLand", () => {
  test("tells utility lands from lands that only make mana", () => {
    assert.equal(isUtilityLand(tower), true);
    assert.equal(
      isUtilityLand(
        land(
          "Bojuka Bog",
          "Bojuka Bog enters tapped.\nWhen Bojuka Bog enters, exile target player's graveyard.\n{T}: Add {B}.",
          ["B"],
        ),
      ),
      true,
    );
    assert.equal(isUtilityLand(guildgate), false);
    assert.equal(isUtilityLand(temple), false);
    assert.equal(isUtilityLand(shock), false);
    assert.equal(
      isUtilityLand(
        land(
          "Vivid Marsh",
          "Vivid Marsh enters tapped with two charge counters on it.\n{T}: Add {B}.\n{T}, Remove a charge counter from Vivid Marsh: Add one mana of any color.",
          ["B"],
        ),
      ),
      false,
    );
    assert.equal(isUtilityLand(forest), false);
  });
});

describe("planManaFixes", () => {
  test("swaps weak lands for untapped duals that fix the short color, never utility lands", () => {
    const deck = weakManaDeck();
    const before = manaDeficit(deck, ["B", "G"], null);
    const { deck: fixed, fixes } = planManaFixes({
      deck,
      identity: ["B", "G"],
      avgLands: null,
      candidates: [shock, guildgate],
      max: 3,
    });
    assert.equal(fixes.length, 1, "only one candidate land not already in the deck");
    assert.equal(fixes[0].in.name, "Overgrown Tomb");
    assert.notEqual(fixes[0].out.name, "Reliquary Tower", "utility lands are kept");
    assert.match(fixes[0].reason, /Overgrown Tomb makes black and green untapped/);
    assert.ok(manaDeficit(fixed, ["B", "G"], null) < before);
  });

  test("respects locked cards, rule violations and does nothing without useful candidates", () => {
    const deck = weakManaDeck();
    const blocked = planManaFixes({
      deck,
      identity: ["B", "G"],
      avgLands: null,
      candidates: [shock],
      violation: () => "over budget",
      max: 3,
    });
    assert.equal(blocked.fixes.length, 0);
    const tapped = planManaFixes({
      deck,
      identity: ["B", "G"],
      avgLands: null,
      candidates: [guildgate],
      max: 3,
    });
    assert.equal(tapped.fixes.length, 0, "tapped lands are never added");
    const locked = planManaFixes({
      deck,
      identity: ["B", "G"],
      avgLands: null,
      candidates: [shock],
      locked: new Set(["Golgari Guildgate", "Temple of the False God", "Forest", "Swamp"]),
      max: 3,
    });
    assert.equal(locked.fixes.length, 0);
  });
});
