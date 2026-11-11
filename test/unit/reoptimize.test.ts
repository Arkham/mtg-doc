import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Report } from "../../shared/types.ts";
import { optimizationGaps, worsenedGaps } from "../../server/analysis/reoptimize.ts";

function report(over: {
  lands?: number;
  blue?: number;
  removal?: number;
  checks?: boolean[];
  price?: number;
}): Report {
  return {
    after: {
      mana: {
        landCount: over.lands ?? 36,
        recommendedLands: 36,
        colors: [{ color: "U", landSources: over.blue ?? 15, targetSources: 15 }],
      },
      roles: [
        { role: "land", count: over.lands ?? 36, target: 36 },
        { role: "removal", count: over.removal ?? 8, target: 8 },
        { role: "wincon", count: 1, target: null },
      ],
      totalPriceUsd: over.price ?? 250,
    },
    bracket: {
      target: 3,
      after: {
        checks: (over.checks ?? [true]).map((ok, i) => ({ label: `Check ${i}`, ok, detail: "d" })),
      },
    },
    options: { budgetTotal: 300 },
  } as unknown as Report;
}

describe("optimizationGaps", () => {
  test("a tuned deck has none, and one card either way is noise", () => {
    assert.deepEqual(optimizationGaps(report({})), []);
    assert.deepEqual(optimizationGaps(report({ lands: 35, blue: 14, removal: 7 })), []);
  });

  test("names what's off, by how much", () => {
    const gaps = optimizationGaps(
      report({ lands: 33, blue: 11, removal: 5, checks: [true, false], price: 320 }),
    );
    assert.deepEqual(
      gaps.map((g) => [g.key, g.size]),
      [
        ["lands", 3],
        ["color:U", 4],
        ["role:removal", 3],
        ["bracket:Check 1", 1],
        ["budget", 20],
      ],
    );
    assert.equal(gaps[0].text, "33 lands, under the recommended 36");
  });
});

describe("worsenedGaps", () => {
  test("only gaps the change opened or widened count", () => {
    const before = report({ lands: 33, removal: 5 });
    assert.deepEqual(worsenedGaps(before, report({ lands: 33, removal: 5 })), []);
    assert.deepEqual(
      worsenedGaps(before, report({ lands: 31, removal: 5 })).map((g) => g.key),
      ["lands"],
    );
    assert.deepEqual(worsenedGaps(before, report({ lands: 35, removal: 5 })), [], "it improved");
    assert.deepEqual(
      worsenedGaps(report({}), report({ checks: [false] })).map((g) => g.key),
      ["bracket:Check 0"],
    );
  });
});
