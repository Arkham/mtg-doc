import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deckPaths, hashRoute, isAppPath, pathRoute, routeHref } from "../../src/routes.ts";

describe("routes", () => {
  test("routes for each view: hashes locally, real paths on the published site", () => {
    const optimized = { page: "deck", slug: "x", view: "optimized" } as const;
    assert.equal(routeHref({ page: "deck", slug: "x", view: "current" }, false), "#/deck/x");
    assert.equal(routeHref(optimized, false), "#/deck/x/optimized");
    assert.equal(routeHref(optimized, true), "decks/x/optimized/");
    assert.equal(routeHref({ page: "home" }, true), "./");
    assert.deepEqual(pathRoute("decks/x/optimized/"), optimized);
    assert.deepEqual(pathRoute("decks/x/"), { page: "deck", slug: "x", view: "current" });
    assert.deepEqual(pathRoute(""), { page: "home" });
    // Links shared before the published site had real paths still find the deck, and links to
    // the old pre-game summary page land on its deck.
    assert.deepEqual(hashRoute("#/deck/x/optimized"), optimized);
    assert.deepEqual(hashRoute("#/deck/x/optimized/rule0"), optimized);
    assert.deepEqual(pathRoute("decks/x/rule0/"), { page: "deck", slug: "x", view: "current" });
    assert.equal(hashRoute("#bracket"), null);
    // Every route the app can reach on the published site has a page to land on.
    for (const path of deckPaths("x")) {
      assert.ok(isAppPath(path));
      assert.equal(routeHref(pathRoute(path), true), path);
    }
    assert.equal(deckPaths("x").length, 2);
    assert.ok(!isAppPath("data/decks/x/report.md"));
  });
});
