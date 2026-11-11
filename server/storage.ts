import fs from "node:fs/promises";
import path from "node:path";
import {
  COLORS,
  type DeckEntry,
  type DeckSummary,
  type OptimizeOptions,
  type Report,
} from "../shared/types.ts";
import { checkReport } from "./analysis/consistency.ts";
import { config } from "./config.ts";
import { formatDecklist, parseDecklist } from "./decklist.ts";
import { slugify } from "./sources/edhrec.ts";
import { renderMarkdown } from "./report.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface DeckMeta {
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
  await fs.writeFile(path.join(dir, "initial.txt"), formatDecklist(meta.commanders, entries));
  await fs.writeFile(path.join(dir, "deck.json"), JSON.stringify(meta, null, 2));
  if (uploads.length) {
    await fs.mkdir(path.join(dir, "uploads"), { recursive: true });
    for (const u of uploads) await fs.writeFile(path.join(dir, "uploads", u.name), u.data);
  }
}

export async function readMeta(slug: string): Promise<DeckMeta> {
  return JSON.parse(await fs.readFile(path.join(deckDir(slug), "deck.json"), "utf8"));
}

export async function writeMeta(meta: DeckMeta) {
  await fs.writeFile(path.join(deckDir(meta.slug), "deck.json"), JSON.stringify(meta, null, 2));
}

/** Replaces the deck as submitted, after the user edited it through chat. */
export async function writeInitial(slug: string, commanders: string[], entries: DeckEntry[]) {
  await fs.writeFile(path.join(deckDir(slug), "initial.txt"), formatDecklist(commanders, entries));
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
 * Saves a report with its markdown and optimized list. The markdown is always rendered here from
 * the report being saved, so report.md can never fall behind report.json, and a report whose
 * sections disagree with its deck list is never saved.
 */
export async function writeResults(
  slug: string,
  report: Report,
  optimized: { commanders: string[]; entries: DeckEntry[] },
) {
  const problems = checkReport(report, optimized);
  if (problems.length)
    throw new Error(
      `Refusing to save an inconsistent report for ${slug}:\n- ${problems.join("\n- ")}`,
    );
  const dir = deckDir(slug);
  await fs.writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(dir, "report.md"), renderMarkdown(report));
  await fs.writeFile(
    path.join(dir, "optimized.txt"),
    formatDecklist(optimized.commanders, optimized.entries),
  );
}

export async function readReport(slug: string): Promise<Report | null> {
  const p = path.join(deckDir(slug), "report.json");
  return (await exists(p)) ? JSON.parse(await fs.readFile(p, "utf8")) : null;
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
