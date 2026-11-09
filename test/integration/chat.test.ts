import "../support/env.ts";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../server/app.ts";
import { parseDecklist } from "../../server/decklist.ts";
import { readDeckFile } from "../../server/storage.ts";
import type { DeckChatMessage, Report } from "../../shared/types.ts";
import { optimizeFixtureDeck } from "../support/sample.ts";

let base = "";
let close: () => void;
let slug = "";
let optimized: Report;

before(async () => {
  ({ slug, report: optimized } = await optimizeFixtureDeck("lathril.txt", {
    bracket: 3,
    tone: "balanced",
    maxSwaps: 6,
  }));
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => close());

const say = async (message: string) => {
  const res = await fetch(`${base}/api/decks/${slug}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as DeckChatMessage;
};
const apply = (id: string) =>
  fetch(`${base}/api/decks/${slug}/chat/${id}/apply`, { method: "POST" });

describe("deck chat without an LLM", () => {
  test("a swap is proposed, validated and applied to the deck and report", async () => {
    const reply = await say("swap Sol Ring for Mind Stone");
    assert.deepEqual(
      reply.changes!.map((c) => [c.action, c.name, c.ok]),
      [
        ["remove", "Sol Ring", true],
        ["add", "Mind Stone", true],
      ],
    );

    const res = await apply(reply.id);
    assert.equal(res.status, 200);
    const { report, message } = (await res.json()) as { report: Report; message: DeckChatMessage };
    assert.equal(message.applied, true);
    assert.equal(report.after.totalCards, 100);
    assert.ok(report.decklist!.some((c) => c.name === "Mind Stone" && c.isNew));
    assert.ok(!report.decklist!.some((c) => c.name === "Sol Ring"));
    assert.equal(report.edits!.at(-1)!.request, "swap Sol Ring for Mind Stone");
    assert.ok(report.bracket!.after.checks.length > 0, "bracket re-checked");

    const list = parseDecklist(await readDeckFile(slug, "optimized.txt"));
    assert.ok(list.entries.some((e) => e.name === "Mind Stone"));
    assert.ok(!list.entries.some((e) => e.name === "Sol Ring"));
    assert.match(await readDeckFile(slug, "report.md"), /## Changes from chat[\s\S]*Mind Stone/);

    assert.equal((await apply(reply.id)).status, 409, "can't apply twice");
  });

  test("applying edits recomputes combos", async () => {
    // Add the missing piece of a combo the deck is one card away from.
    const piece = optimized.combosOneAway[0].missing[0];
    const reply = await say(`swap Forest for ${piece}`);
    assert.deepEqual(
      reply.changes!.map((c) => [c.action, c.name, c.ok]),
      [
        ["remove", "Forest", true],
        ["add", piece, true],
      ],
    );
    const res = await apply(reply.id);
    assert.equal(res.status, 200);
    const { report } = (await res.json()) as { report: Report };
    assert.ok(
      report.combosPresent.some((c) => c.cards.includes(piece)),
      `${piece} now completes a combo in the deck`,
    );
    assert.ok(!report.combosOneAway.some((c) => c.missing[0] === piece), "no longer one card away");
    assert.ok(report.cardIndex![piece]?.image, "new combo cards have previews");
  });

  test("invalid changes are rejected with a reason", async () => {
    const reply = await say(
      "add Counterspell; remove Definitely Not A Card; add Lathril, Blade of the Elves",
    );
    const byName = new Map(reply.changes!.map((c) => [c.name, c]));
    assert.match(byName.get("Counterspell")!.problem!, /color identity/);
    assert.match(
      [...byName.values()].find((c) => c.action === "remove")!.problem!,
      /not in the deck/,
    );
    assert.match(byName.get("Lathril, Blade of the Elves")!.problem!, /your commander/);
    assert.equal((await apply(reply.id)).status, 409, "nothing valid to apply");
  });

  test("free text gets help, and history persists", async () => {
    const reply = await say("make it better please");
    assert.match(reply.content, /simple edits/i);
    assert.equal(reply.changes, undefined);
    const history = (await (
      await fetch(`${base}/api/decks/${slug}/chat`)
    ).json()) as DeckChatMessage[];
    assert.equal(history.length, 8);
    assert.equal(history[1].applied, true);
  });

  test("validation errors and missing decks", async () => {
    const empty = await fetch(`${base}/api/decks/${slug}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    assert.equal(empty.status, 400);
    assert.equal((await fetch(`${base}/api/decks/no-such-deck/chat`)).status, 404);
    assert.equal((await apply("nope")).status, 404);
  });
});
