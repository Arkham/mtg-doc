import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type Sighting,
  estimateQuantity,
  mapLimit,
  planTilings,
  splitByVotes,
  tallySightings,
  tileGrid,
} from "../../server/analysis/vision.ts";

const sighting = (pass: string, name: string, qty = 1, tile: string | null = null): Sighting => ({
  pass,
  tile,
  name,
  printed: "",
  lang: "en",
  qty,
});

describe("tileGrid", () => {
  test("covers the whole image with overlapping tiles inside its bounds", () => {
    const rects = tileGrid(4032, 3024, 3, 2);
    assert.equal(rects.length, 6);
    for (const r of rects) {
      assert.ok(r.left >= 0 && r.top >= 0 && r.left + r.width <= 4032 && r.top + r.height <= 3024);
    }
    assert.ok(rects[1].left < rects[0].left + rects[0].width, "neighbours overlap");
    assert.equal(Math.max(...rects.map((r) => r.left + r.width)), 4032);
    assert.equal(Math.max(...rects.map((r) => r.top + r.height)), 3024);
  });
});

describe("planTilings", () => {
  test("a phone photo gets two tilings with different boundaries", () => {
    const [a, b] = planTilings(4032, 3024);
    assert.equal(a.length, 3 * 2);
    assert.equal(b.length, 4 * 3);
    assert.notDeepEqual(a[0], b[0]);
  });
  test("screenshots and small images get no tiles", () => {
    assert.deepEqual(planTilings(1170, 1100), []);
  });
});

describe("voting", () => {
  test("groups sightings by resolved card and counts independent passes", () => {
    const tallies = tallySightings([
      { sighting: sighting("full", "Sol Ring"), key: "Sol Ring" },
      { sighting: sighting("tilesA", "Sol Rng", 1, "0:0:1"), key: "Sol Ring" },
      { sighting: sighting("tilesA", "Sol Ring", 1, "0:0:2"), key: "Sol Ring" },
      { sighting: sighting("tilesB", "Gibberish"), key: null },
      { sighting: sighting("tilesB", "Arcane Signet", 1, "0:1:0"), key: "Arcane Signet" },
    ]);
    assert.deepEqual([...tallies.keys()], ["Sol Ring", "Arcane Signet"]);
    assert.deepEqual([...tallies.get("Sol Ring")!.passes].sort(), ["full", "tilesA"]);
    const { accepted, contested } = splitByVotes(tallies.values(), 2);
    assert.deepEqual(
      accepted.map((t) => t.key),
      ["Sol Ring"],
    );
    assert.deepEqual(
      contested.map((t) => t.key),
      ["Arcane Signet"],
    );
  });

  test("quantities prefer the whole-photo count, else the smaller tile total", () => {
    const tally = (sightings: Sighting[]) =>
      tallySightings(sightings.map((s) => ({ sighting: s, key: "Island" }))).get("Island")!;
    assert.equal(
      estimateQuantity(tally([sighting("full", "Island", 9), sighting("tilesA", "Island", 12)])),
      9,
    );
    assert.equal(
      estimateQuantity(
        tally([
          sighting("tilesA", "Island", 5),
          sighting("tilesA", "Island", 6),
          sighting("tilesB", "Island", 10),
        ]),
      ),
      10,
    );
  });
});

describe("mapLimit", () => {
  test("preserves order and caps concurrency", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n, i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n * 2));
      active--;
      return `${i}:${n}`;
    });
    assert.deepEqual(out, ["0:5", "1:1", "2:4", "3:2", "4:3"]);
    assert.equal(peak, 2);
  });
});
