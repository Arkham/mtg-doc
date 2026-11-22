import "../support/env.ts";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { applyDeckChanges, applySwap } from "../../src/server/chat.ts";
import { config } from "../../src/server/config.ts";
import { cancelDebounced, editStatus } from "../../src/server/edit-queue.ts";
import { loadDeck } from "../../src/server/pipeline.ts";
import { readCards, readReport } from "../../src/server/storage.ts";
import { optimizeFixtureDeck } from "../support/sample.ts";

/** Requests that leave the machine, while counting. */
let outbound: string[] | null = null;
const replay = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (outbound && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) outbound.push(url);
  return replay(input, init);
};
const requestsDuring = async (work: () => Promise<unknown>) => {
  outbound = [];
  await work();
  const made = outbound;
  outbound = null;
  return made;
};

let slug = "";
before(async () => {
  ({ slug } = await optimizeFixtureDeck("lathril.txt", {
    bracket: 3,
    tone: "balanced",
    maxSwaps: 6,
  }));
  // The refresh after an edit does reach out; it's not what's measured here.
  config.refreshDelayMs = 3_600_000;
});
after(() => {
  cancelDebounced(slug);
  config.refreshDelayMs = 0;
});

describe("simple edits work from the deck's saved cards", () => {
  test("a run saves every card of both lists", async () => {
    const cards = await readCards(slug);
    for (const file of ["initial.txt", "optimized.txt"] as const) {
      const { deck } = await loadDeck(slug, file);
      for (const c of [...deck.commanders, ...deck.slots.map((s) => s.card)])
        assert.deepEqual(cards.get(c.name), c, `${c.name} (${file})`);
    }
  });

  test("cutting a card, or adding one the deck already knows, asks nothing of Scryfall or Spellbook", async () => {
    const report = (await readReport(slug))!;
    const land = report.decklist!.find((c) => c.name === "Forest")!;
    assert.ok(land, "the deck plays Forests");
    const cut = await requestsDuring(() =>
      applyDeckChanges(
        slug,
        [{ action: "remove", name: "Forest", qty: 1, reason: "" }],
        "cut a Forest",
      ),
    );
    assert.deepEqual(cut, []);
    // A card the suggestions swapped out: in the submitted list, so its card is saved.
    const cards = await readCards(slug);
    const identity = new Set(report.commanderCards.flatMap((c) => c.colorIdentity));
    const out = report.swaps.find((s) =>
      cards.get(s.out)?.colorIdentity.every((c) => identity.has(c)),
    )!.out;
    const added = await requestsDuring(() =>
      applyDeckChanges(
        slug,
        [
          {
            action: "remove",
            name: report.swaps.find((s) => s.out === out)!.in,
            qty: 1,
            reason: "",
          },
          { action: "add", name: out, qty: 1, reason: "" },
        ],
        `put ${out} back`,
      ),
    );
    assert.deepEqual(added, []);
    assert.ok((await readReport(slug))!.decklist!.some((c) => c.name === out));
  });

  test("a suggested swap's Apply takes its cards from the swap: nothing to look up", async () => {
    const swap = (await readReport(slug))!.swaps.find((s) => s.inCard && s.outCard)!;
    const made = await requestsDuring(async () => {
      const id = await applySwap(slug, swap.out, swap.in);
      while (["queued", "running"].includes(editStatus(id)!.state.kind))
        await new Promise((r) => setTimeout(r, 5));
      assert.deepEqual(editStatus(id)!.state, { kind: "done" });
    });
    assert.deepEqual(made, []);
    const report = (await readReport(slug))!;
    assert.ok(report.original!.decklist.some((c) => c.name === swap.in));
    assert.ok((await readCards(slug)).has(swap.in));
  });
});
