/**
 * Marks the cards named in saved reports' copy and the doc's chat messages as [[Card Name]]
 * references, for decks from before copy carried them. The model only adds markers: a text is
 * taken only if, without them, it's exactly what it was, and only references that resolve to real
 * cards survive. The user's own messages stay as typed. Needs an LLM. `--only a,b` limits it to
 * some decks.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { plainText, refsIn } from "../src/shared/card-refs.ts";
import { toEntries } from "../src/server/analysis/deck.ts";
import { CARD_REFS_RULE, mapProse } from "../src/server/analysis/prose.ts";
import { buildCardIndex } from "../src/server/card-index.ts";
import { llmEnabled } from "../src/server/config.ts";
import { chatJson } from "../src/server/llm.ts";
import { loadDeck } from "../src/server/pipeline.ts";
import { listDecks, readReport, writeResults } from "../src/server/storage.ts";
import { refSettler } from "../src/server/chat.ts";
import { readChat, updateChat } from "../src/server/chat-history.ts";
import type { DeckChatMessage } from "../src/shared/types.ts";

const { values } = parseArgs({ options: { only: { type: "string" } } });
if (!llmEnabled()) {
  console.error("Marking card references needs an LLM: set LLM_API_KEY (see README).");
  process.exit(1);
}
const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
const BATCH = 25;
const Marked = z.object({ texts: z.array(z.object({ id: z.number(), text: z.string() })) });

/** Marked versions of the texts the model got exactly right, keyed by the original. */
async function markTexts(texts: string[], commanders: string[]): Promise<Map<string, string>> {
  const marked = new Map<string, string>();
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await chatJson(Marked, [
      {
        role: "user",
        content: `These texts come from a report on a Commander deck led by ${commanders.join(" + ")}. Return each one exactly as it is, character for character, except that every Magic card it names is wrapped as [[Card Name]]. ${CARD_REFS_RULE}

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
  return marked;
}

const unmarked = (t: string) => Boolean(t) && !refsIn(t).length;

for (const { slug } of await listDecks()) {
  if (only && !only.has(slug)) continue;
  const report = await readReport(slug);
  if (!report) continue;
  const texts: string[] = [];
  mapProse(report, (t) => {
    if (unmarked(t)) texts.push(t);
    return t;
  });
  const marked = await markTexts(texts, report.commanders);
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

  // The doc's chat messages, settled like a new reply would be.
  const chat = await readChat(slug);
  const doc = chat.filter((m) => m.role === "assistant");
  const chatTexts = doc
    .flatMap((m) => [m.content, ...(m.changes ?? []).map((c) => c.reason)])
    .filter(unmarked);
  if (!chatTexts.length) continue;
  const chatMarked = await markTexts([...new Set(chatTexts)], report.commanders);
  const settled = new Map<string, DeckChatMessage>();
  for (const m of doc) {
    const mark = (t: string) => chatMarked.get(t) ?? t;
    const changes = m.changes?.map((c) => ({ ...c, reason: mark(c.reason) }));
    const settle = await (
      await refSettler(saved, deck, changes ?? [])
    )([mark(m.content), ...(changes ?? []).map((c) => c.reason)]);
    settled.set(m.id, {
      ...m,
      content: settle(mark(m.content)),
      ...(changes && { changes: changes.map((c) => ({ ...c, reason: settle(c.reason) })) }),
    });
  }
  await updateChat(slug, (ms) => ms.map((m) => settled.get(m.id) ?? m));
  console.log(
    `${slug} chat: marked ${chatMarked.size} of ${new Set(chatTexts).size} texts in ${doc.length} messages`,
  );
}
