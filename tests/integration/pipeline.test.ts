import "../support/env.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BRACKETS } from "../../src/server/analysis/bracket.ts";
import { parseDecklist } from "../../src/server/decklist.ts";
import { readDeckFile } from "../../src/server/storage.ts";
import type { Report } from "../../src/shared/types.ts";
import { optimizeFixtureDeck } from "../support/sample.ts";
import { listedCards, mdSection } from "../support/markdown.ts";

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

describe("full optimizer pipeline (fake APIs, no LLM)", () => {
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
      assert.ok(m.changes.every((c) => !c.problem && c.card?.isLand));
    }

    // The submitted deck is kept for the default view, untouched by the swaps.
    const original = report.original!;
    assert.ok(original.decklist.every((c) => !c.isNew && c.delta === 0));
    assert.ok(report.swaps.every((s) => original.decklist.some((c) => c.name === s.out)));
    assert.ok(Array.isArray(original.combosPresent) && Array.isArray(original.combosOneAway));

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
    const pieces = report.combosOneAway.map((c) => c.missing[0]);
    assert.ok(
      pieces.every((n) => index[n]?.priceUsd !== undefined),
      "one-card-away pieces show a price",
    );
    assert.match(report.strategy, /no LLM configured/);
  });

  test("bracket 2, casual: no Game Changers or combos, sound mana base", async () => {
    const { slug, report, job } = await optimizeFixtureDeck("lathril.txt", {
      bracket: 2,
      tone: "casual",
      maxSwaps: 8,
    });
    assertLegalDeck(report, await readDeckFile(slug, "optimized.txt"));
    assert.equal(
      job.steps.find((s) => s.label === "Check for contradictions")!.status,
      "skipped",
      "needs an LLM",
    );
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
    // The deck as submitted and the doc's suggestions are separate parts, so an agent can't take
    // a suggested card for one the deck plays.
    const part1 = mdSection(md, /^Part 1: The deck as submitted$/);
    const part2 = mdSection(md, /^Part 2: The doc's suggestions/);
    const names = (cards: { name: string; qty: number }[]) =>
      cards.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    assert.deepEqual(
      listedCards(mdSection(part1, /^Decklist \(100 cards\)$/)).sort((a, b) => a.localeCompare(b)),
      names(report.original!.decklist),
    );
    assert.deepEqual(
      listedCards(mdSection(part2, /^Suggested decklist/)).sort((a, b) => a.localeCompare(b)),
      names(report.decklist!),
    );
    const submitted = new Set(report.original!.decklist.map((c) => c.name));
    const added = report.swaps.map((s) => s.in).filter((n) => !submitted.has(n));
    assert.ok(added.length > 0);
    // Part 1 can name a suggested card only as the piece a combo is missing, saying so.
    const oneAway = /^### Combos one card away$/m.test(part1)
      ? mdSection(part1, /^Combos one card away$/)
      : "";
    for (const name of added) {
      assert.ok(
        !part1.replace(oneAway, "").includes(name),
        `${name} only comes in with the swaps, not in Part 1`,
      );
      for (const line of oneAway.split("\n").filter((l) => l.includes(`**${name}**`)))
        assert.match(line, /one of the suggested swaps in Part 2 adds it/);
      assert.ok(part2.includes(name), `${name} is in Part 2`);
    }
    for (const heading of [
      /^Stats$/,
      /^Bracket \d: /,
      /^Combos in the deck$/,
      /^Suggested swaps \(\d+\)$/,
      /^What the swaps change$/,
      /^Bracket after the swaps: 2$/,
    ])
      mdSection(md, heading);
    assert.match(md, /^> \*\*How to read this report\.\*\* Part 1 is the deck exactly as/m);
  });
});
