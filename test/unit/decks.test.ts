import "../support/env.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkSavedDeck } from "../../server/storage.ts";

const DECKS = path.resolve(import.meta.dirname, "../../decks");

for (const slug of fs
  .readdirSync(DECKS)
  .filter((f) => fs.statSync(path.join(DECKS, f)).isDirectory())) {
  test(`published deck ${slug} is consistent across every section`, async () => {
    assert.deepEqual(await checkSavedDeck(path.join(DECKS, slug)), []);
  });
}
