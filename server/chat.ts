import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Card, DeckChange, DeckChatMessage, Report } from "../shared/types.ts";
import { BRACKETS, assessBracket, flagsFor } from "./analysis/bracket.ts";
import {
  type Deck,
  countRoles,
  identityOf,
  toDecklist,
  toEntries,
  totalCards,
  totalPrice,
} from "./analysis/deck.ts";
import {
  type ProposedChange,
  applyChanges,
  joinCommaNames,
  matchInDeck,
  parseCommand,
  structuralProblem,
} from "./analysis/edits.ts";
import { makeViolation } from "./analysis/search.ts";
import { config, llmEnabled } from "./config.ts";
import { chatJson } from "./llm.ts";
import { loadDeck, snapshot, twoCardCombos } from "./pipeline.ts";
import { buildCardIndex } from "./card-index.ts";
import { suggestManaFixes } from "./mana-advice.ts";
import { findSynergies, keepPresentSynergies } from "./synergies.ts";
import { renderMarkdown } from "./report.ts";
import { lookupExact, lookupFuzzy } from "./sources/scryfall.ts";
import { estimateBracket, findCombos } from "./sources/spellbook.ts";
import { HttpError, readMeta, readReport, writeResults } from "./storage.ts";

const HISTORY_FILE = "chat.json";
const SIMPLE_COMMANDS_HELP =
  "Simple edits always work: “add Arcane Signet”, “remove Sol Ring” or “swap Sol Ring for Mind Stone”.";
const HISTORY_FOR_MODEL = 12;

const chatPath = (slug: string) => path.join(config.decksDir, slug, HISTORY_FILE);

export async function readChat(slug: string): Promise<DeckChatMessage[]> {
  await readMeta(slug);
  return fs.readFile(chatPath(slug), "utf8").then(
    (t) => JSON.parse(t) as DeckChatMessage[],
    () => [],
  );
}

const writeChat = (slug: string, messages: DeckChatMessage[]) =>
  fs.writeFile(chatPath(slug), JSON.stringify(messages, null, 2));

const ReplySchema = z.object({
  reply: z.string(),
  changes: z
    .array(
      z.object({
        action: z.enum(["add", "remove"]),
        name: z.string().min(1),
        qty: z.coerce.number().int().positive().catch(1),
        reason: z.string().catch(""),
      }),
    )
    .catch([]),
});

function deckSummary(deck: Deck, report: Report | null) {
  const lines = deck.slots
    .map(
      (s) =>
        `${s.qty} ${s.card.name} | ${s.card.typeLine} | mv${s.card.cmc} | ${s.card.roles.join("/")}${s.card.priceUsd !== null ? ` | $${s.card.priceUsd}` : ""}`,
    )
    .sort();
  const roles = countRoles(deck, true)
    .filter((r) => r.target !== null)
    .map((r) => `${r.role} ${r.count}/${r.target}`)
    .join(", ");
  const b = report?.bracket;
  return [
    `Commander(s):\n${deck.commanders.map((c) => `${c.name} (${c.manaCost}) — ${c.typeLine}\n${c.oracleText}`).join("\n\n")}`,
    `Cards: ${totalCards(deck)} (Commander decks need exactly 100) · price $${totalPrice(deck)}`,
    `Roles (count/typical): ${roles}`,
    b
      ? `Target bracket ${b.target} (${b.name}): Game Changers ${b.after.gameChangers.length}/${b.gameChangerLimit ?? "any"} (${b.after.gameChangers.join(", ") || "none"}); mass land denial ${BRACKETS[b.target].massLandDenial ? "allowed" : "not allowed"}; two-card combos ${BRACKETS[b.target].twoCardCombos}.`
      : "",
    report?.options.budgetTotal ? `Deck budget: $${report.options.budgetTotal}` : "",
    report?.options.budgetPerCard ? `Max per card: $${report.options.budgetPerCard}` : "",
    `Current list:\n${lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const SYSTEM = `You are mtg-doc, an expert Commander (EDH) deckbuilding assistant chatting with the deck's owner.
Answer questions about the deck concisely and concretely. When the user asks for changes, propose them as
"changes": exact official English card names, "add" or "remove", quantities, and a short reason each.
Rules:
- Only propose changes when the user asks for edits (or clearly wants suggestions applied). Questions get answers only.
- Keep the deck at exactly 100 cards: pair every add with a remove unless the user explicitly says otherwise.
- Respect the commander's color identity, singleton (basics excepted), the target bracket and the budget. Every change is validated; invalid ones are rejected.
- Only remove cards that are in the current list.
- Keep "reply" short (2-5 sentences); mention the key trade-offs.
Reply with JSON only: {"reply": string, "changes": [{"action": "add"|"remove", "name": string, "qty": number, "reason": string}]}`;

async function proposeWithLlm(deck: Deck, report: Report | null, history: DeckChatMessage[]) {
  const recent = history.slice(-HISTORY_FOR_MODEL).map((m) => ({
    role: m.role,
    content:
      m.role === "assistant" && m.changes?.length
        ? `${m.content}\n[Proposed: ${m.changes.map((c) => `${c.action} ${c.qty} ${c.name}${c.ok ? "" : ` (rejected: ${c.problem})`}`).join("; ")}${m.applied ? " — applied" : ""}]`
        : m.content,
  }));
  return chatJson(ReplySchema, [
    { role: "system", content: `${SYSTEM}\n\n${deckSummary(deck, report)}` },
    ...recent,
  ]);
}

/** Resolves and checks proposed changes against the deck, bracket and budget, in application order. */
export async function validateChanges(
  deck: Deck,
  report: Report | null,
  proposed: ProposedChange[],
  budget: { total: number | null; perCard: number | null },
): Promise<DeckChange[]> {
  const identity = identityOf(deck.commanders);
  // Card names can contain commas; re-join pieces of a split name before resolving anything.
  const commaCandidates = proposed.flatMap((p, i) =>
    p.afterComma && i > 0 && proposed[i - 1].action === "add" && p.action === "add"
      ? [`${proposed[i - 1].name}, ${p.name}`]
      : [],
  );
  const joinedHits = commaCandidates.length
    ? await lookupExact(commaCandidates)
    : new Map<string, Card>();
  proposed = joinCommaNames(proposed, (name, action) =>
    action === "remove"
      ? !!matchInDeck(name, deck) || deck.commanders.some((c) => c.name === name)
      : joinedHits.has(name),
  );
  // Removals only ever match cards already in the deck: a global fuzzy match could cut a card the
  // user never named. Additions resolve against all of Magic.
  const removeCard = (name: string) => matchInDeck(name, deck);
  const addNames = [...new Set(proposed.filter((p) => p.action === "add").map((p) => p.name))];
  const exact = await lookupExact(addNames);
  const cards = new Map<string, Card | null>();
  for (const n of addNames) cards.set(n, exact.get(n) ?? (await lookupFuzzy(n)));

  const adds = [...cards.values()].filter((c): c is Card => !!c);
  const est = adds.length
    ? await estimateBracket(
        deck.commanders.map((c) => c.name),
        adds.map((c) => c.name),
      ).catch(() => null)
    : null;
  const target = report?.bracket?.target ?? 4;
  const flagCache = new Map<string, ReturnType<typeof flagsFor>>();
  const flagOf = (c: Card) => {
    if (!flagCache.has(c.name)) flagCache.set(c.name, flagsFor(c, est));
    return flagCache.get(c.name)!;
  };
  const violation = makeViolation({
    rules: BRACKETS[target],
    target,
    flagOf,
    budgetTotal: budget.total,
  });

  let working = deck;
  const out: DeckChange[] = [];
  const ordered = [
    ...proposed.filter((p) => p.action === "remove"),
    ...proposed.filter((p) => p.action === "add"),
  ];
  for (const p of ordered) {
    const card = p.action === "remove" ? removeCard(p.name) : (cards.get(p.name) ?? null);
    const base = { action: p.action, name: card?.name ?? p.name, qty: p.qty, reason: p.reason };
    if (!card) {
      out.push({
        ...base,
        ok: false,
        problem:
          p.action === "remove" ? "not in the deck" : `couldn't find a card named “${p.name}”`,
      });
      continue;
    }
    let problem: string | null = null;
    if (p.action === "remove") {
      const slot = working.slots.find((s) => s.card.name === card.name);
      if (deck.commanders.some((c) => c.name === card.name)) problem = "it's your commander";
      else if (!slot) problem = "not in the deck";
      else if (slot.qty < p.qty) problem = `only ${slot.qty} in the deck`;
    } else {
      problem =
        structuralProblem(card, working, identity) ??
        (budget.perCard !== null && (card.priceUsd ?? 0) > budget.perCard
          ? `over the $${budget.perCard} per-card budget`
          : null) ??
        violation(card, working);
    }
    const change: DeckChange = { ...base, ok: !problem, card, ...(problem ? { problem } : {}) };
    out.push(change);
    if (change.ok) working = applyChanges(working, [change]);
  }
  return out;
}

export async function chatAboutDeck(slug: string, message: string): Promise<DeckChatMessage> {
  const meta = await readMeta(slug);
  const report = await readReport(slug);
  const { deck } = await loadDeck(slug, report ? "optimized.txt" : "initial.txt");
  const history = await readChat(slug);
  const user: DeckChatMessage = {
    id: randomUUID(),
    role: "user",
    content: message,
    at: new Date().toISOString(),
  };
  history.push(user);

  let reply: string;
  let proposed: ProposedChange[];
  const parsed = parseCommand(message);
  const llm = llmEnabled()
    ? await proposeWithLlm(deck, report, history).catch((err: unknown) => ({ error: err }))
    : null;
  if (llm && !("error" in llm)) {
    reply = llm.reply;
    proposed = llm.changes;
  } else if (parsed) {
    // Simple commands work without the model, including when the provider refuses a request.
    proposed = parsed;
    reply = "Here's what that would change. Apply it when you're happy.";
  } else {
    proposed = [];
    reply = !llm
      ? SIMPLE_COMMANDS_HELP
      : /content_filter|content management policy/i.test(String((llm as { error: unknown }).error))
        ? `The AI provider's content filter blocked that request (Magic card names sometimes trip it). Try rephrasing, or use a simple edit. ${SIMPLE_COMMANDS_HELP}`
        : `I couldn't reach the AI model just now. ${SIMPLE_COMMANDS_HELP}`;
  }
  const changes = proposed.length
    ? await validateChanges(deck, report, proposed, {
        total: meta.options.budgetTotal ?? null,
        perCard: meta.options.budgetPerCard ?? null,
      })
    : [];
  const assistant: DeckChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: reply,
    at: new Date().toISOString(),
    ...(changes.length ? { changes } : {}),
  };
  history.push(assistant);
  await writeChat(slug, history);
  return assistant;
}

/**
 * Applies the valid changes from an assistant message to the current list, re-validating first,
 * then recomputes the report's stats, simulation and bracket check.
 */
/**
 * Validates and applies changes to the current list, then recomputes everything derived from the
 * deck: stats, simulation, bracket, combos, mana suggestions and card previews.
 */
export async function applyDeckChanges(
  slug: string,
  proposed: DeckChange[],
  request: string,
): Promise<{ report: Report; changes: DeckChange[] }> {
  const meta = await readMeta(slug);
  const report = await readReport(slug);
  if (!report) throw new HttpError(409, "Optimize the deck before editing it.");
  const budget = {
    total: meta.options.budgetTotal ?? null,
    perCard: meta.options.budgetPerCard ?? null,
  };
  const { deck } = await loadDeck(slug, "optimized.txt");
  const { deck: initial } = await loadDeck(slug, "initial.txt");
  const changes = await validateChanges(
    deck,
    report,
    proposed.filter((c) => c.ok),
    budget,
  );
  const valid = changes.filter((c) => c.ok);
  if (!valid.length) throw new HttpError(409, "None of those changes are valid any more.");
  const next = applyChanges(deck, valid);

  const commanders = next.commanders.map((c) => c.name);
  const identity = identityOf(next.commanders);
  const legalMain = next.slots
    .filter((s) => s.card.colorIdentity.every((c) => identity.includes(c)))
    .map((s) => s.card.name);
  const [est, combos] = await Promise.all([
    estimateBracket(commanders, legalMain).catch(() => null),
    findCombos(commanders, legalMain, identity).catch(() => null),
  ]);
  const avgLands = report.edhrec?.avgLands ?? null;
  const after = snapshot(next, avgLands, meta.format === "commander", twoCardCombos(est));
  const target = report.bracket?.target ?? 4;
  const manaSuggestions =
    meta.format === "commander"
      ? await suggestManaFixes({
          deck: next,
          identity,
          avgLands,
          budgetPerCard: budget.perCard,
          violation: makeViolation({
            rules: BRACKETS[target],
            target,
            flagOf: (c) => flagsFor(c, est),
            budgetTotal: budget.total,
          }),
          locked: new Set([...meta.options.locked, ...commanders]),
        }).catch(() => report.manaSuggestions ?? [])
      : [];
  const updated: Report = {
    ...report,
    after,
    // Edits can complete or break combos, so the lists are recomputed from the new deck.
    ...(combos
      ? { combosPresent: combos.present, combosOneAway: combos.oneAway.slice(0, 20) }
      : {}),
    decklist: toDecklist(next, initial),
    bracket: report.bracket
      ? { ...report.bracket, after: assessBracket(next, est, after.sim, report.bracket.target) }
      : report.bracket,
    manaSuggestions,
    synergies: keepPresentSynergies(report.synergies, next),
    edits: [
      ...(report.edits ?? []),
      {
        at: new Date().toISOString(),
        request,
        changes: valid.map((c) => ({
          action: c.action,
          name: c.name,
          qty: c.qty,
          reason: c.reason,
        })),
      },
    ],
  };
  updated.cardIndex = await buildCardIndex(
    updated,
    valid.flatMap((c) => (c.card ? [c.card] : [])),
  );
  await writeResults(
    slug,
    updated,
    { commanders, entries: toEntries(next) },
    renderMarkdown(updated),
  );
  return { report: updated, changes };
}

export async function applyChatChanges(
  slug: string,
  messageId: string,
): Promise<{ report: Report; message: DeckChatMessage }> {
  const history = await readChat(slug);
  const index = history.findIndex((m) => m.id === messageId);
  const message = history[index];
  if (!message?.changes?.length) throw new HttpError(404, "No changes to apply in that message.");
  if (message.applied) throw new HttpError(409, "Those changes were already applied.");
  const request =
    history
      .slice(0, index)
      .reverse()
      .find((m) => m.role === "user")?.content ?? "";
  const { report, changes } = await applyDeckChanges(slug, message.changes, request);
  history[index] = { ...message, changes, applied: true };
  await writeChat(slug, history);
  return { report, message: history[index] };
}

/** Re-runs the synergy search for the current list (e.g. after edits added new cards). */
export async function refreshSynergies(slug: string): Promise<Report> {
  const report = await readReport(slug);
  if (!report) throw new HttpError(409, "Optimize the deck first.");
  if (!llmEnabled()) throw new HttpError(409, "Finding synergies needs an LLM configured.");
  const { deck } = await loadDeck(slug, "optimized.txt");
  const updated: Report = { ...report, synergies: await findSynergies(deck, report.combosPresent) };
  updated.cardIndex = await buildCardIndex(updated);
  const commanders = deck.commanders.map((c) => c.name);
  await writeResults(
    slug,
    updated,
    { commanders, entries: toEntries(deck) },
    renderMarkdown(updated),
  );
  return updated;
}

export async function applyManaSuggestion(slug: string, id: string): Promise<Report> {
  const report = await readReport(slug);
  const suggestion = report?.manaSuggestions?.find((m) => m.id === id);
  if (!suggestion) throw new HttpError(404, "That suggestion is no longer available.");
  return (await applyDeckChanges(slug, suggestion.changes, `Mana base: ${suggestion.reason}`))
    .report;
}
