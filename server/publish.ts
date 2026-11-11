/** What the static site publishes for a deck whose owner hid the doc's suggestions. */
import type { DeckSummary, Report } from "../shared/types.ts";
import { referencedNames } from "./card-index.ts";

/**
 * The report as it applies to the deck as submitted, with nothing the doc suggested: no swaps,
 * suggested list, strategy write-up, chat edits, mana or Game Changer suggestions, and no previews
 * of cards only the suggestions mention.
 */
export function withoutSuggestions(r: Report): Report {
  const o = r.original;
  const names = new Set(o?.decklist.map((c) => c.name));
  const stripped: Report = {
    ...r,
    // The optimizer's strategy describes its changes ("these swaps replace…").
    strategy: "",
    after: r.before,
    swaps: [],
    edits: [],
    manaSuggestions: [],
    warnings: [],
    decklist: o?.decklist,
    combosPresent: o?.combosPresent ?? [],
    combosOneAway: o?.combosOneAway ?? [],
    synergies: r.synergies?.filter((s) => s.cards.every((n) => names.has(n))),
    bracket: r.bracket && {
      ...r.bracket,
      after: r.bracket.before,
      excluded: [],
      gameChangerOptions: [],
    },
    suggestionsHidden: true,
  };
  const kept = new Set(referencedNames(stripped));
  stripped.cardIndex = Object.fromEntries(
    Object.entries(r.cardIndex ?? {}).filter(([name]) => kept.has(name)),
  );
  return stripped;
}

export function withoutSuggestionCounts(d: DeckSummary): DeckSummary {
  const { swapCount: _, targetBracket: __, ...rest } = d;
  return rest;
}
