import fs from "node:fs/promises";
import path from "node:path";
import type { DeckEntry, DeckSummary, OptimizeOptions, Report } from "../shared/types.ts";
import { config } from "./config.ts";
import { formatDecklist } from "./decklist.ts";
import { slugify } from "./sources/edhrec.ts";

export interface DeckMeta {
  slug: string;
  format: "commander" | "other";
  commanders: string[];
  deckName: string | null;
  createdAt: string;
  options: OptimizeOptions;
  image: string | null;
}

const deckDir = (slug: string) => {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("Invalid deck slug");
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

export async function readInitial(slug: string): Promise<string> {
  return fs.readFile(path.join(deckDir(slug), "initial.txt"), "utf8");
}

export async function writeResults(
  slug: string,
  report: Report,
  optimized: { commanders: string[]; entries: DeckEntry[] },
  markdown: string,
) {
  const dir = deckDir(slug);
  await fs.writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(dir, "report.md"), markdown);
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
      out.push({
        slug: meta.slug,
        commanders: meta.commanders,
        format: meta.format,
        createdAt: meta.createdAt,
        hasReport: await exists(path.join(deckDir(d.name), "report.json")),
        image: meta.image,
      });
    } catch {
      // Folders without deck.json aren't managed by the app.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
