import fs from "node:fs";
import path from "node:path";
import { parseDecklist } from "../../server/decklist.ts";
import { getJob, startOptimize } from "../../server/pipeline.ts";
import { createDeckFolder, readReport, writeDeck } from "../../server/storage.ts";
import type { Job, OptimizeOptions, Report } from "../../shared/types.ts";

export const DEFAULT_OPTIONS: OptimizeOptions = {
  maxSwaps: 12,
  budgetPerCard: null,
  budgetTotal: null,
  bracket: null,
  tone: "max",
  locked: [],
  webResearch: false,
};

export async function waitForJob(id: string, timeoutMs = 120_000): Promise<Job> {
  const start = Date.now();
  for (;;) {
    const job = getJob(id);
    if (job && job.status !== "running") return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} timed out`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Saves a fixture decklist to DECKS_DIR and runs the full optimizer on it. */
export async function optimizeFixtureDeck(
  file: string,
  options: Partial<OptimizeOptions> = {},
): Promise<{ slug: string; job: Job; report: Report }> {
  const text = fs.readFileSync(
    path.resolve(import.meta.dirname, "../fixtures/decks", file),
    "utf8",
  );
  const parsed = parseDecklist(text);
  const slug = await createDeckFolder(parsed.commanders.join(" "));
  await writeDeck(
    {
      slug,
      format: "commander",
      commanders: parsed.commanders,
      deckName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      options: { ...DEFAULT_OPTIONS, ...options },
      image: null,
    },
    parsed.entries,
    [],
  );
  const job = await waitForJob(startOptimize(slug).id);
  if (job.status !== "done") throw new Error(`Optimizer failed: ${job.error}`);
  const report = await readReport(slug);
  if (!report) throw new Error("No report written");
  return { slug, job, report };
}
