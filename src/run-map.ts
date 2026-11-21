/**
 * `<mtg-run-map>`: a run drawn as a map. Its tasks are stars laid out by what they wait for, the
 * outside services are stations along the bottom, and every request is a comet that flies from its
 * task to its service, circles there while it waits and flies back with the answer.
 *
 * Everything on it is a function of the trace and a moment, so the same drawing goes live (the
 * moment moves on between snapshots by itself) and shows any moment of a finished run.
 *
 * Set `trace` (a `Trace`) as a property; attributes: `running` while the run goes on, `at` (ms) to
 * show a moment of a finished run rather than its end, and `selected` (a task's name) to light up
 * what it waits for and what waits for it. Fires `select` (detail: a task's name) when a task is
 * tapped.
 */
import type { Service, Trace, TraceRequest, TraceTask } from "../shared/types.ts";
import { criticalEdges, depths, directNeeds, stateAt } from "./run-graph.ts";

const SERVICES: { id: Service; name: string; color: string }[] = [
  { id: "scryfall", name: "Scryfall", color: "#8fc8e8" },
  { id: "spellbook", name: "Commander Spellbook", color: "#c4a3f2" },
  { id: "edhrec", name: "EDHREC", color: "#f29a5a" },
  { id: "model", name: "The model", color: "#ebc876" },
  { id: "decisions", name: "Decisions", color: "#7fd49b" },
];
const GOLD = "#ebc876";
const NEEDS = "#8fc8e8";
const FEEDS = "#7fd49b";
const LIVE = "#f06272";
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
/** How long a comet takes to reach its service, or to come back. */
const FLIGHT_MS = 420;
const DRIFT_MS = 1500;

interface Point {
  x: number;
  y: number;
}

type Side = "below" | "above" | "right" | "left";

interface Layout {
  width: number;
  /** Where each task's label goes, so labels don't run into each other. */
  labels: Map<string, Side>;
  direct: Map<string, string[]>;
  height: number;
  vertical: boolean;
  nodes: Map<string, Point>;
  stations: Map<Service, Point>;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (p: number) => 1 - (1 - p) ** 3;

function layout(tasks: TraceTask[], width: number, measure: (label: string) => number): Layout {
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
    const top = 36;
    const h = Math.max(260, Math.max(...columns.map((c) => c.length)) * 78);
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
  for (const at of nodes.values())
    placed.push({ x0: at.x - 12, x1: at.x + 12, y0: at.y - 12, y1: at.y + 12 });
  for (const t of tasks) {
    const at = nodes.get(t.name)!;
    const w = measure(t.label) / 2 + 4;
    const sides: [Side, Box][] = [
      ["below", { x0: at.x - w, x1: at.x + w, y0: at.y + 13, y1: at.y + 48 }],
      ["above", { x0: at.x - w, x1: at.x + w, y0: at.y - 48, y1: at.y - 13 }],
      ["right", { x0: at.x + 16, x1: at.x + 20 + 2 * w, y0: at.y - 16, y1: at.y + 16 }],
      ["left", { x0: at.x - 20 - 2 * w, x1: at.x - 16, y0: at.y - 16, y1: at.y + 16 }],
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
    labels,
    direct: directNeeds(tasks),
    height: stationY + (vertical ? 86 : 72),
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

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

export class RunMap extends HTMLElement {
  static observedAttributes = ["running", "selected", "at"];
  #trace: Trace | null = null;
  #received = 0;
  #canvas = document.createElement("canvas");
  #ctx = this.#canvas.getContext("2d")!;
  #layout: Layout | null = null;
  #frame = 0;
  #resize = new ResizeObserver(() => this.#relayout());

  set trace(trace: Trace) {
    const first = !this.#trace || this.#trace.tasks.length !== trace.tasks.length;
    this.#trace = trace;
    this.#received = performance.now();
    if (first) this.#relayout();
    this.#wake();
  }

  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    if (!root.firstChild) {
      const style = document.createElement("style");
      style.textContent =
        ":host{display:block;position:relative;touch-action:pan-y}canvas{display:block;width:100%}";
      root.append(style, this.#canvas);
    }
    this.#resize.observe(this);
    this.#canvas.addEventListener("pointermove", this.#move);
    this.#canvas.addEventListener("pointerup", this.#up);
    this.#relayout();
  }

  disconnectedCallback() {
    this.#resize.disconnect();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  attributeChangedCallback() {
    this.#wake();
  }

  get #running() {
    return this.hasAttribute("running");
  }

  /** The moment the map shows. */
  #now(): number {
    const trace = this.#trace!;
    const at = this.getAttribute("at");
    if (at !== null) return Number(at);
    // Only so far past the latest trace: the server sends one every second.
    const drift = Math.min(DRIFT_MS, performance.now() - this.#received);
    return this.#running ? trace.elapsed + drift : trace.elapsed;
  }

  #relayout() {
    const width = this.clientWidth;
    if (!width || !this.#trace) return;
    this.#ctx.font = `500 ${width < 640 ? 11 : 12.5}px ${FONT}`;
    this.#layout = layout(this.#trace.tasks, width, (label) => this.#ctx.measureText(label).width);
    const dpr = window.devicePixelRatio || 1;
    this.#canvas.width = Math.round(width * dpr);
    this.#canvas.height = Math.round(this.#layout.height * dpr);
    this.#canvas.style.height = `${this.#layout.height}px`;
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#wake();
  }

  /** Draws now, and keeps drawing while something on the map moves. */
  #wake() {
    if (this.#frame || !this.isConnected) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (!this.#trace || !this.#layout) return;
      this.#draw(this.#now());
      if (this.#running) this.#wake();
    });
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
    const finished = !this.#running && t >= trace.elapsed;
    const critical = this.#running ? new Set<string>() : criticalEdges(trace.tasks);

    ctx.clearRect(0, 0, l.width, l.height);
    this.#backdrop(l);

    // Lines between tasks: what each waits for.
    for (const task of trace.tasks) {
      const b = l.nodes.get(task.name)!;
      const state = stateAt(task, t);
      for (const need of l.direct.get(task.name)!) {
        const a = l.nodes.get(need)!;
        const needDone = stateAt(tasks.get(need)!, t) === "done";
        const key = `${need}>${task.name}`;
        let color = "rgba(255,255,255,0.06)";
        let width = 1;
        let dash: number[] = [];
        if (selected === task.name) [color, width] = [NEEDS, 2];
        else if (selected === need) [color, width] = [FEEDS, 2];
        else if (finished && critical.has(key)) [color, width] = [GOLD, 2.5];
        else if (state !== "waiting") color = "rgba(255,255,255,0.17)";
        else if (needDone) [color, dash] = ["rgba(235,200,118,0.45)", [3, 5]];
        ctx.save();
        if (finished && critical.has(key) && !selected) {
          ctx.shadowColor = GOLD;
          ctx.shadowBlur = 10;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
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
        // The handoff: a spark runs down the line as the task starts.
        const since = t - (task.start ?? Infinity);
        if (since >= 0 && since < 600) {
          const p = edgePoint(a, b, ease(since / 600), l.vertical);
          this.#glow(p, 3.5, GOLD, 1 - since / 600);
        }
      }
    }

    this.#paths(trace.requests, t, l);
    this.#stations(trace.requests, t, l);
    this.#comets(trace.requests, t, l);

    for (const task of trace.tasks) this.#node(task, t, l, selected, finished && critical, tasks);
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
      const name = l.vertical && s.id === "spellbook" ? "Spellbook" : s.name;
      ctx.fillText(name, at.x, at.y + r + 8);
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
  #paths(requests: TraceRequest[], t: number, l: Layout) {
    const ctx = this.#ctx;
    ctx.save();
    ctx.lineWidth = 1;
    requests.forEach((r, i) => {
      if (r.start > t) return;
      const color = SERVICES.find((s) => s.id === r.service)!.color;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.03 + 0.09 * clamp((t - r.start) / 1500);
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
    critical: false | Set<string>,
    tasks: Map<string, TraceTask>,
  ) {
    const ctx = this.#ctx;
    const at = l.nodes.get(task.name)!;
    const state = stateAt(task, t);
    const ran = state === "waiting" ? 0 : Math.min(t, task.end ?? t) - task.start!;
    const r = state === "waiting" ? 6 : 6 + Math.min(13, Math.sqrt(ran / 1000) * 3.2);
    const onPath =
      critical &&
      [...critical].some((e) => e.startsWith(`${task.name}>`) || e.endsWith(`>${task.name}`));
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
        task.label,
        `${state === "running" ? 600 : 500} ${l.vertical ? 11 : 12.5}px ${FONT}`,
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
