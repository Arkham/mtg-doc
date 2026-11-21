import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type Card,
  COLORS,
  type DeckEntry,
  type DeckSummary,
  type OptimizeOptions,
  type Report,
  type RunRecord,
} from "../shared/types.ts";
import type { Gap } from "./analysis/reoptimize.ts";
import { checkReport } from "./analysis/consistency.ts";
import { config } from "./config.ts";
import { formatDecklist, parseDecklist } from "./decklist.ts";
import { slugify } from "./sources/edhrec.ts";
import { renderMarkdown } from "./report.ts";
import { settleRefs } from "./analysis/prose.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface DeckMeta {
  slug: string;
  format: "commander" | "other";
  commanders: string[];
  deckName: string | null;
  createdAt: string;
  options: OptimizeOptions;
  image: string | null;
  /** Publish only the deck as submitted, without the doc's suggestions. */
  hideSuggestions?: boolean;
}

const deckDir = (slug: string) => {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new HttpError(400, "Invalid deck slug");
  return path.join(config.decksDir, slug);
};

async function exists(p: string) {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

/**
 * Writes a file so readers see the old or the new version, never half of one: the UI polls a deck
 * while background edits rewrite it.
 */
export async function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export async function createDeckFolder(base: string): Promise<string> {
  await fs.mkdir(config.decksDir, { recursive: true });
  const root = slugify(base) || "deck";
  for (let i = 1; ; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    if (!(await exists(deckDir(slug)))) {
      await fs.mkdir(deckDir(slug), { recursive: true });
      return slug;
    }
  }
}

export async function writeDeck(
  meta: DeckMeta,
  entries: DeckEntry[],
  uploads: { name: string; data: Buffer }[],
) {
  const dir = deckDir(meta.slug);
  await writeAtomic(path.join(dir, "initial.txt"), formatDecklist(meta.commanders, entries));
  await writeAtomic(path.join(dir, "deck.json"), JSON.stringify(meta, null, 2));
  if (uploads.length) {
    await fs.mkdir(path.join(dir, "uploads"), { recursive: true });
    for (const u of uploads) await fs.writeFile(path.join(dir, "uploads", u.name), u.data);
  }
}

export async function readMeta(slug: string): Promise<DeckMeta> {
  return JSON.parse(await fs.readFile(path.join(deckDir(slug), "deck.json"), "utf8"));
}

export async function writeMeta(meta: DeckMeta) {
  await writeAtomic(path.join(deckDir(meta.slug), "deck.json"), JSON.stringify(meta, null, 2));
}

/** Replaces the deck as submitted, after the user edited it through chat. */
export async function writeInitial(slug: string, commanders: string[], entries: DeckEntry[]) {
  await writeAtomic(path.join(deckDir(slug), "initial.txt"), formatDecklist(commanders, entries));
}

export async function setHideSuggestions(slug: string, hide: boolean): Promise<DeckMeta> {
  const meta = await readMeta(slug);
  if (hide) meta.hideSuggestions = true;
  else delete meta.hideSuggestions;
  await writeMeta(meta);
  return meta;
}

export async function readInitial(slug: string): Promise<string> {
  return fs.readFile(path.join(deckDir(slug), "initial.txt"), "utf8");
}

/**
 * Saves a report with its markdown and optimized list, and returns it as saved: every card its
 * copy references is settled against its card index first (see settleRefs). The markdown is always rendered here from
 * the report being saved, so report.md can never fall behind report.json, and a report whose
 * sections disagree with its deck list is never saved.
 */
export async function writeResults(
  slug: string,
  draft: Report,
  optimized: { commanders: string[]; entries: DeckEntry[] },
): Promise<Report> {
  const report = settleRefs(draft);
  const problems = checkReport(report, optimized);
  if (problems.length)
    throw new Error(
      `Refusing to save an inconsistent report for ${slug}:\n- ${problems.join("\n- ")}`,
    );
  const dir = deckDir(slug);
  await writeAtomic(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  await writeAtomic(path.join(dir, "report.md"), renderMarkdown(report));
  await writeAtomic(
    path.join(dir, "optimized.txt"),
    formatDecklist(optimized.commanders, optimized.entries),
  );
  return report;
}

/**
 * Every card in a deck's two lists, as Scryfall had them when the deck was last optimized or
 * edited, keyed by name. Edits work from these instead of fetching the whole deck again: what
 * they work out then follows from the same cards as the report they change.
 */
export async function readCards(slug: string): Promise<Map<string, Card>> {
  const text = await fs.readFile(path.join(deckDir(slug), "cards.json"), "utf8").catch(() => null);
  if (!text) return new Map();
  return new Map(Object.entries(JSON.parse(text) as Record<string, Card>));
}

/** Saves the cards of the deck's lists (exactly these: cards no list has any more are dropped). */
export async function writeCards(slug: string, cards: Iterable<Card>) {
  const byName = Object.fromEntries(
    [...cards].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.name, c]),
  );
  await writeAtomic(path.join(deckDir(slug), "cards.json"), JSON.stringify(byName));
}

export async function readReport(slug: string): Promise<Report | null> {
  const p = path.join(deckDir(slug), "report.json");
  return (await exists(p)) ? JSON.parse(await fs.readFile(p, "utf8")) : null;
}

/** When the report was last saved (ms since the epoch), or null if it hasn't been. */
export async function reportSavedAt(slug: string): Promise<number | null> {
  const stat = await fs.stat(path.join(deckDir(slug), "report.json")).catch(() => null);
  return stat ? stat.mtimeMs : null;
}

/**
 * Edits whose slower consequences (combos, synergies, guides...) haven't been worked out yet.
 * Kept on disk so a restart doesn't lose them.
 */
export interface PendingRefresh {
  /** Bumped by every edit: a refresh saves its results only if no edit came in meanwhile. */
  version: number;
  /** When the refresh starts (ms since the epoch). */
  due: number;
  /** The report's gaps before the first of these edits, to judge what they made worse. */
  gaps: Gap[];
  /** The doc's swaps these edits made no longer apply. */
  droppedSwaps: number;
  /** Cards the edits brought in, to look for synergies with. */
  added: string[];
  /** Whether they changed the deck as submitted, not only the suggestions. */
  original: boolean;
  /** The changes, oldest first. */
  changes: { action: "add" | "remove"; name: string; qty: number }[];
}

const pendingPath = (slug: string) => path.join(deckDir(slug), "refresh.json");

export async function readPendingRefresh(slug: string): Promise<PendingRefresh | null> {
  return fs.readFile(pendingPath(slug), "utf8").then(
    (t) => JSON.parse(t) as PendingRefresh,
    () => null,
  );
}

export async function writePendingRefresh(slug: string, pending: PendingRefresh) {
  await writeAtomic(pendingPath(slug), JSON.stringify(pending, null, 2));
}

export async function clearPendingRefresh(slug: string) {
  await fs.rm(pendingPath(slug), { force: true });
}

/** Decks with a refresh still to run, from before a restart. */
export async function decksWithPendingRefresh(): Promise<string[]> {
  const dirs = await fs.readdir(config.decksDir, { withFileTypes: true }).catch(() => []);
  return dirs
    .filter(
      (d) =>
        d.isDirectory() && fsSync.existsSync(path.join(config.decksDir, d.name, "refresh.json")),
    )
    .map((d) => d.name);
}

/** The deck's last optimizer run, as it went, for replaying. */
export async function writeRun(slug: string, run: RunRecord) {
  await writeAtomic(path.join(deckDir(slug), "run.json"), JSON.stringify(run));
}

export async function readRun(slug: string): Promise<RunRecord | null> {
  const p = path.join(deckDir(slug), "run.json");
  return (await exists(p)) ? JSON.parse(await fs.readFile(p, "utf8")) : null;
}

export async function hasRun(slug: string) {
  return exists(path.join(deckDir(slug), "run.json"));
}

export async function readDeckFile(
  slug: string,
  file: "initial.txt" | "optimized.txt" | "report.md",
) {
  return fs.readFile(path.join(deckDir(slug), file), "utf8");
}

export async function listDecks(): Promise<DeckSummary[]> {
  await fs.mkdir(config.decksDir, { recursive: true });
  const out: DeckSummary[] = [];
  for (const d of await fs.readdir(config.decksDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      const meta = await readMeta(d.name);
      const report = await readReport(d.name).catch(() => null);
      const list = await readInitial(d.name).then(parseDecklist, () => null);
      out.push({
        slug: meta.slug,
        commanders: meta.commanders,
        format: meta.format,
        createdAt: meta.createdAt,
        hasReport: report !== null,
        image: meta.image,
        colorIdentity: report
          ? COLORS.filter((c) => report.commanderCards.some((k) => k.colorIdentity.includes(c)))
          : undefined,
        bracket: report?.bracket?.before.bracket,
        landCount: report?.before.mana.landCount,
        priceUsd: report?.before.totalPriceUsd,
        swapCount: report?.swaps.length,
        targetBracket: report?.bracket?.target,
        cards: list
          ? [...new Set([...list.commanders, ...list.entries.map((e) => e.name)])].sort()
          : [],
        commanderPreviews: report
          ? Object.fromEntries(
              report.commanderCards.map((c) => [
                c.name,
                { image: c.image, scryfallUri: c.scryfallUri },
              ]),
            )
          : undefined,
      });
    } catch {
      // Folders without deck.json aren't managed by the app.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Consistency problems in a deck folder's saved report and list (see `checkReport`). */
export async function checkSavedDeck(dir: string): Promise<string[]> {
  const report = await fs.readFile(path.join(dir, "report.json"), "utf8").catch(() => null);
  if (!report) return [];
  const list = await fs.readFile(path.join(dir, "optimized.txt"), "utf8").catch(() => null);
  return checkReport(JSON.parse(report) as Report, list ? parseDecklist(list) : undefined);
}
