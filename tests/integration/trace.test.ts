import "../support/env.ts";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { createApp } from "../../src/server/app.ts";
import { getJob, startOptimize, watchJob } from "../../src/server/pipeline.ts";
import { TASK_LABELS } from "../../src/shared/run-copy.ts";
import type { Job, RunRecord } from "../../src/shared/types.ts";
import { optimizeFixtureDeck, waitForJob } from "../support/sample.ts";

describe("a run's trace", () => {
  test("times every task after what it needs, and every request against the task that made it", async () => {
    const { job } = await optimizeFixtureDeck("lathril.txt", { bracket: 3, tone: "balanced" });
    const trace = getJob(job.id)!.trace!;
    const tasks = new Map(trace.tasks.map((t) => [t.name, t]));
    assert.ok(tasks.size > 10);
    for (const t of trace.tasks) {
      assert.equal(t.state, "done", t.name);
      // Ids only: the words are the frontend's, and each id has them.
      assert.deepEqual(Object.keys(t).sort(), ["end", "name", "needs", "start", "state"]);
      assert.ok(TASK_LABELS[t.name], `${t.name} has a name`);
      for (const need of t.needs)
        assert.ok(tasks.get(need)!.end! <= t.start!, `${t.name} starts after ${need} ends`);
    }

    const services = new Set(trace.requests.map((r) => r.service));
    for (const s of ["scryfall", "spellbook", "edhrec"] as const) assert.ok(services.has(s), s);
    for (const r of trace.requests) {
      const task = tasks.get(r.task!)!;
      assert.ok(task, `${r.what} belongs to a task`);
      assert.ok(r.start >= task.start! && r.end! <= task.end!, `${r.what} within ${task.name}`);
      // Some fail on purpose (a bracket page EDHREC doesn't have); every one has an answer.
      assert.equal(typeof r.ok, "boolean");
    }
    assert.ok(trace.requests.some((r) => /^look up \d+ cards$/.test(r.what)));
    // Independent work overlapped: the candidate lookups started before the solver needed them.
    assert.ok(tasks.get("landPool")!.start! < tasks.get("upgrades")!.start!);
  });

  test("streams over the API as it runs, to the end", async () => {
    const { slug } = await optimizeFixtureDeck("lathril.txt", { bracket: 2, tone: "casual" });
    const server = createApp().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    try {
      const job = startOptimize(slug);
      // Watched as soon as it's started, as the page's stream does, before its run begins.
      let changes = 0;
      const unwatch = watchJob(job.id, () => changes++);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const res = await fetch(`${base}/api/jobs/${job.id}/events`);
      assert.match(res.headers.get("content-type")!, /^text\/event-stream/);
      const events = (await res.text())
        .split("\n\n")
        .filter(Boolean)
        .map((block) => JSON.parse(/^data: (.+)$/m.exec(block)![1]) as Job)
        // Until the run starts (it waits in the deck's queue) the job has no trace yet.
        .filter((e) => e.trace);
      await waitForJob(job.id);
      assert.deepEqual(
        events[0].status,
        { kind: "running" },
        "from while it ran, not only the end",
      );
      unwatch();
      assert.ok(changes > 10, `heard every change, not only the heartbeat (${changes})`);
      assert.deepEqual(events.at(-1)!.status, { kind: "done" });
      const done = events.at(-1)!.trace!;
      assert.ok(done.tasks.every((t) => t.state === "done"));
      const elapsed = events.map((e) => e.trace!.elapsed);
      assert.deepEqual(
        elapsed,
        [...elapsed].sort((a, b) => a - b),
        "in order",
      );
      assert.equal((await fetch(`${base}/api/jobs/nope/events`)).status, 404);

      // Saved with the deck, to replay.
      const saved = (await (await fetch(`${base}/api/decks/${slug}/run`)).json()) as RunRecord;
      assert.equal(saved.status, "done");
      assert.deepEqual(saved.trace.tasks, done.tasks);
      assert.deepEqual(saved.trace.requests, done.requests);
      assert.ok(!Number.isNaN(Date.parse(saved.startedAt)));
      const detail = await (await fetch(`${base}/api/decks/${slug}`)).json();
      assert.equal(detail.hasRun, true);
      assert.equal((await fetch(`${base}/api/decks/nope/run`)).status, 404);
    } finally {
      server.close();
    }
  });
});
