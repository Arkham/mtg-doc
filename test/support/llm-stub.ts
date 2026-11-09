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

function answer(body: Record<string, unknown>, text: string, hasImage: boolean) {
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
  if (hasImage) {
    return message(
      JSON.stringify({
        isCommanderDeck: true,
        formatConfidence: 0.9,
        commanders: ["Lathril, Blade of the Elves"],
        cards: [
          { name: "Llanowar Elfs", qty: 1 },
          { name: "Sol Ring", qty: 1 },
          { name: "Divination", qty: 1 },
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
        manaNotes: ["Stub mana note."],
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
      res.end(JSON.stringify(answer(body, text, hasImage)));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
