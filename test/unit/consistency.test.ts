import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DecklistCard, Report, Swap } from "../../shared/types.ts";
import { checkReport } from "../../server/analysis/consistency.ts";

const entry = (name: string, qty = 1, extra: Partial<DecklistCard> = {}): DecklistCard => ({
  name,
  qty,
  group: "Creature",
  cmc: 2,
  image: null,
  scryfallUri: "",
  priceUsd: null,
  isNew: false,
  delta: 0,
  ...extra,
});

const submitted = [
  entry("Nekusar, the Mindrazer", 1, { group: "Commander" }),
  entry("Helm of the Ghastlord"),
  entry("Fog Bank"),
  entry("Island", 3),
];
/** Helm was cut for Fevered Visions, then put back in place of Fog Bank. */
const current = [
  entry("Nekusar, the Mindrazer", 1, { group: "Commander" }),
  entry("Helm of the Ghastlord"),
  entry("Fevered Visions", 1, { isNew: true, delta: 1 }),
  entry("Island", 3),
];
const swap = (out: string, add: string, extra: Partial<Swap> = {}): Swap => ({
  out,
  in: add,
  category: "other",
  reason: "",
  ...extra,
});

function report(overrides: Partial<Report> = {}): Report {
  return {
    decklist: current,
    original: { decklist: submitted, combosPresent: [], combosOneAway: [] },
    swaps: [swap("Fog Bank", "Fevered Visions")],
    after: { totalCards: 6 },
    combosPresent: [],
    combosOneAway: [],
    ...overrides,
  } as Report;
}

const optimized = {
  commanders: ["Nekusar, the Mindrazer"],
  entries: [
    { name: "Helm of the Ghastlord", qty: 1 },
    { name: "Fevered Visions", qty: 1 },
    { name: "Island", qty: 3 },
  ],
};

describe("checkReport", () => {
  test("a consistent report has no problems", () => {
    assert.deepEqual(checkReport(report(), optimized), []);
  });

  test("a swap that cuts a card the deck still has is caught", () => {
    const problems = checkReport(
      report({ swaps: [swap("Helm of the Ghastlord", "Fevered Visions")] }),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Swaps: cut Helm of the Ghastlord, but the list cut Fog Bank/);
  });

  test("changes missing from the swaps are caught", () => {
    const [problem, ...rest] = checkReport(report({ swaps: [] }));
    assert.match(problem, /cut nothing, but the list cut Fog Bank/);
    assert.match(rest[0], /add nothing, but the list added Fevered Visions/);
  });

  test("the saved list and the report's list must match", () => {
    const stale = { ...optimized, entries: [...optimized.entries, { name: "Fog Bank", qty: 1 }] };
    assert.match(checkReport(report(), stale)[0], /only in the list: Fog Bank/);
  });

  test("every section naming cards is checked against the deck", () => {
    const problems = checkReport(
      report({
        swaps: [
          swap("Fog Bank", "Fevered Visions", {
            alternatives: [{ name: "Helm of the Ghastlord", image: null, scryfallUri: "" }],
          }),
        ],
        combosPresent: [{ cards: ["Niv-Mizzet, the Firemind", "Helm of the Ghastlord"] }],
        combosOneAway: [
          { cards: ["Helm of the Ghastlord", "Fevered Visions"], missing: ["Fevered Visions"] },
        ],
        synergies: [
          { title: "Walls", cards: ["Fog Bank", "Nekusar, the Mindrazer"], explanation: "" },
        ],
        bracket: {
          after: { gameChangers: [], massLandDenial: [], extraTurns: [], combos: [] },
          excluded: [{ name: "Helm of the Ghastlord", reason: "combo" }],
          gameChangerOptions: [{ name: "Fevered Visions", score: 1, inDeck: false }],
        },
        manaSuggestions: [
          {
            id: "m",
            reason: "",
            changes: [
              { action: "remove", name: "Swamp", qty: 1, reason: "", ok: true },
              { action: "add", name: "Island", qty: 1, reason: "", ok: true },
            ],
          },
        ],
      } as unknown as Partial<Report>),
    );
    for (const expected of [
      /Swaps: Helm of the Ghastlord is suggested instead of Fevered Visions, but it's in the deck/,
      /Combos: .* needs Niv-Mizzet, the Firemind/,
      /Combos one card away: .* lists Fevered Visions as missing, but the deck has it/,
      /Synergies: “Walls” uses Fog Bank/,
      /Bracket: Helm of the Ghastlord is listed as skipped/,
      /Bracket: Game Changer Fevered Visions is marked not in the deck, but it is/,
      /Mana suggestions: cuts Swamp/,
    ])
      assert.ok(
        problems.some((p) => expected.test(p)),
        `${expected} in:\n${problems.join("\n")}`,
      );
    assert.equal(problems.length, 7, "adding a basic land is fine");
  });

  test("new and change marks must follow the submitted deck", () => {
    const wrong = current.map((c) => (c.name === "Fevered Visions" ? { ...c, isNew: false } : c));
    assert.match(checkReport(report({ decklist: wrong }))[0], /Fevered Visions is marked not new/);
  });

  test("singleton and totals", () => {
    const doubled = [...current, entry("Helm of the Ghastlord")];
    const problems = checkReport(
      report({ decklist: doubled, after: { totalCards: 7 } } as Partial<Report>),
    );
    assert.ok(problems.some((p) => /Helm of the Ghastlord appears twice/.test(p)));
  });
});
