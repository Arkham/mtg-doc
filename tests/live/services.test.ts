/**
 * The real services, through the app's own clients: what the fakes stand in for must still come
 * back in a shape they read. Needs the network, so it's not part of `pnpm test`:
 *
 *   pnpm test:live
 *
 * Run it when a client changes, or now and then; a failure means a fake needs updating too.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getCommanderData } from "../../src/server/sources/edhrec.ts";
import {
  landsForColor,
  lookupExact,
  lookupFuzzy,
  printedToEnglish,
  printedKey,
  searchCards,
} from "../../src/server/sources/scryfall.ts";
import { estimateBracket, findCombos } from "../../src/server/sources/spellbook.ts";

describe("Scryfall", () => {
  test("looks cards up by name, a double-faced one by its front", async () => {
    const found = await lookupExact(["Demonic Tutor", "Delver of Secrets"]);
    const tutor = found.get("Demonic Tutor")!;
    assert.equal(tutor.cmc, 2);
    assert.ok(tutor.legalCommander && tutor.gameChanger && tutor.image && tutor.priceUsd! > 0);
    assert.match(
      found.get("Delver of Secrets")!.name,
      /Delver of Secrets \/\/ Insectile Aberration/,
    );
  });

  test("fuzzy names, searches and printed names", async () => {
    assert.equal((await lookupFuzzy("Lightning Greavs"))?.name, "Lightning Greaves");
    const gameChangers = await searchCards("is:gamechanger id<=bg legal:commander");
    assert.ok(gameChangers.length > 5 && gameChangers.every((c) => c.gameChanger));
    const lands = await landsForColor(["B", "G"], "G");
    // Lands, and spells with a land on the back.
    assert.ok(lands.length > 10 && lands.every((c) => c.producedMana.includes("G")));
    const printed = await printedToEnglish([{ printed: "Stivali Piedelesto", lang: "it" }]);
    assert.equal(printed.get(printedKey("Stivali Piedelesto", "it")), "Swiftfoot Boots");
  });
});

describe("Commander Spellbook", () => {
  const commanders = ["Lathril, Blade of the Elves"];
  const main = ["Staff of Domination", "Priest of Titania", "Llanowar Elves", "Demonic Tutor"];

  test("finds combos in a list and one card away", async () => {
    const { present, oneAway } = await findCombos(commanders, main, ["B", "G"]);
    assert.ok(present.some((c) => c.cards.includes("Staff of Domination")));
    assert.ok(oneAway.every((c) => c.missing.length === 1 && c.url.startsWith("https://")));
  });

  test("estimates a bracket with card flags and classified combos", async () => {
    const est = await estimateBracket(commanders, main);
    assert.match(est.tag, /^[A-Z]$/);
    assert.equal(est.cards.get("Demonic Tutor")?.gameChanger, true);
    assert.ok(est.combos.length > 0);
    assert.equal(typeof est.combos[0].definitelyTwoCard, "boolean");
  });
});

describe("EDHREC", () => {
  test("reads a commander's page and a bracket's", async () => {
    for (const variant of [undefined, "upgraded"]) {
      const data = (await getCommanderData(["Lathril, Blade of the Elves"], variant))!;
      assert.ok(data.numDecks! > 100 && data.avgLands! > 30 && data.cards.size > 50);
    }
    assert.equal(await getCommanderData(["Definitely Not A Commander Zz"]), null);
  });
});
