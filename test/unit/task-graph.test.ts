import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TaskGraph } from "../../server/task-graph.ts";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

enum Task {
  Deck = "deck",
  Slow = "slow",
  Fast = "fast",
  AfterFast = "after fast",
  Sum = "sum",
}

describe("TaskGraph", () => {
  test("each task starts once what it needs is done, with those results; the rest run together", async () => {
    const log: string[] = [];
    const timed =
      <T>(name: string, ms: number, value: T) =>
      async () => {
        log.push(`${name} start`);
        await tick(ms);
        log.push(`${name} end`);
        return value;
      };
    const graph = new TaskGraph()
      .task(Task.Deck, [], timed("deck", 5, 100))
      .task(Task.Slow, [Task.Deck], timed("slow", 40, "s"))
      .task(Task.Fast, [Task.Deck], timed("fast", 5, "f"))
      .task(Task.AfterFast, [Task.Fast], timed("after fast", 5, "af"))
      .task(Task.Sum, [Task.Deck, Task.Slow, Task.AfterFast], (done) => {
        log.push("sum");
        // Typed by the task that made each: a number, then strings.
        const deck: number = done[Task.Deck];
        return `${deck} ${done[Task.Slow]} ${done[Task.AfterFast]}`;
      });
    const results = await graph.all();
    assert.equal(results[Task.Sum], "100 s af");
    assert.equal(await graph.get(Task.Fast), "f");
    // Independent tasks overlapped: the fast branch finished while the slow one ran.
    assert.ok(log.indexOf("after fast end") < log.indexOf("slow end"));
    assert.ok(log.indexOf("slow start") < log.indexOf("fast end"));
    assert.equal(log.at(-1), "sum");
    assert.deepEqual(graph.edges(), [
      ["deck", []],
      ["slow", ["deck"]],
      ["fast", ["deck"]],
      ["after fast", ["fast"]],
      ["sum", ["deck", "slow", "after fast"]],
    ]);
  });

  test("a failure fails what needs it and the whole graph, but not unrelated tasks", async () => {
    let unrelated = false;
    const graph = new TaskGraph()
      .task("broken", [], async () => {
        throw new Error("no such card");
      })
      .task("needs broken", ["broken"], () => "never")
      .task("unrelated", [], async () => {
        await tick(5);
        unrelated = true;
      });
    await assert.rejects(graph.get("needs broken"), /no such card/);
    await assert.rejects(graph.all(), /no such card/);
    await graph.get("unrelated");
    assert.ok(unrelated);
  });
});
