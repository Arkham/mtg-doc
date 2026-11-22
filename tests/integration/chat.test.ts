import "../support/env.ts";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../src/server/app.ts";
import { parseDecklist } from "../../src/server/decklist.ts";
import { readDeckFile } from "../../src/server/storage.ts";
import type {
  DeckChatMessage,
  DeckDetail,
  EditStatus,
  EditTarget,
  Report,
} from "../../src/shared/types.ts";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../src/server/config.ts";
import { whenIdle } from "../../src/server/edit-queue.ts";
import { optimizeFixtureDeck, waitForJob } from "../support/sample.ts";
import { mdSection } from "../support/markdown.ts";

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

const say = async (message: string, view: EditTarget = "optimized") => {
  const res = await fetch(`${base}/api/decks/${slug}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, view }),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as DeckChatMessage;
};
const apply = (id: string) =>
  fetch(`${base}/api/decks/${slug}/chat/${id}/apply`, { method: "POST" });

/** Edits run in the background: checks one was queued, waits for it, and reads back the deck. */
async function applied(res: globalThis.Response, deck = slug) {
  assert.equal(res.status, 202, "queued, not made while the request waits");
  const { editId } = (await res.json()) as { editId: string };
  await whenIdle(deck);
  const edit = (await (await fetch(`${base}/api/edits/${editId}`)).json()) as EditStatus;
  assert.deepEqual(edit.state, { kind: "done" });
  const { report } = (await (await fetch(`${base}/api/decks/${deck}`)).json()) as {
    report: Report;
  };
  const chat = (await (await fetch(`${base}/api/decks/${deck}/chat`)).json()) as DeckChatMessage[];
  return { report, chat };
}

describe("deck chat without an LLM", () => {
  test("a swap is proposed, validated and applied to the deck and report", async () => {
    const reply = await say("swap Sol Ring for Mind Stone");
    assert.deepEqual(
      reply.changes!.map((c) => [c.action, c.name, !c.problem]),
      [
        ["remove", "Sol Ring", true],
        ["add", "Mind Stone", true],
      ],
    );

    const res = await apply(reply.id);
    const { report, chat } = await applied(res);
    const message = chat.find((m) => m.id === reply.id)!;
    assert.deepEqual(message.apply, { kind: "applied" });
    assert.equal(report.after.totalCards, 100);
    assert.ok(report.decklist!.some((c) => c.name === "Mind Stone" && c.isNew));
    assert.ok(!report.decklist!.some((c) => c.name === "Sol Ring"));
    assert.equal(report.edits!.at(-1)!.request, "swap Sol Ring for Mind Stone");
    assert.ok(report.bracket!.after.checks.length > 0, "bracket re-checked");

    const list = parseDecklist(await readDeckFile(slug, "optimized.txt"));
    assert.ok(list.entries.some((e) => e.name === "Mind Stone"));
    assert.ok(!list.entries.some((e) => e.name === "Sol Ring"));
    // report.md (and the published plain page built from it) follows the edited list.
    const md = await readDeckFile(slug, "report.md");
    assert.match(mdSection(md, /^Changes from chat$/), /Mind Stone/);
    const suggested = mdSection(md, /^Suggested decklist/);
    assert.match(suggested, /- 1 Mind Stone .*_\(new\)_/);
    assert.doesNotMatch(suggested, /Sol Ring/);
    const submitted = mdSection(mdSection(md, /^Part 1: /), /^Decklist /);
    assert.match(submitted, /- 1 Sol Ring/);
    assert.doesNotMatch(submitted, /Mind Stone/, "the suggestion isn't in the deck as submitted");

    assert.equal((await apply(reply.id)).status, 409, "can't apply twice");
  });

  test("the chat keeps going while an edit is applied, and neither loses the other's messages", async () => {
    const reply = await say("swap Forest for Arcane Signet");
    const res = await apply(reply.id);
    assert.equal(res.status, 202);
    const { message } = (await res.json()) as { message: DeckChatMessage };
    assert.deepEqual(message.apply, { kind: "applying" }, "shows as applying right away");
    const detail = (await (await fetch(`${base}/api/decks/${slug}`)).json()) as DeckDetail;
    assert.deepEqual(detail.changes, { kind: "updating" }, "the report says it's updating");
    // Sent while the edit runs: its reply and the edit both land in the history.
    const meanwhile = await say("what are this deck's weaknesses?");
    await whenIdle(slug);
    const chat = (await (
      await fetch(`${base}/api/decks/${slug}/chat`)
    ).json()) as DeckChatMessage[];
    assert.deepEqual(chat.find((m) => m.id === reply.id)!.apply, { kind: "applied" });
    assert.ok(chat.some((m) => m.id === meanwhile.id));
    assert.ok(chat.some((m) => m.content === "what are this deck's weaknesses?"));
    const after = (await (await fetch(`${base}/api/decks/${slug}`)).json()) as DeckDetail & {
      report: Report;
    };
    assert.notDeepEqual(after.changes, { kind: "updating" });
    assert.ok(after.report.decklist!.some((c) => c.name === "Arcane Signet"));
  });

  test("an edit cut short by a restart says so instead of spinning forever", async () => {
    const file = path.join(config.decksDir, slug, "chat.json");
    const chat = JSON.parse(await fs.readFile(file, "utf8")) as DeckChatMessage[];
    const stuck = {
      ...chat.findLast((m) => m.changes)!,
      id: "stuck",
      apply: { kind: "applying" },
    };
    await fs.writeFile(file, JSON.stringify([...chat, stuck]));
    const read = (await (
      await fetch(`${base}/api/decks/${slug}/chat`)
    ).json()) as DeckChatMessage[];
    const message = read.find((m) => m.id === "stuck")!;
    assert.equal(message.apply?.kind, "failed");
    assert.match(message.apply?.kind === "failed" ? message.apply.error : "", /Interrupted/);
    await fs.writeFile(file, JSON.stringify(chat, null, 2));
  });

  test("applying edits recomputes combos", async () => {
    // Add the missing piece of a combo the deck is one card away from.
    const piece = optimized.combosOneAway[0].missing[0];
    const reply = await say(`swap Forest for ${piece}`);
    assert.deepEqual(
      reply.changes!.map((c) => [c.action, c.name, !c.problem]),
      [
        ["remove", "Forest", true],
        ["add", piece, true],
      ],
    );
    const { report } = await applied(await apply(reply.id));
    assert.ok(
      report.combosPresent.some((c) => c.cards.includes(piece)),
      `${piece} now completes a combo in the deck`,
    );
    assert.ok(!report.combosOneAway.some((c) => c.missing[0] === piece), "no longer one card away");
    assert.ok(report.cardIndex![piece]?.image, "new combo cards have previews");
  });

  test("mana suggestions are recomputed after edits and can be applied", async () => {
    const detail = (await (await fetch(`${base}/api/decks/${slug}`)).json()) as { report: Report };
    const suggestions = detail.report.manaSuggestions!;
    assert.ok(Array.isArray(suggestions), "recomputed by the previous edit");
    if (!suggestions.length) return;
    const [first] = suggestions;
    const recommended = detail.report.before.mana.recommendedLands;
    const { report } = await applied(
      await fetch(`${base}/api/decks/${slug}/mana-suggestions/${first.id}/apply`, {
        method: "POST",
      }),
    );
    const added = first.changes.find((c) => c.action === "add")!.name;
    assert.ok(report.decklist!.some((c) => c.name === added));
    const submitted = parseDecklist(await readDeckFile(slug, "initial.txt")).entries;
    assert.ok(
      submitted.some((e) => e.name === added),
      "made in the deck as submitted",
    );
    assert.equal(report.edits!.at(-1)!.target, "original");
    assert.equal(report.before.totalCards, 100);
    assert.equal(report.after.totalCards, 100);
    assert.ok(report.edhrec?.avgLands, "the fixture has an EDHREC land average to blend in");
    assert.equal(
      report.before.mana.recommendedLands,
      recommended,
      "a land swap keeps the land recommendation, EDHREC average included",
    );
    assert.match(report.edits!.at(-1)!.request, /^Mana base:/);
    assert.ok(
      !report.manaSuggestions!.some((m) => m.id === first.id),
      "applied suggestion is gone",
    );
    const again = await fetch(`${base}/api/decks/${slug}/mana-suggestions/${first.id}/apply`, {
      method: "POST",
    });
    assert.equal(again.status, 404);
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
    assert.deepEqual(history.at(-1), reply);
    assert.equal(history.at(-2)!.content, "make it better please");
    const swap = history.find((m) => m.changes?.some((c) => c.name === "Mind Stone"))!;
    assert.deepEqual(swap.apply, { kind: "applied" });
    // Swapping a Forest for a creature widened the land shortfall, so the doc offered a re-run.
    const offer = history.find((m) => m.rerun)!;
    assert.match(offer.content, /lands, under the recommended/);
    assert.equal(offer.rerun!.keepEdits, true);
  });

  test("putting a cut card back updates the swaps and everything built from them", async () => {
    const { report: current } = (await (await fetch(`${base}/api/decks/${slug}`)).json()) as {
      report: Report;
    };
    const swapped = new Set(current.swaps.flatMap((s) => [s.out, s.in]));
    const undone = current.swaps.find(
      (s) => !s.fromChat && !["bracket", "combo"].includes(s.category) && !s.outCard?.isLand,
    )!;
    const filler = current.decklist!.find(
      (c) =>
        !c.isNew &&
        c.delta === 0 &&
        !["Commander", "Land"].includes(c.group) &&
        !swapped.has(c.name),
    )!.name;

    const reply = await say(`swap ${filler} for ${undone.out}`);
    assert.ok(
      reply.changes!.every((c) => !c.problem),
      JSON.stringify(reply.changes),
    );
    const { report } = await applied(await apply(reply.id));

    assert.ok(
      !report.swaps.some((s) => s.out === undone.out || s.in === undone.out),
      `${undone.out} is back in the deck, so no swap cuts it`,
    );
    const repaired = report.swaps.find((s) => s.in === undone.in)!;
    assert.deepEqual([repaired.out, repaired.fromChat], [filler, true]);
    assert.equal(repaired.outCard?.name, filler, "the cut shows the card it cuts");
    // The swaps are exactly the difference between the submitted and current lists.
    const now = new Map(report.decklist!.map((c) => [c.name, c]));
    const before = new Set(report.original!.decklist.map((c) => c.name));
    for (const s of report.swaps) {
      assert.ok(!now.has(s.out) || now.get(s.out)!.delta < 0, `${s.out} is cut`);
      assert.ok(now.get(s.in)?.isNew || now.get(s.in)!.delta > 0, `${s.in} is new`);
    }
    const cut = report.original!.decklist.filter((c) => !now.has(c.name)).length;
    const added = report.decklist!.filter((c) => c.isNew).length;
    assert.equal(report.swaps.filter((s) => !now.has(s.out)).length, cut);
    assert.equal(report.swaps.filter((s) => !before.has(s.in)).length, added);

    const md = await readDeckFile(slug, "report.md");
    const table = mdSection(md, /^Suggested swaps/);
    assert.match(table, new RegExp(`\\| ${filler} \\| ${undone.in} \\| chat edit \\|`));
    assert.doesNotMatch(table, new RegExp(`\\| ${undone.out} \\|`));
  });

  test("on the deck as submitted, chat edits that list and rebuilds the suggestions from it", async () => {
    const { report: current } = (await (await fetch(`${base}/api/decks/${slug}`)).json()) as {
      report: Report;
    };
    const swapped = new Set(current.swaps.flatMap((s) => [s.out, s.in]));
    const inBoth = current.original!.decklist.find(
      (c) =>
        !["Commander", "Land"].includes(c.group) &&
        !swapped.has(c.name) &&
        current.decklist!.some((d) => d.name === c.name),
    )!.name;
    const cutByDoc = current.swaps.find((s) => !s.fromChat && !s.outCard?.isLand)!;

    const reply = await say(
      `swap ${inBoth} for Wayfarer's Bauble; swap ${cutByDoc.out} for Commander's Sphere`,
      "original",
    );
    assert.equal(reply.target, "original");
    assert.ok(
      reply.changes!.every((c) => !c.problem),
      JSON.stringify(reply.changes),
    );
    const { report } = await applied(await apply(reply.id));

    const submitted = parseDecklist(await readDeckFile(slug, "initial.txt")).entries.map(
      (e) => e.name,
    );
    for (const name of ["Wayfarer's Bauble", "Commander's Sphere"]) {
      assert.ok(submitted.includes(name), `${name} is in the submitted list`);
      assert.ok(report.original!.decklist.some((c) => c.name === name));
    }
    assert.ok(!submitted.includes(inBoth) && !submitted.includes(cutByDoc.out));
    assert.equal(report.before.totalCards, 100);

    const suggested = new Map(report.decklist!.map((c) => [c.name, c]));
    // A change to a card the doc kept carries through to the suggestions, and isn't "new" there.
    assert.equal(suggested.get("Wayfarer's Bauble")?.isNew, false);
    assert.ok(!suggested.has(inBoth));
    // Replacing a card the doc cut drops that swap: the user's pick takes the slot.
    assert.ok(suggested.has("Commander's Sphere"));
    assert.ok(!suggested.has(cutByDoc.in), `${cutByDoc.in} no longer comes in`);
    assert.ok(!report.swaps.some((s) => s.out === cutByDoc.out));
    assert.equal(report.after.totalCards, 100);
    assert.equal(report.edits!.at(-1)!.target, "original");
    assert.match(await readDeckFile(slug, "report.md"), /\(made in the deck as submitted\) “swap /);
  });

  test("a swap's Apply button makes it in the deck as submitted, and the suggestions stay", async () => {
    const { report: current } = (await (await fetch(`${base}/api/decks/${slug}`)).json()) as {
      report: Report;
    };
    const swap = current.swaps.find((s) => !s.fromChat && !s.outCard?.isLand)!;
    const applySwap = (body: unknown) =>
      fetch(`${base}/api/decks/${slug}/swaps/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const { report } = await applied(await applySwap({ out: swap.out, in: swap.in }));

    const submitted = parseDecklist(await readDeckFile(slug, "initial.txt")).entries.map(
      (e) => e.name,
    );
    assert.ok(submitted.includes(swap.in) && !submitted.includes(swap.out));
    assert.ok(report.original!.decklist.some((c) => c.name === swap.in));
    const list = (r: Report) => r.decklist!.map((c) => `${c.qty} ${c.name}`).sort();
    assert.deepEqual(list(report), list(current), "the suggested deck doesn't change");
    assert.equal(report.decklist!.find((c) => c.name === swap.in)!.isNew, false);
    assert.ok(!report.swaps.some((s) => s.out === swap.out && s.in === swap.in));
    assert.equal(report.swaps.length, current.swaps.length - 1, "no other swap is dropped");
    assert.equal(report.edits!.at(-1)!.target, "original");
    assert.equal(report.edits!.at(-1)!.request, `Swap: ${swap.out} → ${swap.in}`);
    assert.equal((await applySwap({ out: swap.out, in: swap.in })).status, 404);
    assert.equal((await applySwap({ out: swap.out })).status, 400);
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

  test("clearing the chat empties it, and the deck and its report stay as they are", async () => {
    const report = async () =>
      ((await (await fetch(`${base}/api/decks/${slug}`)).json()) as { report: Report }).report;
    const before = await report();
    await say("what are this deck's weaknesses?");
    const res = await fetch(`${base}/api/decks/${slug}/chat`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
    assert.deepEqual(await (await fetch(`${base}/api/decks/${slug}/chat`)).json(), []);
    assert.deepEqual(await report(), before);
    assert.equal(
      (await fetch(`${base}/api/decks/no-such-deck/chat`, { method: "DELETE" })).status,
      404,
    );
  });
});

describe("re-optimizing after a change", () => {
  test("an edit that leaves gaps gets a re-run proposal, and the re-run keeps the edit", async () => {
    const fresh = await optimizeFixtureDeck("lathril.txt", {
      bracket: 3,
      tone: "balanced",
      maxSwaps: 6,
    });
    const at = (path: string, init?: RequestInit) =>
      fetch(`${base}/api/decks/${fresh.slug}${path}`, init);
    const post = (path: string, body: unknown) =>
      at(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    // Three basics out for rocks: the land count falls well below the recommendation.
    const reply = (await (
      await post("/chat", {
        message:
          "swap Forest for Fellwar Stone; swap Forest for Thought Vessel; swap Forest for Mind Stone",
      })
    ).json()) as DeckChatMessage;
    assert.ok(
      reply.changes!.every((c) => !c.problem),
      JSON.stringify(reply.changes),
    );
    const made = await applied(await post(`/chat/${reply.id}/apply`, {}), fresh.slug);
    const offer = made.chat.at(-1)!;
    assert.ok(offer, "the doc offers to re-optimize");
    assert.match(offer.content, /lands, under the recommended/);
    // No jobId yet: nothing runs until the user confirms.
    assert.deepEqual(offer.rerun, {
      options: {},
      summary: "the current settings, keeping your edits",
      keepEdits: true,
    });

    const { jobId } = (await (await post(`/chat/${offer.id}/rerun`, {})).json()) as {
      jobId: string;
    };
    const job = await waitForJob(jobId);
    assert.deepEqual(job.status, { kind: "done" });
    const { report } = (await (await at("")).json()) as { report: Report };
    const inDeck = new Set(report.decklist!.map((c) => c.name));
    for (const rock of ["Fellwar Stone", "Thought Vessel", "Mind Stone"])
      assert.ok(inDeck.has(rock), `${rock} survives the re-run`);
    assert.equal(report.edits!.length, 1, "the edit history is kept");
    assert.ok(report.swaps.some((s) => s.in === "Mind Stone" && s.fromChat));
    assert.ok(
      report.after.mana.landCount > made.report.after.mana.landCount,
      "the re-run rebalanced the lands around the edit",
    );
  });
});
