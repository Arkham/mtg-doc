import "../support/env.ts";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../server/app.ts";
import { parseDecklist } from "../../server/decklist.ts";
import { readDeckFile } from "../../server/storage.ts";
import type { DeckChatMessage, EditTarget, Report } from "../../shared/types.ts";
import { optimizeFixtureDeck, waitForJob } from "../support/sample.ts";

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
    // report.md (and the published plain page built from it) follows the edited list.
    const md = await readDeckFile(slug, "report.md");
    assert.match(md, /## Changes from chat[\s\S]*Mind Stone/);
    const suggested = md.split("## Suggested deck list")[1].split("\n## ")[0];
    assert.match(suggested, /- 1 Mind Stone .*_\(new\)_/);
    assert.doesNotMatch(suggested, /Sol Ring/);
    assert.match(md.split("## Deck list as submitted")[1].split("\n## ")[0], /- 1 Sol Ring/);

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

  test("mana suggestions are recomputed after edits and can be applied", async () => {
    const detail = (await (await fetch(`${base}/api/decks/${slug}`)).json()) as { report: Report };
    const suggestions = detail.report.manaSuggestions!;
    assert.ok(Array.isArray(suggestions), "recomputed by the previous edit");
    if (!suggestions.length) return;
    const [first] = suggestions;
    const res = await fetch(`${base}/api/decks/${slug}/mana-suggestions/${first.id}/apply`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
    const report = (await res.json()) as Report;
    const added = first.changes.find((c) => c.action === "add")!.name;
    assert.ok(report.decklist!.some((c) => c.name === added));
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
    assert.equal(history.length, 9);
    assert.equal(history[1].applied, true);
    // Swapping a Forest for a creature widened the land shortfall, so the doc offered a re-run.
    assert.match(history[4].content, /lands, under the recommended/);
    assert.equal(history[4].rerun?.keepEdits, true);
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
      reply.changes!.every((c) => c.ok),
      JSON.stringify(reply.changes),
    );
    const { report } = (await (await apply(reply.id)).json()) as { report: Report };

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
    const table = md.split("## Swaps")[1].split("\n## ")[0];
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
      reply.changes!.every((c) => c.ok),
      JSON.stringify(reply.changes),
    );
    const { report } = (await (await apply(reply.id)).json()) as { report: Report };

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
    assert.match(await readDeckFile(slug, "report.md"), /\(your deck\) “swap /);
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
      reply.changes!.every((c) => c.ok),
      JSON.stringify(reply.changes),
    );
    const applied = (await (await post(`/chat/${reply.id}/apply`, {})).json()) as {
      report: Report;
      followUp?: DeckChatMessage;
    };
    const offer = applied.followUp!;
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
    assert.equal(job.status, "done", job.error ?? "");
    const { report } = (await (await at("")).json()) as { report: Report };
    const inDeck = new Set(report.decklist!.map((c) => c.name));
    for (const rock of ["Fellwar Stone", "Thought Vessel", "Mind Stone"])
      assert.ok(inDeck.has(rock), `${rock} survives the re-run`);
    assert.equal(report.edits!.length, 1, "the edit history is kept");
    assert.ok(report.swaps.some((s) => s.in === "Mind Stone" && s.fromChat));
    assert.ok(
      report.after.mana.landCount > applied.report.after.mana.landCount,
      "the re-run rebalanced the lands around the edit",
    );
  });
});
