/**
 * Builds a read-only static site from decks/ into site/ (or --out <dir>).
 * Host it anywhere: GitHub Pages, Netlify, Cloudflare Pages, S3. Routing is hash-based, so no rewrites needed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { build } from "vite";
import { config } from "../server/config.ts";
import { listDecks, readDeckFile, readInitial, readMeta, readReport } from "../server/storage.ts";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "site" },
    only: { type: "string" },
  },
});

const outDir = path.resolve(config.root, values.out!);
const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;

process.env.VITE_STATIC = "1";
await build({
  root: config.root,
  logLevel: "warn",
  build: { outDir, emptyOutDir: true },
});

const decks = (await listDecks()).filter((d) => !only || only.has(d.slug));
const dataDir = path.join(outDir, "data");
await fs.mkdir(path.join(dataDir, "decks"), { recursive: true });

for (const d of decks) {
  const dir = path.join(dataDir, "decks", d.slug);
  await fs.mkdir(dir, { recursive: true });
  const [meta, report, initial] = await Promise.all([
    readMeta(d.slug),
    readReport(d.slug),
    readInitial(d.slug),
  ]);
  await fs.writeFile(path.join(dir, "detail.json"), JSON.stringify({ meta, report, initial }));
  for (const file of ["initial.txt", "optimized.txt", "report.md"] as const) {
    const text = await readDeckFile(d.slug, file).catch(() => null);
    if (text !== null) await fs.writeFile(path.join(dir, file), text);
  }
}

await fs.writeFile(path.join(dataDir, "decks.json"), JSON.stringify(decks));
// Stops GitHub Pages' Jekyll from processing the output.
await fs.writeFile(path.join(outDir, ".nojekyll"), "");

console.log(
  `Static site with ${decks.length} deck(s) written to ${path.relative(process.cwd(), outDir) || "."}/`,
);
