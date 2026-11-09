import sharp from "sharp";
import { z } from "zod";
import type { Card, DeckEntry, RecognitionResult, RecognizedEntry } from "../shared/types.ts";
import { config } from "./config.ts";
import { parseDecklist } from "./decklist.ts";
import { chatJson, type ChatMessage } from "./llm.ts";
import { resolveNames } from "./sources/scryfall.ts";

const VisionSchema = z.object({
  imageKind: z.string().optional(),
  isCommanderDeck: z.boolean(),
  formatConfidence: z.number().min(0).max(1).default(0.5),
  commanders: z.array(z.string()).default([]),
  deckName: z.string().nullable().optional(),
  cards: z.array(z.object({ name: z.string(), qty: z.number().int().positive().default(1) })),
  notes: z.array(z.string()).default([]),
});

const PROMPT = `You are an expert Magic: The Gathering judge reading a photo or screenshot of a deck.
The images may be a screenshot of a decklist (text), real cards laid out with names visible, or a mix. Multiple images are different parts of the same deck.

Tasks:
1. Read every card name you can see. Use the exact official English card name (fix OCR-like misspellings using your MTG knowledge). For real cards, read the title bar; use art/frame only to disambiguate.
2. Quantities: use the number shown in a list; for physical cards count copies. Basic lands are often stacked—estimate their count and mention it in notes.
3. Decide whether this is a Commander/EDH deck (≈100 singleton cards, a legendary commander often listed separately, placed apart, or under a "Commander" heading).
4. If it is, identify the commander(s) (two if partners/background/companion pairing). Do NOT also include the commander(s) in "cards".
5. Never invent cards you cannot see. If a name is partially legible, give your best guess and add a note.

Reply with JSON only:
{"imageKind": "screenshot|physical|mixed", "isCommanderDeck": boolean, "formatConfidence": 0..1, "commanders": string[], "deckName": string|null, "cards": [{"name": string, "qty": number}], "notes": string[]}`;

export async function prepareImage(buf: Buffer): Promise<string> {
  const jpeg = await sharp(buf)
    .rotate()
    .resize({ width: 3072, height: 3072, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export async function recognizeImages(images: Buffer[]): Promise<RecognitionResult> {
  const urls = await Promise.all(images.map(prepareImage));
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        ...urls.map((url) => ({ type: "image" as const, url, detail: "high" as const })),
      ],
    },
  ];
  const vision = await chatJson(VisionSchema, messages, { model: config.llm.visionModel });
  return buildRecognition(
    vision.isCommanderDeck ? "commander" : "other",
    vision.formatConfidence,
    vision.commanders,
    vision.cards,
    vision.deckName ?? null,
    vision.notes,
  );
}

export async function recognizeText(text: string): Promise<RecognitionResult> {
  const parsed = parseDecklist(text);
  const total = parsed.entries.reduce((n, e) => n + e.qty, 0) + parsed.commanders.length;
  const looksCommander = parsed.commanders.length > 0 || (total >= 95 && total <= 101);
  return buildRecognition(
    looksCommander ? "commander" : "other",
    parsed.commanders.length ? 1 : 0.6,
    parsed.commanders,
    parsed.entries,
    null,
    [],
  );
}

async function buildRecognition(
  format: "commander" | "other",
  formatConfidence: number,
  commanderNames: string[],
  cards: DeckEntry[],
  deckName: string | null,
  notes: string[],
): Promise<RecognitionResult> {
  const merged = new Map<string, number>();
  for (const c of cards) merged.set(c.name.trim(), (merged.get(c.name.trim()) ?? 0) + c.qty);
  const names = [...merged.keys()];
  const resolved = await resolveNames([...commanderNames, ...names]);
  const byRequested = new Map(resolved.map((r) => [r.requested, r]));

  const commanderCards: Card[] = [];
  for (const n of commanderNames) {
    const card = byRequested.get(n)?.card;
    if (card?.canBeCommander && !commanderCards.some((c) => c.name === card.name))
      commanderCards.push(card);
  }
  const commanders = commanderCards.map((c) => c.name);

  const entries = new Map<string, RecognizedEntry>();
  for (const [raw, qty] of merged) {
    const r = byRequested.get(raw)!;
    const name = r.card?.name ?? raw;
    if (commanders.includes(name)) continue;
    const existing = entries.get(name);
    if (existing) existing.qty += qty;
    else entries.set(name, { raw, qty, name, status: r.status, card: r.card ?? undefined });
  }
  for (const n of commanderNames) {
    const r = byRequested.get(n);
    if (r?.card && !r.card.canBeCommander && !entries.has(r.card.name)) {
      entries.set(r.card.name, {
        raw: n,
        qty: 1,
        name: r.card.name,
        status: r.status,
        card: r.card,
      });
      notes.push(`"${r.card.name}" can't be a commander, so it was moved to the main deck.`);
    }
  }

  const list = [...entries.values()];
  const candidates = list.filter((e) => e.card?.canBeCommander).map((e) => e.name);
  if (format === "commander" && commanders.length === 0 && candidates.length === 1) {
    const only = list.find((e) => e.name === candidates[0])!;
    commanders.push(only.name);
    commanderCards.push(only.card!);
  }
  if (commanderCards.length) {
    const identity = new Set(commanderCards.flatMap((c) => c.colorIdentity));
    const offColor = list.filter(
      (e) =>
        !commanders.includes(e.name) &&
        e.card &&
        !e.card.colorIdentity.every((c) => identity.has(c)),
    );
    if (offColor.length) {
      notes.push(
        `Outside the commander's color identity: ${offColor.map((e) => e.name).join(", ")}. These will be cut.`,
      );
    }
  }
  const total = list.reduce((n, e) => n + e.qty, 0) + commanders.length;
  if (format === "commander" && total !== 100) {
    notes.push(`Recognized ${total} cards; a commander deck needs exactly 100. Please review.`);
  }
  return {
    format,
    formatConfidence,
    commanders,
    commanderCards,
    commanderCandidates: candidates,
    deckName,
    entries: list.filter((e) => !commanders.includes(e.name)),
    notes,
  };
}
