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

export interface CardFlags {
  gameChanger: boolean;
  massLandDenial: boolean;
  extraTurn: boolean;
  banned: boolean;
}

export interface ClassifiedCombo {
  id: string;
  cards: string[];
  produces: string[];
  definitelyTwoCard: boolean;
  arguablyTwoCard: boolean;
  relevant: boolean;
  lock: boolean;
  extraTurn: boolean;
  massLandDenial: boolean;
  tag: string | null;
  url: string;
}

export interface BracketEstimate {
  tag: string;
  cards: Map<string, CardFlags>;
  combos: ClassifiedCombo[];
}

interface EstimateResponse {
  bracketTag: string;
  cards: (CardFlags & { card: { name: string } })[];
  combos: {
    combo: SpellbookVariant;
    relevant: boolean;
    definitelyTwoCard: boolean;
    arguablyTwoCard: boolean;
    lock: boolean;
    extraTurn: boolean;
    massLandDenial: boolean;
  }[];
}

/** Commander Spellbook's bracket classifier: per-card flags and per-combo severity. */
export async function estimateBracket(
  commanders: string[],
  main: string[],
): Promise<BracketEstimate> {
  const res = await fetch("https://backend.commanderspellbook.com/estimate-bracket", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": config.userAgent },
    body: JSON.stringify({
      commanders: commanders.map((card) => ({ card })),
      main: main.map((card) => ({ card })),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Commander Spellbook bracket estimate failed: ${res.status}`);
  const data = (await res.json()) as EstimateResponse;
  const cards = new Map<string, CardFlags>();
  for (const c of data.cards) {
    const flags = {
      gameChanger: c.gameChanger,
      massLandDenial: c.massLandDenial,
      extraTurn: c.extraTurn,
      banned: c.banned,
    };
    cards.set(c.card.name, flags);
    cards.set(c.card.name.split(" // ")[0], flags);
  }
  return {
    tag: data.bracketTag,
    cards,
    combos: data.combos.map((v) => ({
      id: v.combo.id,
      cards: v.combo.uses.map((u) => u.card.name),
      produces: v.combo.produces.map((p) => p.feature.name),
      definitelyTwoCard: v.definitelyTwoCard,
      arguablyTwoCard: v.arguablyTwoCard,
      relevant: v.relevant,
      lock: v.lock,
      extraTurn: v.extraTurn,
      massLandDenial: v.massLandDenial,
      tag: v.combo.bracketTag ?? null,
      url: `https://commanderspellbook.com/combo/${v.combo.id}/`,
    })),
  };
}
