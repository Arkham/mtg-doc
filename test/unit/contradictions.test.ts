import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyTextFixes,
  knownCards,
  plausibleFix,
  reportFacts,
  reportTexts,
} from "../../server/analysis/contradictions.ts";
import type { Report } from "../../shared/types.ts";

const snap = {
  totalCards: 100,
  totalPriceUsd: 250,
  mana: { landCount: 36, recommendedLands: 38, avgCmc: 3.1, rampCount: 9, tappedLands: [] },
  roles: [{ role: "ramp", count: 9, target: 10 }],
};
const card = (name: string) => ({ name, qty: 1 });
const report = {
  commanders: ["Lathril, Blade of the Elves"],
  strategy: "Go wide. Counterspell stays in the deck.",
  swaps: [
    {
      out: "Counterspell",
      in: "Llanowar Elves",
      category: "ramp",
      reason: "Keep the proposal. Cheap ramp.",
    },
    { out: "Forest", in: "Overgrown Tomb", category: "mana", reason: "Untapped dual." },
  ],
  synergies: [
    { title: "Real", cards: ["A", "B"], explanation: "Works." },
    { title: "Impossible", cards: ["A", "C"], explanation: "Can't work." },
  ],
  manaSuggestions: [
    { id: "m", reason: "More black.", changes: [{ action: "add", name: "Swamp" }] },
  ],
  before: snap,
  after: snap,
  original: {
    decklist: [card("Counterspell"), card("Forest")],
    combosPresent: [],
    combosOneAway: [],
  },
  decklist: [card("Llanowar Elves"), card("Overgrown Tomb")],
  combosPresent: [],
  options: { budgetTotal: 300, budgetPerCard: null },
} as unknown as Report;

describe("contradiction check", () => {
  test("covers every model-written text, with what it's about", () => {
    const texts = reportTexts(report);
    assert.deepEqual(
      texts.map((t) => t.id),
      ["strategy", "swap-0", "swap-1", "synergy-0", "synergy-1"],
    );
    assert.equal(texts[1].kind, "reason for the swap cut Counterspell → add Llanowar Elves");
  });

  test("facts name both lists and the swaps, so a text can be checked against them", () => {
    const facts = reportFacts(report);
    assert.match(facts, /Deck as submitted \(what the owner plays today\): Counterspell; Forest\./);
    assert.match(facts, /Suggested deck \(after all the swaps\): Llanowar Elves; Overgrown Tomb\./);
    assert.match(
      facts,
      /Swaps \(cut → add\): Counterspell → Llanowar Elves; Forest → Overgrown Tomb\./,
    );
    assert.match(facts, /Total budget: \$300\./);
  });

  test("applies rewrites and drops impossible synergies, leaving the rest alone", () => {
    const fixed = applyTextFixes(report, [
      { id: "strategy", quote: "", problem: "", fixed: "Go wide. Counterspell is cut." },
      { id: "swap-0", quote: "", problem: "", fixed: " Cheap ramp. " },
      { id: "synergy-1", quote: "", problem: "", fixed: null },
    ]);
    assert.equal(fixed.strategy, "Go wide. Counterspell is cut.");
    assert.deepEqual(
      fixed.swaps.map((s) => s.reason),
      ["Cheap ramp.", "Untapped dual."],
    );
    assert.deepEqual(
      fixed.synergies!.map((s) => s.title),
      ["Real"],
    );
    assert.equal(fixed.manaSuggestions![0].reason, "More black.", "code's own text");
    assert.equal(report.strategy, "Go wide. Counterspell stays in the deck.", "input untouched");
  });

  test("only minimal rewrites count as fixes; only synergies can be dropped", () => {
    const text = "Counterspell stays in the deck, protecting the combo.";
    assert.ok(
      plausibleFix(text, "Counterspell is cut; the combo relies on other protection.", "strategy"),
    );
    assert.ok(!plausibleFix(text, text, "strategy"), "unchanged");
    assert.ok(!plausibleFix(text, "  ", "strategy"), "empty");
    assert.ok(!plausibleFix(text, "Cut.", "swap-0"), "guts the text");
    assert.ok(!plausibleFix(text, text.repeat(5), "swap-0"), "a different, longer text");
    assert.ok(!plausibleFix(text, null, "swap-0"));
    assert.ok(plausibleFix(text, null, "synergy-2"));
  });

  test("a fix that brings in a card the text didn't name is rejected", () => {
    // A real case: the model "fixed" a correct land-swap reason by naming a different land.
    const cards = knownCards(report);
    const text = "Counterspell stays, Llanowar Elves comes in.";
    assert.ok(
      !plausibleFix(text, "Counterspell is cut, Overgrown Tomb comes in.", "swap-0", cards),
    );
    assert.ok(plausibleFix(text, "Counterspell is cut, Llanowar Elves comes in.", "swap-0", cards));
  });
});
