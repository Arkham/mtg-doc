import { z } from "zod";
import { type ReasoningEffort, config } from "./config.ts";

export type { ReasoningEffort };

export type ContentPart =
  { type: "text"; text: string } | { type: "image"; url: string; detail?: "low" | "high" | "auto" };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ResponsesOutput {
  type: string;
  content?: {
    type: string;
    text?: string;
    annotations?: { type: string; url?: string; title?: string }[];
  }[];
}

interface ResponsesResult {
  status?: string;
  output?: ResponsesOutput[];
  error?: { message?: string } | null;
}

export class LlmError extends Error {}

/** Converts our provider-neutral messages to OpenAI Responses API input items. */
export function toResponsesInput(messages: ChatMessage[]) {
  return messages.map((m) => {
    const parts =
      typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    return {
      role: m.role,
      content: parts.map((p) =>
        p.type === "text"
          ? { type: m.role === "assistant" ? "output_text" : "input_text", text: p.text }
          : { type: "input_image", image_url: p.url, detail: p.detail ?? "auto" },
      ),
    };
  });
}

/** A successful response, after retrying rate limits and server errors. */
async function request(path: string, body: Record<string, unknown>, timeoutMs: number) {
  if (!config.llm.apiKey) throw new LlmError("LLM_API_KEY is not configured");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.llm.baseUrl}/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.llm.apiKey}`,
        "content-type": "application/json",
        // A gateway may answer a repeated prompt from its cache; "find again" means a new answer.
        "cache-control": "no-cache",
      },
      body: JSON.stringify(
        path === "responses" && config.llm.serviceTier
          ? { ...body, service_tier: config.llm.serviceTier }
          : body,
      ),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res;
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 2) {
      throw new LlmError(`LLM request failed (${res.status}): ${text.slice(0, 500)}`);
    }
    await new Promise((r) => setTimeout(r, config.llm.retryDelayMs * (attempt + 1)));
  }
}

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 300_000,
): Promise<T> {
  const data = (await (await request(path, body, timeoutMs)).json()) as T & {
    error?: { message?: string } | null;
  };
  if (data.error?.message) throw new LlmError(`LLM error: ${data.error.message}`);
  return data;
}

const respond = (body: Record<string, unknown>) => post<ResponsesResult>("responses", body);

/** All assistant text from a Responses API result, in order. */
export function outputText(res: ResponsesResult): string {
  return (res.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new LlmError("LLM response contained no JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function chatJson<T extends z.ZodType>(
  schema: T,
  messages: ChatMessage[],
  opts: { model?: string; reasoning?: ReasoningEffort } = {},
): Promise<z.infer<T>> {
  const model = opts.model ?? config.llm.model;
  let lastError: unknown;
  const convo = [...messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await respond({
      model,
      input: toResponsesInput(convo),
      text: { format: { type: "json_object" } },
      reasoning: { effort: opts.reasoning ?? config.llm.reasoning },
    });
    const content = outputText(res);
    try {
      return schema.parse(extractJson(content));
    } catch (err) {
      lastError = err;
      convo.push(
        { role: "assistant", content },
        {
          role: "user",
          content: `That response did not match the required JSON shape: ${String(err).slice(0, 800)}. Reply again with only the corrected JSON object.`,
        },
      );
    }
  }
  throw new LlmError(`LLM returned invalid JSON: ${String(lastError)}`);
}

/** The events of a server-sent event stream, as the JSON each one carries. */
async function* streamEvents(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") yield JSON.parse(data) as Record<string, unknown>;
    }
  }
}

/**
 * Like `chatJson`, with the model's answer streamed: `onText` gets its text so far as it arrives,
 * for showing the reply while the rest is written. Providers that don't stream answer all at once.
 */
export async function chatJsonStream<T extends z.ZodType>(
  schema: T,
  messages: ChatMessage[],
  onText: (text: string) => void,
  opts: { model?: string; reasoning?: ReasoningEffort } = {},
): Promise<z.infer<T>> {
  const res = await request(
    "responses",
    {
      model: opts.model ?? config.llm.model,
      input: toResponsesInput(messages),
      text: { format: { type: "json_object" } },
      stream: true,
      reasoning: { effort: opts.reasoning ?? config.llm.reasoning },
    },
    300_000,
  );
  let content = "";
  if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
    for await (const event of streamEvents(res.body)) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        content += event.delta;
        onText(content);
      } else if (event.type === "response.completed") {
        content = outputText(event.response as ResponsesResult) || content;
      } else if (event.type === "response.failed" || event.type === "error") {
        const failed = event.response as ResponsesResult | undefined;
        const message = failed?.error?.message ?? (event.message as string | undefined);
        throw new LlmError(`LLM error: ${message ?? "the response failed"}`);
      }
    }
  } else {
    const data = (await res.json()) as ResponsesResult;
    if (data.error?.message) throw new LlmError(`LLM error: ${data.error.message}`);
    content = outputText(data);
    onText(content);
  }
  try {
    return schema.parse(extractJson(content));
  } catch (err) {
    // The same second chance `chatJson` gives, without streaming: the reply shown so far is replaced.
    return chatJson(
      schema,
      [
        ...messages,
        { role: "assistant", content },
        {
          role: "user",
          content: `That response did not match the required JSON shape: ${String(err).slice(0, 800)}. Reply again with only the corrected JSON object.`,
        },
      ],
      opts,
    );
  }
}

/** Runs a prompt with the built-in web_search tool and returns the answer with its cited sources. */
export async function webSearch(
  prompt: string,
  model = config.llm.searchModel,
): Promise<{ text: string; citations: { title: string; url: string }[] }> {
  const res = await respond({
    model,
    tools: [{ type: "web_search" }],
    input: toResponsesInput([{ role: "user", content: prompt }]),
    reasoning: { effort: config.llm.reasoning },
  });
  const citations = new Map<string, string>();
  for (const o of res.output ?? []) {
    for (const c of o.content ?? []) {
      for (const a of c.annotations ?? []) {
        if (a.type === "url_citation" && a.url) {
          const url = a.url.replace(/[?&]utm_source=[^&]*/, "");
          citations.set(url, a.title ?? url);
        }
      }
    }
  }
  return {
    text: outputText(res),
    citations: [...citations].map(([url, title]) => ({ url, title })),
  };
}

export interface Predicate {
  name: string;
  instructions: string;
}

/** Keeps requests small so each stays well inside the Decisions API's latency budget. */
const DECISION_BATCH = 20;

/**
 * Yes/no questions about a context (and optional images), answered with the probability that
 * each predicate is true, keyed by name. Uses the Decisions API for calibrated answers; when it's
 * turned off (LLM_DECISIONS=false) or a call fails, the regular model answers instead, so callers
 * never need to care which one did.
 */
export async function decide(
  context: string,
  images: string[],
  predicates: Predicate[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < predicates.length; i += DECISION_BATCH) {
    const batch = predicates.slice(i, i + DECISION_BATCH);
    let answers: Map<string, number> | null = null;
    if (config.llm.decisions) {
      answers = await decideWithDecisionsApi(context, images, batch).catch(() => null);
    }
    answers ??= await decideWithModel(context, images, batch);
    // The Decisions API can leave a question out; the regular model answers those.
    const missing = batch.filter((p) => !answers.has(p.name));
    if (missing.length && config.llm.decisions)
      for (const [name, p] of await decideWithModel(context, images, missing)) answers.set(name, p);
    for (const [name, p] of answers) out.set(name, p);
  }
  return out;
}

async function decideWithDecisionsApi(context: string, images: string[], batch: Predicate[]) {
  const res = await post<{ answers?: { name: string; type: string; probability?: number }[] }>(
    "decisions",
    {
      model: config.llm.decisionModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: context },
            ...images.map((url) => ({ type: "input_image", image_url: url })),
          ],
        },
      ],
      questions: batch.map((p) => ({
        type: "predicate",
        name: p.name,
        instructions: p.instructions,
      })),
    },
    60_000,
  );
  const out = new Map<string, number>();
  for (const a of res.answers ?? []) {
    if (a.type === "predicate" && typeof a.probability === "number") out.set(a.name, a.probability);
  }
  return out;
}

const ModelDecisionSchema = z.object({
  answers: z.array(
    z.object({ name: z.string(), probability: z.coerce.number().catch(Number.NaN) }),
  ),
});

/** The same questions through the regular model, asked for a probability per predicate. */
async function decideWithModel(context: string, images: string[], batch: Predicate[]) {
  const questions = batch.map((p) => `- ${p.name}: ${p.instructions}`).join("\n");
  const res = await chatJson(
    ModelDecisionSchema,
    [
      {
        role: "system",
        content:
          "You answer yes/no questions about the input. For each question, give the probability (0 to 1) that the answer is yes: near 1 or 0 only when the input makes it clear, around 0.5 when it doesn't. Reply with JSON only.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${context}\n\nQuestions:\n${questions}\n\nReply with {"answers": [{"name": string, "probability": number}]}, one per question, using the names above.`,
          },
          ...images.map((url) => ({ type: "image" as const, url })),
        ],
      },
    ],
    { model: images.length ? config.llm.visionModel : config.llm.model },
  );
  const names = new Set(batch.map((p) => p.name));
  const out = new Map<string, number>();
  for (const a of res.answers)
    if (names.has(a.name) && Number.isFinite(a.probability))
      out.set(a.name, Math.min(1, Math.max(0, a.probability)));
  return out;
}
