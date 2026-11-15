/**
 * Runs the pipeline's contradiction check on saved decks and saves the fixes (through
 * writeResults, so report.md follows). Needs an LLM. `--only a,b` limits it to some decks;
 * `--dry-run` only prints what it would fix.
 */
import { parseArgs } from "node:util";
import { toEntries } from "../server/analysis/deck.ts";
import { llmEnabled } from "../server/config.ts";
import { checkContradictions } from "../server/contradictions.ts";
import { loadDeck } from "../server/pipeline.ts";
import { listDecks, readReport, writeResults } from "../server/storage.ts";

const { values } = parseArgs({
  options: { only: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});
if (!llmEnabled()) {
  console.error("The contradiction check needs an LLM: set LLM_API_KEY (see README).");
  process.exit(1);
}
const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;

for (const { slug } of await listDecks()) {
  if (only && !only.has(slug)) continue;
  const saved = await readReport(slug);
  if (!saved) continue;
  const { report, fixes } = await checkContradictions(saved);
  console.log(`\n${slug}: ${fixes.length ? `${fixes.length} fixed` : "no contradictions"}`);
  for (const f of fixes) {
    console.log(`- [${f.id}] ${f.problem}\n  “${f.quote}”\n  → ${f.fixed ?? "(dropped)"}`);
  }
  if (!fixes.length || values["dry-run"]) continue;
  const { deck } = await loadDeck(slug, "optimized.txt");
  await writeResults(slug, report, {
    commanders: deck.commanders.map((c) => c.name),
    entries: toEntries(deck),
  });
}
