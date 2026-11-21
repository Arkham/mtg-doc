/** The shape of a run's graph, for drawing it: pure, so it's tested without a page. */
import type { TraceTask } from "../shared/types.ts";

/** Each task's depth: how many tasks are in the longest chain it waits for. */
export function depths(tasks: TraceTask[]): Map<string, number> {
  const byName = new Map(tasks.map((t) => [t.name, t]));
  const depth = new Map<string, number>();
  const of = (name: string): number => {
    const known = depth.get(name);
    if (known !== undefined) return known;
    const needs = byName.get(name)?.needs ?? [];
    const d = needs.length ? 1 + Math.max(...needs.map(of)) : 0;
    depth.set(name, d);
    return d;
  };
  for (const t of tasks) of(t.name);
  return depth;
}

type State = "waiting" | "running" | "done" | "failed";

/** A task's state at a moment: from its times, so a replay shows it as it was then. */
export function stateAt(task: TraceTask, t: number): State {
  if (task.start === undefined || task.start > t) return "waiting";
  if (task.end !== undefined && task.end <= t) return task.state === "failed" ? "failed" : "done";
  return "running";
}

/** The chain of tasks that set how long the run took, as pairs (need → task). */
export function criticalEdges(tasks: TraceTask[]): Set<string> {
  const byName = new Map(tasks.map((t) => [t.name, t]));
  const latest = (names: string[]) =>
    names
      .map((n) => byName.get(n)!)
      .reduce<TraceTask | undefined>(
        (a, b) => (!a || (b.end ?? 0) > (a.end ?? 0) ? b : a),
        undefined,
      );
  const edges = new Set<string>();
  let at = latest(tasks.map((t) => t.name));
  while (at) {
    const before = latest(at.needs);
    if (before) edges.add(`${before.name}>${at.name}`);
    at = before;
  }
  return edges;
}

/**
 * The lines worth drawing: a task's needs, less those it already waits for through another of
 * them. Review waits for the deck loading, but it waits for it through everything else too.
 */
export function directNeeds(tasks: TraceTask[]): Map<string, string[]> {
  const byName = new Map(tasks.map((t) => [t.name, t]));
  const below = new Map<string, Set<string>>();
  const reach = (name: string): Set<string> => {
    const known = below.get(name);
    if (known) return known;
    const all = new Set<string>();
    for (const n of byName.get(name)?.needs ?? []) {
      all.add(n);
      for (const m of reach(n)) all.add(m);
    }
    below.set(name, all);
    return all;
  };
  return new Map(
    tasks.map((t) => [
      t.name,
      t.needs.filter((n) => !t.needs.some((other) => other !== n && reach(other).has(n))),
    ]),
  );
}
