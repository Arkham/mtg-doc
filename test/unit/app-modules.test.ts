import "../support/env.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import sharp from "sharp";
import type { Plan } from "../../server/analysis/optimizer.ts";
import {
  applyPlan,
  fixLandCount,
  mergeSwaps,
  rebalanceBasics,
} from "../../server/analysis/optimizer.ts";
import { analyzeMana } from "../../server/analysis/mana.ts";
import { config } from "../../server/config.ts";
import { prepareImage, recognizeText } from "../../server/ocr.ts";
import {
  createDeckFolder,
  listDecks,
  readDeckFile,
  readMeta,
  readReport,
  writeDeck,
} from "../../server/storage.ts";
import type { OptimizeOptions } from "../../shared/types.ts";
import { forest, solverCard, spell, swamp, testDeck } from "../support/cards.ts";

const OPTIONS: OptimizeOptions = {
  maxSwaps: 10,
  budgetPerCard: null,
  budgetTotal: null,
  bracket: null,
  tone: "max",
  locked: [],
  webResearch: false,
};

const plan = (swaps: Plan["swaps"]): Plan => ({ strategy: "", themes: [], swaps });

describe("applyPlan", () => {
  test("applies valid swaps and skips invalid ones with warnings", async () => {
    const deck = testDeck(37, [spell("Pet"), spell("Weak")]);
    const good = spell("Good");
    const blue = spell("Blue", { colorIdentity: ["U"] });
    const pricey = spell("Pricey", { priceUsd: 99 });
    const r = await applyPlan(
      deck,
      plan([
        { out: "Weak", in: "Good", category: "synergy", reason: "better" },
        { out: "Not In Deck", in: "Good", category: "other", reason: "" },
        { out: "Pet", in: "Good", category: "other", reason: "" },
        { out: "Filler 0", in: "Blue", category: "other", reason: "" },
        { out: "Filler 1", in: "Pricey", category: "other", reason: "" },
        { out: "Filler 2", in: "Good", category: "other", reason: "" },
        { out: "Filler 3", in: "Blocked", category: "other", reason: "" },
      ]),
      ["B", "G"],
      [good, blue, pricey, spell("Blocked")].map((c) => solverCard(c, 0.5)),
      { ...OPTIONS, locked: ["Pet"], budgetPerCard: 10 },
      (c) => (c.name === "Blocked" ? "bracket rule" : null),
      new Map([["Weak", [good, spell("Alt 1"), spell("Alt 2")]]]),
    );
    assert.deepEqual(
      r.swaps.map((s) => `${s.out}->${s.in}`),
      ["Weak->Good"],
    );
    assert.deepEqual(
      r.swaps[0].alternatives?.map((a) => a.name),
      ["Alt 1", "Alt 2"],
    );
    const warnings = r.warnings.join("\n");
    for (const w of [
      "not in the deck",
      "is locked",
      "not legal",
      "over budget",
      "already in the deck",
      "bracket rule",
    ]) {
      assert.match(warnings, new RegExp(w));
    }
    assert.equal(
      r.deck.slots.reduce((n, s) => n + s.qty, 0),
      99,
    );
    assert.equal(
      deck.slots.some((s) => s.card.name === "Good"),
      false,
      "input deck is not mutated",
    );
  });
});

describe("mana base fixes (recorded basics)", () => {
  test("fixLandCount adds lands to a land-light deck without cutting short roles", async () => {
    const removal = spell("Removal", { oracleText: "Destroy target creature." });
    const deck = testDeck(31, [removal]);
    const scored = deck.slots
      .filter((s) => !s.card.isLand)
      .map((s) => solverCard(s.card, s.card.name === "Removal" ? 0 : 0.2));
    const r = await fixLandCount(
      deck,
      ["B", "G"],
      scored,
      [],
      null,
      new Set(["Cmdr"]),
      new Set(),
      4,
    );
    assert.ok(r.swaps.length >= 3);
    assert.ok(r.swaps.every((s) => s.inCard?.isLand && s.category === "mana"));
    assert.ok(!r.swaps.some((s) => s.out === "Removal"), "removal is short, so keep it");
    assert.ok(analyzeMana(r.deck, null).landCount > 31);
  });

  test("rebalanceBasics shifts basics toward the color that's short", async () => {
    const blackHeavy = Array.from({ length: 30 }, (_, i) =>
      spell(`Black ${i}`, { manaCost: "{B}{B}", colorIdentity: ["B"] }),
    );
    const deck = {
      ...testDeck(36, blackHeavy),
      slots: [
        { card: forest, qty: 30 },
        { card: swamp, qty: 6 },
        ...blackHeavy.map((card) => ({ card, qty: 1 })),
        ...Array.from({ length: 33 }, (_, i) => ({ card: spell(`G ${i}`), qty: 1 })),
      ],
    };
    const before = analyzeMana(deck, null).colors.find((c) => c.color === "B")!.landSources;
    const r = await rebalanceBasics(deck, ["B", "G"], null, new Set());
    const after = analyzeMana(r.deck, null).colors.find((c) => c.color === "B")!.landSources;
    assert.ok(after > before);
    assert.ok(r.swaps.every((s) => s.out === "Forest" && s.in === "Swamp"));
  });

  test("mergeSwaps collapses basic-land chains and drops no-ops", () => {
    const merged = mergeSwaps([
      { out: "Rogue's Passage", in: "Swamp", category: "mana", reason: "a." },
      { out: "Swamp", in: "Forest", category: "mana", reason: "b." },
      { out: "Forest", in: "Rogue's Passage", category: "mana", reason: "c." },
    ]);
    assert.equal(merged.length, 0);
  });
});

describe("storage", () => {
  test("creates suffixed folders, writes and lists decks", async () => {
    const meta = (slug: string) => ({
      slug,
      format: "commander" as const,
      commanders: ["Cmdr"],
      deckName: null,
      createdAt: new Date().toISOString(),
      options: OPTIONS,
      image: null,
    });
    const a = await createDeckFolder("Atraxa, Praetors' Voice");
    const b = await createDeckFolder("Atraxa, Praetors' Voice");
    assert.equal(a, "atraxa-praetors-voice");
    assert.equal(b, "atraxa-praetors-voice-2");
    await writeDeck(
      meta(a),
      [{ name: "Sol Ring", qty: 1 }],
      [{ name: "photo.jpg", data: Buffer.from("x") }],
    );
    assert.equal((await readMeta(a)).commanders[0], "Cmdr");
    assert.match(await readDeckFile(a, "initial.txt"), /Commander\n1 Cmdr\n\nDeck\n1 Sol Ring/);
    assert.ok(fs.existsSync(path.join(config.decksDir, a, "uploads", "photo.jpg")));
    assert.equal(await readReport(a), null);
    const listed = await listDecks();
    assert.ok(listed.some((d) => d.slug === a && !d.hasReport));
    assert.ok(!listed.some((d) => d.slug === b), "folders without deck.json are ignored");
  });

  test("rejects path traversal in slugs", async () => {
    await assert.rejects(readMeta("../etc"), /Invalid deck slug/);
  });
});

describe("ocr", () => {
  test("recognizeText finds the commander, flags off-color cards and the count", async () => {
    const text = fs.readFileSync(
      path.resolve(import.meta.dirname, "../fixtures/decks/lathril-overpowered.txt"),
      "utf8",
    );
    const r = await recognizeText(text);
    assert.equal(r.format, "commander");
    assert.deepEqual(r.commanders, ["Lathril, Blade of the Elves"]);
    assert.equal(r.commanderCards[0].name, "Lathril, Blade of the Elves");
    assert.equal(r.entries.reduce((n, e) => n + e.qty, 0) + 1, 100);
    assert.ok(r.notes.some((n) => n.includes("Divination") && n.includes("color identity")));
    assert.ok(r.entries.every((e) => e.status === "exact"));
  });

  test("recognizeText warns when the list isn't 100 cards", async () => {
    const r = await recognizeText("Commander\n1 Lathril, Blade of the Elves\n\nDeck\n1 Sol Ring");
    assert.ok(r.notes.some((n) => n.includes("needs exactly 100")));
  });

  test("prepareImage normalizes photos to a bounded JPEG data URL", async () => {
    const png = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#123" },
    })
      .png()
      .toBuffer();
    const url = await prepareImage(png);
    assert.match(url, /^data:image\/jpeg;base64,/);
    const meta = await sharp(Buffer.from(url.split(",")[1], "base64")).metadata();
    assert.equal(meta.width, 3072);
  });
});
