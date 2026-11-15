import { randomUUID } from "node:crypto";
import type { EditStatus } from "../shared/types.ts";

/**
 * Changes to a deck's report (chat edits, applied swaps, re-runs, synergy searches) take seconds
 * to minutes, so they run in the background: callers get an id back at once and poll it. Each
 * deck has one queue that runs its tasks in order, so no two write the report at the same time.
 */
const tails = new Map<string, Promise<unknown>>();
const tasks = new Map<string, EditStatus>();
/** Finished tasks stay around this long, for clients to read their outcome. */
const KEEP_MS = 10 * 60_000;

export function enqueueEdit<T>(
  slug: string,
  label: string,
  run: () => Promise<T>,
): { status: EditStatus; done: Promise<T> } {
  const status: EditStatus = { id: randomUUID(), slug, label, state: "queued" };
  tasks.set(status.id, status);
  const done = (tails.get(slug) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      status.state = "running";
      try {
        const result = await run();
        status.state = "done";
        return result;
      } catch (err) {
        status.state = "failed";
        status.error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        setTimeout(() => tasks.delete(status.id), KEEP_MS).unref();
      }
    });
  tails.set(slug, done);
  // Failures are reported through the status; nobody has to await the task.
  done.catch(() => {});
  return { status, done };
}

export const editStatus = (id: string) => tasks.get(id);

/** Tasks still waiting or running for a deck. */
export const pendingEdits = (slug: string) =>
  [...tasks.values()].filter(
    (t) => t.slug === slug && (t.state === "queued" || t.state === "running"),
  );

/** Resolves once every task queued for the deck so far has finished. */
export async function whenIdle(slug: string) {
  while (pendingEdits(slug).length) await tails.get(slug)?.catch(() => {});
}
