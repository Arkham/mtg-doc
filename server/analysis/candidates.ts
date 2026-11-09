import type { Card, Combo, Color, Role, RoleCount } from "../../shared/types.ts";
import { type EdhrecData, edhrecKey } from "../sources/edhrec.ts";
import { isBasicLand, lookupExact } from "../sources/scryfall.ts";
import type { Deck } from "./deck.ts";

export interface ScoredCard {
  card: Card;
  score: number;
  inclusion: number | null;
  synergy: number | null;
  comboPiece: boolean;
  offIdentity: boolean;
  source: string[];
}

const fitsIdentity = (card: Card, identity: Color[]) =>
  card.colorIdentity.every((c) => identity.includes(c));

function baseScore(inclusion: number | null, synergy: number | null) {
  const inc = inclusion ?? 0;
  const syn = Math.max(-1, Math.min(1, (synergy ?? 0) * 2));
  return 0.6 * inc + 0.4 * syn;
}

function neededRoles(roles: RoleCount[]): Set<Role> {
  return new Set(roles.filter((r) => r.target !== null && r.count < r.target).map((r) => r.role));
}

export function scoreDeckCards(
  deck: Deck,
  identity: Color[],
  edhrec: EdhrecData | null,
  combosPresent: Combo[],
  roles: RoleCount[],
): ScoredCard[] {
  const comboCards = new Set(combosPresent.flatMap((c) => c.cards));
  const needed = neededRoles(roles);
  return deck.slots.map(({ card }) => {
    const e = edhrec?.cards.get(edhrecKey(card.name));
    const comboPiece = comboCards.has(card.name);
    let score = baseScore(e?.inclusion ?? null, e?.synergy ?? null);
    if (comboPiece) score += 0.5;
    if (card.roles.some((r) => needed.has(r))) score += 0.15;
    if (card.cmc >= 6) score -= 0.08 * (card.cmc - 5);
    const offIdentity = !fitsIdentity(card, identity) || !card.legalCommander;
    if (offIdentity) score -= 2;
    return {
      card,
      score: Math.round(score * 1000) / 1000,
      inclusion: e ? Math.round(e.inclusion * 1000) / 1000 : null,
      synergy: e ? Math.round(e.synergy * 1000) / 1000 : null,
      comboPiece,
      offIdentity,
      source: e ? [`edhrec:${e.list}`] : [],
    };
  });
}

export async function findAddCandidates(opts: {
  deck: Deck;
  identity: Color[];
  edhrec: EdhrecData | null;
  oneAway: Combo[];
  researchCards: string[];
  roles: RoleCount[];
  budgetPerCard: number | null;
  limit?: number;
}): Promise<ScoredCard[]> {
  const { deck, identity, edhrec, oneAway, researchCards, roles, budgetPerCard } = opts;
  const inDeck = new Set(
    [...deck.commanders, ...deck.slots.map((s) => s.card)].flatMap((c) => [
      c.name,
      c.name.split(" // ")[0],
    ]),
  );
  const pool = new Map<
    string,
    {
      score: number;
      source: string[];
      inclusion: number | null;
      synergy: number | null;
      comboPiece: boolean;
    }
  >();
  const bump = (
    name: string,
    delta: number,
    source: string,
    extra: Partial<{ inclusion: number; synergy: number; comboPiece: boolean }> = {},
  ) => {
    if (inDeck.has(name) || isBasicLand(name)) return;
    const cur = pool.get(name) ?? {
      score: 0,
      source: [],
      inclusion: null,
      synergy: null,
      comboPiece: false,
    };
    cur.score += delta;
    cur.source.push(source);
    if (extra.inclusion !== undefined) cur.inclusion = extra.inclusion;
    if (extra.synergy !== undefined) cur.synergy = extra.synergy;
    if (extra.comboPiece) cur.comboPiece = true;
    pool.set(name, cur);
  };

  for (const e of edhrec?.cards.values() ?? []) {
    if (e.list === "New Cards") continue;
    bump(e.name, baseScore(e.inclusion, e.synergy), `edhrec:${e.list}`, {
      inclusion: Math.round(e.inclusion * 1000) / 1000,
      synergy: Math.round(e.synergy * 1000) / 1000,
    });
  }
  for (const combo of oneAway.slice(0, 25)) {
    bump(combo.missing[0], 0.35, `combo:${combo.produces.slice(0, 2).join(", ")}`, {
      comboPiece: true,
    });
  }
  for (const name of researchCards) bump(name, 0.1, "web-research");

  const top = [...pool].sort((a, b) => b[1].score - a[1].score).slice(0, 160);
  const cards = await lookupExact(top.map(([n]) => n));
  const needed = neededRoles(roles);
  const out: ScoredCard[] = [];
  for (const [name, p] of top) {
    const card = cards.get(name);
    if (!card || inDeck.has(card.name) || !card.legalCommander || !fitsIdentity(card, identity))
      continue;
    if (budgetPerCard !== null && (card.priceUsd ?? 0) > budgetPerCard) continue;
    const roleBonus = card.roles.some((r) => needed.has(r)) ? 0.15 : 0;
    out.push({
      card,
      score: Math.round((p.score + roleBonus) * 1000) / 1000,
      inclusion: p.inclusion,
      synergy: p.synergy,
      comboPiece: p.comboPiece,
      offIdentity: false,
      source: [...new Set(p.source)],
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 90);
}
