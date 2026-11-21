import { z } from "zod";
import type { BracketReport, Combo, PlayGuide, Report, Synergy } from "../shared/types.ts";
import { BRACKETS } from "./analysis/bracket.ts";
import type { Deck } from "./analysis/deck.ts";
import { matchInDeck } from "./analysis/edits.ts";
import { fitGuide } from "./analysis/play-guide.ts";
import { CARD_REFS_RULE, CardNameSchema } from "./analysis/prose.ts";
import { chatJson } from "./llm.ts";

const GuideSchema = z.object({
  summary: z.string().min(1),
  early: z.array(z.string()).catch([]),
  mid: z.array(z.string()).catch([]),
  late: z.array(z.string()).catch([]),
  winConditions: z.array(z.string()).catch([]),
  keyCards: z.array(z.object({ name: CardNameSchema, why: z.string() })).catch([]),
  mulligan: z.string().catch(""),
  watchOut: z.array(z.string()).catch([]),
});

/** Writes an easy-to-read guide to playing this exact list. */
async function writePlayGuide(
  deck: Deck,
  context: {
    combos: Combo[];
    synergies: Synergy[];
    bracket?: Pick<BracketReport, "minTurns"> & { bracket: number; name: string };
    lands: number;
  },
): Promise<PlayGuide> {
  const commander = deck.commanders
    .map((c) => `${c.name} (${c.manaCost}) — ${c.typeLine}\n${c.oracleText}`)
    .join("\n\n");
  const list = deck.slots
    .filter((s) => !s.card.isLand || s.card.oracleText.length > 40)
    .map(
      (s) =>
        `- ${s.card.name} | ${s.card.typeLine} | ${s.card.oracleText.replace(/\n/g, " ").slice(0, 160)}`,
    )
    .join("\n");
  const res = await chatJson(GuideSchema, [
    {
      role: "user",
      content: `Write a short, friendly guide to playing this Commander deck, for a player picking it up for the first time. Keep every bullet to one plain sentence of at most 15 words, name real cards from the list, and skip anything generic that would be true of any deck. ${CARD_REFS_RULE} In "keyCards", "name" is the plain card name.

Commander:
${commander}

${context.bracket ? `Bracket ${context.bracket.bracket} (${context.bracket.name}): games should last at least ${context.bracket.minTurns} turns.\n` : ""}${context.lands} lands.
Combos in the deck: ${context.combos.map((c) => `${c.cards.join(" + ")} (${c.produces.slice(0, 2).join(", ")})`).join("; ") || "none"}
Synergies: ${context.synergies.map((s) => `${s.title}: ${s.cards.join(" + ")}`).join("; ") || "none listed"}

Deck:
${list}

Reply with JSON only:
{"summary": "one or two sentences: what the deck does and how it wins",
 "early": ["2-3 bullets for turns 1-3"], "mid": ["2-3 bullets for the middle turns"], "late": ["2-3 bullets for closing the game"],
 "winConditions": ["1-3 bullets: the ways this list actually wins"],
 "keyCards": [{"name": "exact card name from the list", "why": "what it does for the plan, under 12 words"}],
 "mulligan": "one sentence: what a keepable opening hand looks like",
 "watchOut": ["1-3 bullets: what to be careful about, or what opponents will try"]}`,
    },
  ]);
  const names = new Map(
    [...deck.commanders, ...deck.slots.map((s) => s.card)].map((c) => [
      c.name.toLowerCase(),
      c.name,
    ]),
  );
  return fitGuide(
    res,
    (name) => names.get(name.toLowerCase()) ?? matchInDeck(name, deck)?.name ?? null,
  );
}

/**
 * Guides for the deck as submitted and the suggested one, from what the report knows about each.
 * Only `which` are written; the others are kept as they were. A guide that fails stays out.
 */
export async function writeGuides(
  report: Report,
  decks: { original: Deck; optimized: Deck },
  which: ("original" | "optimized")[] = ["original", "optimized"],
): Promise<Report["howToPlay"]> {
  const inDeck = (d: Deck) => {
    const names = new Set([...d.commanders, ...d.slots.map((s) => s.card)].map((c) => c.name));
    return (cards: string[]) => cards.every((n) => names.has(n));
  };
  const b = report.bracket;
  const write = (key: "original" | "optimized") => {
    const deck = decks[key];
    const has = inDeck(deck);
    const assessed = key === "original" ? b?.before : b?.after;
    return writePlayGuide(deck, {
      combos: key === "original" ? (report.original?.combosPresent ?? []) : report.combosPresent,
      synergies: (report.synergies ?? []).filter((s) => has(s.cards)),
      bracket: b &&
        assessed && {
          bracket: assessed.bracket,
          name: BRACKETS[assessed.bracket].name,
          minTurns: BRACKETS[assessed.bracket].minTurns,
        },
      lands: (key === "original" ? report.before : report.after).mana.landCount,
    }).catch(() => undefined);
  };
  const out = { ...report.howToPlay };
  const written = await Promise.all(which.map(async (k) => [k, await write(k)] as const));
  for (const [k, guide] of written) {
    if (guide) out[k] = guide;
    else delete out[k];
  }
  return out.original || out.optimized ? out : undefined;
}

/** Without a model to rewrite them, guides keep only the key cards their decks still run. */
export function keepGuidesTo(
  guides: Report["howToPlay"],
  decks: { original: Deck; optimized: Deck },
): Report["howToPlay"] {
  if (!guides) return guides;
  const fit = (key: "original" | "optimized") => {
    const guide = guides[key];
    if (!guide) return undefined;
    const names = new Set(
      [...decks[key].commanders, ...decks[key].slots.map((s) => s.card)].map((c) => c.name),
    );
    return fitGuide(guide, (n) => (names.has(n) ? n : null));
  };
  const out = { original: fit("original"), optimized: fit("optimized") };
  return out.original || out.optimized ? out : undefined;
}
