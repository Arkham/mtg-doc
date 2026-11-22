import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  debounce,
  debouncedAt,
  debouncedRunning,
  editStatus,
  enqueueEdit,
  pendingEdits,
  whenIdle,
} from "../../src/server/edit-queue.ts";
import { writeAtomic } from "../../src/server/storage.ts";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("edit queue", () => {
  test("a deck's edits run one at a time, in order; other decks don't wait", async () => {
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`${name} start`);
      await tick(ms);
      log.push(`${name} end`);
      return name;
    };
    const a = enqueueEdit("deck-a", "first", task("a1", 20));
    const b = enqueueEdit("deck-a", "second", task("a2", 1));
    const other = enqueueEdit("deck-b", "other", task("b1", 1));
    assert.deepEqual(
      a.status.state,
      { kind: "queued" },
      "callers get an id back before anything runs",
    );
    assert.equal(pendingEdits("deck-a").length, 2);
    assert.equal(await other.done, "b1");
    assert.ok(!log.includes("a1 end"), "deck-b ran alongside deck-a");
    assert.deepEqual(await Promise.all([a.done, b.done]), ["a1", "a2"]);
    assert.ok(log.indexOf("a1 end") < log.indexOf("a2 start"), "never two edits on one deck");
    assert.deepEqual(editStatus(b.status.id)!.state, { kind: "done" });
    assert.equal(pendingEdits("deck-a").length, 0);
  });

  test("a failed edit reports why and doesn't stop the next one", async () => {
    const failed = enqueueEdit("deck-c", "boom", async () => {
      throw new Error("no such card");
    });
    const next = enqueueEdit("deck-c", "after", async () => "ok");
    await whenIdle("deck-c");
    assert.deepEqual(editStatus(failed.status.id)!.state, {
      kind: "failed",
      error: "no such card",
    });
    assert.equal(await next.done, "ok");
  });
});

describe("debounce", () => {
  test("runs once after the calls stop; each call pushes it back, and idle waits for it", async () => {
    const runs: number[] = [];
    const call = (n: number) =>
      debounce("deck-d", 40, async () => {
        await tick(10);
        runs.push(n);
      });
    call(1);
    const first = debouncedAt("deck-d")!;
    await tick(25);
    call(2);
    assert.ok(debouncedAt("deck-d")! > first, "the second call pushed it back");
    await tick(25);
    assert.deepEqual(runs, [], "not run while calls keep coming");
    await whenIdle("deck-d");
    assert.deepEqual(runs, [2], "run once, by the last call");
    assert.equal(debouncedAt("deck-d"), null);
    assert.equal(debouncedRunning("deck-d"), false);
  });
});

describe("writeAtomic", () => {
  test("readers see a whole file while it's rewritten, and no temp files stay behind", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mtg-doc-atomic-"));
    const file = path.join(dir, "report.json");
    const big = (n: number) => JSON.stringify({ n, pad: "x".repeat(200_000) });
    await writeAtomic(file, big(0));
    const reads: Promise<number>[] = [];
    const writes: Promise<void>[] = [];
    for (let i = 1; i <= 20; i++) {
      writes.push(writeAtomic(file, big(i)));
      reads.push(fs.readFile(file, "utf8").then((t) => (JSON.parse(t) as { n: number }).n));
    }
    await Promise.all(writes);
    for (const n of await Promise.all(reads)) assert.ok(n >= 0 && n <= 20);
    assert.deepEqual(await fs.readdir(dir), ["report.json"]);
  });
});
