import { z } from "zod";
import type { Report } from "../shared/types.ts";
import {
  type ReportText,
  type TextFix,
  applyTextFixes,
  knownCards,
  plausibleFix,
  reportFacts,
  reportTexts,
} from "./analysis/contradictions.ts";
import { chatJson, decide } from "./llm.ts";

const IssueSchema = z.object({
  issues: z
    .array(
      z.object({
        id: z.string(),
        quote: z.string(),
        problem: z.string(),
        fixed: z.string().nullable(),
      }),
    )
    .catch([]),
});

/** Texts per read. */
const CHUNK = 10;

/** Below this, a second opinion doesn't think the contradiction is real or the fix resolves it. */
const THRESHOLD = 0.5;

/**
 * Finds what the report's model-written texts (strategy, swap reasons, synergies)
 * say that its facts contradict, and rewrites them. Don't trust a single model read: an
 * independent check confirms each contradiction and its fix before it's applied.
 */
export async function checkContradictions(
  report: Report,
): Promise<{ report: Report; fixes: TextFix[] }> {
  const texts = reportTexts(report);
  if (!texts.length) return { report, fixes: [] };
  const facts = reportFacts(report);
  const prompt = (
    chunk: ReportText[],
  ) => `You check a Commander deck report for contradictions. The FACTS were computed by deterministic code and are correct. The TEXTS were written by a language model and may be wrong.

Find every text that states something the facts contradict, for example:
- a card that stays, remains or is kept when a swap cuts it, or one that is cut when it stays
- a card said to be in a deck when that deck's list doesn't have it
- a combo, Game Changer, land count, bracket, price or budget the facts don't show
- something said of the deck as submitted that only holds for the suggested deck, or the reverse

Ignore opinions, advice and anything the facts can neither confirm nor refute. Report only clear contradictions.

Also report, separately, every text that talks about how it was written instead of about the deck, such as "Keep the proposal.", "Change the proposed cut from X to Y" or "Replace the proposed land swap with…". The reader never saw any proposals or drafts, so for each such text the fix removes or rewords that part. Check every text for this, even if many share it.

For each, give the text's id, the quote, the problem in one sentence, and "fixed": the whole text rewritten with the smallest change that removes the contradiction, keeping everything else word for word and reading naturally. Remove or correct the false claim; never bring in a card the text didn't already name. For a synergy that can't be true at all, set "fixed" to null.

FACTS
${facts}

TEXTS
${chunk.map((t) => `[${t.id}] (${t.kind}) ${t.text}`).join("\n")}

Reply with JSON only: {"issues": [{"id": "swap-3", "quote": "...", "problem": "...", "fixed": "..."}]}. Reply {"issues": []} if there are none.`;
  // A model skims long lists, so it reads a few texts at a time, twice: two independent reads
  // find more than one, and the check below confirms whatever either finds.
  const chunks = Array.from({ length: Math.ceil(texts.length / CHUNK) }, (_, i) =>
    texts.slice(i * CHUNK, (i + 1) * CHUNK),
  );
  const reads = await Promise.all(
    chunks.flatMap((chunk) =>
      [0, 1].map(() => chatJson(IssueSchema, [{ role: "user", content: prompt(chunk) }])),
    ),
  );
  const byId = new Map(texts.map((t) => [t.id, t]));
  const cards = knownCards(report);
  // One fix per text: the first plausible one either read gives.
  const candidates: TextFix[] = [];
  for (const issue of reads.flatMap((r) => r.issues)) {
    const t = byId.get(issue.id);
    if (!t || candidates.some((c) => c.id === issue.id)) continue;
    if (plausibleFix(t.text, issue.fixed, issue.id, cards)) candidates.push(issue);
  }
  if (!candidates.length) return { report, fixes: [] };

  const answers = await decide(
    `Facts about a Commander deck, computed by deterministic code and correct:\n${facts}`,
    [],
    // Asked both ways, since the reader's label can be wrong ("than the proposed X" is a
    // leftover, not a contradiction). Plainly put, too: to the owner every swap is a proposal,
    // so "refers to a proposal" alone reads as fine.
    candidates.flatMap((c, i) => {
      const t = byId.get(c.id)!;
      return [
        {
          name: `contradiction-${i}`,
          instructions: `This text (${t.kind}) contradicts the facts: “${t.text}” The contradiction: ${c.problem}`,
        },
        {
          name: `leftover-${i}`,
          instructions: `This text (${t.kind}) contains words addressed to its writer or reviewer instead of the deck's owner, such as an instruction to keep, change or replace a proposal, or a comparison with a proposal the owner never saw: “${t.text}”`,
        },
        {
          name: `fixed-${i}`,
          instructions:
            c.fixed === null
              ? `This synergy can't be true given the facts, so it should be dropped: ${t.kind}: “${t.text}”`
              : `Rewriting “${t.text}” as “${c.fixed}” removes this problem and keeps the rest of what it says: ${c.problem}`,
        },
      ];
    }),
  ).catch(() => new Map<string, number>());
  const fixes = candidates.filter(
    (_, i) =>
      Math.max(answers.get(`contradiction-${i}`) ?? 0, answers.get(`leftover-${i}`) ?? 0) >=
        THRESHOLD && (answers.get(`fixed-${i}`) ?? 0) >= THRESHOLD,
  );
  return { report: fixes.length ? applyTextFixes(report, fixes) : report, fixes };
}
