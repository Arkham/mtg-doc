/**
 * Pins and fills in the fixture decks for the visual suite, so its screenshots show every section
 * and stay the same from one day (and one run) to the next.
 */
import { parseDecklist } from "../../server/decklist.ts";
import { readDeckFile, readReport, writeResults } from "../../server/storage.ts";
import type { PlayGuide, Report } from "../../shared/types.ts";

/** Dates on screen ("Updated …") come from the report. */
export const PINNED_AT = "2026-01-15T12:00:00.000Z";

export const guide = (summary: string): PlayGuide => ({
  summary,
  early: ["Play [[Llanowar Elves]] on turn one.", "Cast Lathril on turn three."],
  mid: ["Attack with Lathril to make Elf Warriors."],
  late: ["Tap ten elves to drain the table."],
  winConditions: ["Lathril's drain, once you have ten elves."],
  keyCards: [{ name: "Lathril, Blade of the Elves", why: "Makes the army and finishes the game." }],
  mulligan: "Keep three lands and a mana elf.",
  watchOut: ["Board wipes reset your tokens."],
});

/** Copy an LLM would have written, naming only cards the deck runs. */
function extras(r: Report): Partial<Report> {
  const names = new Set((r.decklist ?? []).map((c) => c.name));
  const pick = (...want: string[]) => want.filter((n) => names.has(n));
  const elves = pick("Llanowar Elves", "Elvish Mystic", "Fyndhorn Elves", "Elvish Archdruid");
  return {
    strategy:
      "Go wide with mana elves, then turn the army into damage. The swaps trade slow cards for [[Llanowar Elves]]-style mana and keep the deck in its bracket.",
    themes: ["Elves", "Go wide", "Drain"],
    synergies: [
      {
        title: "Elves fuel the army",
        cards: ["Lathril, Blade of the Elves", ...elves.slice(0, 2)],
        explanation:
          "Mana elves cast Lathril early, and every Elf Warrior token is another body for her drain.",
      },
    ],
    research: {
      summary: [
        "## How people build Lathril",
        "",
        "Most lists lean on **mana elves** and token makers, then finish with *Lathril's drain*.",
        "",
        "- Ramp early with [[Llanowar Elves]]",
        "- Protect the board from wipes",
        "",
        "| Plan | Cards |",
        "|---|---|",
        "| Ramp | **Elves**, [a guide](https://example.test/guide) |",
        "| Finish | Lathril |",
      ].join("\n"),
      cardsMentioned: ["Llanowar Elves"],
      sources: [
        { title: "Lathril deck tech", url: "https://www.example.test/lathril" },
        { title: "Elves in Commander", url: "https://guides.example.test/elves" },
      ],
    },
  };
}

/** Rewrites a saved report with the pinned date, guides and the copy above. */
export async function pinReport(slug: string, { rich = false }: { rich?: boolean } = {}) {
  const report = (await readReport(slug))!;
  const updated: Report = {
    ...report,
    generatedAt: PINNED_AT,
    ...(rich
      ? {
          ...extras(report),
          howToPlay: {
            original: guide("Your elves: go wide, then drain the table with Lathril."),
            optimized: guide("The suggested elves: faster mana, the same drain finish."),
          },
        }
      : {}),
  };
  return writeResults(slug, updated, parseDecklist(await readDeckFile(slug, "optimized.txt")));
}
