import type {
  Card,
  Color,
  Combo,
  OptimizeOptions,
  Role,
  RoleCount,
  Tone,
} from "../../shared/types.ts";
import { type EdhrecData, edhrecKey } from "../sources/edhrec.ts";
import { isBasicLand, lookupExact, searchCards } from "../sources/scryfall.ts";
import type { CardFlags } from "../sources/spellbook.ts";
import { BRACKETS, type BracketRules } from "./bracket.ts";
import type { ScoredCard } from "./candidates.ts";
import { type Deck, countRoles, totalPrice } from "./deck.ts";

export interface SolverCard extends ScoredCard {
  flags: CardFlags;
}

export interface ProposedSwap {
  out: Card;
  in: Card;
  gain: number;
  forced: string | null;
  alternatives: Card[];
}

export interface SolverResult {
  swaps: ProposedSwap[];
  excluded: { name: string; reason: string }[];
  gameChangerOptions: { name: string; score: number; inDeck: boolean }[];
}

export interface SolverContext {
  deck: Deck;
  identity: Color[];
  target: number;
  rules: BracketRules;
  tone: Tone;
  scored: SolverCard[];
  candidates: SolverCard[];
  /** Reason a card can't be added to `deck` (after removing `out`), or null if it's fine. */
  violation: (card: Card, deck: Deck, out?: Card) => string | null;
  budgetTotal: number | null;
}

const ROLE_WEIGHT = 0.12;
/** Gain cost of spending the whole budget on one swap; keeps upgrades value-for-money. */
const PRICE_WEIGHT = 0.5;

export const priceOf = (c: Card) => c.priceUsd ?? 0;
const MIN_GAIN = 0.04;

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

function cardValue(
  card: Card,
  flags: CardFlags,
  edh: { bracket: EdhrecData | null; all: EdhrecData | null },
  tone: Tone,
  rules: BracketRules,
  comboBonus: number,
) {
  const key = edhrecKey(card.name);
  const eb = edh.bracket?.cards.get(key);
  const ea = edh.all?.cards.get(key);
  const inclusion = eb?.inclusion ?? (ea ? ea.inclusion * 0.8 : 0);
  const synergy = eb?.synergy ?? ea?.synergy ?? 0;
  let v = 0.6 * inclusion + 0.4 * clamp(synergy * 2);
  const gcAllowed = rules.gameChangers > 0;
  // Power bonuses only for cards this commander's decks actually play; a random Game Changer isn't an upgrade.
  const played = (eb ?? ea) !== undefined;
  const fastMana = card.roles.includes("ramp") && card.cmc <= 2 && !card.isLand;
  const tutor = card.roles.includes("tutor");
  if (tone === "max" && played) {
    if (flags.gameChanger && gcAllowed) v += 0.22;
    if (tutor) v += 0.08;
    if (fastMana) v += 0.06;
    if (card.roles.includes("removal") || card.roles.includes("counter")) v += 0.04;
  } else if (tone === "balanced" && played) {
    if (flags.gameChanger && gcAllowed) v += 0.08;
  } else if (tone === "casual") {
    if (flags.gameChanger) v -= 0.25;
    if (tutor) v -= 0.1;
    if (flags.massLandDenial || flags.extraTurn) v -= 0.3;
  }
  if (card.cmc >= 6) v -= 0.08 * (card.cmc - 5);
  return {
    value: Math.round((v + comboBonus) * 1000) / 1000,
    inclusion: eb ? eb.inclusion : ea ? ea.inclusion : null,
    synergy: eb ? eb.synergy : ea ? ea.synergy : null,
  };
}

function roleCounts(deck: Deck) {
  const m = new Map<Role, number>();
  for (const r of countRoles(deck, true)) m.set(r.role, r.count);
  return m;
}

function rolePenalty(counts: Map<Role, number>, targets: RoleCount[]) {
  let p = 0;
  for (const t of targets) if (t.target) p += Math.max(0, t.target - (counts.get(t.role) ?? 0));
  return ROLE_WEIGHT * p;
}

function deltaRoles(counts: Map<Role, number>, out: Card, inCard: Card) {
  const next = new Map(counts);
  for (const r of out.roles) next.set(r, (next.get(r) ?? 0) - 1);
  for (const r of inCard.roles) next.set(r, (next.get(r) ?? 0) + 1);
  return next;
}

export async function buildSolverContext(opts: {
  deck: Deck;
  identity: Color[];
  target: number;
  options: OptimizeOptions;
  edhAll: EdhrecData | null;
  edhBracket: EdhrecData | null;
  combosPresent: Combo[];
  oneAway: Combo[];
  researchCards: string[];
  flagsFor: (card: Card) => CardFlags;
  classifyNames: (names: string[]) => Promise<Map<string, CardFlags>>;
}): Promise<SolverContext> {
  const { deck, identity, target, options } = opts;
  const rules = BRACKETS[target];
  const tone = options.tone ?? "max";
  const edh = { bracket: opts.edhBracket, all: opts.edhAll };
  const inDeck = new Set(
    [...deck.commanders, ...deck.slots.map((s) => s.card)].flatMap((c) => [
      c.name,
      c.name.split(" // ")[0],
    ]),
  );
  const presentComboCards = new Set(opts.combosPresent.flatMap((c) => c.cards));
  // Two-card combos are what bracket rules restrict; only reward completing ones the bracket allows.
  const comboAllowed = (c: Combo) => {
    if (c.cards.length > 2 || rules.twoCardCombos === "any") return true;
    if (rules.twoCardCombos === "none") return false;
    return c.bracketTag !== "R";
  };
  const oneAwayBonus = new Map<string, number>();
  const blockedByCombo = new Map<string, string>();
  for (const c of opts.oneAway.slice(0, 40)) {
    const piece = c.missing[0];
    if (comboAllowed(c)) oneAwayBonus.set(piece, Math.max(oneAwayBonus.get(piece) ?? 0, 0.25));
    else if (!blockedByCombo.has(piece))
      blockedByCombo.set(piece, `completes ${c.cards.join(" + ")}`);
  }

  const scored: SolverCard[] = deck.slots.map(({ card }) => {
    const flags = opts.flagsFor(card);
    const v = cardValue(card, flags, edh, tone, rules, presentComboCards.has(card.name) ? 0.4 : 0);
    const offIdentity =
      !card.colorIdentity.every((c) => identity.includes(c)) || !card.legalCommander;
    return {
      card,
      flags,
      score: offIdentity ? v.value - 5 : v.value,
      inclusion: v.inclusion,
      synergy: v.synergy,
      comboPiece: presentComboCards.has(card.name),
      offIdentity,
      source: [],
    };
  });

  const pool = new Map<string, string[]>();
  const add = (name: string, src: string) => {
    if (inDeck.has(name) || isBasicLand(name)) return;
    pool.set(name, [...(pool.get(name) ?? []), src]);
  };
  for (const [label, data] of [
    ["edhrec-bracket", opts.edhBracket],
    ["edhrec", opts.edhAll],
  ] as const) {
    for (const e of data?.cards.values() ?? [])
      if (e.list !== "New Cards") add(e.name, `${label}:${e.list}`);
  }
  for (const c of opts.oneAway.slice(0, 40)) add(c.missing[0], "combo");
  for (const n of opts.researchCards) add(n, "web-research");
  if (rules.gameChangers > 0 && tone !== "casual") {
    const gcs = await searchCards(`is:gamechanger id<=${identity.join("") || "c"} legal:commander`);
    for (const c of gcs) add(c.name, "game-changer");
  }

  const cards = await lookupExact([...pool.keys()].slice(0, 260));
  const resolved = [...cards.values()].filter(
    (c) =>
      !inDeck.has(c.name) &&
      c.legalCommander &&
      c.colorIdentity.every((x) => identity.includes(x)) &&
      (options.budgetPerCard === null || (c.priceUsd ?? 0) <= options.budgetPerCard),
  );
  const unique = [...new Map(resolved.map((c) => [c.name, c])).values()];
  const spellbookFlags = await opts.classifyNames(unique.map((c) => c.name)).catch(() => new Map());
  const candidates: SolverCard[] = unique.map((card) => {
    const sf = spellbookFlags.get(card.name) ?? spellbookFlags.get(card.name.split(" // ")[0]);
    const flags: CardFlags = {
      gameChanger: card.gameChanger || Boolean(sf?.gameChanger),
      massLandDenial: Boolean(sf?.massLandDenial),
      extraTurn: Boolean(sf?.extraTurn),
      banned: Boolean(sf?.banned),
    };
    const v = cardValue(card, flags, edh, tone, rules, oneAwayBonus.get(card.name) ?? 0);
    return {
      card,
      flags,
      score: v.value,
      inclusion: v.inclusion,
      synergy: v.synergy,
      comboPiece: oneAwayBonus.has(card.name),
      offIdentity: false,
      source: [...new Set(pool.get(card.name) ?? [])],
    };
  });
  candidates.sort((a, b) => b.score - a.score);

  const flagByName = new Map<string, CardFlags>();
  for (const s of [...scored, ...candidates]) flagByName.set(s.card.name, s.flags);
  const flagOf = (c: Card) => flagByName.get(c.name) ?? opts.flagsFor(c);

  const violation = makeViolation({
    rules,
    target,
    flagOf,
    budgetTotal: options.budgetTotal ?? null,
    blockedByCombo,
  });

  return {
    deck,
    identity,
    target,
    rules,
    tone,
    scored,
    candidates,
    violation,
    budgetTotal: options.budgetTotal ?? null,
  };
}

/**
 * Swaps expensive cards for cheaper ones until the deck fits the budget, picking the trades that
 * save the most money per point of value lost.
 */
export function trimToBudget(
  ctx: SolverContext,
  deck: Deck,
  locked: Set<string>,
  roleTargets: RoleCount[],
  used: Set<string> = new Set(),
): ProposedSwap[] {
  const budget = ctx.budgetTotal;
  if (budget === null) return [];
  const value = new Map<string, number>();
  for (const s of [...ctx.scored, ...ctx.candidates]) value.set(s.card.name, s.score);
  const swaps: ProposedSwap[] = [];
  const inDeck = () => new Set(deck.slots.map((s) => s.card.name));
  for (let i = 0; i < 40 && totalPrice(deck) > budget; i++) {
    const counts = roleCounts(deck);
    const base = rolePenalty(counts, roleTargets);
    const present = inDeck();
    let best: { out: Card; ranked: { card: Card; ratio: number; gain: number }[] } | null = null;
    for (const { card: out } of deck.slots) {
      if (locked.has(out.name) || isBasicLand(out.name) || priceOf(out) < 1) continue;
      const ranked = ctx.candidates
        .filter((c) => !used.has(c.card.name) && !present.has(c.card.name))
        .filter((c) => c.card.isLand === out.isLand && priceOf(c.card) < priceOf(out))
        .filter((c) => !ctx.violation(c.card, deck, out))
        .map((c) => {
          const gain =
            c.score -
            (value.get(out.name) ?? 0) +
            base -
            rolePenalty(deltaRoles(counts, out, c.card), roleTargets);
          const savings = priceOf(out) - priceOf(c.card);
          return { card: c.card, gain, ratio: savings / (Math.max(0, -gain) + 0.05) };
        })
        .sort((a, b) => b.ratio - a.ratio);
      if (ranked[0] && (!best || ranked[0].ratio > best.ranked[0].ratio)) best = { out, ranked };
    }
    if (!best) break;
    const pick = best.ranked[0];
    const slot = deck.slots.find((s) => s.card.name === best!.out.name)!;
    slot.qty--;
    if (slot.qty === 0) deck.slots.splice(deck.slots.indexOf(slot), 1);
    deck.slots.push({ card: pick.card, qty: 1 });
    used.add(pick.card.name);
    swaps.push({
      out: best.out,
      in: pick.card,
      gain: pick.gain,
      forced: `$${priceOf(best.out).toFixed(2)}, trimmed to fit the $${budget} deck budget`,
      alternatives: best.ranked.slice(1, 4).map((r) => r.card),
    });
  }
  return swaps;
}

/** Builds the hard-constraint check shared by the solver, plan validation and land fixes. */
export function makeViolation(opts: {
  rules: BracketRules;
  target: number;
  flagOf: (card: Card) => CardFlags;
  budgetTotal: number | null;
  blockedByCombo?: Map<string, string>;
}) {
  const { rules, target, flagOf, budgetTotal } = opts;
  const blocked = opts.blockedByCombo ?? new Map<string, string>();
  return (card: Card, d: Deck, out?: Card): string | null => {
    const f = flagOf(card);
    if (f.banned) return "banned in Commander";
    if (blocked.has(card.name))
      return `${blocked.get(card.name)}, a two-card combo bracket ${target} doesn't allow`;
    if (f.massLandDenial && !rules.massLandDenial)
      return `mass land denial isn't allowed in bracket ${target}`;
    const others = [...d.commanders, ...d.slots.map((s) => s.card)].filter(
      (c) => c.name !== out?.name,
    );
    if (f.extraTurn && others.filter((c) => flagOf(c).extraTurn).length + 1 > rules.extraTurnCards)
      return `extra turns are limited in bracket ${target}`;
    if (budgetTotal !== null && priceOf(card) > (out ? priceOf(out) : 0)) {
      const next = totalPrice(d) - (out ? priceOf(out) : 0) + priceOf(card);
      if (next > budgetTotal) return `would put the deck over the $${budgetTotal} budget`;
    }
    if (f.gameChanger) {
      const used = others.filter((c) => flagOf(c).gameChanger).length;
      if (used + 1 > rules.gameChangers)
        return rules.gameChangers === 0
          ? `Game Changers aren't allowed in bracket ${target}`
          : `all ${rules.gameChangers} Game Changer slots are used`;
    }
    return null;
  };
}

/** Greedy best-improvement hill climbing over one-for-one swaps, with hard bracket constraints. */
export function solve(
  ctx: SolverContext,
  options: OptimizeOptions,
  roleTargets: RoleCount[],
  extraForced: { card: Card; reason: string }[] = [],
): SolverResult {
  const locked = new Set([...options.locked, ...ctx.deck.commanders.map((c) => c.name)]);
  const deck: Deck = {
    commanders: [...ctx.deck.commanders],
    slots: ctx.deck.slots.map((s) => ({ ...s })),
  };
  const value = new Map<string, number>();
  for (const s of [...ctx.scored, ...ctx.candidates]) value.set(s.card.name, s.score);
  const flags = new Map<string, CardFlags>();
  for (const s of [...ctx.scored, ...ctx.candidates]) flags.set(s.card.name, s.flags);
  const swaps: ProposedSwap[] = [];
  const used = new Set<string>();

  const remove = (card: Card) => {
    const slot = deck.slots.find((s) => s.card.name === card.name)!;
    slot.qty--;
    if (slot.qty === 0) deck.slots.splice(deck.slots.indexOf(slot), 1);
  };
  const insert = (card: Card) => deck.slots.push({ card, qty: 1 });

  const rankIns = (out: Card, counts: Map<Role, number>) => {
    const base = rolePenalty(counts, roleTargets);
    return ctx.candidates
      .filter((c) => !used.has(c.card.name) && c.card.isLand === out.isLand)
      .filter((c) => !ctx.violation(c.card, deck, out))
      .map((c) => ({
        card: c.card,
        gain:
          c.score -
          (value.get(out.name) ?? 0) +
          base -
          rolePenalty(deltaRoles(counts, out, c.card), roleTargets) -
          (ctx.budgetTotal
            ? (PRICE_WEIGHT * Math.max(0, priceOf(c.card) - priceOf(out))) / ctx.budgetTotal
            : 0),
      }))
      .sort((a, b) => b.gain - a.gain);
  };

  // Forced: anything that breaks the target bracket or colour identity goes first.
  const forcedOuts: { card: Card; reason: string }[] = [...extraForced];
  const gcsInDeck = ctx.scored.filter((s) => s.flags.gameChanger).sort((a, b) => a.score - b.score);
  const gcOver = Math.max(0, gcsInDeck.length - ctx.rules.gameChangers);
  for (const s of gcsInDeck.slice(0, gcOver))
    forcedOuts.push({
      card: s.card,
      reason:
        ctx.rules.gameChangers === 0
          ? `Game Changer; bracket ${ctx.target} allows none`
          : `over the ${ctx.rules.gameChangers} Game Changer limit`,
    });
  for (const s of ctx.scored) {
    if (s.offIdentity)
      forcedOuts.push({ card: s.card, reason: "outside the commander's color identity" });
    else if (s.flags.massLandDenial && !ctx.rules.massLandDenial)
      forcedOuts.push({
        card: s.card,
        reason: `mass land denial; not allowed in bracket ${ctx.target}`,
      });
    else if (s.flags.banned) forcedOuts.push({ card: s.card, reason: "banned in Commander" });
  }
  const extraTurnCards = ctx.scored
    .filter((s) => s.flags.extraTurn)
    .sort((a, b) => a.score - b.score);
  for (const s of extraTurnCards.slice(
    0,
    Math.max(0, extraTurnCards.length - ctx.rules.extraTurnCards),
  ))
    forcedOuts.push({ card: s.card, reason: `extra turns are limited in bracket ${ctx.target}` });

  for (const { card, reason } of forcedOuts) {
    if (!deck.slots.some((s) => s.card.name === card.name)) continue;
    const ranked = rankIns(card, roleCounts(deck));
    const pick = ranked[0];
    if (!pick) continue;
    remove(card);
    insert(pick.card);
    used.add(pick.card.name);
    swaps.push({
      out: card,
      in: pick.card,
      gain: pick.gain,
      forced: reason,
      alternatives: ranked.slice(1, 4).map((r) => r.card),
    });
  }

  swaps.push(...trimToBudget(ctx, deck, locked, roleTargets, used));

  while (swaps.length < options.maxSwaps) {
    const counts = roleCounts(deck);
    let best: { out: Card; ranked: { card: Card; gain: number }[] } | null = null;
    const eligible = deck.slots
      .map((s) => s.card)
      .filter((c) => !locked.has(c.name) && !isBasicLand(c.name) && !used.has(c.name))
      .sort((a, b) => (value.get(a.name) ?? 0) - (value.get(b.name) ?? 0));
    // Game Changers are always considered so a full slot can be upgraded to a better one.
    const outs = [
      ...new Set([
        ...eligible.slice(0, 30),
        ...eligible.filter((c) => flags.get(c.name)?.gameChanger),
      ]),
    ];
    for (const out of outs) {
      const ranked = rankIns(out, counts);
      if (ranked[0] && (!best || ranked[0].gain > best.ranked[0].gain)) best = { out, ranked };
    }
    if (!best || best.ranked[0].gain < MIN_GAIN) break;
    const pick = best.ranked[0];
    remove(best.out);
    insert(pick.card);
    used.add(pick.card.name);
    used.add(best.out.name);
    swaps.push({
      out: best.out,
      in: pick.card,
      gain: pick.gain,
      forced: null,
      alternatives: best.ranked.slice(1, 4).map((r) => r.card),
    });
  }

  const excluded = ctx.candidates
    .filter((c) => !used.has(c.card.name))
    .map((c) => ({ c, why: ctx.violation(c.card, deck) }))
    // Only cards decks with this commander actually play, so the list is meaningful.
    .filter((x) => x.why && x.c.inclusion !== null && x.c.inclusion >= 0.05)
    .slice(0, 8)
    .map((x) => ({ name: x.c.card.name, reason: x.why! }));

  const gameChangerOptions = [
    ...ctx.scored
      .filter((s) => s.flags.gameChanger)
      .map((s) => ({
        name: s.card.name,
        score: s.score,
        inDeck: deck.slots.some((d) => d.card.name === s.card.name),
      })),
    ...ctx.candidates
      .filter((c) => c.flags.gameChanger)
      .map((c) => ({ name: c.card.name, score: c.score, inDeck: used.has(c.card.name) })),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((g) => ({ ...g, score: Math.round(g.score * 100) / 100 }));

  return { swaps, excluded, gameChangerOptions };
}
