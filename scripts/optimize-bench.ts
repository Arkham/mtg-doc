/**
 * Times a full optimizer run on a copy of a saved deck, against the live APIs and the configured
 * model: when each step runs, and every outbound request by service, as a timeline.
 *
 *   node --import tsx scripts/optimize-bench.ts <slug> [--json out.json]
 *
 * The copy lives in a temporary decks folder; the saved deck isn't touched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: "string" } },
});
const slug = positionals[0];
if (!slug) throw new Error("Usage: optimize-bench.ts <slug> [--json out.json]");

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "decks", slug);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-doc-bench-"));
fs.mkdirSync(path.join(dir, slug));
for (const file of ["deck.json", "initial.txt"])
  fs.copyFileSync(path.join(source, file), path.join(dir, slug, file));
process.env.DECKS_DIR = dir;

interface Call {
  service: string;
  what: string;
  start: number;
  end: number;
  status?: number;
}
const calls: Call[] = [];
const t0 = Date.now();
const since = () => Date.now() - t0;

const SERVICES: [RegExp, string][] = [
  [/api\.scryfall\.com/, "Scryfall"],
  [/commanderspellbook\.com/, "Spellbook"],
  [/edhrec\.com/, "EDHREC"],
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const service =
    SERVICES.find(([re]) => re.test(url.host))?.[1] ??
    (url.pathname.endsWith("/decisions") ? "Decisions" : "LLM");
  const call: Call = { service, what: url.pathname, start: since(), end: 0 };
  calls.push(call);
  try {
    const res = await realFetch(input, init);
    // A request lasts until its body has arrived; read it once and hand back a copy.
    const body = await res.arrayBuffer();
    call.end = since();
    call.status = res.status;
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (err) {
    call.end = since();
    throw err;
  }
};

const { startOptimize, getJob } = await import("../server/pipeline.ts");
const job = startOptimize(slug);
const steps = new Map<string, { start?: number; end?: number; status: string }>();
for (;;) {
  const j = getJob(job.id)!;
  for (const s of j.steps) {
    const seen = steps.get(s.label) ?? { status: "pending" };
    if (s.status === "running" && seen.start === undefined) seen.start = since();
    if (["done", "skipped", "error"].includes(s.status) && seen.end === undefined) {
      seen.start ??= since();
      seen.end = since();
    }
    seen.status = s.status;
    steps.set(s.label, seen);
  }
  if (j.status !== "running") {
    if (j.status === "error") console.error(`Job failed: ${j.error}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 20));
}
const total = since();

const WIDTH = 60;
const bar = (start: number, end: number) => {
  const a = Math.floor((start / total) * WIDTH);
  const b = Math.max(a + 1, Math.ceil((end / total) * WIDTH));
  return " ".repeat(a) + "█".repeat(b - a) + " ".repeat(Math.max(0, WIDTH - b));
};
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

console.log(`\n${slug}: ${secs(total)} in total\n\nSteps`);
for (const [label, s] of steps) {
  if (s.start === undefined || s.end === undefined) continue;
  console.log(
    `${label.padEnd(32)} ${bar(s.start, s.end)} ${secs(s.end - s.start).padStart(6)}${s.status === "skipped" ? " (skipped)" : ""}`,
  );
}
console.log("\nRequests by service (time with at least one in flight, and count)");
for (const service of new Set(calls.map((c) => c.service))) {
  const mine = calls.filter((c) => c.service === service).sort((a, b) => a.start - b.start);
  let busy = 0;
  let until = 0;
  for (const c of mine) {
    busy += Math.max(0, c.end - Math.max(c.start, until));
    until = Math.max(until, c.end);
  }
  const line = Array.from({ length: WIDTH }, (_, i) => {
    const t = ((i + 0.5) / WIDTH) * total;
    return mine.some((c) => c.start <= t && t < c.end) ? "▒" : " ";
  }).join("");
  console.log(`${service.padEnd(32)} ${line} ${secs(busy).padStart(6)} · ${mine.length}`);
}
const { readReport } = await import("../server/storage.ts");
const report = await readReport(slug);
if (report) {
  const guides = Object.keys(report.howToPlay ?? {}).join(" and ") || "none";
  console.log(
    `\nResult: ${report.swaps.length} swaps (${report.model ?? "no model"}), bracket ${report.bracket?.after.bracket ?? "?"}, ${report.synergies?.length ?? 0} synergies, guides: ${guides}`,
  );
  for (const s of report.swaps.slice(0, 5)) console.log(`  ${s.out} → ${s.in}: ${s.reason}`);
  if (report.warnings.length)
    console.log(`Warnings\n${report.warnings.map((w) => `- ${w}`).join("\n")}`);
}
if (values.json)
  fs.writeFileSync(
    values.json,
    JSON.stringify({ slug, total, steps: Object.fromEntries(steps), calls }, null, 2),
  );
fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
