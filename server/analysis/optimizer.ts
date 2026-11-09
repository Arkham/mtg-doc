import { z } from "zod";
import type {
  Card,
  Color,
  Combo,
  ManaReport,
  OptimizeOptions,
  Research,
  RoleCount,
  Swap,
} from "../../shared/types.ts";
import { chatJson } from "../llm.ts";
import { isBasicLand, lookupExact, lookupFuzzy } from "../sources/scryfall.ts";
import type { BracketRules } from "./bracket.ts";
import type { ScoredCard } from "./candidates.ts";
import { type Deck, cloneDeck, countRoles, totalPrice } from "./deck.ts";
import { BASIC_FOR, analyzeMana, landColors } from "./mana.ts";
import type { ProposedSwap, SolverCard, SolverResult } from "./search.ts";

const CATEGORIES = [
  "bracket",
  "synergy",
  "combo",
  "mana",
  "ramp",
  "draw",
  "interaction",
  "curve",
  "other",
] as const;

const PlanSchema = z.object({
  strategy: z.string(),
  themes: z.array(z.string()).default([]),
  swaps: z.array(
    z.object({
      out: z.string(),
      in: z.string(),
      category: z
        .string()
        .transform(
          (c) => ((CATEGORIES as readonly string[]).includes(c) ? c : "other") as Swap["category"],
        ),
      reason: z.string(),
    }),
  ),
  manaNotes: z.array(z.string()).default([]),
});

export type Plan = z.infer<typeof PlanSchema>;

export interface PlanInput {
  deck: Deck;
  identity: Color[];
  scored: SolverCard[];
  candidates: SolverCard[];
  solver: SolverResult;
  target: number;
  rules: BracketRules;
  combosPresent: Combo[];
  oneAway: Combo[];
  mana: ManaReport;
  roles: RoleCount[];
  research: Research | null;
  edhrecThemes: string[];
  options: OptimizeOptions;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

const fmtCard = (s: ScoredCard & { flags?: SolverCard["flags"] }) =>
  [
    s.offIdentity ? `${s.card.name} [OFF-COLOR/ILLEGAL: must cut]` : s.card.name,
    `mv${s.card.cmc}`,
    s.card.typeLine.split(" — ")[0],
    s.card.roles.join("/"),
    s.inclusion !== null ? `incl ${pct(s.inclusion)}` : "not on EDHREC",
    s.synergy !== null ? `syn ${s.synergy >= 0 ? "+" : ""}${Math.round(s.synergy * 100)}%` : "",
    `score ${s.score.toFixed(2)}`,
    s.flags?.gameChanger ? "GAME CHANGER" : "",
    s.flags?.massLandDenial ? "MASS LAND DENIAL" : "",
    s.flags?.extraTurn ? "EXTRA TURN" : "",
    s.comboPiece ? "COMBO" : "",
    s.card.priceUsd !== null ? `$${s.card.priceUsd}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

const fmtProposal = (p: ProposedSwap, i: number) =>
  `${i + 1}. OUT ${p.out.name} ($${p.out.priceUsd ?? "?"}) → IN ${p.in.name} ($${p.in.priceUsd ?? "?"}) (gain ${p.gain.toFixed(2)}${p.forced ? `, REQUIRED: ${p.forced}` : ""})${
    p.alternatives.length ? `; alternatives: ${p.alternatives.map((a) => a.name).join(", ")}` : ""
  }`;

const TONE_TEXT = {
  max: "Push power as high as the bracket allows: best-in-slot staples, efficient interaction, tutors and fast mana where legal, and use every Game Changer slot that improves the deck.",
  balanced:
    "Improve consistency and synergy, but don't chase every staple; keep the deck's personality.",
  casual:
    "Keep it friendly: favour synergy and fun over raw power, avoid tutors, stax and salty cards, and leave Game Changer slots empty unless thematic.",
};

export async function planWithLlm(input: PlanInput): Promise<Plan> {
  const { deck, options, rules, target } = input;
  const commander = deck.commanders
    .map((c) => `${c.name} (${c.manaCost}) — ${c.typeLine}\n${c.oracleText}`)
    .join("\n\n");
  const qty = new Map(deck.slots.map((s) => [s.card.name, s.qty]));
  const deckLines = [...input.scored]
    .sort((a, b) => a.score - b.score)
    .map((s) => {
      const n = qty.get(s.card.name) ?? 1;
      return `- ${s.card.isLand ? "[land] " : ""}${fmtCard(s)}${n > 1 ? ` x${n}` : ""}`;
    });
  const candLines = input.candidates
    .slice(0, 70)
    .map((s) => `- ${fmtCard(s)} | via ${s.source.join(", ")}`);
  const gcLimit = rules.gameChangers === Infinity ? "unlimited" : String(rules.gameChangers);
  const prompt = `You are an expert Commander (EDH) deckbuilder. A constraint solver has proposed swaps for this deck. Review them like a strong player would, then produce the final list with explanations.

## Commander
${commander}

## Target: Bracket ${target} (${rules.name}), tone "${options.tone ?? "max"}"
${TONE_TEXT[options.tone ?? "max"]}
Hard bracket rules (the final deck MUST satisfy them; every swap is re-validated):
- Game Changers: ${gcLimit}
- Mass land denial: ${rules.massLandDenial ? "allowed" : "NOT allowed"}
- Extra-turn cards: ${rules.extraTurnCards === Infinity ? "allowed" : `at most ${rules.extraTurnCards}, never chained`}
- Two-card infinite combos: ${rules.twoCardCombos === "any" ? "allowed" : rules.twoCardCombos === "late" ? "only ones that don't come together before turn 6" : "NOT allowed"}
- Players should expect at least ${rules.minTurns} turns before anyone wins or loses.

## Solver proposals (ordered; gain = data-driven improvement)
${input.solver.swaps.map(fmtProposal).join("\n") || "none"}

Swaps marked REQUIRED fix bracket or legality violations: keep them (you may pick one of their alternatives instead).
For the rest: keep, drop, or replace the "in" with one of its alternatives or another card from the candidate list. Drop swaps that are anti-synergistic, nonbos, or off-plan. You may add swaps from the candidate list, up to ${options.maxSwaps} total.

## Game Changer slots
${(() => {
  const flagged = new Map(input.candidates.map((c) => [c.card.name, c.flags.gameChanger]));
  for (const c of input.scored) flagged.set(c.card.name, c.flags.gameChanger);
  const after = new Set(input.scored.filter((c) => c.flags.gameChanger).map((c) => c.card.name));
  for (const p of input.solver.swaps) {
    after.delete(p.out.name);
    if (flagged.get(p.in.name)) after.add(p.in.name);
  }
  const limit = rules.gameChangers === Infinity ? "unlimited" : rules.gameChangers;
  return `After the proposals: ${after.size}/${limit} (${[...after].join(", ") || "none"}). To add a different Game Changer when slots are full, cut one of these in the same swap.`;
})()}

## Cards excluded to stay in the bracket (do not add these)
${input.solver.excluded.map((e) => `- ${e.name}: ${e.reason}`).join("\n") || "none"}

## Other constraints
- "out" must be in the deck. Never cut: ${[...deck.commanders.map((c) => c.name), ...options.locked].join(", ") || "(nothing locked)"}.
- No duplicates except basic lands.${options.budgetPerCard ? ` Max $${options.budgetPerCard} per card.` : ""}
${options.budgetTotal ? `- DECK BUDGET: the whole deck (commander included) must cost at most $${options.budgetTotal}. It costs $${totalPrice(deck)} now; the proposals bring it to $${(totalPrice(deck) + input.solver.swaps.reduce((n, p) => n + (p.in.priceUsd ?? 0) - (p.out.priceUsd ?? 0), 0)).toFixed(2)}. Prefer value per dollar; swaps that push it over are rejected.` : ""}
- Land count: ${input.mana.landCount} lands now, ~${input.mana.recommendedLands} recommended. Lands are fixed automatically afterwards, so focus on spells unless a land swap is clearly better.

## Mana analysis
${JSON.stringify({ avgCmc: input.mana.avgCmc, curve: input.mana.curve, colors: input.mana.colors, tapped: input.mana.tappedLands, issues: input.mana.issues })}

## Roles (count/typical)
${input.roles
  .filter((r) => r.target !== null)
  .map((r) => `${r.role} ${r.count}/${r.target}`)
  .join(", ")}

## Current deck (weakest first)
${deckLines.join("\n")}

## Combos in the deck
${input.combosPresent.map((c) => `- ${c.cards.join(" + ")} → ${c.produces.join(", ")}`).join("\n") || "none"}

## Popular themes on EDHREC
${input.edhrecThemes.join(", ") || "n/a"}

## Web research
${input.research?.summary.slice(0, 4000) ?? "n/a"}

## Candidate additions (validated for legality, identity and budget; best first)
${candLines.join("\n")}

Reply with JSON only:
{"strategy": "2-4 sentences: the game plan, what these changes improve, and where the deck sits in bracket ${target}", "themes": string[], "swaps": [{"out": string, "in": string, "category": "bracket|synergy|combo|mana|ramp|draw|interaction|curve|other", "reason": "one or two sentences, specific to this commander"}], "manaNotes": ["concise mana base observations"]}`;
  return chatJson(PlanSchema, [{ role: "user", content: prompt }]);
}

/** Solver output as a plan, used when no LLM is configured or the LLM call fails. */
export function planHeuristic(input: PlanInput): Plan {
  return {
    strategy: `Data-driven swaps for bracket ${input.target} (${input.rules.name}) based on EDHREC inclusion and synergy (no LLM configured).`,
    themes: input.edhrecThemes.slice(0, 3),
    swaps: input.solver.swaps.map((p) => ({
      out: p.out.name,
      in: p.in.name,
      category: p.forced
        ? "bracket"
        : p.in.roles.includes("ramp")
          ? "ramp"
          : p.in.roles.includes("draw")
            ? "draw"
            : p.in.roles.some((r) => r === "removal" || r === "counter" || r === "wipe")
              ? "interaction"
              : "synergy",
      reason: p.forced
        ? `${p.out.name} is ${p.forced}; ${p.in.name} is the best legal replacement.`
        : `${p.in.name} scores ${p.gain.toFixed(2)} higher for this commander at bracket ${input.target}.`,
    })),
    manaNotes: [],
  };
}

/** Returns why a card can't be added (bracket rules etc.), or null. */
export type Violation = (card: Card, deck: Deck, out?: Card) => string | null;

export interface ApplyResult {
  deck: Deck;
  swaps: Swap[];
  warnings: string[];
}

export async function applyPlan(
  deck: Deck,
  plan: Plan,
  identity: Color[],
  candidates: ScoredCard[],
  options: OptimizeOptions,
  violation: Violation = () => null,
  alternatives: Map<string, Card[]> = new Map(),
): Promise<ApplyResult> {
  const next = cloneDeck(deck);
  const warnings: string[] = [];
  const swaps: Swap[] = [];
  const locked = new Set([...options.locked, ...deck.commanders.map((c) => c.name)]);
  const known = new Map<string, Card>(candidates.map((c) => [c.card.name, c.card]));
  for (const s of deck.slots) known.set(s.card.name, s.card);
  const missing = plan.swaps.map((s) => s.in).filter((n) => !known.has(n));
  if (missing.length) for (const [n, c] of await lookupExact(missing)) known.set(n, c);

  for (const s of plan.swaps.slice(0, options.maxSwaps)) {
    const outSlot = next.slots.find((x) => x.card.name.toLowerCase() === s.out.toLowerCase());
    if (!outSlot) {
      warnings.push(`Skipped swap: "${s.out}" is not in the deck.`);
      continue;
    }
    if (locked.has(outSlot.card.name)) {
      warnings.push(`Skipped swap: "${outSlot.card.name}" is locked.`);
      continue;
    }
    let inCard = known.get(s.in) ?? null;
    if (!inCard) inCard = await lookupFuzzy(s.in);
    if (!inCard) {
      warnings.push(`Skipped swap: couldn't find a card named "${s.in}".`);
      continue;
    }
    if (!inCard.legalCommander || !inCard.colorIdentity.every((c) => identity.includes(c))) {
      warnings.push(`Skipped swap: ${inCard.name} is not legal in this deck.`);
      continue;
    }
    const existing = next.slots.find((x) => x.card.name === inCard!.name);
    if (existing && !isBasicLand(inCard.name)) {
      warnings.push(`Skipped swap: ${inCard.name} is already in the deck.`);
      continue;
    }
    if (options.budgetPerCard !== null && (inCard.priceUsd ?? 0) > options.budgetPerCard) {
      warnings.push(`Skipped swap: ${inCard.name} ($${inCard.priceUsd}) is over budget.`);
      continue;
    }
    const why = violation(inCard, next, outSlot.card);
    if (why) {
      warnings.push(`Skipped swap: ${inCard.name} (${why}).`);
      continue;
    }
    outSlot.qty--;
    if (outSlot.qty === 0) next.slots.splice(next.slots.indexOf(outSlot), 1);
    if (existing) existing.qty++;
    else next.slots.push({ card: inCard, qty: 1 });
    swaps.push({
      out: outSlot.card.name,
      in: inCard.name,
      category: s.category,
      reason: s.reason,
      outCard: outSlot.card,
      inCard,
      alternatives: (alternatives.get(outSlot.card.name) ?? [])
        .filter((a) => a.name !== inCard!.name)
        .slice(0, 3)
        .map((a) => ({ name: a.name, image: a.image, scryfallUri: a.scryfallUri })),
    });
  }
  return { deck: next, swaps, warnings };
}

/** Moves basics between colors until land sources track pip demand; returns the extra swaps. */
export async function rebalanceBasics(
  deck: Deck,
  identity: Color[],
  edhrecAvgLands: number | null,
  locked: Set<string>,
): Promise<{ deck: Deck; swaps: Swap[] }> {
  if (identity.length < 2) return { deck, swaps: [] };
  const next = cloneDeck(deck);
  const swaps: Swap[] = [];
  const basicCards = await lookupExact(identity.map((c) => BASIC_FOR[c]));
  for (let iter = 0; iter < 8; iter++) {
    const mana = analyzeMana(next, edhrecAvgLands);
    const deficit = (c: Color) => {
      const s = mana.colors.find((x) => x.color === c)!;
      return s.targetSources > 0 ? (s.targetSources - s.landSources) / s.targetSources : -1;
    };
    const donors = identity
      .map((c) => ({ c, slot: next.slots.find((s) => s.card.name === BASIC_FOR[c]) }))
      .filter((d) => d.slot && d.slot.qty > 0 && !locked.has(d.slot.card.name));
    const needy = [...identity].sort((a, b) => deficit(b) - deficit(a))[0];
    const donor = donors
      .filter((d) => d.c !== needy)
      .sort((a, b) => deficit(a.c) - deficit(b.c))[0];
    if (!donor || !needy) break;
    const needyStat = mana.colors.find((x) => x.color === needy)!;
    const donorStat = mana.colors.find((x) => x.color === donor.c)!;
    // Only move when the needy color is clearly short and the donor stays at/above its own target.
    if (
      needyStat.landSources >= needyStat.targetSources ||
      donorStat.landSources - 1 < donorStat.targetSources ||
      deficit(needy) - deficit(donor.c) < 0.1
    )
      break;
    const inCard = basicCards.get(BASIC_FOR[needy]);
    if (!inCard) break;
    donor.slot!.qty--;
    if (donor.slot!.qty === 0) next.slots.splice(next.slots.indexOf(donor.slot!), 1);
    const target = next.slots.find((s) => s.card.name === inCard.name);
    if (target) target.qty++;
    else next.slots.push({ card: inCard, qty: 1 });
    swaps.push({
      out: donor.slot!.card.name,
      in: inCard.name,
      category: "mana",
      reason: `${needy} is short on sources (${needyStat.landSources}/${needyStat.targetSources}) while ${donor.c} has ${donorStat.landSources}/${donorStat.targetSources}.`,
      outCard: donor.slot!.card,
      inCard,
    });
  }
  return { deck: next, swaps };
}

function moveCard(deck: Deck, out: Card, inCard: Card) {
  const slot = deck.slots.find((s) => s.card.name === out.name)!;
  slot.qty--;
  if (slot.qty === 0) deck.slots.splice(deck.slots.indexOf(slot), 1);
  const existing = deck.slots.find((s) => s.card.name === inCard.name);
  if (existing) existing.qty++;
  else deck.slots.push({ card: inCard, qty: 1 });
}

/** Enforces the recommended land count after the plan, since LLM plans don't always balance it. */
export async function fixLandCount(
  deck: Deck,
  identity: Color[],
  scored: ScoredCard[],
  candidates: ScoredCard[],
  edhrecAvgLands: number | null,
  locked: Set<string>,
  justAdded: Set<string>,
  budget: number,
  violation: Violation = () => null,
): Promise<{ deck: Deck; swaps: Swap[] }> {
  const next = cloneDeck(deck);
  const swaps: Swap[] = [];
  const scoreOf = new Map(scored.map((s) => [s.card.name, s]));
  const basics = await lookupExact(identity.map((c) => BASIC_FOR[c]));
  for (let i = 0; i < Math.min(4, budget); i++) {
    const mana = analyzeMana(next, edhrecAvgLands);
    const effective = mana.landCount + mana.mdfcLands * 0.5;
    const diff = mana.recommendedLands - effective;
    const inDeck = new Set(next.slots.map((s) => s.card.name));
    const cuttable = next.slots.filter(
      (s) =>
        !locked.has(s.card.name) &&
        !justAdded.has(s.card.name) &&
        !scoreOf.get(s.card.name)?.comboPiece,
    );
    if (diff >= 1) {
      // Don't cut into roles that are already short (e.g. the last pieces of removal).
      const roles = countRoles(next, true);
      const short = new Set(
        roles.filter((r) => r.target !== null && r.count <= r.target).map((r) => r.role),
      );
      const cutCost = (c: Card) =>
        (scoreOf.get(c.name)?.score ?? 0) + (c.roles.some((r) => short.has(r)) ? 0.35 : 0);
      const cut = cuttable
        .filter((s) => !s.card.isLand)
        .sort((a, b) => cutCost(a.card) - cutCost(b.card))[0];
      const needy = [...mana.colors].sort(
        (a, b) => b.targetSources - b.landSources - (a.targetSources - a.landSources),
      )[0];
      const land =
        candidates.find(
          (c) =>
            c.card.isLand &&
            !inDeck.has(c.card.name) &&
            !violation(c.card, next, cut?.card) &&
            !c.card.entersTapped &&
            landColors(c.card, identity).length >= Math.min(2, identity.length),
        )?.card ?? (needy ? basics.get(BASIC_FOR[needy.color]) : undefined);
      if (!cut || !land) break;
      moveCard(next, cut.card, land);
      justAdded.add(land.name);
      swaps.push({
        out: cut.card.name,
        in: land.name,
        category: "mana",
        reason: `Brings the land count from ${mana.landCount} toward the recommended ${mana.recommendedLands} (avg mana value ${mana.avgCmc}); ${cut.card.name} was the lowest-scoring spell.`,
        outCard: cut.card,
        inCard: land,
      });
    } else if (diff <= -2.5) {
      const surplus = (c: Card) =>
        Math.min(
          ...landColors(c, identity).map((col) => {
            const s = mana.colors.find((x) => x.color === col);
            return s ? s.landSources - s.targetSources : 0;
          }),
        );
      const cut = cuttable
        .filter((s) => s.card.isLand)
        .sort(
          (a, b) =>
            Number(b.card.entersTapped) - Number(a.card.entersTapped) ||
            landColors(a.card, identity).length - landColors(b.card, identity).length ||
            surplus(b.card) - surplus(a.card),
        )[0];
      const spell = candidates.find(
        (c) => !c.card.isLand && !inDeck.has(c.card.name) && !violation(c.card, next, cut?.card),
      )?.card;
      if (!cut || !spell) break;
      moveCard(next, cut.card, spell);
      justAdded.add(spell.name);
      swaps.push({
        out: cut.card.name,
        in: spell.name,
        category: "mana",
        reason: `${mana.landCount} lands is more than the ~${mana.recommendedLands} this curve needs; ${spell.name} is the best-rated addition.`,
        outCard: cut.card,
        inCard: spell,
      });
    } else break;
  }
  return { deck: next, swaps };
}

/** Collapses chains like A→Swamp, Swamp→Forest into A→Forest. */
export function mergeSwaps(swaps: Swap[]): Swap[] {
  const out: Swap[] = [];
  for (const s of swaps) {
    const prev = isBasicLand(s.out) ? out.find((p) => p.in === s.out) : undefined;
    if (prev) {
      prev.in = s.in;
      prev.inCard = s.inCard;
      prev.reason = `${prev.reason} Swapped to ${s.in} for color balance.`;
      if (prev.out === prev.in) out.splice(out.indexOf(prev), 1);
    } else out.push(s);
  }
  return out;
}
