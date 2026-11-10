/**
 * Plain HTML and text versions of the published site, for readers that don't run JavaScript
 * (AI agents, crawlers, link previews). The interactive app uses hash routes, which never reach
 * the server, so every deck also gets a real page at decks/<slug>/.
 */
import { Marked } from "marked";
import type { DeckSummary, Report } from "../shared/types.ts";

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

// Report text comes partly from the LLM: render markdown, never raw HTML.
const md = new Marked({ renderer: { html: ({ text }) => escapeHtml(text) } });

const SITE_INTRO =
  "Commander deck check-ups from the mtg doc: each deck's bracket, mana base, goldfish stats, combos, synergies and the swaps the doc suggests.";

const deckLine = (d: DeckSummary) =>
  [
    d.bracket !== undefined && `bracket ${d.bracket}`,
    d.landCount !== undefined && `${d.landCount} lands`,
    d.priceUsd !== undefined && `$${Math.round(d.priceUsd)}`,
    d.swapCount
      ? `${d.swapCount} suggested swaps${d.targetBracket ? ` for bracket ${d.targetBracket}` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");

const title = (d: DeckSummary) => d.commanders.join(" + ") || d.slug;

/** llms.txt: the index agents look for at the site root. */
export function llmsTxt(decks: DeckSummary[]): string {
  return [
    "# mtg doc",
    "",
    `> ${SITE_INTRO}`,
    "",
    "The site is a JavaScript app. Links like `#/deck/<slug>` show the same deck as the plain page `decks/<slug>/`; its full report is also at `data/decks/<slug>/report.md`.",
    "",
    "## Decks",
    "",
    ...decks.map(
      (d) =>
        `- [${title(d)}](decks/${d.slug}/): ${deckLine(d)} ([markdown](data/decks/${d.slug}/report.md))`,
    ),
    "",
  ].join("\n");
}

/** Readable content placed inside the app's root element; React replaces it once it starts. */
export function indexFallback(decks: DeckSummary[]): string {
  const items = decks
    .map(
      (d) =>
        `<li><a href="decks/${d.slug}/">${escapeHtml(title(d))}</a>: ${escapeHtml(deckLine(d))} (<a href="data/decks/${d.slug}/report.md">markdown</a>)</li>`,
    )
    .join("");
  return `<main class="agent-fallback"><h1>mtg doc</h1><p>${escapeHtml(SITE_INTRO)}</p><p>This page is an interactive app. Without JavaScript, read the plain versions below. A link like <code>#/deck/&lt;slug&gt;</code> is the same deck as <code>decks/&lt;slug&gt;/</code>. There's also an <a href="llms.txt">llms.txt</a> index.</p><h2>Decks</h2><ul>${items}</ul></main>`;
}

const PAGE_CSS = `body{margin:0;background:#0a0c12;color:#eceef4;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:780px;margin:0 auto;padding:24px 20px 64px}a{color:#ebc876}h1{font-size:2rem;line-height:1.15}
h2{margin-top:2em;font-size:1.3rem}h3{font-size:1rem;color:#b9bfd0}table{border-collapse:collapse;width:100%;font-size:.9em}
th,td{border-bottom:1px solid #2a2f3d;padding:6px 8px;text-align:left}.app-link{display:inline-block;margin:8px 0 16px}`;

/** A complete, script-free page for one deck, built from its markdown report. */
export function deckPage(summary: DeckSummary, report: Report, markdown: string): string {
  const name = title(summary);
  const desc = `${name}: ${deckLine(summary)}. ${report.themes.length ? `Themes: ${report.themes.join(", ")}.` : ""}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(name)} · mtg doc</title>
<meta name="description" content="${escapeHtml(desc)}" />
<link rel="alternate" type="text/markdown" href="../../data/decks/${summary.slug}/report.md" />
<link rel="icon" type="image/png" href="../../icon-64.png" />
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<p><a href="../../">mtg doc</a> · <a class="app-link" href="../../#/deck/${summary.slug}">Open the interactive report</a></p>
${md.parse(markdown) as string}
</main>
</body>
</html>
`;
}
