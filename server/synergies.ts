import { z } from "zod";
import type { Combo, Synergy } from "../shared/types.ts";
import type { Deck } from "./analysis/deck.ts";
import { matchInDeck } from "./analysis/edits.ts";
import { chatJson, decide } from "./llm.ts";

const SynergySchema = z.object({
  synergies: z
    .array(
      z.object({
        title: z.string().min(1),
        cards: z.array(z.string()).min(2).max(4),
        explanation: z.string().min(1),
      }),
    )
    .catch([]),
});

const MAX_SYNERGIES = 10;

const keyOf = (cards: string[]) => [...cards].sort().join("|");

/**
 * Asks the model for the deck's best non-infinite interactions, then keeps only those whose cards
 * are really in the deck (names normalized to the deck's spelling). With `known`, it looks for
 * new ones instead and skips any card group already listed; with `focus`, only ones involving
 * those cards (e.g. cards just added).
 */
export async function findSynergies(
  deck: Deck,
  combos: Combo[],
  known: Synergy[] = [],
  focus: string[] = [],
): Promise<Synergy[]> {
  const commander = deck.commanders
    .map((c) => `${c.name} (${c.manaCost}) — ${c.typeLine}\n${c.oracleText}`)
    .join("\n\n");
  const list = deck.slots
    .filter((s) => !s.card.isLand || s.card.oracleText.length > 40)
    .map(
      (s) =>
        `- ${s.card.name} | ${s.card.typeLine} | ${s.card.oracleText.replace(/\n/g, " ").slice(0, 220)}`,
    )
    .join("\n");
  const comboList = combos.map((c) => c.cards.join(" + ")).join("; ") || "none";
  const ask = focus.length
    ? `These cards were just added to this Commander deck: ${focus.join(", ")}. Find up to 4 notable synergies that each involve at least one of them: interactions between 2-4 cards in the list (the commander counts) that are stronger together than apart.${known.length ? ` Skip these, already listed:\n${known.map((s) => `- ${s.title}: ${s.cards.join(" + ")}`).join("\n")}` : ""}`
    : known.length
      ? `Find 4-8 more notable synergies in this Commander deck, different from the ones already found:\n${known.map((s) => `- ${s.title}: ${s.cards.join(" + ")}`).join("\n")}\nLook for other interactions between 2-4 cards in the list (the commander counts) that are stronger together than apart, such as engines, payoffs, protection packages or value loops.`
      : "Find the 6-10 most notable synergies in this Commander deck: interactions between 2-4 cards in the list (the commander counts) that are stronger together than apart, such as engines, payoffs, protection packages or value loops.";
  const res = await chatJson(SynergySchema, [
    {
      role: "user",
      content: `${ask}
Exclude infinite combos (already covered: ${comboList}). Prefer interactions involving the commander and the deck's main plan. Use exact card names from the list.

Commander:
${commander}

Deck:
${list}

Reply with JSON only: {"synergies": [{"title": "short punchy title", "cards": ["Card A", "Card B"], "explanation": "1-2 sentences on how they work together in this deck"}]}`,
    },
  ]);
  const out: Synergy[] = [];
  const seen = new Set(known.map((k) => keyOf(k.cards)));
  for (const s of res.synergies) {
    const cards: string[] = [];
    for (const name of s.cards) {
      const resolved =
        deck.commanders.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name ??
        matchInDeck(name, deck)?.name;
      if (!resolved) break;
      if (!cards.includes(resolved)) cards.push(resolved);
    }
    if (cards.length !== s.cards.length || cards.length < 2) continue;
    if (focus.length && !cards.some((c) => focus.includes(c))) continue;
    const key = keyOf(cards);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: s.title, cards, explanation: s.explanation });
    if (out.length >= MAX_SYNERGIES) break;
  }
  return verifySynergies(deck, out);
}

/** Below this, a second opinion thinks the interaction isn't real or doesn't work as described. */
const SYNERGY_THRESHOLD = 0.5;

/**
 * Don't trust a single model read: a second, independent check confirms each interaction from the
 * cards' rules text. If the check itself fails, the synergies are kept as found.
 */
async function verifySynergies(deck: Deck, synergies: Synergy[]): Promise<Synergy[]> {
  if (!synergies.length) return synergies;
  const cards = new Map(
    [...deck.commanders, ...deck.slots.map((s) => s.card)].map((c) => [c.name, c]),
  );
  const named = [...new Set(synergies.flatMap((s) => s.cards))];
  const context = `Cards in a Commander deck (commander: ${deck.commanders.map((c) => c.name).join(" + ")}), with their rules text:\n${named
    .map((n) => `- ${n}: ${cards.get(n)?.oracleText.replace(/\n/g, " ") ?? ""}`)
    .join("\n")}`;
  const answers = await decide(
    context,
    [],
    synergies.map((s, i) => ({
      name: `synergy-${i}`,
      instructions: `${s.cards.join(" + ")} work together as described, going by their rules text, and are stronger together than apart: “${s.title}: ${s.explanation}”`,
    })),
  ).catch(() => null);
  if (!answers) return synergies;
  return synergies.filter((_, i) => (answers.get(`synergy-${i}`) ?? 1) >= SYNERGY_THRESHOLD);
}

/** Synergies that still apply after cards were removed from the deck. */
export function keepPresentSynergies(
  synergies: Synergy[] | undefined,
  deck: Deck,
): Synergy[] | undefined {
  if (!synergies) return synergies;
  const names = new Set([...deck.commanders, ...deck.slots.map((s) => s.card)].map((c) => c.name));
  return synergies.filter((s) => s.cards.every((n) => names.has(n)));
}
