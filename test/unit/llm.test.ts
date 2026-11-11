import "../support/env.ts";
import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import { z } from "zod";

process.env.LLM_API_KEY = "test-key";
const llm = await import("../../server/llm.ts");

type Handler = (
  body: Record<string, unknown>,
  call: number,
  url: string,
) => { status?: number; json?: unknown; text?: string };
const realFetch = globalThis.fetch;
let calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];

function stub(handler: Handler) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
    const r = handler(body, calls.length, url);
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
    assert.equal(calls[0].body.model, "gpt-6.1-sol");
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

describe("decide", () => {
  test("asks yes/no questions with images via the Decisions API, in batches", async () => {
    stub((body) => {
      const questions = body.questions as { name: string }[];
      return {
        json: {
          answers: questions.map((q, i) => ({
            type: "predicate",
            name: q.name,
            probability: i % 2 ? 0.1 : 0.9,
          })),
        },
      };
    });
    const predicates = Array.from({ length: 25 }, (_, i) => ({
      name: `q${i}`,
      instructions: `card ${i}?`,
    }));
    const answers = await llm.decide("context", ["data:image/jpeg;base64,x"], predicates);
    assert.equal(calls.length, 2, "20 questions per request");
    assert.equal(calls[0].url, "https://llm.test/v1/decisions");
    assert.equal(calls[0].body.model, "gpt-6-luna");
    const input = calls[0].body.input as { content: { type: string }[] }[];
    assert.deepEqual(
      input[0].content.map((c) => c.type),
      ["input_text", "input_image"],
    );
    assert.equal((calls[0].body.questions as { type: string }[])[0].type, "predicate");
    assert.equal(answers.size, 25);
    assert.equal(answers.get("q0"), 0.9);
    assert.equal(answers.get("q1"), 0.1);
  });
});

describe("decide without the Decisions API", () => {
  const predicates = [
    { name: "in-deck", instructions: "Is Sol Ring in the list?" },
    { name: "red", instructions: "Is the commander red?" },
  ];
  const modelAnswers = (url: string) =>
    url.endsWith("/responses")
      ? {
          json: message(
            JSON.stringify({
              answers: [
                { name: "in-deck", probability: 0.97 },
                { name: "red", probability: "1.4" },
                { name: "made-up", probability: 0.5 },
              ],
            }),
          ),
        }
      : { status: 404, text: "no such endpoint" };

  test("falls back to the regular model when the Decisions API fails", async () => {
    stub((_body, _call, url) => modelAnswers(url));
    const answers = await llm.decide("1 Sol Ring", [], predicates);
    assert.deepEqual(
      calls.map((c) => c.url.split("/").at(-1)),
      ["decisions", "responses"],
    );
    assert.equal(calls[1].body.model, "gpt-6.1-sol", "the regular model, not the classifier");
    const prompt = JSON.stringify(calls[1].body.input);
    assert.match(prompt, /in-deck: Is Sol Ring in the list\?/);
    assert.deepEqual(
      [...answers],
      [
        ["in-deck", 0.97],
        ["red", 1],
      ],
      "clamped, and only the questions asked",
    );
  });

  test("goes straight to the model when decisions are turned off, with images on the vision model", async () => {
    const { config } = await import("../../server/config.ts");
    config.llm.decisions = false;
    config.llm.visionModel = "vision-model";
    try {
      stub((_body, _call, url) => modelAnswers(url));
      const answers = await llm.decide("a photo", ["data:image/jpeg;base64,x"], predicates);
      assert.deepEqual(
        calls.map((c) => c.url.split("/").at(-1)),
        ["responses"],
      );
      assert.equal(calls[0].body.model, "vision-model");
      assert.match(JSON.stringify(calls[0].body.input), /input_image/);
      assert.equal(answers.get("in-deck"), 0.97);
    } finally {
      config.llm.decisions = true;
      config.llm.visionModel = config.llm.model;
    }
  });
});

describe("reasoning effort", () => {
  test("is passed through when requested", async () => {
    stub(() => ({ json: message('{"n": 1}') }));
    await llm.chatJson(z.object({ n: z.number() }), [{ role: "user", content: "go" }], {
      reasoning: "low",
    });
    assert.deepEqual(calls[0].body.reasoning, { effort: "low" });
  });
});
