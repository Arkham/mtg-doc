import { z } from "zod";
import { config } from "./config.ts";

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

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 300_000,
): Promise<T> {
  if (!config.llm.apiKey) throw new LlmError("LLM_API_KEY is not configured");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.llm.baseUrl}/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.llm.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = (await res.json()) as T & { error?: { message?: string } | null };
      if (data.error?.message) throw new LlmError(`LLM error: ${data.error.message}`);
      return data;
    }
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 2) {
      throw new LlmError(`LLM request failed (${res.status}): ${text.slice(0, 500)}`);
    }
    await new Promise((r) => setTimeout(r, config.llm.retryDelayMs * (attempt + 1)));
  }
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

export type ReasoningEffort = "low" | "medium" | "high";

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
      ...(opts.reasoning ? { reasoning: { effort: opts.reasoning } } : {}),
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

/** Runs a prompt with the built-in web_search tool and returns the answer with its cited sources. */
export async function webSearch(
  prompt: string,
  model = config.llm.searchModel,
): Promise<{ text: string; citations: { title: string; url: string }[] }> {
  const res = await respond({
    model,
    tools: [{ type: "web_search" }],
    input: toResponsesInput([{ role: "user", content: prompt }]),
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
    { model: images.length ? config.llm.visionModel : config.llm.model, reasoning: "low" },
  );
  const names = new Set(batch.map((p) => p.name));
  const out = new Map<string, number>();
  for (const a of res.answers)
    if (names.has(a.name) && Number.isFinite(a.probability))
      out.set(a.name, Math.min(1, Math.max(0, a.probability)));
  return out;
}
