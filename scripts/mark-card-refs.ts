/**
 * Marks the cards named in saved reports' copy as [[Card Name]] references, for reports written
 * before copy carried them. The model only adds markers: a text is taken only if, without them,
 * it's exactly what it was, and only references to cards the report knows survive. Needs an LLM.
 * `--only a,b` limits it to some decks.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { plainText, refsIn } from "../shared/card-refs.ts";
import { toEntries } from "../server/analysis/deck.ts";
import { CARD_REFS_RULE, mapProse } from "../server/analysis/prose.ts";
import { buildCardIndex } from "../server/card-index.ts";
import { llmEnabled } from "../server/config.ts";
import { chatJson } from "../server/llm.ts";
import { loadDeck } from "../server/pipeline.ts";
import { listDecks, readReport, writeResults } from "../server/storage.ts";

const { values } = parseArgs({ options: { only: { type: "string" } } });
if (!llmEnabled()) {
  console.error("Marking card references needs an LLM: set LLM_API_KEY (see README).");
  process.exit(1);
}
const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
const BATCH = 25;
const Marked = z.object({ texts: z.array(z.object({ id: z.number(), text: z.string() })) });

for (const { slug } of await listDecks()) {
  if (only && !only.has(slug)) continue;
  const report = await readReport(slug);
  if (!report) continue;
  const texts: string[] = [];
  mapProse(report, (t) => {
    if (t && !refsIn(t).length) texts.push(t);
    return t;
  });
  const marked = new Map<string, string>();
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await chatJson(Marked, [
      {
        role: "user",
        content: `These texts come from a report on a Commander deck led by ${report.commanders.join(" + ")}. Return each one exactly as it is, character for character, except that every Magic card it names is wrapped as [[Card Name]]. ${CARD_REFS_RULE}

${batch.map((t, j) => `[${j}] ${t}`).join("\n")}

Reply with JSON only: {"texts": [{"id": 0, "text": "..."}]}`,
      },
    ]).catch(() => ({ texts: [] }));
    for (const { id, text } of res.texts) {
      const original = batch[id];
      // Only markers may change: anything else means the model rewrote the text.
      if (original !== undefined && plainText(text) === original) marked.set(original, text);
    }
  }
  const draft = mapProse(report, (t) => marked.get(t) ?? t);
  draft.cardIndex = await buildCardIndex(draft);
  const { deck } = await loadDeck(slug, "optimized.txt");
  const saved = await writeResults(slug, draft, {
    commanders: deck.commanders.map((c) => c.name),
    entries: toEntries(deck),
  });
  const refs = new Set<string>();
  mapProse(saved, (t) => (refsIn(t).forEach((n) => refs.add(n)), t));
  console.log(
    `${slug}: marked ${marked.size} of ${texts.length} texts, ${refs.size} cards referenced`,
  );
}
