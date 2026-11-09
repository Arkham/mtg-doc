import "../support/env.ts";
import assert from "node:assert/strict";
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
  });
});
