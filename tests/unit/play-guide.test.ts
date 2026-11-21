import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  GUIDE_LIMITS,
  fitGuide,
  guideTexts,
  withGuideText,
} from "../../src/server/analysis/play-guide.ts";
import { keepGuidesTo } from "../../src/server/play-guide.ts";
import type { PlayGuide } from "../../src/shared/types.ts";
import { spell, testDeck } from "../support/cards.ts";

const guide = (extra: Partial<PlayGuide> = {}): PlayGuide => ({
  summary: " Drain the table. ",
  early: ["Ramp.", " ", "Cast the commander.", "Hold removal.", "Too many."],
  mid: ["Attack."],
  late: ["Win."],
  winConditions: ["The drain."],
  keyCards: [
    { name: "Sol Ring", why: "Fast mana." },
    { name: "sol ring", why: "A repeat." },
    { name: "Mind Stone", why: "Not in the deck." },
  ],
  mulligan: "Three lands and a rock.",
  watchOut: ["Wipes."],
  ...extra,
});

describe("how-to-play guides", () => {
  test("fit the deck: key cards resolved or dropped, repeats and blanks gone, lists capped", () => {
    const names = new Map([["sol ring", "Sol Ring"]]);
    const fit = fitGuide(guide(), (n) => names.get(n.toLowerCase()) ?? null);
    assert.equal(fit.summary, "Drain the table.");
    assert.deepEqual(fit.early, ["Ramp.", "Cast the commander.", "Hold removal."]);
    assert.equal(fit.early.length, GUIDE_LIMITS.phase);
    assert.deepEqual(fit.keyCards, [{ name: "Sol Ring", why: "Fast mana." }]);
  });

  test("after an edit without a model, keep only the key cards each deck still runs", () => {
    const withRing = testDeck(36, [spell("Sol Ring")]);
    const without = testDeck(37);
    const kept = keepGuidesTo(
      { original: guide(), optimized: guide() },
      { original: withRing, optimized: without },
    )!;
    assert.deepEqual(
      kept.original!.keyCards.map((k) => k.name),
      ["Sol Ring"],
    );
    assert.deepEqual(kept.optimized!.keyCards, [], "the suggested deck cut it");
  });

  test("every text has a key the contradiction check can write back to", () => {
    const g = fitGuide(guide(), (n) => (n === "Sol Ring" ? n : null));
    const texts = guideTexts(g);
    assert.deepEqual(
      texts.map((t) => t.key),
      [
        "summary",
        "early.0",
        "early.1",
        "early.2",
        "mid.0",
        "late.0",
        "winConditions.0",
        "watchOut.0",
        "keyCards.0",
        "mulligan",
      ],
    );
    let fixed = g;
    for (const t of texts) fixed = withGuideText(fixed, t.key, `${t.text}!`);
    assert.deepEqual(
      guideTexts(fixed).map((t) => t.text),
      texts.map((t) => `${t.text}!`),
    );
    assert.equal(fixed.keyCards[0].name, "Sol Ring", "only the explanation changes");
  });
});
