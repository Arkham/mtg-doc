import "../support/env.ts";
import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import { z } from "zod";

process.env.LLM_API_KEY = "test-key";
const llm = await import("../../server/llm.ts");

type Handler = (
  body: Record<string, unknown>,
  call: number,
) => { status?: number; json?: unknown; text?: string };
const realFetch = globalThis.fetch;
let calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];

function stub(handler: Handler) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
    const r = handler(body, calls.length);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
}

const message = (
  text: string,
  annotations: { type: string; url?: string; title?: string }[] = [],
) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text, annotations }] }],
});

before(() => assert.equal(llm.outputText(message("x")), "x"));
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("toResponsesInput", () => {
  test("maps text and images to Responses API parts by role", () => {
    const input = llm.toResponsesInput([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "image", url: "data:x", detail: "high" },
        ],
      },
      { role: "assistant", content: "previous" },
    ]);
    assert.deepEqual(input, [
      {
        role: "user",
        content: [
          { type: "input_text", text: "hi" },
          { type: "input_image", image_url: "data:x", detail: "high" },
        ],
      },
      { role: "assistant", content: [{ type: "output_text", text: "previous" }] },
    ]);
  });
});

describe("extractJson", () => {
  test("accepts bare, fenced and chatty JSON", () => {
    assert.deepEqual(llm.extractJson('{"a":1}'), { a: 1 });
    assert.deepEqual(llm.extractJson('Sure!\n```json\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(llm.extractJson('Here you go: {"a":{"b":3}} hope that helps'), {
      a: { b: 3 },
    });
    assert.throws(() => llm.extractJson("no json here"), /no JSON object/);
  });
});

describe("chatJson", () => {
  const schema = z.object({ n: z.number() });

  test("posts to /responses with JSON mode and parses the result", async () => {
    stub(() => ({ json: message('{"n": 7}') }));
    assert.deepEqual(await llm.chatJson(schema, [{ role: "user", content: "go" }]), { n: 7 });
    assert.equal(calls[0].url, "https://llm.test/v1/responses");
    assert.equal(calls[0].auth, "Bearer test-key");
    assert.deepEqual(calls[0].body.text, { format: { type: "json_object" } });
    assert.equal(calls[0].body.model, "gpt-5.4");
  });

  test("asks again with the validation error when the shape is wrong", async () => {
    stub((_b, n) => ({ json: message(n === 1 ? '{"n": "seven"}' : '{"n": 7}') }));
    assert.deepEqual(await llm.chatJson(schema, [{ role: "user", content: "go" }]), { n: 7 });
    assert.equal(calls.length, 2);
    const retry = calls[1].body.input as { role: string }[];
    assert.deepEqual(
      retry.map((m) => m.role),
      ["user", "assistant", "user"],
    );
  });

  test("gives up after a second invalid answer", async () => {
    stub(() => ({ json: message("nope") }));
    await assert.rejects(llm.chatJson(schema, [{ role: "user", content: "go" }]), /invalid JSON/);
  });

  test("retries 429/5xx but not 4xx", async () => {
    stub((_b, n) => (n < 3 ? { status: 503, text: "busy" } : { json: message('{"n":1}') }));
    assert.deepEqual(await llm.chatJson(schema, [{ role: "user", content: "go" }]), { n: 1 });
    assert.equal(calls.length, 3);
    stub(() => ({ status: 400, text: "bad request" }));
    await assert.rejects(llm.chatJson(schema, [{ role: "user", content: "go" }]), /400/);
    assert.equal(calls.length, 1);
  });

  test("surfaces API-level errors", async () => {
    stub(() => ({ json: { error: { message: "model overloaded" } } }));
    await assert.rejects(
      llm.chatJson(schema, [{ role: "user", content: "go" }]),
      /model overloaded/,
    );
  });
});

describe("webSearch", () => {
  test("uses the web_search tool and returns deduplicated citations", async () => {
    stub(() => ({
      json: {
        output: [
          { type: "web_search_call" },
          message("Answer", [
            {
              type: "url_citation",
              url: "https://edhrec.com/x?utm_source=openai",
              title: "EDHREC",
            },
            {
              type: "url_citation",
              url: "https://edhrec.com/x?utm_source=openai",
              title: "EDHREC",
            },
          ]).output[0],
        ],
      },
    }));
    const r = await llm.webSearch("find combos");
    assert.deepEqual(calls[0].body.tools, [{ type: "web_search" }]);
    assert.equal(r.text, "Answer");
    assert.deepEqual(r.citations, [{ url: "https://edhrec.com/x", title: "EDHREC" }]);
  });
});
