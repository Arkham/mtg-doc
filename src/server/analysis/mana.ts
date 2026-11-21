import type { Card, Color, ColorStat, ManaReport } from "../../shared/types.ts";
import { COLORS } from "../../shared/types.ts";
import { isBasicLand } from "../sources/scryfall.ts";
import { type Deck, identityOf } from "./deck.ts";
import { isCheapAccel } from "./roles.ts";

const BASIC_TYPE: Record<string, Color> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
};
export const BASIC_FOR: Record<Color, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};

/** Pip weight per color for a mana cost; hybrid and phyrexian symbols count half. */
export function pipsOf(manaCost: string): Record<Color, number> {
  const pips: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const [, sym] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const parts = sym.split("/");
    const colors = parts.filter((p): p is Color => (COLORS as string[]).includes(p));
    if (!colors.length) continue;
    const weight = parts.length === 1 ? 1 : 0.5;
    for (const c of colors) pips[c] += weight;
  }
  return pips;
}

/** Colors a land can effectively produce, including fetch lands that find basics or typed lands. */
export function landColors(card: Card, identity: Color[]): Color[] {
  const direct = card.producedMana.filter((m): m is Color => identity.includes(m as Color));
  if (direct.length) return direct;
  const text = card.oracleText.toLowerCase();
  if (!/search your library for/.test(text)) return [];
  if (
    /basic land card|land card with a basic land type/.test(text) &&
    !/(plains|island|swamp|mountain|forest) (card|or)/.test(text)
  ) {
    return identity;
  }
  const found = new Set<Color>();
  for (const [type, color] of Object.entries(BASIC_TYPE)) {
    if (new RegExp(`\\b${type}\\b`).test(text) && identity.includes(color)) found.add(color);
  }
  return [...found];
}

export function recommendedLandCount(avgCmc: number, cheapAccel: number, edhrecAvg: number | null) {
  // Frank Karsten's regression for 99-card decks.
  const karsten = 31.42 + 3.13 * avgCmc - 0.28 * cheapAccel;
  const blended = edhrecAvg ? (karsten + edhrecAvg) / 2 : karsten;
  return Math.max(30, Math.min(42, Math.round(blended)));
}

export function analyzeMana(deck: Deck, edhrecAvgLands: number | null): ManaReport {
  const identity = identityOf(deck.commanders);
  const nonland = deck.slots.filter((s) => !s.card.isLand);
  const lands = deck.slots.filter((s) => s.card.isLand);
  const landCount = lands.reduce((n, s) => n + s.qty, 0);
  const mdfcLands = nonland.filter((s) => s.card.isMdfcLand).reduce((n, s) => n + s.qty, 0);

  const spellCount = nonland.reduce((n, s) => n + s.qty, 0);
  const avgCmc = spellCount ? nonland.reduce((n, s) => n + s.card.cmc * s.qty, 0) / spellCount : 0;
  const curve: Record<string, number> = {};
  for (const s of nonland) {
    const k = s.card.cmc >= 7 ? "7+" : String(Math.floor(s.card.cmc));
    curve[k] = (curve[k] ?? 0) + s.qty;
  }

  const pipTotals: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const maxPips: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const heaviest: Partial<Record<Color, { name: string; manaCost: string; pips: number }>> = {};
  const spells = [
    ...nonland.map((s) => ({ card: s.card, qty: s.qty, cmdr: false })),
    ...deck.commanders.map((card) => ({ card, qty: 1, cmdr: true })),
  ];
  for (const { card, qty, cmdr } of spells) {
    const pips = pipsOf(card.manaCost);
    for (const c of COLORS) {
      // Commander pips are weighted up because it is cast every game.
      pipTotals[c] += pips[c] * qty * (cmdr ? 4 : 1);
      maxPips[c] = Math.max(maxPips[c], pips[c] + (cmdr ? 1 : 0));
      if (pips[c] > 0 && pips[c] > (heaviest[c]?.pips ?? 0)) {
        heaviest[c] = { name: card.name, manaCost: card.manaCost, pips: pips[c] };
      }
    }
  }
  const pipSum = COLORS.reduce((n, c) => n + pipTotals[c], 0) || 1;
  const cheapAccel = nonland.filter((s) => isCheapAccel(s.card)).reduce((n, s) => n + s.qty, 0);
  const recommendedLands = recommendedLandCount(avgCmc, cheapAccel, edhrecAvgLands);

  const colors: ColorStat[] = identity.map((color) => {
    const landSources = lands
      .filter((s) => landColors(s.card, identity).includes(color))
      .reduce((n, s) => n + s.qty, 0);
    const rampSources = nonland
      .filter((s) => s.card.roles.includes("ramp") && s.card.producedMana.includes(color))
      .reduce((n, s) => n + s.qty, 0);
    const pipShare = pipTotals[color] / pipSum;
    const intensity =
      maxPips[color] >= 3 ? 21 : maxPips[color] >= 2 ? 17 : maxPips[color] > 0 ? 12 : 0;
    const base =
      identity.length === 1
        ? recommendedLands
        : Math.round(recommendedLands * (0.25 + 0.6 * pipShare));
    const shareTarget = pipTotals[color] > 0 ? base : 0;
    const h = heaviest[color];
    return {
      color,
      pips: Math.round(pipTotals[color] * 10) / 10,
      pipShare: Math.round(pipShare * 1000) / 1000,
      landSources,
      rampSources,
      targetSources: Math.min(recommendedLands, Math.max(intensity, shareTarget)),
      targetReason: intensity > shareTarget ? "heaviest-card" : "share",
      ...(h ? { heaviestCard: { name: h.name, manaCost: h.manaCost } } : {}),
    };
  });

  const tappedLands = lands.filter((s) => s.card.entersTapped).map((s) => s.card.name);
  const colorlessLands =
    identity.length >= 2
      ? lands.filter((s) => landColors(s.card, identity).length === 0).map((s) => s.card.name)
      : [];
  const basics: Record<string, number> = {};
  for (const s of lands) if (isBasicLand(s.card.name)) basics[s.card.name] = s.qty;
  const rampCount = nonland
    .filter((s) => s.card.roles.includes("ramp"))
    .reduce((n, s) => n + s.qty, 0);

  const issues: string[] = [];
  const effectiveLands = landCount + mdfcLands * 0.5;
  if (effectiveLands < recommendedLands - 1)
    issues.push(
      `Only ${landCount} lands${mdfcLands ? ` (+${mdfcLands} MDFC)` : ""}; about ${recommendedLands} recommended for an average mana value of ${avgCmc.toFixed(2)}.`,
    );
  if (effectiveLands > recommendedLands + 2)
    issues.push(
      `${landCount} lands is more than the ~${recommendedLands} this curve needs; consider trading a land for a spell.`,
    );
  const colorWord = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } as const;
  for (const c of colors) {
    if (c.landSources < c.targetSources - 1)
      issues.push(
        `${colorWord[c.color]}: ${c.landSources} lands make it, about ${c.targetSources} wanted.`,
      );
  }
  if (tappedLands.length > 4)
    issues.push(`${tappedLands.length} lands enter tapped unconditionally; aim for 4 or fewer.`);
  if (colorlessLands.length > Math.max(1, 4 - identity.length))
    issues.push(
      `${colorlessLands.length} colorless-only lands strain a ${identity.length}-color mana base.`,
    );
  if (rampCount < 8) issues.push(`Only ${rampCount} ramp pieces; 10 or so is typical.`);

  return {
    landCount,
    mdfcLands,
    recommendedLands,
    avgCmc: Math.round(avgCmc * 100) / 100,
    curve,
    colors,
    tappedLands,
    colorlessLands,
    basics,
    rampCount,
    issues,
  };
}
