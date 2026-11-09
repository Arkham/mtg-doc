import "../support/env.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BRACKET_PAGE, getCommanderData } from "../../server/sources/edhrec.ts";
import {
  type ScryfallCard,
  isBasicLand,
  lookupExact,
  lookupFuzzy,
  lookupPrintedInexact,
  printedKey,
  printedToEnglish,
  resolveNames,
  searchCards,
  toCard,
} from "../../server/sources/scryfall.ts";
import { estimateBracket, findCombos } from "../../server/sources/spellbook.ts";

const base: ScryfallCard = {
  name: "X",
  oracle_id: "o",
  cmc: 0,
  type_line: "Land",
  color_identity: [],
  layout: "normal",
  legalities: { commander: "legal" },
  prices: { usd: "1.00" },
  scryfall_uri: "https://scryfall.com/x",
};

describe("toCard", () => {
  test("detects lands that enter tapped, ignoring conditional ones", () => {
    const tap = (oracle_text: string) => toCard({ ...base, oracle_text }).entersTapped;
    assert.equal(tap("Golgari Guildgate enters tapped.\n{T}: Add {B} or {G}."), true);
    assert.equal(tap("This land enters tapped unless you control a Swamp or a Forest."), false);
    assert.equal(
      tap("As this land enters, you may pay 2 life. If you don't, it enters tapped."),
      false,
    );
    assert.equal(tap("{T}: Add {G}."), false);
  });

  test("handles modal DFCs whose back face is a land", () => {
    const c = toCard({
      ...base,
      name: "Turntimber Symbiosis // Turntimber, Serpentine Wood",
      layout: "modal_dfc",
      type_line: "Sorcery // Land",
      card_faces: [
        {
          name: "Turntimber Symbiosis",
          type_line: "Sorcery",
          mana_cost: "{4}{G}{G}{G}",
          oracle_text: "Look at the top seven cards...",
        },
        { name: "Turntimber, Serpentine Wood", type_line: "Land", oracle_text: "{T}: Add {G}." },
      ],
    });
    assert.equal(c.isLand, false);
    assert.equal(c.isMdfcLand, true);
    assert.equal(c.manaCost, "{4}{G}{G}{G}");
  });

  test("reads commander eligibility, Game Changer flag and price", () => {
    const c = toCard({
      ...base,
      type_line: "Legendary Creature — Elf",
      game_changer: true,
      prices: { usd: null, usd_foil: "4.50" },
    });
    assert.equal(c.canBeCommander, true);
    assert.equal(c.gameChanger, true);
    assert.equal(c.priceUsd, 4.5);
    assert.equal(
      toCard({
        ...base,
        type_line: "Legendary Planeswalker",
        oracle_text: "This can be your commander.",
      }).canBeCommander,
      true,
    );
  });

  test("knows basic lands, including snow basics", () => {
    assert.ok(isBasicLand("Forest") && isBasicLand("Snow-Covered Island") && isBasicLand("Wastes"));
    assert.ok(!isBasicLand("Forest Bear"));
  });
});

describe("Scryfall client (recorded)", () => {
  test("batch exact lookup, matching front faces and fixing missing prices", async () => {
    const found = await lookupExact([
      "Sol Ring",
      "Lion's Eye Diamond",
      "Growing Rites of Itlimoc",
      "Not A Real Card Xyz",
    ]);
    assert.equal(found.get("Sol Ring")!.roles[0], "ramp");
    assert.ok(
      (found.get("Lion's Eye Diamond")!.priceUsd ?? 0) > 50,
      "falls back to the cheapest priced printing",
    );
    assert.equal(found.get("Lion's Eye Diamond")!.gameChanger, true);
    assert.equal(
      found.get("Growing Rites of Itlimoc")!.name,
      "Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun",
    );
    assert.equal(found.has("Not A Real Card Xyz"), false);
  });

  test("fuzzy resolution of OCR-style misspellings", async () => {
    assert.equal((await lookupFuzzy("Llanowar Elfs"))?.name, "Llanowar Elves");
    const [exact, fuzzy, missing] = await resolveNames([
      "Sol Ring",
      "Elvish Mistic",
      "Qwxzzy Plorb",
    ]);
    assert.equal(exact.status, "exact");
    assert.equal(fuzzy.status, "fuzzy");
    assert.equal(fuzzy.card?.name, "Elvish Mystic");
    assert.equal(missing.status, "unresolved");
  });

  test("batch-resolves printed non-English names, with an inexact fallback", async () => {
    const items = [
      "Stivali Piedelesto",
      "Tempesta Stellare",
      "Nekusar, il Distruttore di Menti",
      "Terminate",
    ].map((printed) => ({
      printed,
      lang: "it",
    }));
    const map = await printedToEnglish(items);
    assert.equal(map.get(printedKey("Stivali Piedelesto", "it")), "Swiftfoot Boots");
    assert.equal(map.get(printedKey("Tempesta Stellare", "it")), "Starstorm");
    assert.equal(
      map.get(printedKey("Nekusar, il Distruttore di Menti", "it")),
      "Nekusar, the Mindrazer",
    );
    assert.equal(
      map.has(printedKey("Terminate", "it")),
      false,
      "an English title isn't an Italian printed name",
    );
    assert.equal(await lookupPrintedInexact("Stivali Piedelest", "it"), "Swiftfoot Boots");
    assert.equal(await lookupPrintedInexact("Qwxzz Plorbato", "it"), null);
  });

  test("search returns cards", async () => {
    const gcs = await searchCards("is:gamechanger id<=bg legal:commander");
    assert.ok(gcs.length > 5 && gcs.every((c) => c.gameChanger));
  });
});

describe("EDHREC client (recorded)", () => {
  test("loads commander data with inclusion and synergy", async () => {
    const data = await getCommanderData(["Lathril, Blade of the Elves"]);
    assert.ok(data);
    assert.equal(data.url, "https://edhrec.com/commanders/lathril-blade-of-the-elves");
    assert.ok((data.numDecks ?? 0) > 1000);
    assert.ok(data.avgLands && data.avgLands > 25);
    const elf = data.cards.get("elvish archdruid");
    assert.ok(elf && elf.inclusion > 0 && elf.inclusion <= 1);
  });

  test("loads bracket-specific pages", async () => {
    const data = await getCommanderData(["Lathril, Blade of the Elves"], BRACKET_PAGE[3]);
    assert.equal(data?.url, "https://edhrec.com/commanders/lathril-blade-of-the-elves/upgraded");
  });

  test("returns null for unknown commanders", async () => {
    assert.equal(await getCommanderData(["Definitely Not A Commander Zz"]), null);
  });
});

describe("Commander Spellbook client (recorded)", () => {
  test("finds combos in the deck and one card away, filtered by identity", async () => {
    const r = await findCombos(
      ["Lathril, Blade of the Elves"],
      ["Priest of Titania", "Sol Ring"],
      ["B", "G"],
    );
    assert.ok(r.oneAway.length > 0);
    assert.ok(r.oneAway.every((c) => c.missing.length === 1));
    assert.ok(
      !r.oneAway.some((c) => c.cards.includes("Hullbreaker Horror")),
      "blue combos are filtered out",
    );
  });

  test("classifies cards and combos for brackets", async () => {
    const est = await estimateBracket(
      ["Lathril, Blade of the Elves"],
      ["Armageddon", "Time Warp", "Demonic Tutor", "Priest of Titania", "Staff of Domination"],
    );
    assert.equal(est.cards.get("Armageddon")!.massLandDenial, true);
    assert.equal(est.cards.get("Time Warp")!.extraTurn, true);
    assert.equal(est.cards.get("Demonic Tutor")!.gameChanger, true);
    const staff = est.combos.find((c) => c.cards.includes("Staff of Domination"));
    assert.ok(staff && staff.relevant);
  });
});
