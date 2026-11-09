import type { Card, Color } from "../../shared/types.ts";
import { config } from "../config.ts";
import { classifyRoles } from "../analysis/roles.ts";

const API = "https://api.scryfall.com";
const MIN_INTERVAL_MS = 110;
let nextSlot = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

async function sfFetch(path: string, init?: RequestInit): Promise<Response> {
  await throttle();
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      "user-agent": config.userAgent,
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

interface ScryfallFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: { normal?: string; art_crop?: string };
}

export interface ScryfallCard {
  name: string;
  oracle_id: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  produced_mana?: string[];
  layout: string;
  legalities: Record<string, string>;
  prices: { usd?: string | null; usd_foil?: string | null };
  game_changer?: boolean;
  image_uris?: { normal?: string; art_crop?: string };
  card_faces?: ScryfallFace[];
  scryfall_uri: string;
}

const BASIC_NAMES = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]);
export const isBasicLand = (name: string) => BASIC_NAMES.has(name) || /^Snow-Covered /.test(name);

export function toCard(sc: ScryfallCard): Card {
  const faces = sc.card_faces ?? [];
  const front = faces[0];
  const typeLine = sc.type_line;
  const frontType = front?.type_line ?? typeLine;
  const oracleText = sc.oracle_text ?? faces.map((f) => f.oracle_text ?? "").join("\n//\n");
  const isLand = /\bLand\b/.test(frontType);
  const isMdfcLand =
    !isLand && sc.layout === "modal_dfc" && faces.some((f) => /\bLand\b/.test(f.type_line ?? ""));
  const landText = isLand ? (front?.oracle_text ?? oracleText) : "";
  const entersTapped =
    isLand &&
    /enters( the battlefield)? tapped/i.test(landText) &&
    !/unless|if you don't|you may pay|if you control/i.test(landText);
  const usd = sc.prices.usd ?? sc.prices.usd_foil;
  const card: Card = {
    name: sc.name,
    oracleId: sc.oracle_id,
    manaCost: sc.mana_cost ?? front?.mana_cost ?? "",
    cmc: sc.cmc,
    typeLine,
    oracleText,
    colors: (sc.colors ?? []) as Color[],
    colorIdentity: sc.color_identity as Color[],
    producedMana: sc.produced_mana ?? [],
    isLand,
    isMdfcLand,
    entersTapped,
    legalCommander: sc.legalities.commander === "legal",
    gameChanger: Boolean(sc.game_changer),
    canBeCommander:
      (/\bLegendary\b/.test(frontType) && /\b(Creature|Vehicle|Spacecraft)\b/.test(frontType)) ||
      /can be your commander/i.test(oracleText),
    priceUsd: usd ? Number(usd) : null,
    image: sc.image_uris?.normal ?? front?.image_uris?.normal ?? null,
    imageArt: sc.image_uris?.art_crop ?? front?.image_uris?.art_crop ?? null,
    scryfallUri: sc.scryfall_uri,
    roles: [],
  };
  card.roles = classifyRoles(card);
  return card;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

/** Exact batch lookup. Returns a map keyed by the requested name. */
export async function lookupExact(names: string[]): Promise<Map<string, Card>> {
  const out = new Map<string, Card>();
  const unique = [...new Set(names)];
  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75);
    const res = await sfFetch("/cards/collection", {
      method: "POST",
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name: name.split(" // ")[0] })) }),
    });
    if (!res.ok) throw new Error(`Scryfall collection failed: ${res.status}`);
    const data = (await res.json()) as { data: ScryfallCard[] };
    const byNorm = new Map<string, Card>();
    for (const sc of data.data) {
      const card = toCard(sc);
      byNorm.set(norm(sc.name), card);
      for (const f of sc.card_faces ?? []) byNorm.set(norm(f.name), card);
    }
    for (const name of batch) {
      const hit = byNorm.get(norm(name)) ?? byNorm.get(norm(name.split(" // ")[0]));
      if (hit) out.set(name, hit);
    }
  }
  return out;
}

export async function lookupFuzzy(name: string): Promise<Card | null> {
  const res = await sfFetch(`/cards/named?fuzzy=${encodeURIComponent(name)}`);
  if (res.ok) return toCard((await res.json()) as ScryfallCard);
  // Fuzzy fails on ambiguous/garbled input; autocomplete is more forgiving with OCR noise.
  const ac = await sfFetch(`/cards/autocomplete?q=${encodeURIComponent(name.slice(0, 40))}`);
  if (!ac.ok) return null;
  const { data } = (await ac.json()) as { data: string[] };
  if (!data.length) return null;
  const exact = await lookupExact([data[0]]);
  return exact.get(data[0]) ?? null;
}

export async function autocomplete(q: string): Promise<string[]> {
  const res = await sfFetch(`/cards/autocomplete?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return ((await res.json()) as { data: string[] }).data;
}

export interface Resolved {
  requested: string;
  card: Card | null;
  status: "exact" | "fuzzy" | "unresolved";
}

export async function resolveNames(names: string[]): Promise<Resolved[]> {
  const exact = await lookupExact(names);
  const results: Resolved[] = [];
  for (const name of names) {
    const hit = exact.get(name);
    if (hit) {
      results.push({ requested: name, card: hit, status: "exact" });
      continue;
    }
    const fuzzy = await lookupFuzzy(name);
    results.push({ requested: name, card: fuzzy, status: fuzzy ? "fuzzy" : "unresolved" });
  }
  return results;
}

/** Scryfall full-text search (first page only, which is plenty for targeted queries). */
export async function searchCards(q: string): Promise<Card[]> {
  const res = await sfFetch(`/cards/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const { data } = (await res.json()) as { data: ScryfallCard[] };
  return data.map(toCard);
}
