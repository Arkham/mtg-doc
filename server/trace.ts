/**
 * What a run is doing, as it does it: the tasks of its graph and every request they make to an
 * outside service, timed from the start of the run. The UI draws it live.
 *
 * Requests are seen through `fetch`, so nothing that makes them has to know: whatever a task runs
 * (`Tracer.run`) carries the task along (AsyncLocalStorage), and `traceFetch` notes each request
 * against it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Service, Trace, TraceRequest, TraceTask } from "../shared/types.ts";
import { config } from "./config.ts";
import type { GraphWatcher } from "./task-graph.ts";

const current = new AsyncLocalStorage<{ tracer: Tracer; task: string }>();

export class Tracer implements GraphWatcher {
  private readonly started = Date.now();
  readonly startedAt = new Date(this.started).toISOString();
  private readonly tasks = new Map<string, TraceTask>();
  private readonly requests: TraceRequest[] = [];
  private readonly listeners = new Set<() => void>();

  private since = () => Date.now() - this.started;

  private changed() {
    for (const listener of this.listeners) listener();
  }

  /** Tells listeners something changed outside the trace, like the run ending. */
  touch() {
    this.changed();
  }

  /** Calls `listener` after every change, until the returned function is called. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  added = (name: string, needs: readonly string[]) => {
    this.tasks.set(name, { name, needs: [...needs], state: "waiting" });
    this.changed();
  };

  run = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const task = this.tasks.get(name)!;
    task.state = "running";
    task.start = this.since();
    this.changed();
    try {
      const result = await current.run({ tracer: this, task: name }, run);
      task.state = "done";
      return result;
    } catch (err) {
      task.state = "failed";
      throw err;
    } finally {
      task.end = this.since();
      this.changed();
    }
  };

  /** Notes a request the current task makes; call what it returns once the answer is in. */
  request(service: Service, what: string, task: string): (ok: boolean) => void {
    const request: TraceRequest = { service, what, task, start: this.since() };
    this.requests.push(request);
    this.changed();
    return (ok) => {
      request.end = this.since();
      request.ok = ok;
      this.changed();
    };
  }

  snapshot(): Trace {
    return {
      elapsed: this.since(),
      tasks: [...this.tasks.values()].map((t) => ({ ...t })),
      requests: this.requests.map((r) => ({ ...r })),
    };
  }
}

const identifiers = (body: unknown) => {
  try {
    return JSON.parse(String(body)) as Record<string, unknown[]>;
  } catch {
    return {};
  }
};

const cards = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

/** Which service a request goes to, and what it asks, in a few words; null if it isn't one. */
function describeRequest(url: URL, body: unknown): { service: Service; what: string } | null {
  const llm = new URL(config.llm.baseUrl);
  if (url.host === llm.host) {
    if (url.pathname.endsWith("/decisions")) {
      const n = identifiers(body).questions?.length ?? 0;
      return { service: "decisions", what: `${n} yes/no ${n === 1 ? "question" : "questions"}` };
    }
    const searches = (identifiers(body).tools as { type?: string }[] | undefined)?.some(
      (t) => t.type === "web_search",
    );
    return { service: "model", what: searches ? "search the web" : "ask the model" };
  }
  if (url.host === "api.scryfall.com") {
    if (url.pathname === "/cards/collection")
      return {
        service: "scryfall",
        what: `look up ${cards(identifiers(body).identifiers?.length ?? 0)}`,
      };
    if (url.pathname === "/cards/search")
      return {
        service: "scryfall",
        what:
          url.searchParams.get("unique") === "prints" ? "find cheaper printings" : "search cards",
      };
    return { service: "scryfall", what: "find a card by name" };
  }
  if (url.host === "backend.commanderspellbook.com") {
    if (url.pathname.startsWith("/find-my-combos"))
      return { service: "spellbook", what: "find combos" };
    return { service: "spellbook", what: `check ${cards(identifiers(body).main?.length ?? 0)}` };
  }
  if (url.host === "json.edhrec.com") return { service: "edhrec", what: "read a commander page" };
  return null;
}

/** Notes every request made inside a traced task. Installed once, around whatever `fetch` is. */
export function traceFetch() {
  const inner = globalThis.fetch;
  if ((inner as { traced?: boolean }).traced) return;
  const traced = async (input: string | URL | Request, init?: RequestInit) => {
    const at = current.getStore();
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const described = at && describeRequest(url, init?.body);
    if (!at || !described) return inner(input, init);
    const done = at.tracer.request(described.service, described.what, at.task);
    let res: Response;
    try {
      res = await inner(input, init);
    } catch (err) {
      done(false);
      throw err;
    }
    if (!res.body) {
      done(res.ok);
      return res;
    }
    // The answer is in once its body is (a streamed one too): note it as the body ends.
    const ok = res.ok;
    const body = res.body.pipeThrough(
      new TransformStream({ flush: () => done(ok), cancel: () => done(false) } as Transformer),
    );
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
  globalThis.fetch = Object.assign(traced, { traced: true }) as typeof fetch;
}
