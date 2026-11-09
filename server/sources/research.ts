import { z } from "zod";
import type { Research } from "../../shared/types.ts";
import { config } from "../config.ts";
import { chatJson, chatWithCitations } from "../llm.ts";

/** Web research via a search-capable model; returns null when no search model is configured. */
export async function researchCommander(commanders: string[]): Promise<Research | null> {
  if (!config.llm.searchModel) return null;
  const who = commanders.join(" + ");
  const { text, citations } = await chatWithCitations(
    [
      {
        role: "user",
        content: `Search the web (EDHREC, Commander Spellbook, MTGGoldfish, Moxfield, Command Zone, Card Kingdom blog, etc.) for current Commander/EDH deckbuilding advice for ${who}.
Report concisely:
1. The main strategies/archetypes people build around this commander.
2. Key synergy cards and engines (name specific cards).
3. Popular combos (exact card names and what they produce).
4. Common mistakes or cards that underperform in this deck.
5. Mana base advice specific to this commander.
Use exact Magic card names.`,
      },
    ],
    config.llm.searchModel,
  );
  const extracted = await chatJson(z.object({ cards: z.array(z.string()) }), [
    {
      role: "user",
      content: `List every Magic: The Gathering card name mentioned in this text, excluding ${who}. Reply as JSON {"cards": string[]}.\n\n${text}`,
    },
  ]).catch(() => ({ cards: [] as string[] }));
  return { summary: text, cardsMentioned: extracted.cards, sources: citations };
}
