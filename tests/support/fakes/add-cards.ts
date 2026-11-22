/**
 * Adds real cards to the fake Scryfall's database, from the live API, trimmed to the fields the
 * app reads. For a test that needs a card the database doesn't have:
 *
 *   pnpm fakes:cards "Sol Ring" "Arcane Signet"
 *
 * Combos and Spellbook's card flags are written by hand in tests/fixtures/fakes/spellbook.json;
 * EDHREC pages go in tests/fixtures/fakes/edhrec/<commander>.json (and <commander>/<bracket>.json).
 */
import fs from "node:fs";
import path from "node:path";
import type { ScryfallCard } from "../../../src/server/sources/scryfall.ts";

/** A card as Scryfall sends it: what the app reads, and what the fake searches by. */
type Live = ScryfallCard & {
  id: string;
  lang?: string;
  printed_name?: string;
  edhrec_rank?: number;
};
const FILE = path.resolve(import.meta.dirname, "../../fixtures/fakes/scryfall.json");

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(
    keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]),
  ) as Partial<Pick<T, K>>;
}
const images = (u: ScryfallCard["image_uris"]) => u && pick(u, ["normal", "art_crop"]);

export function trim(c: Live) {
  return {
    ...pick(c, [
      "id",
      "oracle_id",
      "name",
      "lang",
      "printed_name",
      "mana_cost",
      "cmc",
      "type_line",
      "oracle_text",
      "colors",
      "color_identity",
      "produced_mana",
      "layout",
      "game_changer",
      "power",
      "toughness",
      "loyalty",
      "scryfall_uri",
      "edhrec_rank",
    ]),
    legalities: { commander: c.legalities?.commander ?? "not_legal" },
    prices: { usd: c.prices?.usd ?? null, usd_foil: c.prices?.usd_foil ?? null },
    ...(c.image_uris ? { image_uris: images(c.image_uris) } : {}),
    ...(c.card_faces
      ? {
          card_faces: c.card_faces.map((f) => ({
            ...pick(f, [
              "name",
              "mana_cost",
              "type_line",
              "oracle_text",
              "power",
              "toughness",
              "loyalty",
            ]),
            ...(f.image_uris ? { image_uris: images(f.image_uris) } : {}),
          })),
        }
      : {}),
  };
}

const names = process.argv.slice(2);
if (!names.length) throw new Error('Usage: pnpm fakes:cards "Card Name" ...');
type Saved = ReturnType<typeof trim>;
const db = JSON.parse(fs.readFileSync(FILE, "utf8")) as { cards: Saved[]; prints: Saved[] };
for (let i = 0; i < names.length; i += 75) {
  const res = await fetch("https://api.scryfall.com/cards/collection", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "mtg-doc-tests" },
    body: JSON.stringify({ identifiers: names.slice(i, i + 75).map((name) => ({ name })) }),
  });
  if (!res.ok) throw new Error(`Scryfall: ${res.status}`);
  const body = (await res.json()) as { data: Live[]; not_found: { name: string }[] };
  for (const missing of body.not_found) console.warn(`Not on Scryfall: ${missing.name}`);
  for (const card of body.data) {
    db.cards = [...db.cards.filter((c) => c.oracle_id !== card.oracle_id), trim(card)];
    console.log(`Added ${card.name}`);
  }
}
db.cards.sort((a, b) => a.name!.localeCompare(b.name!) || a.id!.localeCompare(b.id!));
fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
