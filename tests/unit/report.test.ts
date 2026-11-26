import "../support/env.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DecklistCard } from "../../src/shared/types.ts";
import { renderDecklist } from "../../src/server/report.ts";

const card = (name: string, cmc: number, manaCost?: string): DecklistCard => ({
  name,
  manaCost,
  qty: 1,
  group: "Instant",
  cmc,
  image: null,
  scryfallUri: "",
  priceUsd: null,
  isNew: false,
  delta: 0,
});

describe("renderDecklist", () => {
  test("sorts by mana value then name, with cards with X in their cost last", () => {
    const lines = renderDecklist("Decklist", [
      card("Fireball", 1, "{X}{R}"),
      card("Opt", 1, "{U}"),
      card("Ballista", 0, "{X}{X}"),
      card("Ornithopter", 0, "{0}"),
      card("Counterspell", 2, "{U}{U}"),
      card("Mana Leak", 2, "{1}{U}"),
    ]);
    const cards = lines
      .filter((l) => l.startsWith("- "))
      .map((l) =>
        l
          .slice(2)
          .replace(/^\d+\s+/, "")
          .replace(/\s*\{.*$/, ""),
      );
    assert.deepEqual(cards, [
      "Ornithopter",
      "Opt",
      "Mana Leak",
      "Counterspell",
      "Ballista",
      "Fireball",
    ]);
  });

  test("puts basic lands after the other lands", () => {
    const land = (name: string): DecklistCard => ({ ...card(name, 0), group: "Land" });
    const lines = renderDecklist("Decklist", [
      land("Forest"),
      land("Command Tower"),
      land("Snow-Covered Island"),
      land("Swamp"),
      land("Woodland Cemetery"),
    ]);
    const cards = lines
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).replace(/^\d+\s+/, ""));
    assert.deepEqual(cards, [
      "Command Tower",
      "Woodland Cemetery",
      "Forest",
      "Snow-Covered Island",
      "Swamp",
    ]);
  });
});
