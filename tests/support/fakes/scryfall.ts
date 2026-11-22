/**
 * A fake Scryfall: the endpoints the app calls, answered from a small card database
 * (`tests/fixtures/fakes/scryfall.json`, real cards trimmed to the fields the app reads). Any
 * batch, order or query the app sends gets an answer, so tests don't depend on how it asks.
 */
import fs from "node:fs";
import path from "node:path";

type FakeCard = {
  id: string;
  oracle_id: string;
  name: string;
  lang?: string;
  printed_name?: string;
  type_line: string;
  color_identity: string[];
  produced_mana?: string[];
  game_changer?: boolean;
  legalities: { commander: string };
  prices: { usd: string | null; usd_foil: string | null };
  edhrec_rank?: number;
  card_faces?: { name: string }[];
};

const db = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../../fixtures/fakes/scryfall.json"), "utf8"),
) as { cards: FakeCard[]; prints: FakeCard[] };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

/** Cards by normalized name, and by each face's. */
const byName = new Map<string, FakeCard>();
for (const card of db.cards)
  for (const name of [card.name, ...(card.card_faces ?? []).map((f) => f.name)])
    if (!byName.has(norm(name))) byName.set(norm(name), card);

/** Every printing: the saved ones, and the default of each card that has none saved. */
const printed = new Set(db.prints.map((p) => p.oracle_id));
const allPrints = [...db.prints, ...db.cards.filter((c) => !printed.has(c.oracle_id))];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = (details: string) =>
  json({ object: "error", code: "not_found", status: 404, details }, 404);

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length];
}

/** Scryfall's fuzzy match, closely enough: the exact name, else the one nearest in spelling. */
function fuzzy(name: string): FakeCard | null {
  const key = norm(name);
  if (byName.has(key)) return byName.get(key)!;
  let best: FakeCard | null = null;
  let bestDistance = Math.max(2, Math.floor(key.length / 5)) + 1;
  for (const [k, card] of byName) {
    const d = distance(key, k);
    if (d < bestDistance) [best, bestDistance] = [card, d];
  }
  return best;
}

// ---------- search ----------

type Test = (c: FakeCard) => boolean;

function tokenize(q: string): string[] {
  return q.match(/-?!?"[^"]*"|\(|\)|[^\s()]+/g) ?? [];
}

/** The query language the app uses: terms ANDed, `or` between them, parentheses, `-` to negate. */
function parse(q: string): Test {
  const tokens = tokenize(q);
  let i = 0;
  const orList = (): Test => {
    const parts = [andList()];
    while (tokens[i]?.toLowerCase() === "or") {
      i++;
      parts.push(andList());
    }
    return (c) => parts.some((p) => p(c));
  };
  const andList = (): Test => {
    const parts: Test[] = [];
    while (i < tokens.length && tokens[i] !== ")" && tokens[i].toLowerCase() !== "or")
      parts.push(term());
    return (c) => parts.every((p) => p(c));
  };
  const term = (): Test => {
    const t = tokens[i++];
    if (t === "(") {
      const inner = orList();
      if (tokens[i++] !== ")") throw new Error(`Fake Scryfall: unbalanced query ${q}`);
      return inner;
    }
    if (t.startsWith("-")) {
      const inner = atom(t.slice(1));
      return (c) => !inner(c);
    }
    return atom(t);
  };
  const atom = (t: string): Test => {
    const names = (c: FakeCard) => [
      c.name,
      c.printed_name ?? "",
      ...(c.card_faces ?? []).map((f) => f.name),
    ];
    if (t.startsWith('!"')) {
      const want = t.slice(2, -1).toLowerCase();
      return (c) => names(c).some((n) => n.toLowerCase() === want);
    }
    if (t.startsWith('"')) {
      const want = t.slice(1, -1).toLowerCase();
      return (c) => names(c).some((n) => n.toLowerCase().includes(want));
    }
    const m = /^([a-z]+)(:|<=|>=|>|<|=)(.+)$/i.exec(t);
    if (!m) throw new Error(`Fake Scryfall doesn't know the search term "${t}" (in ${q})`);
    const [, key, op, value] = m;
    const v = value.toLowerCase();
    switch (`${key.toLowerCase()}${op}`) {
      case "oracleid:":
        return (c) => c.oracle_id === v;
      case "lang:":
        return (c) => v === "any" || (c.lang ?? "en") === v;
      case "t:":
        return (c) => c.type_line.toLowerCase().includes(v);
      case "id<=":
        return (c) => c.color_identity.every((x) => v.includes(x.toLowerCase()));
      case "produces:":
        return (c) => (c.produced_mana ?? []).some((x) => x.toLowerCase() === v);
      case "legal:":
        return (c) => v === "commander" && c.legalities.commander === "legal";
      case "is:":
        if (v === "gamechanger") return (c) => Boolean(c.game_changer);
        break;
      case "usd>":
        return (c) => Number(c.prices.usd ?? 0) > Number(v);
    }
    throw new Error(`Fake Scryfall doesn't know the search term "${t}" (in ${q})`);
  };
  const test = orList();
  if (i < tokens.length) throw new Error(`Fake Scryfall: couldn't read the query ${q}`);
  return test;
}

function search(url: URL): Response {
  const q = url.searchParams.get("q") ?? "";
  const test = parse(q);
  const unique = url.searchParams.get("unique") ?? "cards";
  // Printings of other languages only come up when the query asks for one.
  const pool = /lang:/.test(q) || unique === "prints" ? allPrints : db.cards;
  let found = pool.filter(test);
  const order = url.searchParams.get("order") ?? "name";
  const dir = url.searchParams.get("dir") === "desc" ? -1 : 1;
  const sortKey: (c: FakeCard) => number | string =
    order === "usd"
      ? (c) => Number(c.prices.usd ?? Infinity)
      : order === "edhrec"
        ? (c) => c.edhrec_rank ?? Infinity
        : (c) => c.name;
  found = [...found].sort((a, b) => {
    const [x, y] = [sortKey(a), sortKey(b)];
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  if (unique !== "prints") {
    const seen = new Set<string>();
    found = found.filter((c) => !seen.has(c.oracle_id) && seen.add(c.oracle_id));
  }
  if (!found.length) return notFound(`Your query didn't match any cards.`);
  return json({ object: "list", total_cards: found.length, has_more: false, data: found });
}

export function scryfall(url: URL, init?: RequestInit): Response {
  if (url.pathname === "/cards/collection" && init?.method === "POST") {
    const { identifiers } = JSON.parse(String(init.body)) as { identifiers: { name: string }[] };
    const data: FakeCard[] = [];
    const missing: { name: string }[] = [];
    for (const id of identifiers) {
      const card = byName.get(norm(id.name));
      if (card) data.push(card);
      else missing.push(id);
    }
    return json({ object: "list", not_found: missing, data });
  }
  if (url.pathname === "/cards/named") {
    const exact = url.searchParams.get("exact");
    const asked = exact ?? url.searchParams.get("fuzzy") ?? "";
    const card = exact !== null ? (byName.get(norm(exact)) ?? null) : fuzzy(asked);
    return card ? json(card) : notFound(`No cards found matching “${asked}”`);
  }
  if (url.pathname === "/cards/autocomplete") {
    const key = norm(url.searchParams.get("q") ?? "");
    const names = db.cards.map((c) => c.name);
    const data = [
      ...names.filter((n) => norm(n).startsWith(key)),
      ...names.filter((n) => !norm(n).startsWith(key) && norm(n).includes(key)),
    ].slice(0, 20);
    return json({ object: "catalog", total_values: data.length, data });
  }
  if (url.pathname === "/cards/search") return search(url);
  throw new Error(`Fake Scryfall has no ${init?.method ?? "GET"} ${url.pathname}`);
}
