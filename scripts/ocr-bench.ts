/**
 * Runs photo recognition on real images and prints what it found, for tuning the scanner.
 * Usage: node --import tsx scripts/ocr-bench.ts photo.jpg [more.jpg] [--truth truth.txt]
 * With --truth (a decklist), prints precision/recall against it.
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { parseDecklist } from "../server/decklist.ts";
import { recognizeImages } from "../server/ocr.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { truth: { type: "string" } },
});
if (!positionals.length) throw new Error("Pass at least one image path");

const started = Date.now();
let lastPhase = "";
const result = await recognizeImages(
  positionals.map((p) => fs.readFileSync(p)),
  {
    onProgress: ({ phase, done, total }) => {
      if (phase !== lastPhase) process.stderr.write(`\n${phase} `);
      lastPhase = phase;
      process.stderr.write(`\r${phase} ${done}/${total}   `);
    },
  },
);
const secs = ((Date.now() - started) / 1000).toFixed(1);

console.log(
  `\n\nCommander(s): ${result.commanders.join(" + ") || "none"} · format ${result.format} · ${secs}s`,
);
const total = result.entries.reduce((n, e) => n + e.qty, 0) + result.commanders.length;
console.log(`${result.entries.length} distinct cards, ${total} total\n`);
for (const e of [...result.entries].sort(
  (a, b) => (a.confidence ?? 0) - (b.confidence ?? 0) || a.name.localeCompare(b.name),
)) {
  const read = e.raw !== e.name ? `  ← "${e.raw}"` : "";
  console.log(
    `${e.status === "exact" ? "✓" : "?"} ${e.qty} ${e.name}${read}  [${e.lang ?? "?"} · ${e.votes ?? 0} votes · ${e.confidence ?? "-"}]`,
  );
}
console.log("\nNotes:\n" + result.notes.map((n) => `- ${n}`).join("\n"));

if (values.truth) {
  const truth = parseDecklist(fs.readFileSync(values.truth, "utf8"));
  const expected = new Set([...truth.commanders, ...truth.entries.map((e) => e.name)]);
  const found = new Set([...result.commanders, ...result.entries.map((e) => e.name)]);
  const hits = [...found].filter((n) => expected.has(n));
  console.log(
    `\nRecall ${hits.length}/${expected.size} (${((hits.length / expected.size) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Precision ${hits.length}/${found.size} (${((hits.length / found.size) * 100).toFixed(1)}%)`,
  );
  console.log(`Missed: ${[...expected].filter((n) => !found.has(n)).join(", ") || "none"}`);
  console.log(`Wrong: ${[...found].filter((n) => !expected.has(n)).join(", ") || "none"}`);
}
