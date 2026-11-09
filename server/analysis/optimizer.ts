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
import type { ScoredCard } from "./candidates.ts";
import { type Deck, cloneDeck } from "./deck.ts";
import { BASIC_FOR, analyzeMana, landColors } from "./mana.ts";

const CATEGORIES = [
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
  scored: ScoredCard[];
  candidates: ScoredCard[];
  combosPresent: Combo[];
  oneAway: Combo[];
  mana: ManaReport;
  roles: RoleCount[];
  research: Research | null;
  edhrecThemes: string[];
  options: OptimizeOptions;
}

const fmtCard = (s: ScoredCard) =>
  [
    s.offIdentity ? `${s.card.name} [OFF-COLOR/ILLEGAL: must cut]` : s.card.name,
    `mv${s.card.cmc}`,
    s.card.typeLine.split(" — ")[0],
    s.card.roles.join("/"),
    s.inclusion !== null ? `incl ${Math.round(s.inclusion * 100)}%` : "not on EDHREC",
    s.synergy !== null ? `syn ${s.synergy >= 0 ? "+" : ""}${Math.round(s.synergy * 100)}%` : "",
    s.comboPiece ? "COMBO" : "",
    s.card.priceUsd !== null ? `$${s.card.priceUsd}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

function landDeltaText(mana: ManaReport) {
  const delta = Math.round(mana.recommendedLands - (mana.landCount + mana.mdfcLands * 0.5));
  if (delta === 0) return "Keep the land count the same (land-for-land swaps only).";
  return delta > 0
    ? `Include exactly ${delta} swap(s) with a NONLAND out and a LAND in (net +${delta} lands).`
    : `Include exactly ${-delta} swap(s) with a LAND out and a NONLAND in (net ${delta} lands).`;
}

export async function planWithLlm(input: PlanInput): Promise<Plan> {
  const { deck, options } = input;
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
  const candLines = input.candidates.map((s) => `- ${fmtCard(s)} | via ${s.source.join(", ")}`);
  const prompt = `You are an expert Commander (EDH) deckbuilder. Optimize this deck while keeping its identity and plan.

## Commander
${commander}

## Constraints
- Propose at most ${options.maxSwaps} one-for-one swaps (fewer is fine if the deck is already tight). Deck must stay at exactly 100 cards.
- "out" must be a card currently in the deck. Never cut: ${[...deck.commanders.map((c) => c.name), ...options.locked].join(", ") || "(nothing locked)"}.
- Prefer "in" cards from the candidate list (validated: legal, in color identity${options.budgetPerCard ? `, ≤ $${options.budgetPerCard}` : ""}). You may suggest other real cards if clearly better; they'll be validated.
- No duplicates except basic lands. To change basic counts, use the basic land name as "out" or "in".
${options.bracket ? `- Target power bracket ${options.bracket} (1 exhibition … 5 cEDH). Don't add Game Changers, mass land denial, or early 2-card infinite combos if that would exceed it.` : "- Keep roughly the same power level; don't turn a casual deck into cEDH."}
- Land count: ${input.mana.landCount} lands${input.mana.mdfcLands ? ` + ${input.mana.mdfcLands} MDFCs` : ""} now, ~${input.mana.recommendedLands} recommended. ${landDeltaText(input.mana)}
- Cut lands that enter tapped unconditionally or produce only colorless when better fixing exists. Count MDFCs as half a land.
- Address role gaps: ${
    input.roles
      .filter((r) => r.target !== null && r.count < r.target)
      .map((r) => `${r.role} ${r.count}/${r.target}`)
      .join(", ") || "none"
  }.
- Prioritize: cutting low-synergy / low-inclusion / clunky cards, completing strong combos only if it suits the deck, and keeping the curve lean.

## Mana analysis
${JSON.stringify({ lands: input.mana.landCount, mdfc: input.mana.mdfcLands, recommended: input.mana.recommendedLands, avgCmc: input.mana.avgCmc, curve: input.mana.curve, colors: input.mana.colors, tapped: input.mana.tappedLands, colorless: input.mana.colorlessLands, basics: input.mana.basics, issues: input.mana.issues })}

## Current deck (sorted weakest first by data score)
${deckLines.join("\n")}

## Combos already in the deck
${input.combosPresent.map((c) => `- ${c.cards.join(" + ")} → ${c.produces.join(", ")}`).join("\n") || "none"}

## Combos one card away
${
  input.oneAway
    .slice(0, 15)
    .map((c) => `- add ${c.missing[0]}: ${c.cards.join(" + ")} → ${c.produces.join(", ")}`)
    .join("\n") || "none"
}

## Popular themes on EDHREC
${input.edhrecThemes.join(", ") || "n/a"}

## Web research
${input.research?.summary.slice(0, 5000) ?? "n/a"}

## Candidate additions (best first)
${candLines.join("\n")}

Reply with JSON only:
{"strategy": "2-4 sentence summary of the deck's game plan and what these changes improve", "themes": string[], "swaps": [{"out": string, "in": string, "category": "synergy|combo|mana|ramp|draw|interaction|curve|other", "reason": "one or two sentences, specific to this commander"}], "manaNotes": ["concise mana base observations/recommendations"]}`;
  return chatJson(PlanSchema, [{ role: "user", content: prompt }]);
}

/** Data-only plan used when no LLM is configured or the LLM call fails. */
export function planHeuristic(input: PlanInput): Plan {
  const locked = new Set([...input.options.locked, ...input.deck.commanders.map((c) => c.name)]);
  const cuts = input.scored
    .filter((s) => (s.offIdentity || !s.card.isLand) && !locked.has(s.card.name) && !s.comboPiece)
    .sort((a, b) => a.score - b.score);
  const adds = input.candidates.filter((s) => !s.card.isLand);
  const swaps: Plan["swaps"] = [];
  const used = new Set<string>();
  for (const cut of cuts) {
    if (swaps.length >= input.options.maxSwaps) break;
    const add = (cut.card.isLand ? input.candidates : adds).find(
      (a) =>
        !used.has(a.card.name) && a.score > cut.score + 0.15 && (!cut.card.isLand || a.card.isLand),
    );
    if (!add) break;
    used.add(add.card.name);
    const shared = add.card.roles.find((r) => cut.card.roles.includes(r) && r !== "other");
    swaps.push({
      out: cut.card.name,
      in: add.card.name,
      category: add.comboPiece ? "combo" : "synergy",
      reason: `${add.card.name} sees play in ${add.inclusion !== null ? Math.round(add.inclusion * 100) + "%" : "many"} of decks for this commander vs ${cut.inclusion !== null ? Math.round(cut.inclusion * 100) + "%" : "almost none"} for ${cut.card.name}${shared ? `; both fill the ${shared} role` : ""}.`,
    });
  }
  return {
    strategy: "Data-driven swaps based on EDHREC inclusion and synergy (no LLM configured).",
    themes: input.edhrecThemes.slice(0, 3),
    swaps,
    manaNotes: [],
  };
}

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
      const cut = cuttable
        .filter((s) => !s.card.isLand)
        .sort(
          (a, b) => (scoreOf.get(a.card.name)?.score ?? 0) - (scoreOf.get(b.card.name)?.score ?? 0),
        )[0];
      const needy = [...mana.colors].sort(
        (a, b) => b.targetSources - b.landSources - (a.targetSources - a.landSources),
      )[0];
      const land =
        candidates.find(
          (c) =>
            c.card.isLand &&
            !inDeck.has(c.card.name) &&
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
      const spell = candidates.find((c) => !c.card.isLand && !inDeck.has(c.card.name))?.card;
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
