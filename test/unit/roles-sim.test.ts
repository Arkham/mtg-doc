import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classifyRoles } from "../../server/analysis/roles.ts";
import { simulate } from "../../server/analysis/simulate.ts";
import { card, spell, testDeck } from "../support/cards.ts";

const roles = (oracleText: string, extra = {}) =>
  classifyRoles(card({ name: "X", typeLine: "Sorcery", oracleText, ...extra }));

describe("classifyRoles", () => {
  test("ramp: mana rocks, dorks, land fetch, treasure", () => {
    assert.deepEqual(roles("{T}: Add {C}{C}.", { typeLine: "Artifact", producedMana: ["C"] }), [
      "ramp",
    ]);
    assert.deepEqual(roles("{T}: Add {G}.", { typeLine: "Creature — Elf", producedMana: ["G"] }), [
      "ramp",
    ]);
    assert.deepEqual(
      roles(
        "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
      ),
      ["ramp"],
    );
    assert.ok(roles("When this enters, create a Treasure token.").includes("ramp"));
  });

  test("interaction: removal, wipes, counters", () => {
    assert.ok(
      roles("Exile target creature. Its controller gains life equal to its power.").includes(
        "removal",
      ),
    );
    assert.deepEqual(roles("Destroy all creatures. They can't be regenerated."), ["wipe"]);
    assert.ok(roles("Counter target spell.").includes("counter"));
    assert.ok(roles("Return target nonland permanent to its owner's hand.").includes("removal"));
  });

  test("card flow and utility", () => {
    assert.ok(roles("Draw three cards.").includes("draw"));
    assert.ok(
      roles("Search your library for a card, put that card into your hand, then shuffle.").includes(
        "tutor",
      ),
    );
    assert.ok(
      !roles("Search your library for a basic land card, put it onto the battlefield.").includes(
        "tutor",
      ),
    );
    assert.ok(
      roles(
        "Target creature you control gains hexproof and indestructible until end of turn.",
      ).includes("protection"),
    );
    assert.ok(
      roles("Return target creature card from your graveyard to your hand.").includes("recursion"),
    );
    assert.ok(roles("Take an extra turn after this one.").includes("wincon"));
  });

  test("lands are just lands; vanilla cards are 'other'", () => {
    assert.deepEqual(
      classifyRoles(card({ name: "L", isLand: true, oracleText: "{T}: Add {G}." })),
      ["land"],
    );
    assert.deepEqual(roles(""), ["other"]);
  });
});

describe("simulate", () => {
  test("is deterministic for a given seed", () => {
    assert.deepEqual(simulate(testDeck(36), 1000, 7), simulate(testDeck(36), 1000, 7));
  });

  test("responds to land count", () => {
    const few = simulate(testDeck(30), 3000);
    const many = simulate(testDeck(40), 3000);
    assert.ok(many.landDropByTurn[4] > few.landDropByTurn[4]);
    assert.ok(many.commanderOnCurve > few.commanderOnCurve);
    assert.ok(few.screwRate > many.screwRate);
    assert.ok(many.floodRate >= few.floodRate);
  });

  test("ramp makes the commander come down faster", () => {
    const rock = card({
      name: "Rock",
      typeLine: "Artifact",
      cmc: 2,
      manaCost: "{2}",
      oracleText: "{T}: Add one mana of any color.",
      producedMana: ["W", "U", "B", "R", "G"],
    });
    const rocks = Array.from({ length: 10 }, (_, i) => ({ ...rock, name: `Rock ${i}` }));
    const base = simulate(testDeck(36), 3000);
    const ramped = simulate(testDeck(36, rocks), 3000);
    assert.ok(ramped.avgManaTurn4 > base.avgManaTurn4);
    assert.ok(ramped.commanderByTurn[3] > base.commanderByTurn[3]);
  });

  test("needs the right colors to cast the commander", () => {
    const allForests = testDeck(36);
    allForests.slots = allForests.slots.map((s) =>
      s.card.name === "Swamp"
        ? { ...s, card: { ...s.card, name: "Forest2", producedMana: ["G"], colorIdentity: ["G"] } }
        : s,
    );
    const sim = simulate(allForests, 2000);
    assert.equal(
      sim.commanderOnCurve,
      0,
      "no black source means the B/G commander is never castable",
    );
    assert.equal(sim.allColorsByTurn3, 0);
  });

  test("tracks two-card combo assembly, with tutors as wildcards", () => {
    const piece = spell("Piece");
    const tutor = spell("Tutor", {
      oracleText: "Search your library for a card, put it into your hand.",
    });
    const plain = simulate(testDeck(37, [piece]), 3000, 1, [["Cmdr", "Piece"]]);
    const tutored = simulate(testDeck(37, [piece, tutor, { ...tutor, name: "Tutor 2" }]), 3000, 1, [
      ["Cmdr", "Piece"],
    ]);
    const byTurn = plain.combos![0].byTurn;
    assert.ok(byTurn[8] >= byTurn[4] && byTurn[8] > 0);
    assert.ok(tutored.combos![0].byTurn[6] > byTurn[6]);
  });

  test("ignores combos whose pieces aren't in the deck", () => {
    assert.deepEqual(simulate(testDeck(37), 100, 1, [["Cmdr", "Missing"]]).combos, []);
  });
});
