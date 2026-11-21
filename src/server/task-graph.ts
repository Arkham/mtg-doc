/**
 * Runs async tasks as a graph: each task names the tasks it needs, gets their results, and starts
 * the moment they're all done, so everything that can run at the same time does. Tasks are added
 * in order (a task can only need ones added before it), which also keeps the graph acyclic.
 *
 *   const results = await new TaskGraph()
 *     .task("deck", [], () => loadDeck(slug))
 *     .task("combos", ["deck"], ({ deck }) => findCombos(deck))
 *     .task("prices", ["deck"], ({ deck }) => priceDeck(deck))   // runs alongside combos
 *     .task("report", ["combos", "prices"], ({ combos, prices }) => write(combos, prices))
 *     .all();
 *
 * A failed task fails the tasks that need it, and `all()`; tasks that don't need it still run.
 * `watch` sees each task added and wraps each run, e.g. to time it or trace what it does.
 */
export interface GraphWatcher {
  added?: (name: string, needs: readonly string[]) => void;
  run?: <T>(name: string, run: () => Promise<T>) => Promise<T>;
}

export class TaskGraph<Results extends Record<string, unknown> = Record<never, never>> {
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly needs = new Map<string, readonly string[]>();

  constructor(private readonly watch: GraphWatcher = {}) {}

  /** Adds a task; it starts as soon as the tasks it `needs` are done. */
  task<const Name extends string, const Needs extends readonly (keyof Results & string)[], Result>(
    name: Name extends keyof Results ? never : Name,
    needs: Needs,
    run: (inputs: { [N in Needs[number]]: Results[N] }) => Promise<Result> | Result,
  ): TaskGraph<Results & { [N in Name]: Awaited<Result> }> {
    const inputs = Promise.all(needs.map((n) => this.running.get(n)!));
    const wrap = this.watch.run ?? (<T>(_: string, go: () => Promise<T>) => go());
    const promise = inputs.then((values) =>
      wrap(name, async () => run(Object.fromEntries(needs.map((n, i) => [n, values[i]])) as never)),
    );
    // Whoever needs the result sees the failure; this stops it counting as unhandled meanwhile.
    promise.catch(() => {});
    this.running.set(name, promise);
    this.needs.set(name, needs);
    this.watch.added?.(name, needs);
    return this as never;
  }

  /** One task's result, once it's done. */
  get<Name extends keyof Results & string>(name: Name): Promise<Results[Name]> {
    return this.running.get(name) as Promise<Results[Name]>;
  }

  /** Every task's result, once all are done; rejects with the first failure. */
  async all(): Promise<Results> {
    const names = [...this.running.keys()];
    const values = await Promise.all(names.map((n) => this.running.get(n)!));
    return Object.fromEntries(names.map((n, i) => [n, values[i]])) as Results;
  }

  /** What each task needs, in the order they were added: the graph itself, for reading or tests. */
  edges(): [string, readonly string[]][] {
    return [...this.needs];
  }
}
