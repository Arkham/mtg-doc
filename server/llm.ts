import type { z } from "zod";
import { config } from "./config.ts";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ChatResponse {
  choices?: {
    message?: {
      content?: string | null;
      annotations?: { type: string; url_citation?: { url: string; title?: string } }[];
    };
  }[];
  error?: unknown;
}

export class LlmError extends Error {}

async function post(body: Record<string, unknown>, timeoutMs = 300_000): Promise<ChatResponse> {
  if (!config.llm.apiKey) throw new LlmError("LLM_API_KEY is not configured");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.llm.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return (await res.json()) as ChatResponse;
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 2) {
      throw new LlmError(`LLM request failed (${res.status}): ${text.slice(0, 500)}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

function extractJson(text: string): unknown {
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
  opts: { model?: string } = {},
): Promise<z.infer<T>> {
  const model = opts.model ?? config.llm.model;
  let lastError: unknown;
  const convo = [...messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await post({ model, messages: convo, response_format: { type: "json_object" } });
    const content = res.choices?.[0]?.message?.content ?? "";
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

export async function chatWithCitations(
  messages: ChatMessage[],
  model: string,
): Promise<{ text: string; citations: { title: string; url: string }[] }> {
  const res = await post({ model, messages });
  const msg = res.choices?.[0]?.message;
  const citations = new Map<string, string>();
  for (const a of msg?.annotations ?? []) {
    if (a.url_citation?.url) {
      const url = a.url_citation.url.replace(/[?&]utm_source=[^&]*/, "");
      citations.set(url, a.url_citation.title ?? url);
    }
  }
  return {
    text: msg?.content ?? "",
    citations: [...citations].map(([url, title]) => ({ url, title })),
  };
}
