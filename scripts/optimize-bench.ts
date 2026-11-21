/**
 * Times a full optimizer run on a copy of a saved deck, against the live APIs and the configured
 * model, from the run's own trace: when each task of its graph ran, and every request it made, by
 * service. `--trace out.json` saves the trace (and snapshots taken as it ran) for the UI's tests.
 *
 *   node --import tsx scripts/optimize-bench.ts <slug> [--trace out.json]
 *
 * The copy lives in a temporary decks folder; the saved deck isn't touched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { taskLabel } from "../shared/run-copy.ts";
import type { Trace } from "../shared/types.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { trace: { type: "string" } },
});
const slug = positionals[0];
if (!slug) throw new Error("Usage: optimize-bench.ts <slug> [--trace out.json]");

const root = path.resolve(import.meta.dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-doc-bench-"));
fs.mkdirSync(path.join(dir, slug));
for (const file of ["deck.json", "initial.txt"])
  fs.copyFileSync(path.join(root, "decks", slug, file), path.join(dir, slug, file));
process.env.DECKS_DIR = dir;

const { startOptimize, getJob } = await import("../server/pipeline.ts");
const { readReport } = await import("../server/storage.ts");
const job = startOptimize(slug);
const snapshots: Trace[] = [];
for (;;) {
  const j = getJob(job.id)!;
  if (j.trace) snapshots.push(j.trace);
  if (j.status !== "running") {
    if (j.status === "error") console.error(`Job failed: ${j.error}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
const trace = getJob(job.id)!.trace!;
const total = trace.elapsed;

const WIDTH = 60;
const at = (ms: number) => Math.floor((ms / total) * WIDTH);
const bar = (start: number, end: number) => {
  const a = at(start);
  const b = Math.max(a + 1, Math.ceil((end / total) * WIDTH));
  return " ".repeat(a) + "█".repeat(b - a) + " ".repeat(Math.max(0, WIDTH - b));
};
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

console.log(`\n${slug}: ${secs(total)} in total\n\nTasks`);
for (const t of trace.tasks)
  if (t.start !== undefined && t.end !== undefined)
    console.log(
      `${taskLabel(t.name).padEnd(26)} ${bar(t.start, t.end)} ${secs(t.end - t.start).padStart(6)}`,
    );
const work = trace.tasks.reduce((n, t) => n + ((t.end ?? 0) - (t.start ?? 0)), 0);
console.log(`\nIts tasks add up to ${secs(work)}; side by side they took ${secs(total)}.`);

console.log("\nRequests by service (time with at least one in flight, and count)");
for (const service of new Set(trace.requests.map((r) => r.service))) {
  const mine = trace.requests.filter((r) => r.service === service);
  let busy = 0;
  let until = 0;
  for (const r of [...mine].sort((a, b) => a.start - b.start)) {
    busy += Math.max(0, (r.end ?? total) - Math.max(r.start, until));
    until = Math.max(until, r.end ?? total);
  }
  const line = Array.from({ length: WIDTH }, (_, i) => {
    const t = ((i + 0.5) / WIDTH) * total;
    return mine.some((r) => r.start <= t && t < (r.end ?? total)) ? "▒" : " ";
  }).join("");
  console.log(`${service.padEnd(26)} ${line} ${secs(busy).padStart(6)} · ${mine.length}`);
}

const report = await readReport(slug);
if (report) {
  const guides = Object.keys(report.howToPlay ?? {}).join(" and ") || "none";
  console.log(
    `\nResult: ${report.swaps.length} swaps (${report.model ?? "no model"}), bracket ${report.bracket?.after.bracket ?? "?"}, ${report.synergies?.length ?? 0} synergies, guides: ${guides}`,
  );
  if (report.warnings.length)
    console.log(`Warnings\n${report.warnings.map((w) => `- ${w}`).join("\n")}`);
}
if (values.trace) fs.writeFileSync(values.trace, JSON.stringify({ trace, snapshots }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
