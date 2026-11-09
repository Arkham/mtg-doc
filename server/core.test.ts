import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../shared/types.ts";
import type { Deck } from "./analysis/deck.ts";
import { analyzeMana, landColors, pipsOf, recommendedLandCount } from "./analysis/mana.ts";
import { mergeSwaps } from "./analysis/optimizer.ts";
import { classifyRoles } from "./analysis/roles.ts";
import { simulate } from "./analysis/simulate.ts";
import { formatDecklist, parseDecklist } from "./decklist.ts";
import { slugify } from "./sources/edhrec.ts";

function card(partial: Partial<Card> & { name: string }): Card {
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
    priceUsd: null,
    image: null,
    imageArt: null,
    scryfallUri: "",
    roles: [],
    ...partial,
  };
  c.roles = classifyRoles(c);
  return c;
}

test("parses common decklist exports", () => {
  const parsed = parseDecklist(`Commander
1 Atraxa, Praetors' Voice

Deck
1x Sol Ring (CMR) 472 *F*
2 Forest
1 Command Tower [Land]

Sideboard
1 Swords to Plowshares`);
  assert.deepEqual(parsed.commanders, ["Atraxa, Praetors' Voice"]);
  assert.deepEqual(parsed.entries, [
    { name: "Sol Ring", qty: 1 },
    { name: "Forest", qty: 2 },
    { name: "Command Tower", qty: 1 },
  ]);
  const roundTrip = parseDecklist(formatDecklist(parsed.commanders, parsed.entries));
  assert.deepEqual(roundTrip, {
    ...parsed,
    entries: [...parsed.entries].sort((a, b) => a.name.localeCompare(b.name)),
  });
});

test("slugifies commander names into folder names", () => {
  assert.equal(slugify("Atraxa, Praetors' Voice"), "atraxa-praetors-voice");
  assert.equal(slugify("Esika, God of the Tree // The Prismatic Bridge"), "esika-god-of-the-tree");
});

test("counts pips including hybrid and phyrexian", () => {
  assert.deepEqual(pipsOf("{2}{W}{W}{U/B}{G/P}"), { W: 2, U: 0.5, B: 0.5, R: 0, G: 0.5 });
});

test("fetch lands produce the colors they can find", () => {
  const wilds = card({
    name: "Evolving Wilds",
    isLand: true,
    oracleText:
      "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped.",
  });
  assert.deepEqual(landColors(wilds, ["B", "G"]), ["B", "G"]);
  const marsh = card({
    name: "Verdant Catacombs",
    isLand: true,
    oracleText:
      "{T}, Pay 1 life, Sacrifice Verdant Catacombs: Search your library for a Swamp or Forest card, put it onto the battlefield.",
  });
  assert.deepEqual(landColors(marsh, ["W", "B", "G"]).sort(), ["B", "G"]);
});

test("classifies common roles", () => {
  assert.ok(
    classifyRoles(
      card({
        name: "Sol Ring",
        typeLine: "Artifact",
        oracleText: "{T}: Add {C}{C}.",
        producedMana: ["C"],
      }),
    ).includes("ramp"),
  );
  assert.ok(
    classifyRoles(
      card({
        name: "Swords",
        typeLine: "Instant",
        oracleText: "Exile target creature. Its controller gains life equal to its power.",
      }),
    ).includes("removal"),
  );
  assert.ok(
    classifyRoles(
      card({
        name: "Damnation",
        typeLine: "Sorcery",
        oracleText: "Destroy all creatures. They can't be regenerated.",
      }),
    ).includes("wipe"),
  );
  assert.ok(
    classifyRoles(
      card({ name: "Harmonize", typeLine: "Sorcery", oracleText: "Draw three cards." }),
    ).includes("draw"),
  );
  assert.deepEqual(
    classifyRoles(
      card({
        name: "Cultivate",
        typeLine: "Sorcery",
        oracleText:
          "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
      }),
    ),
    ["ramp"],
  );
});

test("land count recommendation follows the curve", () => {
  assert.ok(recommendedLandCount(2.5, 12, null) < recommendedLandCount(4, 4, null));
});

function testDeck(lands: number): Deck {
  const forest = card({
    name: "Forest",
    isLand: true,
    typeLine: "Basic Land — Forest",
    producedMana: ["G"],
    colorIdentity: ["G"],
  });
  const swamp = card({
    name: "Swamp",
    isLand: true,
    typeLine: "Basic Land — Swamp",
    producedMana: ["B"],
    colorIdentity: ["B"],
  });
  const bear = card({ name: "Bear", manaCost: "{1}{G}", cmc: 2, colorIdentity: ["G"] });
  const cmdr = card({
    name: "Cmdr",
    manaCost: "{2}{B}{G}",
    cmc: 4,
    colorIdentity: ["B", "G"],
    canBeCommander: true,
  });
  return {
    commanders: [cmdr],
    slots: [
      { card: forest, qty: Math.ceil(lands / 2) },
      { card: swamp, qty: Math.floor(lands / 2) },
      { card: bear, qty: 99 - lands },
    ],
  };
}

test("simulation responds to land count", () => {
  const few = simulate(testDeck(30), 3000);
  const many = simulate(testDeck(40), 3000);
  assert.ok(many.landDropByTurn[4] > few.landDropByTurn[4]);
  assert.ok(many.commanderOnCurve > few.commanderOnCurve);
  assert.ok(few.screwRate > many.screwRate);
});

test("mana analysis flags short land counts", () => {
  const mana = analyzeMana(testDeck(30), null);
  assert.equal(mana.landCount, 30);
  assert.ok(mana.issues.some((i) => i.includes("lands")));
});

test("merges chained basic land swaps", () => {
  const merged = mergeSwaps([
    { out: "Rogue's Passage", in: "Swamp", category: "mana", reason: "a." },
    { out: "Swamp", in: "Forest", category: "mana", reason: "b." },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].out, "Rogue's Passage");
  assert.equal(merged[0].in, "Forest");
});
