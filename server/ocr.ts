import sharp from "sharp";
import { z } from "zod";
import type { Card, RecognitionResult, RecognizedEntry } from "../shared/types.ts";
import {
  type Sighting,
  type Tally,
  estimateQuantity,
  mapLimit,
  planTilings,
  splitByVotes,
  tallySightings,
} from "./analysis/vision.ts";
import { config } from "./config.ts";
import { parseDecklist } from "./decklist.ts";
import { chatJson, decide } from "./llm.ts";
import {
  SCRYFALL_LANGS,
  isBasicLand,
  lookupExact,
  lookupFuzzy,
  lookupPrintedInexact,
  printedKey,
  printedToEnglish,
  resolveNames,
} from "./sources/scryfall.ts";

export interface RecognizeProgress {
  phase: string;
  done: number;
  total: number;
}

export interface RecognizeOptions {
  onProgress?: (p: RecognizeProgress) => void;
}

const CONCURRENCY = 8;
/** Verification probability needed to keep a card only one reading pass saw. */
const CONFIRM_P = 0.5;

const SightingSchema = z.object({
  name: z.string().min(1),
  printed: z.string().catch(""),
  lang: z
    .string()
    .catch("en")
    .transform((l) => l.toLowerCase()),
  qty: z.coerce.number().int().positive().catch(1),
});

const CommanderSchema = z.union([
  z.string().transform((name) => ({ name, printed: "", lang: "en" })),
  SightingSchema.omit({ qty: true }),
]);

const FullSchema = z.object({
  isCommanderDeck: z.boolean().catch(true),
  formatConfidence: z.number().min(0).max(1).catch(0.5),
  commanders: z.array(CommanderSchema).catch([]),
  deckName: z.string().nullable().catch(null),
  cards: z.array(SightingSchema).catch([]),
  notes: z.array(z.string()).catch([]),
});

const TileSchema = z.object({ cards: z.array(SightingSchema).catch([]) });

const CARD_FIELDS = `For every card give:
- "name": the official English Oracle card name (translate non-English cards using your MTG knowledge),
- "printed": the title exactly as printed on the card (in its own language),
- "lang": the language the card is printed in, as a Scryfall code (en, it, de, fr, es, pt, ja, ko, ru, zhs, zht),
- "qty": how many copies you can see.`;

const FULL_PROMPT = `You are an expert Magic: The Gathering judge reading a photo or screenshot of a deck.
It may be a screenshot of a decklist, real cards laid out on a table (often in overlapping columns where only the title bars show), or a mix. Multiple images are different parts of the same deck.

Tasks:
1. Read every card title you can see. Use the art and frame only to disambiguate.
2. Decide whether this is a Commander/EDH deck (about 100 singleton cards, with a legendary commander usually placed apart or listed under a "Commander" heading).
3. If it is, identify the commander(s) (two for partners/backgrounds). Do NOT also list them in "cards".
4. Basic lands are often stacked: count them carefully.
5. Never invent cards you cannot see. Skip titles you can't read.

${CARD_FIELDS}

Reply with JSON only:
{"isCommanderDeck": boolean, "formatConfidence": 0..1, "commanders": [{"name": string, "printed": string, "lang": string}], "deckName": string|null, "cards": [{"name": string, "printed": string, "lang": string, "qty": number}], "notes": string[]}`;

const TILE_PROMPT = `This is a crop of a photo of Magic: The Gathering cards laid out on a table, often in overlapping columns where only the title bars show.
List every card whose title is readable in this crop, including partly covered cards whose title is visible.
Skip cards whose title is cut off by the crop edge or unreadable. Never guess cards you can't read.

${CARD_FIELDS}

Reply with JSON only: {"cards": [{"name": string, "printed": string, "lang": string, "qty": number}]}`;

const toDataUrl = (buf: Buffer) => `data:image/jpeg;base64,${buf.toString("base64")}`;

export async function prepareImage(buf: Buffer): Promise<string> {
  const jpeg = await sharp(buf)
    .rotate()
    .resize({ width: 3072, height: 3072, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return toDataUrl(jpeg);
}

interface PassTask {
  pass: string;
  tile: string | null;
  url: string;
  prompt: "full" | "tile";
}

interface PreparedImage {
  full: string;
  tilings: { pass: string; tiles: { id: string; url: string }[] }[];
}

async function prepareForPasses(buf: Buffer, index: number): Promise<PreparedImage> {
  const { data, info } = await sharp(buf).rotate().toBuffer({ resolveWithObject: true });
  const full = toDataUrl(
    await sharp(data)
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer(),
  );
  const tilings = await Promise.all(
    planTilings(info.width, info.height).map(async (rects, t) => ({
      pass: t === 0 ? "tilesA" : "tilesB",
      tiles: await Promise.all(
        rects.map(async (r, i) => ({
          id: `${index}:${t}:${i}`,
          url: toDataUrl(
            await sharp(data)
              .extract(r)
              .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
              .jpeg({ quality: 92 })
              .toBuffer(),
          ),
        })),
      ),
    })),
  );
  return { full, tilings };
}

interface PassResult {
  task: PassTask;
  sightings: Sighting[];
  full?: z.infer<typeof FullSchema>;
}

async function runPass(task: PassTask): Promise<PassResult> {
  const prompt = task.prompt === "full" ? FULL_PROMPT : TILE_PROMPT;
  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: prompt },
        { type: "image" as const, url: task.url, detail: "high" as const },
      ],
    },
  ];
  const toSighting = (c: z.infer<typeof SightingSchema>): Sighting => ({
    ...c,
    pass: task.pass,
    tile: task.tile,
  });
  if (task.prompt === "full") {
    const full = await chatJson(FullSchema, messages, { model: config.llm.visionModel });
    return { task, full, sightings: full.cards.map(toSighting) };
  }
  const tile = await chatJson(TileSchema, messages, { model: config.llm.visionModel });
  return { task, sightings: tile.cards.map(toSighting) };
}

type Resolution = { card: Card; how: "exact" | "printed" | "fuzzy" };

/**
 * Matches what the model read to real cards, in batches. The printed title is what's physically on
 * the card, so non-English cards are matched by printed name and language first.
 */
async function resolveSightings(sightings: { name: string; printed: string; lang: string }[]) {
  const keyOf = (s: { name: string; printed: string; lang: string }) =>
    `${s.lang}|${s.printed}|${s.name}`;
  const unique = [...new Map(sightings.map((s) => [keyOf(s), s])).values()];
  const foreign = unique.filter((s) => s.lang !== "en" && s.printed);
  const englishByPrinted = await printedToEnglish(foreign);
  const fromPrinted = (s: { printed: string; lang: string }) =>
    s.lang !== "en" && s.printed ? englishByPrinted.get(printedKey(s.printed, s.lang)) : undefined;
  const cards = await lookupExact([
    ...new Set(unique.flatMap((s) => [s.name, fromPrinted(s)].filter((n): n is string => !!n))),
  ]);

  const out = new Map<string, Resolution | null>();
  for (const s of unique) {
    // Most to least reliable: exact printed title, exact English name, then inexact matches.
    const viaPrinted = fromPrinted(s);
    let res: Resolution | null = null;
    if (viaPrinted && cards.get(viaPrinted)) res = { card: cards.get(viaPrinted)!, how: "printed" };
    else if (cards.get(s.name)) res = { card: cards.get(s.name)!, how: "exact" };
    else {
      const inexact =
        s.lang !== "en" && s.printed ? await lookupPrintedInexact(s.printed, s.lang) : null;
      const card =
        (inexact ? (await lookupExact([inexact])).get(inexact) : null) ??
        (await lookupFuzzy(s.name));
      if (card) res = { card, how: "fuzzy" };
    }
    out.set(keyOf(s), res);
  }
  return (s: { name: string; printed: string; lang: string }) => out.get(keyOf(s)) ?? null;
}

const describe = (s: Sighting) =>
  s.printed && s.printed.toLowerCase() !== s.name.toLowerCase()
    ? `"${s.name}" (printed as "${s.printed}")`
    : `"${s.name}"`;

/**
 * Re-checks cards only one reading pass saw against the crops they were seen in, using calibrated
 * yes/no classification. Returns the best probability per card.
 */
async function verifyContested(
  contested: Tally[],
  urlById: Map<string, string>,
  fallbackIds: string[],
  onDone: () => void,
): Promise<Map<string, number>> {
  const byImage = new Map<string, { key: string; sighting: Sighting }[]>();
  for (const t of contested) {
    const ids = [...new Set(t.sightings.map((s) => s.tile).filter((x): x is string => x !== null))];
    for (const id of ids.length ? ids : fallbackIds) {
      byImage.set(id, [...(byImage.get(id) ?? []), { key: t.key, sighting: t.sightings[0] }]);
    }
  }
  const best = new Map<string, number>();
  await mapLimit([...byImage], CONCURRENCY, async ([id, items]) => {
    const answers = await decide(
      "A photo (or crop of a photo) of Magic: The Gathering cards laid out on a table, often in overlapping columns where only the title bars show. Cards may be printed in any language.",
      [urlById.get(id)!],
      items.map((it, i) => ({
        name: `card_${i}`,
        instructions: `Is the Magic card ${describe(it.sighting)} visible in this image, with its title readable? Answer false if you only see a different card with a similar name.`,
      })),
    );
    items.forEach((it, i) => {
      const p = answers.get(`card_${i}`) ?? 0;
      best.set(it.key, Math.max(best.get(it.key) ?? 0, p));
    });
    onDone();
  });
  return best;
}

export async function recognizeImages(
  images: Buffer[],
  opts: RecognizeOptions = {},
): Promise<RecognitionResult> {
  const progress = opts.onProgress ?? (() => {});
  progress({ phase: "Preparing photos", done: 0, total: 1 });
  const prepared = await Promise.all(images.map(prepareForPasses));

  const tasks: PassTask[] = [];
  prepared.forEach((p, i) => {
    tasks.push({ pass: "full", tile: null, url: p.full, prompt: "full" });
    // Small images (screenshots) get no tiles; a second independent read still catches misses.
    if (!p.tilings.length) tasks.push({ pass: "full2", tile: null, url: p.full, prompt: "full" });
    for (const tiling of p.tilings) {
      for (const tile of tiling.tiles)
        tasks.push({ pass: tiling.pass, tile: tile.id, url: tile.url, prompt: "tile" });
    }
    void i;
  });
  const urlById = new Map(
    prepared.flatMap((p) => p.tilings.flatMap((t) => t.tiles.map((x) => [x.id, x.url] as const))),
  );
  prepared.forEach((p, i) => urlById.set(`full:${i}`, p.full));

  let done = 0;
  const failures: string[] = [];
  const results = (
    await mapLimit(tasks, CONCURRENCY, async (task) => {
      try {
        return await runPass(task);
      } catch (err) {
        failures.push(String(err instanceof Error ? err.message : err));
        return null;
      } finally {
        progress({ phase: "Reading cards", done: ++done, total: tasks.length });
      }
    })
  ).filter((r): r is PassResult => r !== null);
  if (!results.length) throw new Error(`Couldn't read the photo: ${failures[0] ?? "no results"}`);

  progress({ phase: "Matching card names", done: 0, total: 1 });
  const fulls = results.flatMap((r) => (r.full ? [r.full] : []));
  const commanderSightings = fulls.flatMap((f) => f.commanders);
  const sightings = results.flatMap((r) => r.sightings);
  const resolve = await resolveSightings([...sightings, ...commanderSightings]);

  const tallies = tallySightings(
    sightings.map((s) => ({ sighting: s, key: resolve(s)?.card.name ?? null })),
  );
  const cardByName = new Map<string, Card>();
  const howByName = new Map<string, Resolution["how"]>();
  for (const s of [...sightings, ...commanderSightings]) {
    const r = resolve(s);
    if (r) {
      cardByName.set(r.card.name, r.card);
      // A card counts as certainly named if any pass matched it exactly (by English or printed title).
      if (r.how !== "fuzzy" || !howByName.has(r.card.name)) howByName.set(r.card.name, r.how);
    }
  }
  const unresolved = [
    ...new Set(sightings.filter((s) => !resolve(s)).map((s) => s.printed || s.name)),
  ];

  const passesRun = new Set(results.map((r) => r.task.pass));
  const minVotes = Math.min(2, passesRun.size);
  const { accepted, contested } = splitByVotes(tallies.values(), minVotes);

  const notes: string[] = [];
  const confidence = new Map<string, number>();
  for (const t of accepted) confidence.set(t.key, 1);
  if (contested.length) {
    const fallbackIds = prepared.flatMap(
      (p, i) => p.tilings[0]?.tiles.map((t) => t.id) ?? [`full:${i}`],
    );
    let checked = 0;
    try {
      const probs = await verifyContested(contested, urlById, fallbackIds, () =>
        progress({
          phase: "Double-checking uncertain cards",
          done: ++checked,
          total: contested.length,
        }),
      );
      const rejected: string[] = [];
      for (const t of contested) {
        const p = probs.get(t.key) ?? 0;
        if (p >= CONFIRM_P) confidence.set(t.key, p);
        else rejected.push(t.key);
      }
      if (rejected.length) {
        notes.push(
          `Ignored ${rejected.length} card(s) only one pass saw that a second look didn't confirm: ${rejected.join(", ")}.`,
        );
      }
    } catch {
      for (const t of contested) confidence.set(t.key, 0.5);
      notes.push("Couldn't double-check cards only one pass saw; they're marked for review.");
    }
  }

  const isCommander = fulls.filter((f) => f.isCommanderDeck).length >= fulls.length / 2;
  const formatConfidence =
    fulls.reduce((n, f) => n + f.formatConfidence, 0) / Math.max(1, fulls.length);
  const commanderVotes = new Map<string, number>();
  for (const c of commanderSightings) {
    const card = resolve(c)?.card;
    if (card?.canBeCommander)
      commanderVotes.set(card.name, (commanderVotes.get(card.name) ?? 0) + 1);
  }
  const commanderCards = [...commanderVotes]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => cardByName.get(name)!);

  const entries: RecognizedEntry[] = [...tallies.values()]
    .filter((t) => confidence.has(t.key))
    .map((t) => {
      const card = cardByName.get(t.key)!;
      const qty = isCommander && !isBasicLand(t.key) ? 1 : estimateQuantity(t);
      const first = t.sightings[0];
      const sure = (confidence.get(t.key) ?? 0) >= 0.8 && howByName.get(t.key) !== "fuzzy";
      return {
        raw: first.printed || first.name,
        name: t.key,
        qty,
        status: sure ? ("exact" as const) : ("fuzzy" as const),
        card,
        lang: first.lang,
        votes: t.passes.size,
        confidence: Math.round((confidence.get(t.key) ?? 0) * 100) / 100,
      };
    });

  const langs = sightings.map((s) => s.lang).filter((l) => SCRYFALL_LANGS.has(l));
  const nonEnglish = langs.filter((l) => l !== "en").length;
  if (nonEnglish > langs.length / 4) {
    notes.push(
      `${Math.round((nonEnglish / langs.length) * 100)}% of cards aren't in English; they were matched to the English cards by printed name.`,
    );
  }
  if (unresolved.length) notes.push(`Couldn't match: ${unresolved.join(", ")}.`);
  if (failures.length) notes.push(`${failures.length} of ${tasks.length} reading passes failed.`);
  notes.push(...fulls.flatMap((f) => f.notes).slice(0, 3));

  return assemble(
    isCommander ? "commander" : "other",
    formatConfidence,
    commanderCards,
    entries,
    fulls.find((f) => f.deckName)?.deckName ?? null,
    notes,
  );
}

export async function recognizeText(text: string): Promise<RecognitionResult> {
  const parsed = parseDecklist(text);
  const total = parsed.entries.reduce((n, e) => n + e.qty, 0) + parsed.commanders.length;
  const looksCommander = parsed.commanders.length > 0 || (total >= 95 && total <= 101);
  const merged = new Map<string, number>();
  for (const e of parsed.entries) merged.set(e.name, (merged.get(e.name) ?? 0) + e.qty);
  const resolved = await resolveNames([...parsed.commanders, ...merged.keys()]);
  const byName = new Map(resolved.map((r) => [r.requested, r]));
  const commanderCards: Card[] = [];
  const entries: RecognizedEntry[] = [];
  for (const n of parsed.commanders) {
    const card = byName.get(n)?.card;
    if (!card) continue;
    if (card.canBeCommander) commanderCards.push(card);
    else entries.push({ raw: n, qty: 1, name: card.name, status: byName.get(n)!.status, card });
  }
  for (const [raw, qty] of merged) {
    const r = byName.get(raw)!;
    entries.push({
      raw,
      qty,
      name: r.card?.name ?? raw,
      status: r.status,
      card: r.card ?? undefined,
    });
  }
  return assemble(
    looksCommander ? "commander" : "other",
    parsed.commanders.length ? 1 : 0.6,
    commanderCards,
    entries,
    null,
    [],
  );
}

/** Shared final step: merge duplicates, pick commanders, and add review notes. */
function assemble(
  format: "commander" | "other",
  formatConfidence: number,
  commanderCards: Card[],
  rawEntries: RecognizedEntry[],
  deckName: string | null,
  notes: string[],
): RecognitionResult {
  const entries = new Map<string, RecognizedEntry>();
  for (const e of rawEntries) {
    const existing = entries.get(e.name);
    if (existing) existing.qty += e.qty;
    else entries.set(e.name, { ...e });
  }
  const commanders = [...new Map(commanderCards.map((c) => [c.name, c])).values()];
  const list = [...entries.values()].filter((e) => !commanders.some((c) => c.name === e.name));
  const candidates = list.filter((e) => e.card?.canBeCommander).map((e) => e.name);
  if (format === "commander" && commanders.length === 0 && candidates.length === 1) {
    const only = list.splice(
      list.findIndex((e) => e.name === candidates[0]),
      1,
    )[0];
    commanders.push(only.card!);
  }
  if (commanders.length) {
    const identity = new Set(commanders.flatMap((c) => c.colorIdentity));
    const offColor = list.filter(
      (e) => e.card && !e.card.colorIdentity.every((c) => identity.has(c)),
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
    commanders: commanders.map((c) => c.name),
    commanderCards: commanders,
    commanderCandidates: candidates.filter((n) => !commanders.some((c) => c.name === n)),
    deckName,
    entries: list,
    notes,
  };
}
