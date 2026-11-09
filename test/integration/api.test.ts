import "../support/env.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../server/app.ts";
import type { Job, RecognitionResult } from "../../shared/types.ts";

let base = "";
let close: () => void;

before(async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => close());

const json = async <T>(res: Response) => ({ status: res.status, body: (await res.json()) as T });
const post = (url: string, body: unknown) =>
  fetch(base + url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("HTTP API", () => {
  test("GET /api/config reports LLM status", async () => {
    const { body } = await json<{ llm: boolean; webResearch: boolean }>(
      await fetch(`${base}/api/config`),
    );
    assert.deepEqual([body.llm, body.webResearch], [false, false]);
  });

  test("recognize → save → optimize → report", async () => {
    const text = fs.readFileSync(
      path.resolve(import.meta.dirname, "../fixtures/decks/lathril.txt"),
      "utf8",
    );
    const form = new FormData();
    form.append("text", text);
    const rec = await json<RecognitionResult>(
      await fetch(`${base}/api/recognize`, { method: "POST", body: form }),
    );
    assert.equal(rec.status, 200);
    assert.deepEqual(rec.body.commanders, ["Lathril, Blade of the Elves"]);

    const saved = await json<{ slug: string; jobId: string }>(
      await post("/api/decks", {
        format: "commander",
        commanders: rec.body.commanders,
        deckName: null,
        entries: rec.body.entries.map((e) => ({ name: e.name, qty: e.qty })),
        options: { maxSwaps: 6, bracket: 2, tone: "balanced", webResearch: false },
      }),
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.slug, "lathril-blade-of-the-elves");

    let job: Job;
    for (;;) {
      job = (await json<Job>(await fetch(`${base}/api/jobs/${saved.body.jobId}`))).body;
      if (job.status !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(job.status, "done", job.error ?? "");

    const decks = await json<{ slug: string; hasReport: boolean; bracket?: number }[]>(
      await fetch(`${base}/api/decks`),
    );
    const listed = decks.body.find((d) => d.slug === saved.body.slug)!;
    assert.equal(listed.hasReport, true);
    assert.equal(listed.bracket, 2);

    const detail = await json<{ report: { bracket: { target: number } }; initial: string }>(
      await fetch(`${base}/api/decks/${saved.body.slug}`),
    );
    assert.equal(detail.body.report.bracket.target, 2);
    assert.match(detail.body.initial, /^Commander\n1 Lathril/);

    const optimized = await fetch(`${base}/api/decks/${saved.body.slug}/files/optimized.txt`);
    assert.equal(optimized.headers.get("content-type")?.split(";")[0], "text/plain");
    assert.match(await optimized.text(), /^Commander\n/);

    const rerun = await json<{ jobId: string }>(
      await post(`/api/decks/${saved.body.slug}/optimize`, {
        options: { maxSwaps: 3, bracket: 2, tone: "casual", webResearch: false },
      }),
    );
    assert.equal(rerun.status, 200);
    assert.ok(rerun.body.jobId);
  });

  test("validation and not-found errors", async () => {
    const empty = await fetch(`${base}/api/recognize`, { method: "POST", body: new FormData() });
    assert.equal(empty.status, 400);

    const noCommander = await post("/api/decks", {
      format: "commander",
      commanders: [],
      entries: [{ name: "Sol Ring", qty: 1 }],
      options: {},
    });
    assert.equal(noCommander.status, 400);

    const badShape = await post("/api/decks", { format: "nope" });
    assert.equal(badShape.status, 400);
    assert.match((await badShape.json()).error, /format/);

    const imageWithoutLlm = new FormData();
    imageWithoutLlm.append(
      "images",
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      "x.png",
    );
    assert.equal(
      (await fetch(`${base}/api/recognize`, { method: "POST", body: imageWithoutLlm })).status,
      400,
    );

    assert.equal((await fetch(`${base}/api/decks/no-such-deck`)).status, 404);
    assert.equal((await fetch(`${base}/api/decks/BAD_SLUG!`)).status, 400);
    assert.equal((await fetch(`${base}/api/decks/x/files/secret.txt`)).status, 400);
    assert.equal((await fetch(`${base}/api/jobs/nope`)).status, 404);
  });
});
