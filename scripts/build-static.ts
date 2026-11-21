/**
 * Builds a read-only static site from decks/ into site/ (or --out <dir>).
 * Host it anywhere: GitHub Pages, Netlify, Cloudflare Pages, S3. Every route is a real page, so no
 * rewrites needed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { build } from "vite";
import { buildElmTo } from "./elm.ts";
import { config } from "../src/server/config.ts";
import { appPage, deckPage, indexFallback, llmsTxt, runPage } from "../src/server/agent-pages.ts";
import { deckPaths, runPath } from "../src/web/routes.ts";
import { withoutSuggestionCounts, withoutSuggestions } from "../src/server/publish.ts";
import { renderMarkdown } from "../src/server/report.ts";
import type { DeckSummary } from "../src/shared/types.ts";
import {
  listDecks,
  readDeckFile,
  readInitial,
  readMeta,
  readReport,
  readRun,
} from "../src/server/storage.ts";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "site" },
    only: { type: "string" },
  },
});

const outDir = path.resolve(config.root, values.out!);
const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;

process.env.VITE_STATIC = "1";
// Its own optimized Elm build, copied in over whatever public/elm/ holds (`pnpm dev`'s, say).
const elm = path.join(config.root, "elm-stuff", "builds", "optimize", "main.js");
await buildElmTo(elm, true);
await build({ root: config.root, logLevel: "warn", build: { outDir, emptyOutDir: true } });
await fs.mkdir(path.join(outDir, "elm"), { recursive: true });
await fs.copyFile(elm, path.join(outDir, "elm", "main.js"));

const indexPath = path.join(outDir, "index.html");
const shell = await fs.readFile(indexPath, "utf8");

const listed = (await listDecks()).filter((d) => !only || only.has(d.slug));
const decks: DeckSummary[] = [];
const dataDir = path.join(outDir, "data");
await fs.mkdir(path.join(dataDir, "decks"), { recursive: true });

for (const listedDeck of listed) {
  const dir = path.join(dataDir, "decks", listedDeck.slug);
  await fs.mkdir(dir, { recursive: true });
  const [meta, saved, initial] = await Promise.all([
    readMeta(listedDeck.slug),
    readReport(listedDeck.slug),
    readInitial(listedDeck.slug),
  ]);
  // The owner can keep the doc's suggestions private: publish only the deck as submitted.
  const hide = Boolean(meta.hideSuggestions);
  const report = saved && hide ? withoutSuggestions(saved) : saved;
  const d = hide ? withoutSuggestionCounts(listedDeck) : listedDeck;
  decks.push(d);
  // The run is part of what the doc suggested: kept private along with the suggestions.
  const run = hide ? null : await readRun(listedDeck.slug);
  await fs.writeFile(
    path.join(dir, "detail.json"),
    JSON.stringify({ meta, report, initial, hasRun: Boolean(run) }),
  );
  if (run) {
    await fs.writeFile(path.join(dir, "run.json"), JSON.stringify(run));
    const page = path.join(outDir, runPath(d.slug));
    await fs.mkdir(page, { recursive: true });
    await fs.writeFile(
      path.join(page, "index.html"),
      runPage(shell, "../".repeat(runPath(d.slug).split("/").filter(Boolean).length), d, run),
    );
  }
  for (const file of hide
    ? (["initial.txt"] as const)
    : (["initial.txt", "optimized.txt"] as const)) {
    const text = await readDeckFile(d.slug, file).catch(() => null);
    if (text !== null) await fs.writeFile(path.join(dir, file), text);
  }
  if (report) {
    // Rendered fresh so published text always matches the report data.
    const markdown = renderMarkdown(report);
    await fs.writeFile(path.join(dir, "report.md"), markdown);
    for (const route of deckPaths(d.slug)) {
      const page = path.join(outDir, route);
      await fs.mkdir(page, { recursive: true });
      const base = "../".repeat(route.split("/").filter(Boolean).length);
      await fs.writeFile(path.join(page, "index.html"), deckPage(shell, base, d, report, markdown));
    }
  }
}

// Everything published must be readable without JavaScript (see AGENTS.md).
await fs.writeFile(path.join(outDir, "llms.txt"), llmsTxt(decks));
await fs.writeFile(
  indexPath,
  appPage(shell, {
    base: "./",
    body: indexFallback(decks),
    head: '<link rel="alternate" type="text/plain" href="llms.txt" title="Plain-text index" />',
  }),
);

await fs.writeFile(path.join(dataDir, "decks.json"), JSON.stringify(decks));
// Stops GitHub Pages' Jekyll from processing the output.
await fs.writeFile(path.join(outDir, ".nojekyll"), "");

console.log(
  `Static site with ${decks.length} deck(s) written to ${path.relative(process.cwd(), outDir) || "."}/`,
);
