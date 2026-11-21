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

/**
 * Work that waits for a deck's edits to settle: `run` starts once `delayMs` pass without another
 * call for the deck, so a burst of edits leads to one run. It runs outside the queue (it's slow,
 * and edits mustn't wait for it); it queues its own writes.
 */
const timers = new Map<string, { timer: NodeJS.Timeout; at: number }>();
const running = new Map<string, Promise<unknown>>();

export function debounce(slug: string, delayMs: number, run: () => Promise<unknown>) {
  cancelDebounced(slug);
  const timer = setTimeout(() => {
    timers.delete(slug);
    const work = run()
      .catch((err) => console.error(`[refresh ${slug}]`, err))
      .finally(() => {
        if (running.get(slug) === work) running.delete(slug);
      });
    running.set(slug, work);
  }, delayMs);
  timers.set(slug, { timer, at: Date.now() + delayMs });
}

export function cancelDebounced(slug: string) {
  const scheduled = timers.get(slug);
  if (scheduled) clearTimeout(scheduled.timer);
  timers.delete(slug);
}

/** When the deck's settled work starts, or null if none is waiting. */
export const debouncedAt = (slug: string) => timers.get(slug)?.at ?? null;

/** Whether the deck's settled work is running now. */
export const debouncedRunning = (slug: string) => running.has(slug);

/** Resolves once every task queued for the deck so far has finished, settled work included. */
export async function whenIdle(slug: string) {
  for (;;) {
    if (pendingEdits(slug).length) await tails.get(slug)?.catch(() => {});
    else if (running.has(slug)) await running.get(slug);
    else if (timers.has(slug))
      await new Promise((r) => setTimeout(r, Math.max(0, timers.get(slug)!.at - Date.now()) + 5));
    else return;
  }
}
