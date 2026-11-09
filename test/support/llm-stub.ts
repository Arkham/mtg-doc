import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal Responses API stand-in. It answers like a cooperative model: accepts the solver's
 * proposals (plus one invalid swap to exercise validation), returns vision and research results.
 */
export interface LlmStub {
  url: string;
  requests: { body: Record<string, unknown>; text: string }[];
  close: () => Promise<void>;
}

const message = (text: string, annotations: unknown[] = []) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text, annotations }] }],
});

/** Verification answers by card: confirmed, unsure-but-yes, and a hallucination to reject. */
const DECISIONS: Record<string, number> = {
  "Lightning Greaves": 0.92,
  Divination: 0.7,
  Counterspell: 0.05,
};

function decisions(body: Record<string, unknown>) {
  const questions = body.questions as { name: string; instructions: string }[];
  const context = JSON.stringify(body.input);
  return {
    answers: questions.map((q) => {
      if (q.name === "confirms")
        return {
          type: "predicate",
          name: q.name,
          probability: /The user replied: \\"(yes|go ahead)/i.test(context) ? 0.95 : 0.1,
        };
      const card = Object.keys(DECISIONS).find((c) => q.instructions.includes(`"${c}"`));
      return { type: "predicate", name: q.name, probability: card ? DECISIONS[card] : 0.5 };
    }),
  };
}

const CONTENT_FILTER = {
  status: 400,
  body: {
    error: {
      message:
        "The response was filtered due to the prompt triggering the content management policy.",
      code: "content_filter",
    },
  },
};

function answer(body: Record<string, unknown>, text: string, hasImage: boolean): unknown {
  if (text.includes("most notable synergies")) {
    return message(
      JSON.stringify({
        synergies: [
          {
            title: "Ramp into the commander",
            cards: ["sol ring", "Lathril, Blade of the Elves"],
            explanation: "Stub synergy.",
          },
          {
            title: "Invented",
            cards: ["Lathril, Blade of the Elves", "Not A Real Card"],
            explanation: "Should be dropped.",
          },
          {
            title: "Lands matter",
            cards: ["Lathril, Blade of the Elves", "Forest"],
            explanation: "Stub synergy two.",
          },
        ],
      }),
    );
  }
  if (text.includes("You are the mtg doc, an expert Commander")) {
    // Simulates the provider refusing a request, which the app must survive.
    if (/Fellwar Stone|risky/.test(text)) return CONTENT_FILTER;
    const last = (body.input as { content: { text?: string }[] }[]).at(-1)?.content[0]?.text ?? "";
    if (/bracket 2/i.test(last))
      return message(
        JSON.stringify({
          reply: "I can re-run the optimizer for bracket 2. Want me to go ahead?",
          changes: [{ action: "add", name: "Sol Ring", qty: 1, reason: "ignored for re-runs" }],
          rerun: { bracket: 2 },
        }),
      );
    return message(
      JSON.stringify({
        reply: "Stub chat: trade Sol Ring for a fairer rock.",
        changes: [
          { action: "remove", name: "Sol Ring", qty: 1, reason: "stub" },
          { action: "add", name: "Mind Stone", qty: 1, reason: "stub" },
        ],
      }),
    );
  }
  if (
    Array.isArray(body.tools) &&
    body.tools.some((t: { type: string }) => t.type === "web_search")
  ) {
    return message("Lathril decks lean on Elvish Archdruid and Priest of Titania for mana.", [
      {
        type: "url_citation",
        url: "https://edhrec.com/commanders/lathril-blade-of-the-elves?utm_source=x",
        title: "EDHREC",
      },
    ]);
  }
  if (hasImage && text.includes("This is a crop of a photo")) {
    return message(
      JSON.stringify({
        cards: [
          { name: "Llanowar Elves", printed: "Elfi di Llanowar", lang: "it", qty: 1 },
          { name: "Swiftfoot Boots", printed: "Stivali Piedelesto", lang: "it", qty: 1 },
        ],
      }),
    );
  }
  if (hasImage) {
    return message(
      JSON.stringify({
        isCommanderDeck: true,
        formatConfidence: 0.9,
        commanders: [
          {
            name: "Lathril, Blade of the Elves",
            printed: "Lathril, Blade of the Elves",
            lang: "en",
          },
        ],
        cards: [
          { name: "Llanowar Elfs", printed: "Llanowar Elfs", lang: "en", qty: 1 },
          { name: "Swiftfoot Boots", printed: "Stivali Piedelesto", lang: "it", qty: 1 },
          { name: "Divination", qty: 1 },
          { name: "Lightning Greaves", qty: 1 },
          { name: "Counterspell", qty: 1 },
        ],
        notes: ["Read from a test photo."],
      }),
    );
  }
  if (text.includes("List every Magic: The Gathering card name")) {
    return message(JSON.stringify({ cards: ["Elvish Archdruid", "Priest of Titania"] }));
  }
  if (text.includes("constraint solver has proposed swaps")) {
    const swaps = [...text.matchAll(/OUT (.+?) \(\$[^)]*\) → IN (.+?) \(\$/g)].map(
      ([, out, inName]) => ({
        out,
        in: inName,
        category: "synergy",
        reason: `Stub review keeps ${inName}.`,
      }),
    );
    swaps.unshift({
      out: "Card Not In Deck",
      in: "Sol Ring",
      category: "other",
      reason: "invalid on purpose",
    });
    return message(
      JSON.stringify({
        strategy: "Stub strategy: go wide with elves.",
        themes: ["Elves"],
        swaps,
      }),
    );
  }
  return message("{}");
}

export async function startLlmStub(): Promise<LlmStub> {
  const requests: LlmStub["requests"] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const parts = (body.input ?? []).flatMap(
        (m: { content: { type: string; text?: string }[] }) => m.content ?? [],
      );
      const text = parts.map((p: { text?: string }) => p.text ?? "").join("\n");
      requests.push({ body, text });
      const hasImage = parts.some((p: { type: string }) => p.type === "input_image");
      res.setHeader("content-type", "application/json");
      const out = req.url?.endsWith("/decisions") ? decisions(body) : answer(body, text, hasImage);
      if (out === CONTENT_FILTER) {
        res.statusCode = CONTENT_FILTER.status;
        res.end(JSON.stringify(CONTENT_FILTER.body));
      } else res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
