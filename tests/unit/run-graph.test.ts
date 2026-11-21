import "../support/env.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  criticalChain,
  criticalEdges,
  depths,
  directNeeds,
  stateAt,
} from "../../src/web/run-graph.ts";
import type { Trace, TraceTask } from "../../src/shared/types.ts";

const task = (name: string, needs: string[], start?: number, end?: number): TraceTask => ({
  name,
  needs,
  state: end !== undefined ? "done" : start !== undefined ? "running" : "waiting",
  start,
  end,
});

// a → b → d, a → c → d, and d also needs a directly.
const diamond = [
  task("a", [], 0, 10),
  task("b", ["a"], 10, 50),
  task("c", ["a"], 10, 20),
  task("d", ["a", "b", "c"], 50, 60),
];

describe("a run's graph, for drawing", () => {
  test("depth is the longest chain a task waits for", () => {
    assert.deepEqual(Object.fromEntries(depths(diamond)), { a: 0, b: 1, c: 1, d: 2 });
  });

  test("only direct needs are drawn: what a task waits for anyway through another goes", () => {
    assert.deepEqual(directNeeds(diamond).get("d"), ["b", "c"]);
    assert.deepEqual(directNeeds(diamond).get("b"), ["a"]);
  });

  test("the critical chain runs back from the last task through whatever ended latest", () => {
    assert.deepEqual(criticalChain(diamond), ["a", "b", "d"]);
    assert.deepEqual([...criticalEdges(diamond)].sort(), ["a>b", "b>d"]);
  });

  test("a task's state at a moment comes from its times, so a replay shows it as it was", () => {
    const b = diamond[1];
    assert.equal(stateAt(b, 5), "waiting");
    assert.equal(stateAt(b, 30), "running");
    assert.equal(stateAt(b, 50), "done");
    assert.equal(stateAt({ ...b, state: "failed" }, 60), "failed");
    assert.equal(stateAt(task("e", [], 5), 1e9), "running");
  });

  test("on a real run, the drawn lines keep every task reachable and the chain sets the time", () => {
    const { done } = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "../fixtures/trace.json"), "utf8"),
    ) as { done: Trace };
    const direct = directNeeds(done.tasks);
    const reach = (name: string, via: Map<string, string[]>): Set<string> =>
      new Set((via.get(name) ?? []).flatMap((n) => [n, ...reach(n, via)]));
    const all = new Map(done.tasks.map((t) => [t.name, t.needs]));
    for (const t of done.tasks) assert.deepEqual(reach(t.name, direct), reach(t.name, all), t.name);
    assert.ok([...direct.values()].flat().length < [...all.values()].flat().length);
    const chain = criticalChain(done.tasks);
    assert.equal(chain[0], "start");
    assert.equal(chain.at(-1), "saved");
  });
});
