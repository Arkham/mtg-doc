import "../support/env.ts";
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import sharp from "sharp";
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

    assert.equal(report.model, "gpt-5.4");
    assert.equal(report.strategy, "Stub strategy: go wide with elves.");
    assert.deepEqual(report.manaNotes, ["Stub mana note."]);
    assert.ok(
      report.warnings.some((w) => w.includes("Card Not In Deck")),
      "invalid LLM swap was rejected",
    );
    assert.ok(report.swaps.some((s) => s.reason.startsWith("Stub review keeps")));
    assert.ok(report.bracket!.after.bracket <= 3);
    assert.ok(report.after.totalPriceUsd <= 300);

    const review = stub.requests.find((r) =>
      r.text.includes("constraint solver has proposed swaps"),
    )!;
    assert.deepEqual(review.body.text, { format: { type: "json_object" } });
    assert.match(review.text, /Target: Bracket 3 \(Upgraded\), tone "max"/);
    assert.match(review.text, /DECK BUDGET/);
    assert.match(review.text, /Game Changer slots/);
  });

  test("photo recognition resolves OCR names and finds the commander", async () => {
    const photo = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#2b4a2b" },
    })
      .jpeg()
      .toBuffer();
    const r = await recognizeImages([photo]);
    assert.deepEqual(r.commanders, ["Lathril, Blade of the Elves"]);
    const elves = r.entries.find((e) => e.raw === "Llanowar Elfs")!;
    assert.equal(elves.name, "Llanowar Elves");
    assert.equal(elves.status, "fuzzy");
    assert.ok(r.notes.includes("Read from a test photo."));
    assert.ok(
      r.notes.some((n) => n.includes("Divination")),
      "off-color note",
    );
    const vision = stub.requests.find((x) =>
      (x.body.input as { content: { type: string }[] }[])[0].content.some(
        (p) => p.type === "input_image",
      ),
    )!;
    assert.equal(vision.body.model, "gpt-5.4");
  });
});
