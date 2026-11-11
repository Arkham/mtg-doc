import "../support/env.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import sharp from "sharp";
import type { RecognitionResult } from "../../shared/types.ts";
import { startLlmStub } from "../support/llm-stub.ts";

// Point the app at the stub before any server module reads its config.
const stub = await startLlmStub();
process.env.LLM_BASE_URL = stub.url;
process.env.LLM_API_KEY = "stub-key";
process.env.LLM_WEB_SEARCH = "true";
const { recognizeImages } = await import("../../server/ocr.ts");
const { optimizeFixtureDeck } = await import("../support/sample.ts");

after(() => stub.close());

describe("pipeline with an LLM (stubbed Responses API)", () => {
  test("web research, solver review and validation of LLM swaps", async () => {
    const { report, job } = await optimizeFixtureDeck("lathril-overpowered.txt", {
      bracket: 3,
      tone: "max",
      budgetTotal: 300,
      webResearch: true,
    });
    assert.equal(job.steps.find((s) => s.label === "Web research")!.status, "done");
    assert.ok(report.research);
    assert.deepEqual(report.research.sources, [
      { url: "https://edhrec.com/commanders/lathril-blade-of-the-elves", title: "EDHREC" },
    ]);
    assert.deepEqual(report.research.cardsMentioned, ["Elvish Archdruid", "Priest of Titania"]);
    for (const name of report.research.cardsMentioned)
      assert.ok(report.cardIndex![name]?.image, `${name} from the research has a preview`);

    assert.equal(report.model, "gpt-6.1-sol");
    assert.equal(report.strategy, "Stub strategy: go wide with elves.");
    assert.ok(
      report.warnings.some((w) => w.includes("Card Not In Deck")),
      "invalid LLM swap was rejected",
    );
    assert.ok(report.swaps.some((s) => s.reason.startsWith("Stub review keeps")));
    assert.ok(report.bracket!.after.bracket <= 3);
    assert.deepEqual(
      report.synergies!.map((x) => x.cards),
      [
        ["Sol Ring", "Lathril, Blade of the Elves"],
        ["Lathril, Blade of the Elves", "Forest"],
      ],
      "names normalized to the deck, invented cards dropped",
    );
    assert.equal(job.steps.find((s) => s.label === "Find synergies")!.status, "done");
    assert.ok(report.after.totalPriceUsd <= 300);

    const review = stub.requests.find((r) =>
      r.text.includes("constraint solver has proposed swaps"),
    )!;
    assert.deepEqual(review.body.text, { format: { type: "json_object" } });
    assert.match(review.text, /Target: Bracket 3 \(Upgraded\), tone "max"/);
    assert.match(review.text, /DECK BUDGET/);
    assert.match(review.text, /Game Changer slots/);
  });

  test("a screenshot-sized image is read twice and both reads must agree", async () => {
    const photo = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#2b4a2b" },
    })
      .jpeg()
      .toBuffer();
    const before = stub.requests.length;
    const r = await recognizeImages([photo]);
    const calls = stub.requests.slice(before);
    assert.equal(calls.filter((c) => c.text.includes("reading a photo or screenshot")).length, 2);
    assert.deepEqual(r.commanders, ["Lathril, Blade of the Elves"]);
    const elves = r.entries.find((e) => e.raw === "Llanowar Elfs")!;
    assert.equal(elves.name, "Llanowar Elves");
    assert.equal(elves.status, "fuzzy", "a misspelled read is flagged for review");
    const boots = r.entries.find((e) => e.name === "Swiftfoot Boots")!;
    assert.equal(boots.lang, "it");
    assert.equal(boots.raw, "Stivali Piedelesto");
    assert.ok(r.notes.includes("Read from a test photo."));
    assert.ok(r.notes.some((n) => n.includes("Divination") && n.includes("color identity")));
  });

  test("a deck photo: tiled passes, voting, verification and progress via the API job", async () => {
    const { createApp } = await import("../../server/app.ts");
    const server = createApp().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const photo = await sharp({
        create: { width: 4032, height: 3024, channels: 3, background: "#2b2b4a" },
      })
        .jpeg()
        .toBuffer();
      const form = new FormData();
      form.append("images", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "deck.jpg");
      const started = await fetch(`${base}/api/recognize`, { method: "POST", body: form });
      assert.equal(started.status, 202);
      const { jobId } = (await started.json()) as { jobId: string };

      const phases = new Set<string>();
      let job: {
        status: string;
        phase: string;
        result?: RecognitionResult & { uploadToken: string };
        error?: string;
      };
      for (;;) {
        job = await (await fetch(`${base}/api/recognize/${jobId}`)).json();
        phases.add(job.phase);
        if (job.status !== "running") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(job.status, "done", job.error ?? "");
      const r = job.result!;
      assert.ok(r.uploadToken);
      assert.ok(
        [...phases].some(
          (p) =>
            p === "Reading cards" ||
            p === "Double-checking uncertain cards" ||
            p === "Matching card names",
        ),
      );

      const byName = new Map(r.entries.map((e) => [e.name, e]));
      assert.equal(byName.get("Llanowar Elves")!.votes, 3, "whole photo + both tilings");
      assert.equal(
        byName.get("Llanowar Elves")!.status,
        "exact",
        "an exact printed-name match outweighs one misspelled read",
      );
      assert.equal(byName.get("Swiftfoot Boots")!.votes, 3);
      assert.equal(byName.get("Lightning Greaves")!.confidence, 0.92, "confirmed by verification");
      assert.equal(byName.get("Lightning Greaves")!.status, "exact");
      assert.equal(
        byName.get("Divination")!.status,
        "fuzzy",
        "verified but unsure: flagged for review",
      );
      assert.equal(byName.has("Counterspell"), false, "a hallucination is rejected");
      assert.ok(r.notes.some((n) => n.includes("Ignored 1 card") && n.includes("Counterspell")));
      assert.ok(r.notes.some((n) => n.includes("aren't in English")));

      const verify = stub.requests.filter((x) => Array.isArray(x.body.questions));
      assert.ok(verify.length > 0);
      assert.ok(verify.every((x) => x.body.model === "gpt-6-luna"));
      const tiles = stub.requests.filter((x) => x.text.includes("This is a crop of a photo"));
      assert.equal(tiles.length, 6 + 12, "3x2 and 4x3 tilings of a 12MP photo");
    } finally {
      server.close();
    }
  });

  test("deck chat proposes a re-run, and only starts it once the user confirms", async () => {
    const { chatAboutDeck, startChatRerun } = await import("../../server/chat.ts");
    const { readMeta } = await import("../../server/storage.ts");
    const { getJob } = await import("../../server/pipeline.ts");
    const { slug } = await optimizeFixtureDeck("lathril.txt", { bracket: 3, maxSwaps: 4 });

    const proposal = await chatAboutDeck(slug, "can you make it bracket 2?");
    assert.deepEqual(proposal.rerun?.options, { bracket: 2 });
    assert.match(proposal.rerun!.summary, /bracket 2 \(Core\)/);
    assert.equal(proposal.rerun!.jobId, undefined, "nothing starts before confirming");
    assert.equal(proposal.changes, undefined, "a re-run replaces card changes");
    assert.equal((await readMeta(slug)).options.bracket, 3);

    const unsure = await chatAboutDeck(slug, "hmm, what would that cut?");
    assert.equal(unsure.rerun, undefined, "a question isn't a confirmation");

    await chatAboutDeck(slug, "can you make it bracket 2?");
    const confirmed = await chatAboutDeck(slug, "yes please");
    assert.ok(confirmed.rerun?.jobId);
    assert.equal((await readMeta(slug)).options.bracket, 2);
    await new Promise<void>((resolve) => {
      const wait = () =>
        getJob(confirmed.rerun!.jobId!)?.status === "running" ? setTimeout(wait, 100) : resolve();
      wait();
    });
    assert.equal(getJob(confirmed.rerun!.jobId!)!.status, "done");
    await assert.rejects(startChatRerun(slug, confirmed.id), /already started/);
  });

  test("everything the report UI can change, the chat can too", async () => {
    const { chatAboutDeck } = await import("../../server/chat.ts");
    const { readReport } = await import("../../server/storage.ts");
    const { slug } = await optimizeFixtureDeck("lathril.txt", { bracket: 3, maxSwaps: 4 });

    // Re-run with the same settings (the "Re-run" form without changes).
    const again = await chatAboutDeck(slug, "run it again please");
    assert.deepEqual(again.rerun, { options: {}, summary: "the current settings" });

    // Find synergies again (the Synergies panel button).
    const before = (await readReport(slug))!;
    const refreshed = await chatAboutDeck(slug, "find the synergies again");
    assert.equal(refreshed.reportUpdated, true);
    const after = (await readReport(slug))!;
    assert.ok(after.synergies!.length > 0);
    assert.deepEqual(after.decklist, before.decklist, "the list itself doesn't change");

    // Find more synergies: keeps the current ones and adds only new card groups.
    const more = await chatAboutDeck(slug, "can you find more synergies?");
    assert.equal(more.reportUpdated, true);
    const withMore = (await readReport(slug))!;
    const titles = withMore.synergies!.map((x) => x.title);
    assert.deepEqual(
      titles.slice(0, after.synergies!.length),
      after.synergies!.map((x) => x.title),
    );
    assert.ok(
      withMore.decklist!.some((c) => c.name === "Arcane Signet"),
      "fixture keeps the Signet",
    );
    assert.ok(titles.includes("Signet into the commander"));
    assert.ok(!titles.includes("Repeat of a known one"), "duplicates are skipped");
    assert.match(more.content, /new synerg|didn't find any new/);
    const prompt = stub.requests.findLast((q) => q.text.includes("more notable synergies"))!.text;
    assert.match(prompt, /different from the ones already found/);

    // Apply a suggested land swap (the Mana panel button): the doc sees the suggestions.
    const { config } = await import("../../server/config.ts");
    const file = path.join(config.decksDir, slug, "report.json");
    const withSuggestion = {
      ...after,
      manaSuggestions: [
        {
          id: "s1",
          reason: "Stub reason.",
          changes: [
            { action: "remove", name: "Forest", qty: 1, reason: "", ok: true },
            { action: "add", name: "Llanowar Wastes", qty: 1, reason: "", ok: true },
          ],
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(withSuggestion));
    await chatAboutDeck(slug, "apply the suggested land swaps");
    const context = stub.requests.at(-1)!.text;
    assert.match(context, /Suggested land swaps[^]*remove Forest, add Llanowar Wastes/);
    assert.match(context, /web research (on|off)/);
  });

  test("deck chat: model proposals, and a content-filter refusal falls back to simple commands", async () => {
    const { chatAboutDeck } = await import("../../server/chat.ts");
    const { slug } = await optimizeFixtureDeck("lathril.txt", {
      bracket: 3,
      tone: "balanced",
      maxSwaps: 4,
    });

    const proposal = await chatAboutDeck(slug, "Give me a fairer mana rock");
    assert.equal(proposal.content, "Stub chat: trade Sol Ring for a fairer rock.");
    assert.deepEqual(
      proposal.changes!.map((c) => [c.action, c.name, c.ok]),
      [
        ["remove", "Sol Ring", true],
        ["add", "Mind Stone", true],
      ],
    );
    const chatCall = stub.requests.at(-1)!;
    assert.match(chatCall.text, /Lathril, Blade of the Elves/, "deck context is sent");
    assert.match(chatCall.text, /Give me a fairer mana rock/);
    assert.match(chatCall.text, /looking at the doc's suggested \(optimized\) deck/);
    assert.equal(proposal.target, "optimized");

    // On "Your deck" the doc sees the list as submitted, without the bracket and budget limits.
    await chatAboutDeck(slug, "What are this deck's weaknesses?", "original");
    const original = stub.requests.at(-1)!.text;
    assert.match(original, /looking at their deck as submitted/);
    assert.match(original, /target bracket and budget don't limit changes to it/);

    const fallback = await chatAboutDeck(slug, "swap Sol Ring for Fellwar Stone");
    assert.deepEqual(
      fallback.changes!.map((c) => [c.action, c.name, c.ok]),
      [
        ["remove", "Sol Ring", true],
        ["add", "Fellwar Stone", true],
      ],
    );

    const refused = await chatAboutDeck(slug, "tell me something risky");
    assert.match(refused.content, /content filter/);
    assert.equal(refused.changes, undefined);

    // Applying the proposal looks for synergies with the card that came in, and lists the swap.
    const { applyChatChanges } = await import("../../server/chat.ts");
    const { report } = await applyChatChanges(slug, proposal.id);
    const found = report.synergies!.filter((x) => x.cards.includes("Mind Stone"));
    assert.deepEqual(
      found.map((x) => x.title),
      ["Rock into the commander"],
    );
    assert.ok(!report.synergies!.some((x) => x.title === "Doesn't involve the new card"));
    assert.match(
      stub.requests.findLast((q) => q.text.includes("were just added"))!.text,
      /were just added to this Commander deck: Mind Stone\./,
    );
    const swap = report.swaps.find((x) => x.in === "Mind Stone")!;
    assert.deepEqual([swap.out, swap.fromChat], ["Sol Ring", true]);
  });
});
