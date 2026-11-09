import type { Card, Color } from "../../shared/types.ts";
import { config } from "../config.ts";
import { classifyRoles } from "../analysis/roles.ts";

const API = "https://api.scryfall.com";
/** Endpoints Scryfall limits to 2 requests/second; everything else allows 10/second. */
const LIMITED = /^\/cards\/(search|named|collection|random)\b/;
const nextSlot = { limited: 0, other: 0 };
/** A 429 locks the client out for 30 seconds, per Scryfall's docs. */
const RATE_LIMIT_PENALTY_MS = 30_000;

async function throttle(path: string) {
  const queue = LIMITED.test(path) ? "limited" : "other";
  const now = Date.now();
  const wait = Math.max(0, nextSlot[queue] - now);
  nextSlot[queue] = Math.max(now, nextSlot[queue]) + config.scryfallIntervalMs[queue];
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

async function sfFetch(path: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await throttle(path);
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "user-agent": config.userAgent,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if ((res.status !== 429 && res.status < 500) || attempt >= 3) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait =
      res.status === 429
        ? Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : RATE_LIMIT_PENALTY_MS
        : 1000 * 2 ** attempt;
    const until = Date.now() + wait;
    nextSlot.limited = Math.max(nextSlot.limited, until);
    nextSlot.other = Math.max(nextSlot.other, until);
  }
}

/** All pages of a search (each page is a rate-limited request). */
async function searchAll(q: string, extra = "", maxPages = 4): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await sfFetch(`/cards/search?q=${encodeURIComponent(q)}${extra}&page=${page}`);
    if (!res.ok) break;
    const body = (await res.json()) as { data: ScryfallCard[]; has_more?: boolean };
    out.push(...body.data);
    if (!body.has_more) break;
  }
  return out;
}

interface ScryfallFace {
  name: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
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
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_uris?: { normal?: string; art_crop?: string };
  card_faces?: ScryfallFace[];
  scryfall_uri: string;
}

const BASIC_NAMES = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]);
export const isBasicLand = (name: string) =>
  BASIC_NAMES.has(name) || name.startsWith("Snow-Covered ");

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
    power: sc.power ?? front?.power,
    toughness: sc.toughness ?? front?.toughness,
    loyalty: sc.loyalty ?? front?.loyalty,
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
  await fillMissingPrices([...new Set(out.values())]);
  return out;
}

/**
 * Scryfall's default printing sometimes has no USD price (promos, foreign-only, Collectors' Edition),
 * which would make expensive cards look free. Fall back to the cheapest printing with a price.
 */
async function fillMissingPrices(cards: Card[]) {
  const missing = cards.filter((c) => c.priceUsd === null && !isBasicLand(c.name));
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const q = `(${batch.map((c) => `oracleid:${c.oracleId}`).join(" or ")}) usd>0`;
    const prints = await searchAll(q, "&unique=prints&order=usd&dir=asc");
    for (const card of batch) {
      const cheapest = prints.find((p) => p.oracle_id === card.oracleId && p.prices.usd);
      if (cheapest?.prices.usd) card.priceUsd = Number(cheapest.prices.usd);
    }
  }
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

/** Languages Scryfall can filter by (`lang:` search keyword). */
export const SCRYFALL_LANGS = new Set([
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ja",
  "ko",
  "ru",
  "zhs",
  "zht",
  "he",
  "la",
  "grc",
  "ar",
  "sa",
  "ph",
]);

const cleanPrinted = (name: string) => name.replace(/["\\()]/g, "").trim();
export const printedKey = (printed: string, lang: string) =>
  `${lang}|${cleanPrinted(printed).toLowerCase()}`;

/**
 * Resolves names as printed on non-English cards (e.g. "Stivali Piedelesto", lang "it") to English
 * card names. Batches many exact-name searches into one query per language with `or`, matching
 * results back through `printed_name`. Returns a map keyed by `printedKey(printed, lang)`.
 */
export async function printedToEnglish(
  items: { printed: string; lang: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byLang = new Map<string, Set<string>>();
  for (const { printed, lang } of items) {
    const name = cleanPrinted(printed);
    if (!name) continue;
    const l = SCRYFALL_LANGS.has(lang) ? lang : "any";
    byLang.set(l, (byLang.get(l) ?? new Set()).add(name));
  }
  for (const [lang, names] of byLang) {
    const list = [...names];
    for (let i = 0; i < list.length; i += 25) {
      const batch = list.slice(i, i + 25);
      const q = `(${batch.map((n) => `!"${n}"`).join(" or ")}) lang:${lang}`;
      for (const c of await searchAll(q, "&unique=prints")) {
        const printed = (c as ScryfallCard & { printed_name?: string }).printed_name ?? c.name;
        for (const face of printed.split(" // ")) {
          const key = printedKey(face, lang);
          if (!out.has(key)) out.set(key, c.name);
        }
      }
    }
  }
  return out;
}

/** Inexact printed-name search, for titles the model read slightly wrong. Less reliable than exact names. */
export async function lookupPrintedInexact(printed: string, lang: string): Promise<string | null> {
  const name = cleanPrinted(printed);
  if (!name) return null;
  const [hit] = await searchAll(
    `"${name}" lang:${SCRYFALL_LANGS.has(lang) ? lang : "any"}`,
    "&unique=cards",
    1,
  );
  return hit?.name ?? null;
}
