import type { Combo } from "../../shared/types.ts";
import { config } from "../config.ts";

interface SpellbookVariant {
  id: string;
  uses: { card: { name: string } }[];
  produces: { feature: { name: string } }[];
  description?: string;
  bracketTag?: string;
  popularity?: number;
  legalities?: Record<string, boolean>;
  identity?: string;
}

interface FindMyCombos {
  results: {
    included: SpellbookVariant[];
    almostIncluded: SpellbookVariant[];
  };
}

function toCombo(v: SpellbookVariant, deck: Set<string>): Combo {
  const cards = v.uses.map((u) => u.card.name);
  return {
    id: v.id,
    cards,
    missing: cards.filter((c) => !deck.has(c)),
    produces: v.produces.map((p) => p.feature.name),
    description: v.description ?? "",
    bracketTag: v.bracketTag ?? null,
    url: `https://commanderspellbook.com/combo/${v.id}/`,
  };
}

export async function findCombos(
  commanders: string[],
  main: string[],
  identity: string[],
): Promise<{ present: Combo[]; oneAway: (Combo & { popularity: number })[] }> {
  const res = await fetch("https://backend.commanderspellbook.com/find-my-combos", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": config.userAgent },
    body: JSON.stringify({
      commanders: commanders.map((card) => ({ card })),
      main: main.map((card) => ({ card })),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Commander Spellbook failed: ${res.status}`);
  const data = (await res.json()) as FindMyCombos;
  const deck = new Set([...commanders, ...main]);
  const legal = (v: SpellbookVariant) =>
    v.legalities?.commander !== false &&
    [...(v.identity ?? "")].every((c) => c === "C" || identity.includes(c));
  return {
    present: data.results.included.filter(legal).map((v) => toCombo(v, deck)),
    oneAway: data.results.almostIncluded
      .filter(legal)
      .map((v) => ({ ...toCombo(v, deck), popularity: v.popularity ?? 0 }))
      .filter((c) => c.missing.length === 1)
      .sort((a, b) => b.popularity - a.popularity),
  };
}
