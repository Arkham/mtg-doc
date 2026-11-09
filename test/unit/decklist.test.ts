import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatDecklist, parseDecklist } from "../../server/decklist.ts";
import { slugify, edhrecKey } from "../../server/sources/edhrec.ts";

describe("parseDecklist", () => {
  test("reads Arena/Moxfield sections, set codes and foil markers", () => {
    const parsed = parseDecklist(`Commander
1 Atraxa, Praetors' Voice

Deck
1x Sol Ring (CMR) 472 *F*
2 Forest
1 Command Tower [Land]

Sideboard
1 Swords to Plowshares`);
    assert.deepEqual(parsed.commanders, ["Atraxa, Praetors' Voice"]);
    assert.deepEqual(parsed.entries, [
      { name: "Sol Ring", qty: 1 },
      { name: "Forest", qty: 2 },
      { name: "Command Tower", qty: 1 },
    ]);
  });

  test("handles // headers, Archidekt *CMDR* tags, comments and maybeboards", () => {
    const parsed = parseDecklist(`// Commander
1 Lathril, Blade of the Elves
// Mainboard
# a comment
1 Llanowar Elves
1 Elvish Mystic
Maybeboard
1 Craterhoof Behemoth`);
    assert.deepEqual(parsed.commanders, ["Lathril, Blade of the Elves"]);
    assert.deepEqual(
      parsed.entries.map((e) => e.name),
      ["Llanowar Elves", "Elvish Mystic"],
    );
    const archidekt = parseDecklist("1x Atraxa, Praetors' Voice *CMDR*\n1x Sol Ring");
    assert.deepEqual(archidekt.commanders, ["Atraxa, Praetors' Voice"]);
  });

  test("merges duplicate lines and defaults quantity to 1", () => {
    const parsed = parseDecklist("Forest\n3 Forest\nSol Ring");
    assert.deepEqual(parsed.entries, [
      { name: "Forest", qty: 4 },
      { name: "Sol Ring", qty: 1 },
    ]);
  });

  test("round-trips through formatDecklist", () => {
    const text = formatDecklist(
      ["Cmdr"],
      [
        { name: "Zebra", qty: 1 },
        { name: "Forest", qty: 30 },
      ],
    );
    assert.match(text, /^Commander\n1 Cmdr\n\nDeck\n30 Forest\n1 Zebra\n$/);
    assert.deepEqual(parseDecklist(text), {
      commanders: ["Cmdr"],
      entries: [
        { name: "Forest", qty: 30 },
        { name: "Zebra", qty: 1 },
      ],
    });
  });
});

describe("names", () => {
  test("slugify makes folder-safe names from the front face", () => {
    assert.equal(slugify("Atraxa, Praetors' Voice"), "atraxa-praetors-voice");
    assert.equal(
      slugify("Esika, God of the Tree // The Prismatic Bridge"),
      "esika-god-of-the-tree",
    );
    assert.equal(slugify("Ætherflux Réservoir"), "aetherflux-reservoir");
    assert.equal(slugify("Lim-Dûl the Necromancer"), "lim-dul-the-necromancer");
  });

  test("edhrecKey matches EDHREC's front-face naming", () => {
    assert.equal(
      edhrecKey("Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun"),
      "growing rites of itlimoc",
    );
  });
});
