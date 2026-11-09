import "../support/env.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BRACKETS } from "../../server/analysis/bracket.ts";
import { parseDecklist } from "../../server/decklist.ts";
import { readDeckFile } from "../../server/storage.ts";
import type { Report } from "../../shared/types.ts";
import { optimizeFixtureDeck } from "../support/sample.ts";

function assertLegalDeck(report: Report, optimized: string) {
  const list = parseDecklist(optimized);
  assert.deepEqual(list.commanders, ["Lathril, Blade of the Elves"]);
  assert.equal(list.entries.reduce((n, e) => n + e.qty, 0) + 1, 100, "exactly 100 cards");
  assert.equal(report.after.totalCards, 100);
  const nonBasics = list.entries.filter((e) => !/^(Forest|Swamp)$/.test(e.name));
  assert.ok(
    nonBasics.every((e) => e.qty === 1),
    "singleton",
  );
  for (const s of report.swaps) {
    assert.ok(s.inCard, `swap ${s.in} has card data`);
    assert.ok(
      s.inCard.colorIdentity.every((c) => c === "B" || c === "G"),
      `${s.in} is in color identity`,
    );
    assert.ok(s.inCard.legalCommander, `${s.in} is legal`);
  }
  assert.ok(
    !report.decklist!.some((c) => c.name === "Divination" || c.name === "Thornwood Falls"),
    "off-color cards are cut",
  );
}

describe("full optimizer pipeline (recorded APIs, no LLM)", () => {
  test("bracket 3, max power, $300 budget: fixes an over-powered deck", async () => {
    const { slug, job, report } = await optimizeFixtureDeck("lathril-overpowered.txt", {
      bracket: 3,
      tone: "max",
      budgetTotal: 300,
      maxSwaps: 12,
    });
    assert.ok(job.steps.every((s) => s.status === "done" || s.status === "skipped"));
    assertLegalDeck(report, await readDeckFile(slug, "optimized.txt"));

    const b = report.bracket!;
    assert.equal(b.target, 3);
    assert.equal(b.before.bracket, 4, "6 Game Changers + an extra-turn card start at bracket 4");
    assert.ok(b.after.bracket <= 3, "verified inside the target bracket");
    assert.ok(b.after.gameChangers.length <= BRACKETS[3].gameChangers);
    assert.equal(b.after.extraTurns.length, 0);
    assert.ok(b.after.checks.every((c) => c.ok));
    assert.ok(report.after.totalPriceUsd <= 300, `deck costs $${report.after.totalPriceUsd}`);
    assert.ok(report.before.totalPriceUsd > 300);
    assert.ok(report.swaps.some((s) => s.category === "bracket"));
    assert.ok(report.swaps.some((s) => s.alternatives && s.alternatives.length > 0));
    assert.equal(report.model, null);

    // The mana base pass replaces tapped lands with untapped ones and leaves actionable suggestions.
    assert.ok(report.after.mana.tappedLands.length < report.before.mana.tappedLands.length);
    const landSwaps = report.swaps.filter(
      (s) => s.category === "mana" && s.inCard?.isLand && s.outCard?.isLand,
    );
    assert.ok(landSwaps.length > 0);
    assert.ok(landSwaps.every((s) => !s.inCard!.entersTapped));
    assert.ok(Array.isArray(report.manaSuggestions));
    for (const m of report.manaSuggestions!) {
      assert.deepEqual(
        m.changes.map((c) => c.action),
        ["remove", "add"],
      );
      assert.ok(m.changes.every((c) => c.ok && c.card?.isLand));
    }

    // Combos describe the final deck: nothing "one card away" is already in it.
    const finalNames = new Set(report.decklist!.map((c) => c.name));
    assert.ok(report.combosOneAway.every((c) => !finalNames.has(c.missing[0])));
    assert.ok(
      report.combosPresent.every((c) =>
        c.cards.every((n) => finalNames.has(n) || report.commanders.includes(n)),
      ),
    );

    // Every card the report mentions has preview data.
    const index = report.cardIndex!;
    const mentioned = [
      ...report.commanders,
      ...report.swaps.flatMap((s) => [s.in, s.out, ...(s.alternatives ?? []).map((a) => a.name)]),
      ...report.decklist!.map((c) => c.name),
      ...report.combosOneAway.flatMap((c) => c.cards),
      ...b.after.gameChangers,
      ...b.gameChangerOptions.map((g) => g.name),
      ...b.excluded.map((e) => e.name),
      ...report.after.mana.tappedLands,
    ];
    const missing = [...new Set(mentioned)].filter((n) => !index[n]?.image);
    assert.deepEqual(missing, [], "every mentioned card has a preview");
    assert.match(report.strategy, /no LLM configured/);
  });

  test("bracket 2, casual: no Game Changers or combos, sound mana base", async () => {
    const { slug, report } = await optimizeFixtureDeck("lathril.txt", {
      bracket: 2,
      tone: "casual",
      maxSwaps: 8,
    });
    assertLegalDeck(report, await readDeckFile(slug, "optimized.txt"));
    const b = report.bracket!;
    assert.equal(b.after.bracket, 2);
    assert.equal(b.after.gameChangers.length, 0);
    assert.ok(b.after.combos.every((c) => !c.twoCard));
    const lands = report.after.mana.landCount + report.after.mana.mdfcLands * 0.5;
    assert.ok(
      Math.abs(lands - report.after.mana.recommendedLands) <= 2,
      "land count near recommendation",
    );
    assert.ok(report.after.mana.tappedLands.length <= report.before.mana.tappedLands.length);
    const md = await readDeckFile(slug, "report.md");
    for (const heading of [
      "## Bracket 2: Core",
      "## Swaps",
      "## Mana base",
      "## Goldfish simulation",
    ]) {
      assert.ok(md.includes(heading), `report.md has ${heading}`);
    }
  });
});
