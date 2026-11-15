/**
 * Writes the how-to-play guides for saved decks (both lists), e.g. after changing how they're
 * written. Needs an LLM. `--only a,b` limits it to some decks. Run `pnpm fix:contradictions` after.
 */
import { parseArgs } from "node:util";
import { toEntries } from "../server/analysis/deck.ts";
import { llmEnabled } from "../server/config.ts";
import { loadDeck } from "../server/pipeline.ts";
import { writeGuides } from "../server/play-guide.ts";
import { listDecks, readReport, writeResults } from "../server/storage.ts";

const { values } = parseArgs({ options: { only: { type: "string" } } });
if (!llmEnabled()) {
  console.error("Writing guides needs an LLM: set LLM_API_KEY (see README).");
  process.exit(1);
}
const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;

for (const { slug } of await listDecks()) {
  if (only && !only.has(slug)) continue;
  const report = await readReport(slug);
  if (!report) continue;
  const [{ deck: original }, { deck: optimized }] = await Promise.all([
    loadDeck(slug, "initial.txt"),
    loadDeck(slug, "optimized.txt"),
  ]);
  const howToPlay = await writeGuides(report, { original, optimized });
  await writeResults(
    slug,
    { ...report, howToPlay },
    { commanders: optimized.commanders.map((c) => c.name), entries: toEntries(optimized) },
  );
  console.log(`${slug}: ${howToPlay ? Object.keys(howToPlay).join(" and ") : "no guides"}`);
}
