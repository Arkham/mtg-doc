/**
 * `<mtg-run-map>`: a run drawn as a map. Its tasks are stars laid out by what they wait for, the
 * outside services are stations along the bottom, and every request is a comet that flies from its
 * task to its service, circles there while it waits and flies back with the answer.
 *
 * Everything on it is a function of the trace and a moment, which the page keeps (live, a little
 * behind the server's events; or a replay's playhead) and moves on every frame: the map draws
 * whatever moment it's given, in the same frame.
 *
 * Set `trace` (a `Trace`) as a property; attributes: `at` (ms), the moment to show (the run's end
 * without it); `running` while the run goes on; and `selected` (a task's name) to light up what it
 * waits for and what waits for it. Fires `select` (detail: a task's name) when a task is tapped.
 */
import type { Service, Trace, TraceRequest, TraceTask } from "../shared/types.ts";
import { taskLabel } from "../shared/run-copy.ts";
import { criticalChain, depths, directNeeds, stateAt } from "./run-graph.ts";

const SERVICES: { id: Service; name: string; color: string }[] = [
  { id: "scryfall", name: "Scryfall", color: "#8fc8e8" },
  { id: "spellbook", name: "Spellbook", color: "#c4a3f2" },
  { id: "edhrec", name: "EDHREC", color: "#f29a5a" },
  { id: "model", name: "LLM", color: "#ebc876" },
  { id: "decisions", name: "Decisions", color: "#7fd49b" },
];
const GOLD = "#ebc876";
const NEEDS = "#8fc8e8";
const FEEDS = "#7fd49b";
const LIVE = "#f06272";
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
/**
 * The end of a run on the map, a finale: the last comets come home and everything else fades; a
 * spark races down the golden path, each of its steps popping as it passes; and the last one
 * bursts. The page plays this long past the run's end (`outroMs` in Page/Progress.elm).
 */
const OUTRO_FROM_MS = 300;
const OUTRO_FADE_MS = 800;
const RACE_FROM_MS = 500;
const RACE_MS = 1100;
const BURST_MS = 1000;
/** How long a step's pop lasts once the spark reaches it. */
const POP_MS = 420;
/** How long after a drag or a wheel stops the map leaves the page alone, before following again. */
const FOLLOW_AFTER_DRAG_MS = 2500;
/** How long the page keeps gliding to where the run is once the playhead stops. */
const SETTLE_MS = 1500;
/** How much of the way left the glide covers in a 60Hz frame; slower frames cover more. */
const GLIDE = 0.15;
/** How close the glide gets before it takes the rest in one step. */
const LAST_STEP_PX = 4;
/** How long a comet takes to reach its service, or to come back. */
const FLIGHT_MS = 420;

interface Point {
  x: number;
  y: number;
}

/** The point `d` along a path of `points` (with `lengths`, how far along each one is). */
function along(points: Point[], lengths: number[], d: number): { i: number; p: Point } {
  const i = lengths.findIndex((x) => x >= d);
  if (i <= 0)
    return { i: i === 0 ? 0 : points.length - 1, p: points[i === 0 ? 0 : points.length - 1] };
  const f = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
  const a = points[i - 1];
  const b = points[i];
  return { i, p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f } };
}

/** The golden path's finale at a moment (see RunMap's #race). */
interface Race {
  /** The path, as points along it, and how far along it each one is. */
  points: Point[];
  lengths: number[];
  /** How far along it the spark has got. */
  head: number;
  done: boolean;
  /** For each step the spark has passed, how long ago (ms). */
  popped: Map<string, number>;
  end: Point;
  /** How long since the spark reached the end (ms; negative before). */
  burst: number;
  /** How long since the run ended (ms). */
  since: number;
}

type Side = "below" | "above" | "right" | "left";

interface Layout {
  width: number;
  /** The labels' font size (px). */
  labelPx: number;
  /** Where each task's label goes, so labels don't run into each other. */
  labels: Map<string, Side>;
  direct: Map<string, string[]>;
  height: number;
  vertical: boolean;
  nodes: Map<string, Point>;
  stations: Map<Service, Point>;
}

/** A task's size: bigger the longer it ran. */
const nodeRadius = (ranMs: number) => 6 + Math.min(13, Math.sqrt(Math.max(0, ranMs) / 1000) * 3.2);

/** Smaller where columns are close, so neighbouring labels on the same side keep apart. */
const labelPx = (width: number) => (width < 640 ? 11 : width < 960 ? 11.5 : 12.5);

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (p: number) => 1 - (1 - p) ** 3;

/**
 * Where everything goes. With `fit` (a height), the map fills it; without, it's as tall as its
 * graph needs (on a phone, where it runs top to bottom, that's taller than the screen).
 */
function layout(
  tasks: TraceTask[],
  width: number,
  fit: number | null,
  measure: (label: string) => number,
): Layout {
  const vertical = width < 640;
  const depth = depths(tasks);
  const columns: string[][] = [];
  for (const t of tasks) (columns[depth.get(t.name)!] ??= []).push(t.name);
  // Each task sits near the average of what it waits for, so lines cross less.
  const slot = new Map<string, number>();
  columns.forEach((column, d) => {
    if (d > 0) {
      const byName = new Map(tasks.map((t) => [t.name, t]));
      const pull = (n: string) => {
        const needs = byName.get(n)!.needs;
        return needs.reduce((s, x) => s + slot.get(x)!, 0) / needs.length;
      };
      column.sort((a, b) => pull(a) - pull(b));
    }
    column.forEach((n, i) => slot.set(n, (i + 0.5) / column.length));
  });

  const pad = vertical ? 28 : 56;
  const nodes = new Map<string, Point>();
  const span = Math.max(1, columns.length - 1);
  let graphBottom: number;
  if (vertical) {
    const step = 96;
    const top = 40;
    // A crowded row zigzags, so its labels have room.
    for (const [name, d] of depth) {
      const column = columns[d];
      const zig = column.length > 2 && column.indexOf(name) % 2 ? 34 : 0;
      nodes.set(name, { x: pad + slot.get(name)! * (width - 2 * pad), y: top + d * step + zig });
    }
    graphBottom = top + span * step;
  } else {
    const top = 64;
    const h = fit
      ? Math.max(160, fit - top - 192)
      : Math.max(260, Math.max(...columns.map((c) => c.length)) * 78);
    for (const [name, d] of depth)
      nodes.set(name, { x: pad + (d / span) * (width - 2 * pad), y: top + slot.get(name)! * h });
    graphBottom = top + h;
  }
  // Labels go under their task, or wherever else runs into the fewest already placed.
  const labels = new Map<string, Side>();
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const placed: Box[] = [];
  const overlap = (b: Box) =>
    placed.reduce(
      (n, o) =>
        n +
        Math.max(0, Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0)) *
          Math.max(0, Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0)),
      0,
    );
  // Each task as big as it's drawn once it's done, so no label covers one.
  for (const t of tasks) {
    const at = nodes.get(t.name)!;
    const r = nodeRadius((t.end ?? 0) - (t.start ?? 0)) + 3;
    placed.push({ x0: at.x - r, x1: at.x + r, y0: at.y - r, y1: at.y + r });
  }
  for (const t of tasks) {
    const at = nodes.get(t.name)!;
    const w = measure(taskLabel(t.name)) / 2 + 7;
    const r = nodeRadius((t.end ?? 0) - (t.start ?? 0)) + 4;
    const sides: [Side, Box][] = [
      ["below", { x0: at.x - w, x1: at.x + w, y0: at.y + r, y1: at.y + r + 35 }],
      ["above", { x0: at.x - w, x1: at.x + w, y0: at.y - r - 35, y1: at.y - r }],
      ["right", { x0: at.x + r, x1: at.x + r + 4 + 2 * w, y0: at.y - 16, y1: at.y + 16 }],
      ["left", { x0: at.x - r - 4 - 2 * w, x1: at.x - r, y0: at.y - 16, y1: at.y + 16 }],
    ];
    const fits = sides.filter(([, b]) => b.x0 >= 0 && b.x1 <= width);
    const [side, box] = fits.reduce((best, s) => (overlap(s[1]) < overlap(best[1]) ? s : best));
    labels.set(t.name, side);
    placed.push(box);
  }
  const stationY = graphBottom + (vertical ? 110 : 120);
  const stations = new Map<Service, Point>();
  SERVICES.forEach((s, i) =>
    stations.set(s.id, {
      x: pad + ((i + 0.5) / SERVICES.length) * (width - 2 * pad),
      y: stationY + (vertical && i % 2 ? 36 : 0),
    }),
  );
  return {
    width,
    labelPx: labelPx(width),
    labels,
    direct: directNeeds(tasks),
    height: fit ?? stationY + (vertical ? 86 : 72),
    vertical,
    nodes,
    stations,
  };
}

/** A point along a cubic curve between two nodes, bending the way the graph flows. */
function edgePoint(a: Point, b: Point, p: number, vertical: boolean): Point {
  const c1 = vertical ? { x: a.x, y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2, y: a.y };
  const c2 = vertical ? { x: b.x, y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2, y: b.y };
  const q = 1 - p;
  return {
    x: q ** 3 * a.x + 3 * q * q * p * c1.x + 3 * q * p * p * c2.x + p ** 3 * b.x,
    y: q ** 3 * a.y + 3 * q * q * p * c1.y + 3 * q * p * p * c2.y + p ** 3 * b.y,
  };
}

/** A number in [0, 1) that's the same for the same `i` and `k`, and unrelated for neighbours. */
const noise = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

export class RunMap extends HTMLElement {
  static observedAttributes = ["running", "selected", "at"];
  #trace: Trace | null = null;
  #canvas = document.createElement("canvas");
  #ctx = this.#canvas.getContext("2d")!;
  #layout: Layout | null = null;
  #pending = false;
  #resize = new ResizeObserver(() => this.#relayout());
  // Following the run down a map taller than the screen (see #follow).
  #followedAt = -1;
  #movedAt = -Infinity;
  /** When the page last took a step towards the run; null between glides. */
  #glidedAt: number | null = null;
  #settling = 0;
  #draggedAt = -Infinity;
  #finale: Race | null = null;
  #dragged = () => {
    this.#draggedAt = performance.now();
  };

  set trace(trace: Trace) {
    const first = !this.#trace || this.#trace.tasks.length !== trace.tasks.length;
    this.#trace = trace;
    if (first) this.#relayout();
    this.#wake();
  }

  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    if (!root.firstChild) {
      const style = document.createElement("style");
      style.textContent =
        ":host{display:block;position:relative;touch-action:pan-y}canvas{display:block;width:100%;top:0;left:0}";
      root.append(style, this.#canvas);
    }
    this.#resize.observe(this);
    this.#canvas.addEventListener("pointermove", this.#move);
    this.#canvas.addEventListener("pointerup", this.#up);
    // Only what moves the page: a tap on a control (play, speed) isn't taking over.
    for (const e of ["touchmove", "wheel"])
      window.addEventListener(e, this.#dragged, { passive: true });
    this.#relayout();
  }

  disconnectedCallback() {
    this.#resize.disconnect();
    for (const e of ["touchmove", "wheel"]) window.removeEventListener(e, this.#dragged);
  }

  attributeChangedCallback() {
    this.#wake();
  }

  get #running() {
    return this.hasAttribute("running");
  }

  /** The moment the map shows. */
  #now(): number {
    const at = this.getAttribute("at");
    return at === null ? this.#trace!.elapsed : Number(at);
  }

  #relayout() {
    const width = this.clientWidth;
    if (!width || !this.#trace) return;
    // The page says (`--map-fit: 1`) when the map should fill the height it's given.
    const fits = getComputedStyle(this).getPropertyValue("--map-fit").trim() === "1";
    const fit = fits && this.clientHeight > 200 ? this.clientHeight : null;
    this.#ctx.font = `500 ${labelPx(width)}px ${FONT}`;
    this.#layout = layout(
      this.#trace.tasks,
      width,
      fit,
      (label) => this.#ctx.measureText(label).width,
    );
    const dpr = window.devicePixelRatio || 1;
    this.#canvas.width = Math.round(width * dpr);
    this.#canvas.height = Math.round(this.#layout.height * dpr);
    this.#canvas.style.height = `${this.#layout.height}px`;
    // Filling the host, the canvas mustn't size it too.
    this.#canvas.style.position = fit ? "absolute" : "";
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#wake();
  }

  /** Draws once whatever changed is in. */
  #wake() {
    if (this.#pending || !this.isConnected) return;
    this.#pending = true;
    // After whatever else the page changes in this frame, and before it's painted.
    queueMicrotask(() => {
      this.#pending = false;
      if (!this.#trace || !this.#layout) return;
      const t = this.#now();
      this.#draw(t);
      this.#follow(t);
    });
  }

  /**
   * On a map taller than the screen (a phone's, top to bottom), keeps the step started last (the
   * one the pill names) in view while the run moves: a little above the middle, clear of the player.
   * Through the finale it goes up to the start of the golden path, rides down it with the spark and
   * stays on the burst. A drag or a wheel takes over; a moment after it stops, following picks up
   * again from wherever the run has got to.
   */
  #follow(t: number) {
    const now = performance.now();
    if (t !== this.#followedAt) {
      this.#followedAt = t;
      this.#movedAt = now;
    }
    const aim = this.#aim(t, now);
    if (!aim) {
      this.#glidedAt = null;
      return;
    }
    // Eased so the page glides, by the time since its last step rather than per frame, so it keeps
    // up when frames come slowly; a whole pixel at least, or WebKit won't move. A new glide (after
    // a drag, say) starts gently, however long it's been. The last few pixels go in one step, so
    // it comes to rest in the same place whichever way it came.
    const frames = this.#glidedAt === null ? 1 : Math.min(now - this.#glidedAt, 1000) / (1000 / 60);
    this.#glidedAt = now;
    const glide = 1 - (1 - GLIDE) ** frames;
    const { off, riding } = aim;
    const finish = riding || Math.abs(off) <= LAST_STEP_PX;
    window.scrollBy(0, finish ? off : Math.sign(off) * Math.max(1, Math.abs(off) * glide));
    if (!this.#settling)
      this.#settling = requestAnimationFrame(() => {
        this.#settling = 0;
        if (this.#trace && this.#layout) this.#follow(this.#now());
      });
  }

  /** How far the page is from where following wants it, or null when it should stay put. */
  #aim(t: number, now: number): { off: number; riding: boolean } | null {
    const l = this.#layout!;
    const box = this.getBoundingClientRect();
    // Once the playhead stops the page still gets where it was going: on a slow phone the last
    // frames can come before it does. After that, a paused page is the reader's to scroll.
    if (!l.vertical || now - this.#movedAt > SETTLE_MS || box.height <= innerHeight) return null;
    if (now - this.#draggedAt < FOLLOW_AFTER_DRAG_MS) return null;
    const latest = this.#trace!.tasks.filter((task) => stateAt(task, t) === "running").sort(
      (a, b) => b.start! - a.start!,
    )[0];
    const race = this.#finale;
    const y = latest
      ? l.nodes.get(latest.name)!.y
      : race
        ? race.done
          ? race.end.y
          : along(race.points, race.lengths, race.head).p.y
        : null;
    if (y === null) return null;
    const off = box.top + y - innerHeight * 0.4;
    if (Math.abs(off) < 1) return null;
    // The spark's on its way: ride with it, not after it, or it gets away.
    return { off, riding: !!race && race.head > 0 && !race.done };
  }

  #point(e: PointerEvent): Point {
    const box = this.#canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  #move = (e: PointerEvent) => {
    this.#canvas.style.cursor = this.#hit(this.#point(e)) ? "pointer" : "";
  };

  #up = (e: PointerEvent) => {
    const hit = this.#hit(this.#point(e));
    if (hit) this.dispatchEvent(new CustomEvent("select", { detail: hit }));
  };

  #hit(p: Point): string | null {
    let best: string | null = null;
    let bestD = 30;
    for (const [name, at] of this.#layout?.nodes ?? []) {
      const d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d < bestD) [best, bestD] = [name, d];
    }
    return best;
  }

  #draw(t: number) {
    const ctx = this.#ctx;
    const trace = this.#trace!;
    const l = this.#layout!;
    const tasks = new Map(trace.tasks.map((task) => [task.name, task]));
    const selected = this.getAttribute("selected");
    // Past the end, once the last comets are home, everything else fades for the golden path.
    const outro = this.#running ? 0 : clamp((t - trace.elapsed - OUTRO_FROM_MS) / OUTRO_FADE_MS);
    const race = this.#running ? null : this.#race(criticalChain(trace.tasks), t - trace.elapsed);
    this.#finale = race && race.since >= 0 ? race : null;

    ctx.clearRect(0, 0, l.width, l.height);
    this.#backdrop(l);

    // Lines between tasks: what each waits for.
    for (const task of trace.tasks) {
      const b = l.nodes.get(task.name)!;
      const state = stateAt(task, t);
      for (const need of l.direct.get(task.name)!) {
        const a = l.nodes.get(need)!;
        const needDone = stateAt(tasks.get(need)!, t) === "done";
        let color = "rgba(255,255,255,0.06)";
        let width = 1;
        let dash: number[] = [];
        const lit = selected === task.name || selected === need;
        if (selected === task.name) [color, width] = [NEEDS, 2];
        else if (selected === need) [color, width] = [FEEDS, 2];
        else if (state !== "waiting") color = "rgba(255,255,255,0.17)";
        else if (needDone) [color, dash] = ["rgba(235,200,118,0.45)", [3, 5]];
        const line = (style: string, w: number, alpha: number, glow: boolean) => {
          if (alpha <= 0) return;
          ctx.save();
          ctx.globalAlpha = alpha;
          if (glow) {
            ctx.shadowColor = GOLD;
            ctx.shadowBlur = 10;
          }
          ctx.strokeStyle = style;
          ctx.lineWidth = w;
          ctx.setLineDash(dash);
          ctx.lineDashOffset = -t / 40;
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const p = edgePoint(a, b, i / 24, l.vertical);
            if (i) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          }
          ctx.stroke();
          ctx.restore();
        };
        line(color, width, lit ? 1 : 1 - outro, false);
        // The handoff: a spark runs down the line as the task starts.
        const since = t - (task.start ?? Infinity);
        if (since >= 0 && since < 600) {
          const p = edgePoint(a, b, ease(since / 600), l.vertical);
          this.#glow(p, 3.5, GOLD, 1 - since / 600);
        }
      }
    }

    this.#paths(trace.requests, t, l, 1 - outro);
    this.#stations(trace.requests, t, l);
    this.#comets(trace.requests, t, l);
    if (race) this.#golden(race);

    for (const task of trace.tasks) this.#node(task, t, l, selected, race?.popped, tasks);
    if (race) this.#burst(race);
  }

  /**
   * The golden path's finale at `since` ms past the run's end: the path as points along it, how far
   * along the spark is, and how long since it passed each step and reached the end.
   */
  #race(chain: string[], since: number): Race {
    const l = this.#layout!;
    const points: Point[] = [];
    const at: number[] = [];
    const reached = new Map<string, number>();
    let length = 0;
    const lengths = [0];
    chain.forEach((name, i) => {
      if (i === 0) {
        points.push(l.nodes.get(name)!);
        at.push(0);
        return;
      }
      const a = l.nodes.get(chain[i - 1])!;
      const b = l.nodes.get(name)!;
      for (let k = 1; k <= 24; k++) {
        const p = edgePoint(a, b, k / 24, l.vertical);
        length += Math.hypot(p.x - points.at(-1)!.x, p.y - points.at(-1)!.y);
        points.push(p);
        lengths.push(length);
      }
      at.push(length);
    });
    // Picks up speed, like something let go: an ease in, then a dash to the end.
    const progress = clamp((since - RACE_FROM_MS) / RACE_MS);
    const head = progress ** 1.6 * length;
    // When the spark passed each step (ms since): inverting the ease, from where each one sits.
    chain.forEach((name, i) => {
      const passedAt = RACE_FROM_MS + (length ? (at[i] / length) ** (1 / 1.6) : 0) * RACE_MS;
      if (since >= passedAt) reached.set(name, since - passedAt);
    });
    return {
      points,
      lengths,
      head,
      done: progress >= 1,
      popped: reached,
      end: l.nodes.get(chain.at(-1)!)!,
      burst: since - RACE_FROM_MS - RACE_MS,
      since,
    };
  }

  /** The golden path, drawn as far as the spark has got, and the spark itself. */
  #golden(race: Race) {
    const ctx = this.#ctx;
    const { points, lengths, head } = race;
    if (head <= 0 || points.length < 2) return;
    const upTo = (d: number) => along(points, lengths, d);
    const tip = upTo(head);
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let k = 1; k < tip.i; k++) ctx.lineTo(points[k].x, points[k].y);
    ctx.lineTo(tip.p.x, tip.p.y);
    ctx.stroke();
    ctx.restore();
    if (race.done) return;
    // The spark: a bright head with a tail along the path behind it.
    for (let k = 10; k >= 1; k--) {
      const { p } = upTo(Math.max(0, head - k * 7));
      this.#glow(p, 4 * (1 - k / 12), "#fff4d6", 0.6 * (1 - k / 11));
    }
    this.#glow(tip.p, 5, "#fffaf0");
    this.#glow(tip.p, 11, "rgba(235,200,118,0.35)");
  }

  /** The last step's burst: a flash, two shockwaves and a shower of sparks that fall away. */
  #burst(race: Race) {
    const age = race.burst;
    if (age < 0 || age > BURST_MS) return;
    const ctx = this.#ctx;
    const l = this.#layout!;
    const { end } = race;
    const fade = 1 - age / BURST_MS;
    ctx.save();
    const flash = ctx.createRadialGradient(
      end.x,
      end.y,
      0,
      end.x,
      end.y,
      Math.max(l.width, l.height),
    );
    flash.addColorStop(0, `rgba(235,200,118,${0.28 * clamp(1 - age / 450)})`);
    flash.addColorStop(1, "rgba(235,200,118,0)");
    ctx.fillStyle = flash;
    ctx.fillRect(0, 0, l.width, l.height);
    for (const [delay, reach] of [
      [0, 0.32],
      [120, 0.22],
    ]) {
      const a = age - delay;
      if (a <= 0) continue;
      ctx.strokeStyle = GOLD;
      ctx.globalAlpha = clamp(1 - a / 700);
      ctx.lineWidth = 2.5 * clamp(1 - a / 700) + 0.5;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 14 + ease(clamp(a / 700)) * reach * 600, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    const SPARKS = 44;
    for (let i = 0; i < SPARKS; i++) {
      // Each its own way and pace (seeded, so a replay bursts the same), kicked up, then falling.
      const angle = noise(i, 1) * Math.PI * 2;
      const speed = 0.06 + noise(i, 2) ** 1.5 * 0.4;
      const lift = 0.1 + noise(i, 3) * 0.12;
      const at = (ms: number) => ({
        x: end.x + Math.cos(angle) * speed * ms,
        y: end.y + (Math.sin(angle) * speed - lift) * ms + 0.0005 * ms * ms,
      });
      const p = at(age);
      const color = i % 3 ? GOLD : "#fff4d6";
      const trail = at(Math.max(0, age - 40));
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(trail.x, trail.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
      this.#glow(p, 1 + noise(i, 4) * 1.5, color, fade);
    }
  }

  #backdrop(l: Layout) {
    const ctx = this.#ctx;
    const g = ctx.createRadialGradient(
      l.width / 2,
      l.height * 0.35,
      0,
      l.width / 2,
      l.height * 0.35,
      l.width * 0.8,
    );
    g.addColorStop(0, "rgba(212,171,82,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, l.width, l.height);
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    for (let x = 12; x < l.width; x += 24)
      for (let y = 12; y < l.height; y += 24) ctx.fillRect(x, y, 1, 1);
  }

  #glow(p: Point, r: number, color: string, alpha = 1) {
    const ctx = this.#ctx;
    ctx.save();
    ctx.globalAlpha = clamp(alpha);
    ctx.shadowColor = color;
    ctx.shadowBlur = r * 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  #stations(requests: TraceRequest[], t: number, l: Layout) {
    const ctx = this.#ctx;
    for (const s of SERVICES) {
      const at = l.stations.get(s.id)!;
      const mine = requests.filter((r) => r.service === s.id && r.start <= t);
      const busy = mine.filter((r) => r.end === undefined || r.end > t).length;
      const r = 14 + Math.min(16, Math.sqrt(mine.length) * 3.2);
      if (busy) {
        for (let k = 0; k < 2; k++) {
          const phase = (((t / 1400 + k / 2) % 1) + 1) % 1;
          ctx.strokeStyle = s.color;
          ctx.globalAlpha = 0.5 * (1 - phase);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(at.x, at.y, r + phase * 22, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.fillStyle = `${s.color}${busy ? "40" : "1c"}`;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = busy ? 2 : 1.2;
      if (busy) {
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 18;
      }
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#eceef4";
      ctx.font = `600 ${l.vertical ? 13 : 15}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(mine.length), at.x, at.y + 1);
      ctx.font = `500 ${l.vertical ? 10 : 12}px ${FONT}`;
      ctx.fillStyle = s.color;
      ctx.textBaseline = "top";
      ctx.fillText(s.name, at.x, at.y + r + 8);
      if (busy) {
        ctx.fillStyle = "#868da3";
        ctx.font = `${l.vertical ? 10 : 11}px ${FONT}`;
        ctx.fillText(`${busy} in flight`, at.x, at.y + r + (l.vertical ? 22 : 24));
      }
    }
  }

  /** A point along a request's flight from its task to its service. */
  #flight(r: TraceRequest, i: number, p: number, l: Layout): Point | null {
    const from = l.nodes.get(r.task ?? "");
    const to = l.stations.get(r.service)!;
    if (!from) return null;
    const seed = hash(`${r.task}${r.start}${i}`);
    const lift = (l.vertical ? 40 : 70) * (seed % 2 ? 1 : -1) * (0.6 + (Math.abs(seed) % 5) / 10);
    const mid = { x: (from.x + to.x) / 2 + lift * 0.6, y: (from.y + to.y) / 2 - Math.abs(lift) };
    const q = 1 - p;
    return {
      x: q * q * from.x + 2 * q * p * mid.x + p * p * to.x,
      y: q * q * from.y + 2 * q * p * mid.y + p * p * to.y,
    };
  }

  /** Every flight so far, faintly: over the run they build up into who asked whom, how often. */
  #paths(requests: TraceRequest[], t: number, l: Layout, fade: number) {
    const ctx = this.#ctx;
    if (fade <= 0) return;
    ctx.save();
    ctx.lineWidth = 1;
    requests.forEach((r, i) => {
      if (r.start > t) return;
      const color = SERVICES.find((s) => s.id === r.service)!.color;
      ctx.strokeStyle = color;
      ctx.globalAlpha = (0.03 + 0.09 * clamp((t - r.start) / 1500)) * fade;
      ctx.beginPath();
      for (let k = 0; k <= 20; k++) {
        const p = this.#flight(r, i, k / 20, l);
        if (!p) return;
        if (k) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  /** Where a request's comet is at a moment, or null when it isn't out. */
  #cometAt(r: TraceRequest, i: number, t: number, l: Layout): Point | null {
    if (t < r.start) return null;
    if (r.end !== undefined && t > r.end + FLIGHT_MS) return null;
    const out = clamp((t - r.start) / FLIGHT_MS);
    const back = r.end === undefined ? 1 : 1 - clamp((t - r.end) / FLIGHT_MS);
    // Out along an arc to the service; while it waits, around it.
    const arc = this.#flight(r, i, ease(Math.min(out, back)), l);
    if (!arc) return null;
    const seed = hash(`${r.task}${r.start}${i}`);
    const waiting = clamp((t - r.start - FLIGHT_MS) / 300) * clamp(back * 3);
    const radius = 24 + (Math.abs(seed) % 4) * 6;
    const angle = (t - r.start) / 520 + (seed % 628) / 100;
    return {
      x: arc.x + Math.cos(angle) * radius * waiting,
      y: arc.y + Math.sin(angle) * radius * 0.55 * waiting,
    };
  }

  #comets(requests: TraceRequest[], t: number, l: Layout) {
    const ctx = this.#ctx;
    requests.forEach((r, i) => {
      const head = this.#cometAt(r, i, t, l);
      if (!head) return;
      const color = SERVICES.find((s) => s.id === r.service)!.color;
      const failed = r.ok === false && r.end !== undefined && t > r.end;
      ctx.lineCap = "round";
      let prev = head;
      for (let k = 1; k <= 14; k++) {
        const p = this.#cometAt(r, i, t - k * 18, l);
        if (!p) break;
        ctx.strokeStyle = failed ? LIVE : color;
        ctx.globalAlpha = 0.55 * (1 - k / 14);
        ctx.lineWidth = 3 * (1 - k / 16);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        prev = p;
      }
      ctx.globalAlpha = 1;
      this.#glow(head, 2.6, failed ? LIVE : color);
    });
  }

  #node(
    task: TraceTask,
    t: number,
    l: Layout,
    selected: string | null,
    popped: Map<string, number> | undefined,
    tasks: Map<string, TraceTask>,
  ) {
    const ctx = this.#ctx;
    const at = l.nodes.get(task.name)!;
    const state = stateAt(task, t);
    const ran = state === "waiting" ? 0 : Math.min(t, task.end ?? t) - task.start!;
    // On the golden path once the spark has passed it: it pops, swells and settles, and rings out.
    const pop = popped?.get(task.name);
    const onPath = pop !== undefined;
    const swell = onPath ? 1 + 0.5 * Math.sin(Math.PI * clamp(pop / POP_MS)) : 1;
    const r = (state === "waiting" ? 6 : nodeRadius(ran)) * swell;
    if (onPath && pop < POP_MS * 1.6) {
      const f = clamp(pop / (POP_MS * 1.6));
      ctx.save();
      ctx.strokeStyle = GOLD;
      ctx.globalAlpha = 1 - f;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r + 4 + ease(f) * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const related =
      selected &&
      (selected === task.name ||
        task.needs.includes(selected) ||
        tasks.get(selected)?.needs.includes(task.name));

    ctx.save();
    ctx.globalAlpha = selected && !related ? 0.35 : 1;
    if (state === "running") {
      const pulse = (Math.sin(t / 220) + 1) / 2;
      this.#glow(at, r + 2 + pulse * 3, "rgba(235,200,118,0.35)");
      ctx.fillStyle = "#3b3220";
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // A sweep for every 10 seconds it has run.
      ctx.strokeStyle = "#fff4d6";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      const turn = (ran / 10000) * Math.PI * 2;
      ctx.arc(at.x, at.y, r + 5, -Math.PI / 2, -Math.PI / 2 + turn);
      ctx.stroke();
    } else if (state === "waiting") {
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1.2;
      ctx.fillStyle = "#12151e";
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = state === "failed" ? "#4a1c24" : onPath ? "#4a3d1f" : "#232838";
      ctx.strokeStyle = state === "failed" ? LIVE : onPath ? GOLD : "rgba(255,255,255,0.4)";
      ctx.lineWidth = onPath ? 2 : 1.2;
      if (onPath) {
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 12;
      }
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Done: a tick, drawn in as it lands.
      const since = clamp((t - task.end!) / 300);
      if (state === "done" && since > 0) {
        ctx.strokeStyle = onPath ? GOLD : "#cfd4e2";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([12, 12]);
        ctx.lineDashOffset = 12 - since * 12;
        const s = Math.min(r, 8) * 0.5;
        ctx.beginPath();
        ctx.moveTo(at.x - s, at.y);
        ctx.lineTo(at.x - s * 0.25, at.y + s * 0.7);
        ctx.lineTo(at.x + s, at.y - s * 0.6);
        ctx.stroke();
        ctx.setLineDash([]);
        if (since < 1) this.#glow(at, r + (1 - since) * 10, "rgba(255,255,255,0.08)");
      }
    }
    if (selected === task.name) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(at.x, at.y, r + 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    const gap = r + (state === "running" ? 11 : 7);
    const side = l.labels.get(task.name)!;
    const lines: [string, string, string][] = [
      [
        taskLabel(task.name),
        `${state === "running" ? 600 : 500} ${l.labelPx}px ${FONT}`,
        state === "waiting" ? "#868da3" : state === "running" ? "#fff" : "#b9bfd0",
      ],
    ];
    if (state !== "waiting")
      lines.push([
        `${(ran / 1000).toFixed(1)}s`,
        `${l.vertical ? 10 : 11}px ${MONO}`,
        state === "running" ? GOLD : "#868da3",
      ]);
    const lineH = l.vertical ? 14 : 16;
    const beside = side === "right" || side === "left";
    ctx.textAlign = side === "right" ? "left" : side === "left" ? "right" : "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    lines.forEach(([words, font, color], i) => {
      const y = beside
        ? at.y - (lines.length * lineH) / 2 + i * lineH
        : side === "above"
          ? at.y - gap - (lines.length - i) * lineH
          : at.y + gap + i * lineH;
      const x = side === "right" ? at.x + r + 10 : side === "left" ? at.x - r - 10 : at.x;
      ctx.font = font;
      ctx.strokeStyle = "#0c0e15";
      ctx.lineWidth = 4;
      ctx.setLineDash([]);
      ctx.strokeText(words, x, y);
      ctx.fillStyle = color;
      ctx.fillText(words, x, y);
    });
    ctx.restore();
  }
}
