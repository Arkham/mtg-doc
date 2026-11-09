import type {
  BracketAssessment,
  BracketCheck,
  BracketCombo,
  Card,
  SimResult,
} from "../../shared/types.ts";
import type { BracketEstimate, CardFlags, ClassifiedCombo } from "../sources/spellbook.ts";
import type { Deck } from "./deck.ts";

/**
 * Official Commander Brackets (beta, Oct 2025 / Feb 2026 updates).
 * minTurns: turns players should expect before anyone wins or loses.
 */
export interface BracketRules {
  name: string;
  gameChangers: number;
  massLandDenial: boolean;
  /** Max extra-turn cards; chaining is what's disallowed below bracket 4. */
  extraTurnCards: number;
  twoCardCombos: "none" | "late" | "any";
  minTurns: number;
}

export const BRACKETS: Record<number, BracketRules> = {
  1: {
    name: "Exhibition",
    gameChangers: 0,
    massLandDenial: false,
    extraTurnCards: 0,
    twoCardCombos: "none",
    minTurns: 9,
  },
  2: {
    name: "Core",
    gameChangers: 0,
    massLandDenial: false,
    extraTurnCards: 1,
    twoCardCombos: "none",
    minTurns: 8,
  },
  3: {
    name: "Upgraded",
    gameChangers: 3,
    massLandDenial: false,
    extraTurnCards: 1,
    twoCardCombos: "late",
    minTurns: 6,
  },
  4: {
    name: "Optimized",
    gameChangers: Infinity,
    massLandDenial: true,
    extraTurnCards: Infinity,
    twoCardCombos: "any",
    minTurns: 4,
  },
  5: {
    name: "cEDH",
    gameChangers: Infinity,
    massLandDenial: true,
    extraTurnCards: Infinity,
    twoCardCombos: "any",
    minTurns: 1,
  },
};

/** A two-card combo counts as "early" when assembled this often before the bracket's minimum game length. */
export const EARLY_COMBO_PCT = 15;

const SPELLBOOK_TAG_BRACKET: Record<string, number> = { E: 1, C: 2, O: 2, P: 3, S: 3, R: 4, B: 4 };

export const isTwoCard = (c: ClassifiedCombo) =>
  c.relevant && (c.definitelyTwoCard || c.arguablyTwoCard);

export function flagsFor(card: Card, est: BracketEstimate | null): CardFlags {
  const f = est?.cards.get(card.name) ?? est?.cards.get(card.name.split(" // ")[0]);
  return {
    gameChanger: card.gameChanger || Boolean(f?.gameChanger),
    massLandDenial: Boolean(f?.massLandDenial),
    extraTurn: Boolean(f?.extraTurn),
    banned: Boolean(f?.banned),
  };
}

function earlyPct(combo: ClassifiedCombo, sim: SimResult | null, minTurns: number): number | null {
  const s = sim?.combos?.find((c) => c.cards.join("|") === combo.cards.join("|"));
  if (!s) return null;
  const turn = Math.min(8, Math.max(1, minTurns - 1));
  return s.byTurn[turn] ?? null;
}

/** Whether a combo breaks a bracket's combo rule. */
export function comboViolates(
  combo: ClassifiedCombo,
  bracket: number,
  early: number | null,
): boolean {
  const rule = BRACKETS[bracket].twoCardCombos;
  if (rule === "any" || !isTwoCard(combo)) return combo.lock && bracket <= 3;
  if (rule === "none") return true;
  // Bracket 3 allows late-game two-card combos; Spellbook "Ruthless" ones are bracket-4 material.
  return combo.tag === "R" || (early ?? 0) > EARLY_COMBO_PCT || combo.extraTurn || combo.lock;
}

/** Heuristic 0-100 power score from the signals bracket checkers commonly use. */
function powerScore(deck: Deck, gcCount: number, twoCardCombos: number, sim: SimResult | null) {
  const cards = deck.slots.flatMap((s) => Array(s.qty).fill(s.card) as Card[]);
  const nonland = cards.filter((c) => !c.isLand);
  const avgCmc = nonland.reduce((n, c) => n + c.cmc, 0) / Math.max(1, nonland.length);
  const fastMana = nonland.filter((c) => c.roles.includes("ramp") && c.cmc <= 1).length;
  const tutors = nonland.filter((c) => c.roles.includes("tutor")).length;
  const interaction = nonland.filter((c) =>
    c.roles.some((r) => r === "removal" || r === "counter" || r === "wipe"),
  ).length;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const score =
    22 * clamp(gcCount / 6) +
    16 * clamp(twoCardCombos / 2) +
    12 * clamp(fastMana / 6) +
    12 * clamp(tutors / 6) +
    12 * clamp(interaction / 14) +
    14 * clamp((4.2 - avgCmc) / 1.8) +
    12 * clamp(((sim?.commanderOnCurve ?? 50) - 40) / 55);
  return Math.round(score);
}

/** Typical power ranges per bracket, used to place a deck low/mid/high within its bracket. */
const POWER_RANGE: Record<number, [number, number]> = {
  1: [0, 25],
  2: [10, 40],
  3: [30, 65],
  4: [55, 90],
  5: [75, 100],
};

export function assessBracket(
  deck: Deck,
  est: BracketEstimate | null,
  sim: SimResult | null,
  target: number | null,
): BracketAssessment {
  const all = [...deck.commanders, ...deck.slots.map((s) => s.card)];
  const flags = all.map((c) => ({ card: c, f: flagsFor(c, est) }));
  const gameChangers = flags.filter((x) => x.f.gameChanger).map((x) => x.card.name);
  const massLandDenial = flags.filter((x) => x.f.massLandDenial).map((x) => x.card.name);
  const extraTurns = flags.filter((x) => x.f.extraTurn).map((x) => x.card.name);
  const relevantCombos = (est?.combos ?? []).filter((c) => c.relevant);

  const fits = (b: number) => {
    const r = BRACKETS[b];
    return (
      gameChangers.length <= r.gameChangers &&
      (r.massLandDenial || massLandDenial.length === 0) &&
      extraTurns.length <= r.extraTurnCards &&
      relevantCombos.every((c) => !comboViolates(c, b, earlyPct(c, sim, r.minTurns)))
    );
  };
  let bracket = [1, 2, 3, 4].find(fits) ?? 4;
  if (est?.tag) bracket = Math.max(bracket, Math.min(SPELLBOOK_TAG_BRACKET[est.tag] ?? 1, 4));
  // Brackets 1 and 2 share rules; 1 is about theme/intent, so never infer it automatically.
  if (bracket === 1) bracket = 2;

  const ref = target ?? bracket;
  const rules = BRACKETS[ref];
  const combos: BracketCombo[] = relevantCombos.map((c) => ({
    cards: c.cards,
    produces: c.produces,
    twoCard: isTwoCard(c),
    tag: c.tag,
    earlyPct: earlyPct(c, sim, rules.minTurns),
    url: c.url,
  }));
  const violating = relevantCombos.filter((c) =>
    comboViolates(c, ref, earlyPct(c, sim, rules.minTurns)),
  );

  const checks: BracketCheck[] = [
    {
      label: "Game Changers",
      ok: gameChangers.length <= rules.gameChangers,
      detail:
        rules.gameChangers === Infinity
          ? `${gameChangers.length} (no limit)`
          : `${gameChangers.length} of ${rules.gameChangers} allowed`,
    },
    {
      label: "Mass land denial",
      ok: rules.massLandDenial || massLandDenial.length === 0,
      detail: massLandDenial.length ? massLandDenial.join(", ") : "none",
    },
    {
      label: "Extra turns",
      ok: extraTurns.length <= rules.extraTurnCards,
      detail: extraTurns.length ? extraTurns.join(", ") : "none",
    },
    {
      label: "Two-card combos",
      ok: violating.length === 0,
      detail: violating.length
        ? violating.map((c) => c.cards.join(" + ")).join("; ")
        : rules.twoCardCombos === "late"
          ? "only late-game ones"
          : rules.twoCardCombos === "none"
            ? "none"
            : "allowed",
    },
  ];

  const power = powerScore(deck, gameChangers.length, combos.filter((c) => c.twoCard).length, sim);
  const [lo, hi] = POWER_RANGE[ref];
  const rel = (power - lo) / (hi - lo);
  return {
    bracket,
    spellbookTag: est?.tag ?? null,
    gameChangers,
    massLandDenial,
    extraTurns,
    combos,
    power,
    position: rel < 0.34 ? "low" : rel < 0.67 ? "mid" : "high",
    checks,
  };
}
