import "../support/env.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../src/server/app.ts";
import { applyDeckChanges } from "../../src/server/chat.ts";
import { config } from "../../src/server/config.ts";
import { cancelDebounced, whenIdle } from "../../src/server/edit-queue.ts";
import { startOptimize } from "../../src/server/pipeline.ts";
import { resumeRefreshes } from "../../src/server/refresh.ts";
import type {
  DeckChatMessage,
  DeckDetail,
  DeckStatus,
  EditStatus,
} from "../../src/shared/types.ts";
import { optimizeFixtureDeck, waitForJob } from "../support/sample.ts";

// Long enough that a slow machine (CI, with coverage) makes both edits before the first refresh.
const DELAY = 2_000;

/** Commander Spellbook combo searches: the refresh makes one, an edit makes none. */
let comboSearches = 0;
/** While set, combo searches wait for it: a refresh paused partway. */
let gate: Promise<void> | null = null;
let searching = () => {};
const replay = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).includes("/find-my-combos")) {
    comboSearches++;
    searching();
    if (gate) await gate;
  }
  return replay(input, init);
};

let base = "";
let close: () => void;
let slug = "";

before(async () => {
  ({ slug } = await optimizeFixtureDeck("lathril.txt", {
    bracket: 3,
    tone: "balanced",
    maxSwaps: 6,
  }));
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  config.refreshDelayMs = DELAY;
});
after(() => {
  config.refreshDelayMs = 0;
  close();
});

const pendingFile = () => path.join(config.decksDir, slug, "refresh.json");
const detail = async () => (await (await fetch(`${base}/api/decks/${slug}`)).json()) as DeckDetail;

/** Proposes a swap in chat and applies it, waiting for the edit (not the refresh after it). */
async function swap(out: string, add: string) {
  const reply = (await (
    await fetch(`${base}/api/decks/${slug}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: `swap ${out} for ${add}` }),
    })
  ).json()) as DeckChatMessage;
  const { editId } = (await (
    await fetch(`${base}/api/decks/${slug}/chat/${reply.id}/apply`, { method: "POST" })
  ).json()) as { editId: string };
  for (;;) {
    const edit = (await (await fetch(`${base}/api/edits/${editId}`)).json()) as EditStatus;
    if (edit.state.kind === "done") return;
    assert.notEqual(edit.state.kind, "failed", JSON.stringify(edit.state));
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("edits' slower consequences wait for the edits to stop", () => {
  test("an edit shows in the list at once; combos and the rest follow once, for all of them", async () => {
    comboSearches = 0;
    await swap("Sol Ring", "Mind Stone");
    const first = await detail();
    assert.ok(
      first.report!.decklist!.some((c) => c.name === "Mind Stone"),
      "in the list at once",
    );
    const waiting = (d: DeckStatus) =>
      d.changes.kind === "waiting" ? d.changes.refreshInMs : null;
    assert.ok(waiting(first)! > 0 && waiting(first)! <= DELAY, "the rest is waiting");
    assert.ok(fs.existsSync(pendingFile()), "kept on disk, in case the server stops");

    await new Promise((r) => setTimeout(r, 150));
    await swap("Forest", "Arcane Signet");
    const second = await detail();
    assert.ok(waiting(second)! > waiting(first)! - 150, "the second edit pushed it back");
    assert.ok(second.report!.decklist!.some((c) => c.name === "Arcane Signet"));
    assert.equal(comboSearches, 0, "nothing slow has run yet");
    const status = (await (await fetch(`${base}/api/decks/${slug}/status`)).json()) as DeckDetail;
    assert.ok(waiting(status)! > 0);
    assert.equal(status.savedAt, second.savedAt);

    await whenIdle(slug);
    const done = await detail();
    assert.equal(comboSearches, 1, "one combo search for both edits");
    assert.deepEqual(done.changes, { kind: "settled" });
    assert.ok(done.savedAt! > second.savedAt!, "the refreshed report was saved");
    assert.ok(!fs.existsSync(pendingFile()));
    for (const name of ["Mind Stone", "Arcane Signet"])
      assert.ok(
        done.report!.decklist!.some((c) => c.name === name),
        `${name} stays`,
      );
  });

  test("an edit made while a refresh runs doesn't wait for it, and that refresh is dropped", async () => {
    config.refreshDelayMs = 0;
    let release = () => {};
    gate = new Promise((r) => (release = r));
    const paused = new Promise<void>((r) => (searching = r));
    try {
      comboSearches = 0;
      await swap("Arcane Signet", "Mind Stone");
      await paused;
      const savedAt = (await detail()).savedAt;
      // Made, and in the list, while the first refresh is still working.
      await swap("Fellwar Stone", "Commander's Sphere");
      const during = await detail();
      assert.ok(during.report!.decklist!.some((c) => c.name === "Commander's Sphere"));
      assert.ok(during.savedAt! > savedAt!);
      gate = null;
      release();
      await whenIdle(slug);
      assert.equal(comboSearches, 2, "the second edit's refresh ran too");
      const done = (await detail()).report!;
      for (const name of ["Mind Stone", "Commander's Sphere"])
        assert.ok(
          done.decklist!.some((c) => c.name === name),
          `${name} is in`,
        );
      assert.ok(!fs.existsSync(pendingFile()));
    } finally {
      gate = null;
      release();
      searching = () => {};
      config.refreshDelayMs = DELAY;
    }
  });

  test("a refresh still waiting when the server stopped runs when it starts again", async () => {
    const report = (await detail()).report!;
    const forest = report.decklist!.find((c) => c.name === "Forest")!;
    await applyDeckChanges(
      slug,
      [{ action: "remove", name: "Forest", qty: 1, reason: "" }],
      "cut a Forest",
    );
    // As if the process had died before the timer fired.
    cancelDebounced(slug);
    assert.ok(fs.existsSync(pendingFile()));
    assert.deepEqual((await detail()).changes, { kind: "settled" });

    await resumeRefreshes();
    await whenIdle(slug);
    assert.ok(!fs.existsSync(pendingFile()));
    const after = (await detail()).report!;
    assert.equal(after.decklist!.find((c) => c.name === "Forest")!.qty, forest.qty - 1);
  });

  test("a full re-run covers edits still waiting for their refresh", async () => {
    comboSearches = 0;
    await swap("Mind Stone", "Fellwar Stone");
    assert.ok(fs.existsSync(pendingFile()));
    const job = await waitForJob(startOptimize(slug, { keepEdits: true }).id);
    assert.deepEqual(job.status, { kind: "done" });
    assert.ok(!fs.existsSync(pendingFile()));
    assert.deepEqual((await detail()).changes, { kind: "settled" }, "nothing left to refresh");
  });
});
