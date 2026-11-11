import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BracketReport, DeckEdit, Swap } from "../../shared/types.ts";
import { type Deck, cloneDeck } from "../../server/analysis/deck.ts";
import {
  fallbackCombos,
  pinEdits,
  rebaseSwaps,
  refreshBracketLists,
  reconcileSwaps,
} from "../../server/analysis/reconcile.ts";
import { forest, spell, swamp, testDeck } from "../support/cards.ts";

const helm = spell("Helm of the Ghastlord");
const fogBank = spell("Fog Bank");
const visions = spell("Fevered Visions");
const signet = spell("Arcane Signet");
const army = spell("Army of the Damned");

const initial = testDeck(37, [helm, fogBank, army]);

/** `deck` with `out` swapped for `add` (by name). */
function swap(deck: Deck, out: string, add: ReturnType<typeof spell>): Deck {
  const next = cloneDeck(deck);
  const slot = next.slots.find((s) => s.card.name === out)!;
  if (--slot.qty === 0) next.slots.splice(next.slots.indexOf(slot), 1);
  const have = next.slots.find((s) => s.card.name === add.name);
  if (have) have.qty++;
  else next.slots.push({ card: add, qty: 1 });
  return next;
}

const optimizerSwaps: Swap[] = [
  {
    out: "Helm of the Ghastlord",
    in: "Fevered Visions",
    category: "bracket",
    reason: "Removing Helm breaks the loop with Niv-Mizzet.",
    alternatives: [{ name: "Fellwar Stone", image: null, scryfallUri: "" }],
  },
  {
    out: "Army of the Damned",
    in: "Arcane Signet",
    category: "ramp",
    reason: "Cheap ramp.",
    alternatives: [
      { name: "Mind Stone", image: null, scryfallUri: "" },
      { name: "Fellwar Stone", image: null, scryfallUri: "" },
    ],
  },
];
const optimized = swap(
  swap(initial, "Helm of the Ghastlord", visions),
  "Army of the Damned",
  signet,
);

const edit = (
  ...changes: [action: "add" | "remove", name: string, reason: string][]
): DeckEdit => ({
  at: "2026-01-01T00:00:00.000Z",
  request: "",
  changes: changes.map(([action, name, reason]) => ({ action, name, qty: 1, reason })),
});

const swap0 = (out: string, add: string): Swap => ({ out, in: add, category: "mana", reason: "" });

const pairs = (swaps: Swap[]) => swaps.map((s) => [s.out, s.in, Boolean(s.fromChat)]);

describe("reconcileSwaps", () => {
  test("keeps the optimizer's swaps while the list still matches them", () => {
    assert.deepEqual(reconcileSwaps(optimizerSwaps, initial, optimized, []), optimizerSwaps);
  });

  test("a cut card put back drops its swap and pairs the added card with the new cut", () => {
    const putBack = edit(
      ["remove", "Fog Bank", "Low-synergy blocker."],
      ["add", "Helm of the Ghastlord", "Draws on every damage trigger."],
    );
    const current = swap(optimized, "Fog Bank", helm);
    const swaps = reconcileSwaps(optimizerSwaps, initial, current, [putBack]);
    assert.deepEqual(pairs(swaps), [
      ["Army of the Damned", "Arcane Signet", false],
      ["Fog Bank", "Fevered Visions", true],
    ]);
    const repaired = swaps[1];
    assert.equal(repaired.reason, "Low-synergy blocker.", "the old reason was about Helm");
    assert.equal(repaired.category, "other");
    assert.equal(repaired.outCard?.name, "Fog Bank");
    assert.equal(repaired.inCard?.name, "Fevered Visions");
    assert.ok(
      !swaps.some((s) => s.out === "Helm of the Ghastlord" || s.in === "Helm of the Ghastlord"),
    );
  });

  test("an added card taken out again pairs its cut with the card that replaced it", () => {
    const mindStone = spell("Mind Stone");
    const current = swap(optimized, "Arcane Signet", mindStone);
    const swaps = reconcileSwaps(optimizerSwaps, initial, current, [
      edit(["remove", "Arcane Signet", ""], ["add", "Mind Stone", "Untaps for value."]),
    ]);
    assert.deepEqual(pairs(swaps), [
      ["Helm of the Ghastlord", "Fevered Visions", false],
      ["Army of the Damned", "Mind Stone", true],
    ]);
    assert.equal(swaps[1].reason, "Untaps for value.");
  });

  test("new chat swaps join the list, and alternatives already in the deck are dropped", () => {
    const fellwar = spell("Fellwar Stone");
    const current = swap(optimized, "Fog Bank", fellwar);
    const swaps = reconcileSwaps(optimizerSwaps, initial, current, [
      edit(["remove", "Fog Bank", ""], ["add", fellwar.name, "More ramp."]),
    ]);
    assert.deepEqual(pairs(swaps), [
      ["Helm of the Ghastlord", "Fevered Visions", false],
      ["Army of the Damned", "Arcane Signet", false],
      ["Fog Bank", "Fellwar Stone", true],
    ]);
    assert.equal(swaps[2].reason, "More ramp.");
    assert.deepEqual(swaps[0].alternatives, []);
    assert.deepEqual(
      swaps[1].alternatives!.map((a) => a.name),
      ["Mind Stone"],
    );
  });

  test("undoing every change leaves no swaps", () => {
    const current = swap(swap(optimized, "Fevered Visions", helm), "Arcane Signet", army);
    assert.deepEqual(reconcileSwaps(optimizerSwaps, initial, current, []), []);
  });

  test("basic land swaps count copies and pair as mana swaps", () => {
    const current = swap(optimized, "Forest", swamp);
    const swaps = reconcileSwaps(optimizerSwaps, initial, current, [
      edit(["remove", "Forest", ""], ["add", "Swamp", "Black is the main color."]),
    ]);
    const land = swaps.at(-1)!;
    assert.deepEqual([land.out, land.in, land.category], ["Forest", "Swamp", "mana"]);
  });
});

test("reconcileSwaps: a request naming a basic more times than the deck still cuts pairs each copy once", () => {
  const rocks = ["Fellwar Stone", "Thought Vessel", "Mind Stone"].map((n) => spell(n));
  // Three Forests out for rocks, then the optimizer brought two Forests back for Swamps, listing
  // only one of those swaps (its own list isn't trusted for copies of basics).
  let current = rocks.reduce((d, rock) => swap(d, "Forest", rock), optimized);
  current = swap(swap(current, "Swamp", forest), "Swamp", forest);
  const swaps = reconcileSwaps([...optimizerSwaps, swap0("Swamp", "Forest")], initial, current, [
    edit(
      ...rocks.flatMap((r): [action: "add" | "remove", name: string, reason: string][] => [
        ["remove", "Forest", ""],
        ["add", r.name, ""],
      ]),
    ),
  ]);
  const outs = swaps.map((s) => s.out).sort();
  assert.deepEqual(outs, [
    "Army of the Damned",
    "Forest",
    "Helm of the Ghastlord",
    "Swamp",
    "Swamp",
  ]);
  assert.deepEqual(
    swaps
      .filter((s) => s.fromChat)
      .map((s) => s.in)
      .sort(),
    ["Fellwar Stone", "Mind Stone", "Thought Vessel"],
  );
});

describe("rebaseSwaps", () => {
  const cards = new Map([visions, signet].map((c) => [c.name, c]));
  const names = (d: Deck) => d.slots.map((s) => `${s.qty} ${s.card.name}`).sort();

  test("an unedited submitted list rebuilds the same suggested deck", () => {
    const { deck, swaps } = rebaseSwaps(initial, optimizerSwaps, cards);
    assert.deepEqual(names(deck), names(optimized));
    assert.deepEqual(swaps, optimizerSwaps);
  });

  test("a card the user swapped in their own list carries through to the suggestions", () => {
    const edited = swap(initial, "Fog Bank", spell("Wall of Omens"));
    const { deck, swaps } = rebaseSwaps(edited, optimizerSwaps, cards);
    assert.deepEqual(names(deck), names(swap(optimized, "Fog Bank", spell("Wall of Omens"))));
    assert.equal(swaps.length, 2);
  });

  test("replacing a card the doc cut drops that swap: the user's pick wins the slot", () => {
    const edited = swap(initial, "Helm of the Ghastlord", spell("Wall of Omens"));
    const { deck, swaps } = rebaseSwaps(edited, optimizerSwaps, cards);
    assert.deepEqual(
      swaps.map((s) => s.in),
      ["Arcane Signet"],
    );
    assert.ok(deck.slots.some((s) => s.card.name === "Wall of Omens"));
    assert.ok(!deck.slots.some((s) => s.card.name === "Fevered Visions"));
  });

  test("adding a card the doc wanted to add drops that swap and keeps the card it would cut", () => {
    const edited = swap(initial, "Filler 0", signet);
    const { deck, swaps } = rebaseSwaps(edited, optimizerSwaps, cards);
    assert.deepEqual(
      swaps.map((s) => s.in),
      ["Fevered Visions"],
    );
    assert.ok(deck.slots.some((s) => s.card.name === "Army of the Damned"));
    assert.equal(deck.slots.find((s) => s.card.name === "Arcane Signet")!.qty, 1);
  });
});

describe("pinEdits", () => {
  const names = (d: Deck) => d.slots.map((s) => `${s.qty} ${s.card.name}`).sort();
  const mindStone = spell("Mind Stone");
  const cards = new Map([visions, signet, mindStone, swamp].map((c) => [c.name, c]));

  test("starts from the submitted list with only chat's swaps, so it stays at 100 cards", () => {
    // Chat swapped the doc's Signet for Mind Stone, and a Forest for a Swamp.
    const edits = [
      edit(["remove", "Arcane Signet", ""], ["add", "Mind Stone", ""]),
      edit(["remove", "Forest", ""], ["add", "Swamp", ""]),
    ];
    const current = swap(swap(optimized, "Arcane Signet", mindStone), "Forest", swamp);
    const swaps = reconcileSwaps(optimizerSwaps, initial, current, edits);
    const pinned = pinEdits(initial, swaps, cards, edits);
    assert.deepEqual(
      names(pinned.deck),
      names(swap(swap(initial, "Army of the Damned", mindStone), "Forest", swamp)),
      "Mind Stone keeps the slot the doc's Signet took; the doc's other swaps are left to the re-run",
    );
    assert.deepEqual(pinned.added, ["Mind Stone"], "locked in the re-run");
    assert.deepEqual(pinned.removed, ["Arcane Signet"], "never re-added");
  });

  test("a card added then taken out again isn't kept, and doesn't come back", () => {
    const edits = [
      edit(["remove", "Fog Bank", ""], ["add", "Mind Stone", ""]),
      edit(["remove", "Mind Stone", ""], ["add", "Fog Bank", ""]),
    ];
    const swaps = reconcileSwaps(optimizerSwaps, initial, optimized, edits);
    const pinned = pinEdits(initial, swaps, cards, edits);
    assert.deepEqual(names(pinned.deck), names(initial));
    assert.deepEqual(pinned.added, []);
    assert.deepEqual(pinned.removed, ["Mind Stone"]);
  });
});

describe("fallbackCombos", () => {
  const combo = (cards: string[], missing: string[] = []) => ({
    id: cards.join("+"),
    cards,
    missing,
    produces: [],
    description: "",
    bracketTag: null,
    url: "",
  });

  test("keeps only combos that still hold, and adds those the bracket estimate found", () => {
    const current = swap(optimized, "Fog Bank", helm);
    const { present, oneAway } = fallbackCombos(
      {
        present: [combo(["Helm of the Ghastlord", "Fevered Visions"]), combo(["Fog Bank", "Cmdr"])],
        oneAway: [
          combo(["Fog Bank", "Arcane Signet"], ["Fog Bank"]),
          combo(["Helm of the Ghastlord", "Arcane Signet"], ["Helm of the Ghastlord"]),
          combo(["Mind Stone", "Fog Bank"], ["Mind Stone"]),
        ],
      },
      current,
      [
        {
          cards: ["Cmdr", "Arcane Signet"],
          produces: ["Infinite mana"],
          twoCard: true,
          tag: "S",
          earlyPct: null,
          url: "u",
        },
      ],
    );
    assert.deepEqual(
      present.map((c) => c.cards),
      [
        ["Helm of the Ghastlord", "Fevered Visions"],
        ["Cmdr", "Arcane Signet"],
      ],
    );
    assert.deepEqual(
      oneAway.map((c) => c.cards),
      [["Fog Bank", "Arcane Signet"]],
    );
  });
});

describe("refreshBracketLists", () => {
  test("marks Game Changers in the deck and drops skipped cards the user added", () => {
    const bracket = {
      gameChangerOptions: [
        { name: "Fevered Visions", score: 1, inDeck: false },
        { name: "Mind Stone", score: 1, inDeck: true },
      ],
      excluded: [
        { name: "Helm of the Ghastlord", reason: "completes a combo" },
        { name: "Mind Stone", reason: "too strong" },
      ],
    } as BracketReport;
    const next = refreshBracketLists(bracket, swap(optimized, "Fog Bank", helm));
    assert.deepEqual(
      next.gameChangerOptions.map((g) => [g.name, g.inDeck]),
      [
        ["Fevered Visions", true],
        ["Mind Stone", false],
      ],
    );
    assert.deepEqual(
      next.excluded.map((e) => e.name),
      ["Mind Stone"],
    );
  });
});
