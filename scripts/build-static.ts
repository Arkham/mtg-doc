/**
 * Builds a read-only static site from decks/ into site/ (or --out <dir>).
 * Host it anywhere: GitHub Pages, Netlify, Cloudflare Pages, S3. Routing is hash-based, so no rewrites needed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { build } from "vite";
import { config } from "../server/config.ts";
import { deckPage, indexFallback, llmsTxt } from "../server/agent-pages.ts";
import { withoutSuggestionCounts, withoutSuggestions } from "../server/publish.ts";
import { renderMarkdown } from "../server/report.ts";
import type { DeckSummary } from "../shared/types.ts";
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
  await fs.writeFile(path.join(dir, "detail.json"), JSON.stringify({ meta, report, initial }));
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
    const page = path.join(outDir, "decks", d.slug);
    await fs.mkdir(page, { recursive: true });
    await fs.writeFile(path.join(page, "index.html"), deckPage(d, report, markdown));
  }
}

// Everything published must be readable without JavaScript (see AGENTS.md).
await fs.writeFile(path.join(outDir, "llms.txt"), llmsTxt(decks));
const indexPath = path.join(outDir, "index.html");
const index = await fs.readFile(indexPath, "utf8");
await fs.writeFile(
  indexPath,
  index
    .replace('<div id="root"></div>', `<div id="root">${indexFallback(decks)}</div>`)
    .replace(
      "</head>",
      '<link rel="alternate" type="text/plain" href="llms.txt" title="Plain-text index" />\n  </head>',
    ),
);

await fs.writeFile(path.join(dataDir, "decks.json"), JSON.stringify(decks));
// Stops GitHub Pages' Jekyll from processing the output.
await fs.writeFile(path.join(outDir, ".nojekyll"), "");

console.log(
  `Static site with ${decks.length} deck(s) written to ${path.relative(process.cwd(), outDir) || "."}/`,
);
