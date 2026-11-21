import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { plainText, proseParts, refsIn, resolveRefs } from "../../src/shared/card-refs.ts";
import { settleRefs } from "../../src/server/analysis/prose.ts";
import type { Report } from "../../src/shared/types.ts";
import { isNamedCard, looksLikeNickname } from "../../src/server/card-index.ts";
import { card } from "../support/cards.ts";

const preview = (slug: string) => ({
  image: `https://img.test/${slug}.jpg`,
  scryfallUri: `https://scryfall.test/${slug}`,
});
describe("card references in copy", () => {
  test("parts, plain text and the names referenced", () => {
    const text = "Pair [[Sol Ring]] with [[ Mind Stone ]].";
    assert.deepEqual(proseParts(text), [
      "Pair ",
      { card: "Sol Ring" },
      " with ",
      { card: "Mind Stone" },
      ".",
    ]);
    assert.equal(plainText(text), "Pair Sol Ring with Mind Stone.");
    assert.deepEqual(refsIn(text), ["Sol Ring", "Mind Stone"]);
  });

  test("references to anything that isn't a known card become plain words", () => {
    const known = new Map([["sol ring", "Sol Ring"]]);
    assert.equal(
      resolveRefs("[[sol ring]] and [[Not A Card]]", (n) => known.get(n.toLowerCase()) ?? null),
      "[[Sol Ring]] and Not A Card",
    );
    // A report keeps only references its card index can preview.
    const report = {
      strategy: "Ramp with [[Sol Ring]], then [[Invented Card]].",
      swaps: [{ out: "a", in: "b", category: "other", reason: "[[mind stone]] is cheaper." }],
      cardIndex: { "Sol Ring": preview("sol"), "Mind Stone": preview("mind") },
    } as unknown as Report;
    const settled = settleRefs(report);
    assert.equal(settled.strategy, "Ramp with [[Sol Ring]], then Invented Card.");
    assert.equal(settled.swaps[0].reason, "[[Mind Stone]] is cheaper.");
  });
});

describe("references to cards outside the report", () => {
  test("count only when they name a playable card in full", () => {
    assert.ok(isNamedCard(card({ name: "Stasis", legalCommander: true }), "stasis"));
    assert.ok(
      isNamedCard(
        card({ name: "Kefka, Court Mage // Kefka, Ruler of Ruin", legalCommander: true }),
        "Kefka, Court Mage",
      ),
      "a double-faced card by its front",
    );
    // Real cases: nicknames that Scryfall resolves to some other card.
    assert.ok(
      !isNamedCard(card({ name: "Beck // Call", legalCommander: true }), "Call"),
      "half of a split card",
    );
    assert.ok(
      !isNamedCard(card({ name: "Rift", legalCommander: false }), "Rift"),
      "a playtest card",
    );
    assert.ok(!isNamedCard(card({ name: "Lotus", legalCommander: false }), "Lotus"), "a token");
  });

  test("a short name inside a longer card nearby is a nickname, even when it's a real card", () => {
    // From a real chat: "gives up the [[Lich]]'s graveyard setup", meaning Underrealm Lich.
    assert.ok(looksLikeNickname("Lich", ["Skithiryx, the Blight Dragon", "Underrealm Lich"]));
    assert.ok(looksLikeNickname("rift", ["Cyclonic Rift"]));
    assert.ok(looksLikeNickname("Lotus", ["Jeweled Lotus"]));
    assert.ok(!looksLikeNickname("Stasis", ["Static Orb", "Winter Orb"]));
    assert.ok(!looksLikeNickname("Lich", ["Lich"]), "the card itself isn't a nickname for itself");
    assert.ok(!looksLikeNickname("Orb", ["Orbs of Warding"]), "whole words only");
  });
});
