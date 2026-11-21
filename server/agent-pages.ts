/**
 * Plain HTML and text versions of the published site, for readers that don't run JavaScript
 * (AI agents, crawlers, link previews). Every URL the app shows is a real page that carries its
 * content in plain HTML.
 */
import { Marked } from "marked";
import { taskLabel } from "../shared/run-copy.ts";
import type { DeckSummary, Report, RunRecord, Service } from "../shared/types.ts";

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
    "Each deck's full report is plain HTML at `decks/<slug>/` and markdown at `data/decks/<slug>/report.md`. Older links like `#/deck/<slug>` are the same deck as `decks/<slug>/`.",
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

/** Readable content placed inside the app's root element; the app replaces it once it starts. */
export function indexFallback(decks: DeckSummary[]): string {
  const items = decks
    .map(
      (d) =>
        `<li><a href="decks/${d.slug}/">${escapeHtml(title(d))}</a>: ${escapeHtml(deckLine(d))} (<a href="data/decks/${d.slug}/report.md">markdown</a>)</li>`,
    )
    .join("");
  return `<main class="agent-fallback"><h1>mtg doc</h1><p>${escapeHtml(SITE_INTRO)}</p><p>Each deck below links to its full report as a plain page and as markdown. An older link like <code>#/deck/&lt;slug&gt;</code> is the same deck as <code>decks/&lt;slug&gt;/</code>. There's also an <a href="llms.txt">llms.txt</a> index.</p><h2>Decks</h2><ul>${items}</ul></main>`;
}

/**
 * One of the app's pages, readable without JavaScript: the built app shell with the page's content
 * inside the root element (the app replaces it once it starts). `base` is the relative path to the
 * site root, so the shell's relative URLs work at any depth.
 */
export function appPage(
  shell: string,
  page: { base: string; body: string; title?: string; description?: string; head?: string },
): string {
  const head = [
    page.description && `<meta name="description" content="${escapeHtml(page.description)}" />`,
    page.head,
  ]
    .filter(Boolean)
    .join("\n    ");
  let html = shell
    .replace("<head>", `<head>\n    <base href="${page.base}" />`)
    .replace('<div id="root"></div>', `<div id="root">${page.body}</div>`);
  if (page.title)
    html = html.replace("<title>mtg doc</title>", `<title>${escapeHtml(page.title)}</title>`);
  return head ? html.replace("</head>", `  ${head}\n  </head>`) : html;
}

const SERVICE_NAMES: Record<Service, string> = {
  scryfall: "Scryfall",
  spellbook: "Commander Spellbook",
  edhrec: "EDHREC",
  model: "the LLM",
  decisions: "Decisions",
};

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * The page replaying a deck's last optimizer run (decks/<slug>/run/): in plain HTML, each step
 * with when it ran and what it waited for, and the requests it made to each service.
 */
export function runPage(shell: string, base: string, summary: DeckSummary, run: RunRecord): string {
  const name = title(summary);
  const { trace } = run;
  const steps = trace.tasks
    .map((t) => {
      const asked = trace.requests.filter((r) => r.task === t.name);
      const services = [...new Set(asked.map((r) => r.service))]
        .map((s) => `${asked.filter((r) => r.service === s).length} to ${SERVICE_NAMES[s]}`)
        .join(", ");
      const when =
        t.start !== undefined && t.end !== undefined
          ? `from ${secs(t.start)} to ${secs(t.end)} (${secs(t.end - t.start)})`
          : "didn't run";
      const needs = t.needs.length
        ? ` after ${t.needs.map((n) => escapeHtml(taskLabel(n))).join(", ")}`
        : "";
      return `<li><strong>${escapeHtml(taskLabel(t.name))}</strong>: ${when}${needs}${services ? `; requests: ${services}` : ""}</li>`;
    })
    .join("");
  const outcome = run.status === "done" ? "finished" : "stopped with an error";
  return appPage(shell, {
    base,
    title: `How the doc optimized ${name} · mtg doc`,
    description: `A replay of the optimizer run for ${name}: ${trace.tasks.length} steps and ${trace.requests.length} requests in ${secs(trace.elapsed)}.`,
    body: `<main class="agent-fallback"><p><a href="./">mtg doc</a> · <a href="decks/${summary.slug}/optimized/">${escapeHtml(name)}</a></p><h1>How the doc optimized ${escapeHtml(name)}</h1><p>The run ${outcome} in ${secs(trace.elapsed)}, with ${trace.requests.length} requests to outside services. Times are from the start of the run.</p><ol>${steps}</ol></main>`,
  });
}

/** The page at one of a deck's URLs (decks/<slug>/...): its full report, from the markdown. */
export function deckPage(
  shell: string,
  base: string,
  summary: DeckSummary,
  report: Report,
  markdown: string,
): string {
  const name = title(summary);
  const report_md = `data/decks/${summary.slug}/report.md`;
  return appPage(shell, {
    base,
    title: `${name} · mtg doc`,
    description: `${name}: ${deckLine(summary)}. ${report.themes.length ? `Themes: ${report.themes.join(", ")}.` : ""}`,
    head: `<link rel="alternate" type="text/markdown" href="${report_md}" />`,
    body: `<main class="agent-fallback"><p><a href="./">mtg doc</a> · <a href="${report_md}">markdown version</a></p>${md.parse(markdown) as string}</main>`,
  });
}
