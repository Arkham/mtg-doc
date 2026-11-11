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
    assert.match(
      problems[0],
      /Swaps: cut Helm of the Ghastlord beyond what the list cuts .*\(it cut Fog Bank\)/,
    );
  });

  test("changes missing from the swaps are caught", () => {
    assert.deepEqual(checkReport(report({ swaps: [] })), [
      "Swaps: 0 listed, but the list's changes from the submitted deck make 1 (cut Fog Bank; added Fevered Visions).",
    ]);
  });

  test("a change in deck size leaves the unpaired cards out of the swaps", () => {
    // Fog Bank cut for Fevered Visions, and an Island cut with nothing in its place.
    const smaller = current.map((c) => (c.name === "Island" ? { ...c, qty: 2, delta: -1 } : c));
    const fewer = report({ decklist: smaller, after: { totalCards: 5 } } as Partial<Report>);
    assert.deepEqual(checkReport(fewer), []);
    const both = report({
      decklist: smaller,
      after: { totalCards: 5 },
      swaps: [swap("Fog Bank", "Fevered Visions"), swap("Island", "Fevered Visions")],
    } as Partial<Report>);
    assert.deepEqual(checkReport(both), [
      "Swaps: add Fevered Visions beyond what the list adds to the submitted deck (it added Fevered Visions).",
    ]);
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
          before: { gameChangers: [], massLandDenial: [], extraTurns: [], combos: [] },
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

  test("the deck as submitted has its own combos and bracket, checked against its own list", () => {
    const problems = checkReport(
      report({
        original: {
          decklist: submitted,
          combosPresent: [{ cards: ["Fog Bank", "Fevered Visions"] }],
          combosOneAway: [{ cards: ["Fog Bank", "Island"], missing: ["Fog Bank"] }],
        },
        bracket: {
          before: {
            gameChangers: ["Fevered Visions"],
            massLandDenial: [],
            extraTurns: [],
            combos: [{ cards: ["Helm of the Ghastlord", "Island"] }],
          },
          after: { gameChangers: [], massLandDenial: [], extraTurns: [], combos: [] },
          excluded: [],
          gameChangerOptions: [],
        },
      } as unknown as Partial<Report>),
    );
    for (const expected of [
      /Combos in the deck as submitted: Fog Bank \+ Fevered Visions needs Fevered Visions/,
      /Combos one card away from the deck as submitted: .* lists Fog Bank as missing, but the deck has it/,
      /Bracket \(deck as submitted\): counts Fevered Visions, which isn't in the deck/,
      /Bracket \(deck as submitted\): counts the combo Helm of the Ghastlord \+ Island, but the Combos section doesn't list it/,
    ])
      assert.ok(
        problems.some((p) => expected.test(p)),
        `${expected} in:\n${problems.join("\n")}`,
      );
    assert.equal(problems.length, 4);
  });

  test("combos the bracket counts must be listed in the Combos section, in any order", () => {
    const combo = { cards: ["Helm of the Ghastlord", "Fevered Visions"] };
    const bracket = (combos: { cards: string[] }[]) => ({
      before: { gameChangers: [], massLandDenial: [], extraTurns: [], combos: [] },
      after: { gameChangers: [], massLandDenial: [], extraTurns: [], combos },
      excluded: [],
      gameChangerOptions: [],
    });
    const unlisted = checkReport(
      report({ bracket: bracket([combo]) } as unknown as Partial<Report>),
    );
    assert.deepEqual(unlisted, [
      "Bracket: counts the combo Helm of the Ghastlord + Fevered Visions, but the Combos section doesn't list it.",
    ]);
    const listed = checkReport(
      report({
        bracket: bracket([combo]),
        combosPresent: [{ cards: ["Fevered Visions", "Helm of the Ghastlord"] }],
      } as unknown as Partial<Report>),
    );
    assert.deepEqual(listed, []);
    // The bracket estimate can miss (or fail on) a combo the search found; that's not an error.
    const notCounted = checkReport(
      report({ bracket: bracket([]), combosPresent: [combo] } as unknown as Partial<Report>),
    );
    assert.deepEqual(notCounted, []);
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
