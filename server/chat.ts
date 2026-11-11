import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  Card,
  DeckChange,
  DeckChatMessage,
  DeckEdit,
  EditTarget,
  Report,
} from "../shared/types.ts";
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
import {
  fallbackCombos,
  rebaseSwaps,
  refreshBracketLists,
  reconcileSwaps,
} from "./analysis/reconcile.ts";
import { makeRerun } from "./analysis/rerun.ts";
import { makeViolation } from "./analysis/search.ts";
import { config, llmEnabled } from "./config.ts";
import { chatJson, decide } from "./llm.ts";
import { loadDeck, snapshot, startOptimize, twoCardCombos } from "./pipeline.ts";
import { buildCardIndex } from "./card-index.ts";
import { suggestManaFixes } from "./mana-advice.ts";
import { findSynergies, keepPresentSynergies } from "./synergies.ts";
import { lookupExact, lookupFuzzy } from "./sources/scryfall.ts";
import { estimateBracket, findCombos } from "./sources/spellbook.ts";
import {
  HttpError,
  readMeta,
  readReport,
  setHideSuggestions,
  writeInitial,
  writeMeta,
  writeResults,
} from "./storage.ts";

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
  rerun: z
    .object({
      bracket: z.number().int().min(1).max(5).nullable().optional(),
      budgetTotal: z.number().positive().nullable().optional(),
      budgetPerCard: z.number().positive().nullable().optional(),
      maxSwaps: z.number().int().min(1).max(40).optional(),
      tone: z.enum(["max", "balanced", "casual"]).optional(),
      webResearch: z.boolean().optional(),
    })
    .nullable()
    .catch(null)
    .default(null),
  synergies: z.enum(["again", "more"]).nullable().catch(null).default(null),
  publishSuggestions: z.boolean().nullable().catch(null).default(null),
});

/** A confirmed re-run needs a fairly clear yes; anything else is treated as a new message. */
const CONFIRM_THRESHOLD = 0.7;

function deckSummary(
  deck: Deck,
  report: Report | null,
  target: EditTarget = "optimized",
  suggestionsHidden = false,
) {
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
  const assessed = target === "original" ? b?.before : b?.after;
  const swaps = report?.swaps.length
    ? `The doc's suggested swaps (cut → add): ${report.swaps.map((x) => `${x.out} → ${x.in}`).join("; ")}`
    : "";
  return [
    !report?.original
      ? ""
      : target === "original"
        ? "The user is looking at their deck as submitted, before the doc's suggestions. The list below is that deck, and changes edit it; the suggested deck is then rebuilt from it, keeping the swaps that still apply. It's their real deck, so the target bracket and budget don't limit changes to it; Commander's rules still do."
        : "The user is looking at the doc's suggested (optimized) deck. The list below is that deck, and changes edit it; their deck as submitted stays as it is.",
    `Commander(s):\n${deck.commanders.map((c) => `${c.name} (${c.manaCost}) — ${c.typeLine}\n${c.oracleText}`).join("\n\n")}`,
    `Cards: ${totalCards(deck)} (Commander decks need exactly 100) · price $${totalPrice(deck)}`,
    `Roles (count/typical): ${roles}`,
    b
      ? `Target bracket ${b.target} (${b.name}); this list reads as bracket ${assessed!.bracket}. Game Changers ${assessed!.gameChangers.length}/${b.gameChangerLimit ?? "any"} (${assessed!.gameChangers.join(", ") || "none"}); mass land denial ${BRACKETS[b.target].massLandDenial ? "allowed" : "not allowed"}; two-card combos ${BRACKETS[b.target].twoCardCombos}.`
      : "",
    report
      ? `Optimizer settings: target bracket ${report.options.bracket ?? "keep current"}, deck budget ${report.options.budgetTotal ? `$${report.options.budgetTotal}` : "none"}, per-card budget ${report.options.budgetPerCard ? `$${report.options.budgetPerCard}` : "none"}, up to ${report.options.maxSwaps} swaps, tone ${report.options.tone}, web research ${report.options.webResearch ? "on" : "off"}`
      : "",
    swaps,
    report
      ? `Published site: the doc's suggestions for this deck are ${suggestionsHidden ? "hidden (only the deck as submitted is published)" : "published"}.`
      : "",
    report?.synergies?.length
      ? `Synergies already listed: ${report.synergies.map((x) => x.title).join("; ")}`
      : "",
    target === "optimized" && report?.manaSuggestions?.length
      ? `Suggested land swaps (the user can ask you to apply them):\n${report.manaSuggestions.map((m) => `- ${m.changes.map((c) => `${c.action} ${c.name}`).join(", ")}: ${m.reason}`).join("\n")}`
      : "",
    `Current list:\n${lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const SYSTEM = `You are the mtg doc, an expert Commander (EDH) deckbuilding assistant chatting with the deck's owner.
Answer questions about the deck concisely and concretely. When the user asks for changes, propose them as
"changes": exact official English card names, "add" or "remove", quantities, and a short reason each.
Rules:
- Only propose changes when the user asks for edits (or clearly wants suggestions applied). Questions get answers only.
- Keep the deck at exactly 100 cards: pair every add with a remove unless the user explicitly says otherwise.
- Respect the commander's color identity, singleton (basics excepted), the target bracket and the budget. Every change is validated; invalid ones are rejected.
- Only remove cards that are in the current list.
- Keep "reply" short (2-5 sentences); mention the key trade-offs.
- If the user wants different optimizer settings (another target bracket, a total or per-card budget, more or fewer swaps, a different tone), propose re-running the optimizer instead of card changes: set "rerun" to only the settings that change and leave "changes" empty. In "reply", say what will change and ask them to confirm; the re-run replaces the current suggestions and chat edits. To re-run with the same settings, set "rerun" to {}. Otherwise set "rerun" to null.
- If the user asks to hide the doc's suggestions on the published site for this deck (publish only their deck as submitted), set "publishSuggestions" to false; to show them again, true. It applies right away and doesn't change the list; otherwise set it to null.
- If the user asks for synergies, set "synergies" to "more" to add new ones to those already found, or "again" to replace them with a fresh search. Either runs right away and doesn't change the list; otherwise set it to null.
Reply with JSON only: {"reply": string, "changes": [{"action": "add"|"remove", "name": string, "qty": number, "reason": string}], "rerun": null | {"bracket"?: 1-5, "budgetTotal"?: number | null, "budgetPerCard"?: number | null, "maxSwaps"?: number, "tone"?: "max"|"balanced"|"casual", "webResearch"?: boolean}, "synergies": null | "again" | "more", "publishSuggestions": null | boolean}`;

async function proposeWithLlm(
  deck: Deck,
  report: Report | null,
  history: DeckChatMessage[],
  target: EditTarget,
  suggestionsHidden: boolean,
) {
  const recent = history.slice(-HISTORY_FOR_MODEL).map((m) => ({
    role: m.role,
    content:
      m.role === "assistant" && m.changes?.length
        ? `${m.content}\n[Proposed: ${m.changes.map((c) => `${c.action} ${c.qty} ${c.name}${c.ok ? "" : ` (rejected: ${c.problem})`}`).join("; ")}${m.applied ? " — applied" : ""}]`
        : m.role === "assistant" && m.rerun
          ? `${m.content}\n[Proposed re-run: ${m.rerun.summary}${m.rerun.jobId ? " — started" : " — awaiting confirmation"}]`
          : m.content,
  }));
  return chatJson(ReplySchema, [
    {
      role: "system",
      content: `${SYSTEM}\n\n${deckSummary(deck, report, target, suggestionsHidden)}`,
    },
    ...recent,
  ]);
}

/**
 * Resolves and checks proposed changes in application order. The suggested deck must also fit the
 * bracket and budget; the deck as submitted is the user's own, so only Commander's rules apply.
 */
export async function validateChanges(
  deck: Deck,
  report: Report | null,
  proposed: ProposedChange[],
  budget: { total: number | null; perCard: number | null },
  target: EditTarget = "optimized",
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
  const bracketTarget = report?.bracket?.target ?? 4;
  const flagCache = new Map<string, ReturnType<typeof flagsFor>>();
  const flagOf = (c: Card) => {
    if (!flagCache.has(c.name)) flagCache.set(c.name, flagsFor(c, est));
    return flagCache.get(c.name)!;
  };
  const violation = makeViolation({
    rules: BRACKETS[bracketTarget],
    target: bracketTarget,
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
        (target === "original"
          ? null
          : ((budget.perCard !== null && (card.priceUsd ?? 0) > budget.perCard
              ? `over the $${budget.perCard} per-card budget`
              : null) ?? violation(card, working)));
    }
    const change: DeckChange = { ...base, ok: !problem, card, ...(problem ? { problem } : {}) };
    out.push(change);
    if (change.ok) working = applyChanges(working, [change]);
  }
  return out;
}

export async function chatAboutDeck(
  slug: string,
  message: string,
  view: EditTarget = "optimized",
): Promise<DeckChatMessage> {
  const meta = await readMeta(slug);
  const report = await readReport(slug);
  // Without a report or a stored original there's only one list to talk about.
  const target: EditTarget = report?.original ? view : "optimized";
  const { deck } = await loadDeck(
    slug,
    report && target === "optimized" ? "optimized.txt" : "initial.txt",
  );
  const history = await readChat(slug);
  const user: DeckChatMessage = {
    id: randomUUID(),
    role: "user",
    content: message,
    at: new Date().toISOString(),
  };
  history.push(user);

  const confirmed = await confirmsPendingRerun(history, message);
  if (confirmed) {
    const jobId = await startChatRerun(slug, confirmed.id, history);
    const assistant: DeckChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: `On it: re-optimizing for ${confirmed.rerun!.summary}. The report updates when the run finishes.`,
      at: new Date().toISOString(),
      rerun: { ...confirmed.rerun!, jobId },
    };
    history.push(assistant);
    await writeChat(slug, history);
    return assistant;
  }

  let reply: string;
  let proposed: ProposedChange[];
  let rerun: DeckChatMessage["rerun"];
  let reportUpdated = false;
  const parsed = parseCommand(message);
  const llm = llmEnabled()
    ? await proposeWithLlm(deck, report, history, target, Boolean(meta.hideSuggestions)).catch(
        (err: unknown) => ({ error: err }),
      )
    : null;
  if (llm && !("error" in llm)) {
    reply = llm.reply;
    rerun = makeRerun(llm.rerun, meta.options);
    proposed = rerun ? [] : llm.changes;
    if (llm.publishSuggestions !== null && !rerun && report) {
      // Cheap and reversible, so it applies right away like finding synergies.
      await setHideSuggestions(slug, !llm.publishSuggestions);
      reportUpdated = true;
      reply = `${reply}\n\n(${llm.publishSuggestions ? "The doc's suggestions will be published again" : "The published site will show only your deck as submitted, without the doc's suggestions"} from the next publish.)`;
    }
    if (llm.synergies && !rerun && report) {
      const before = report.synergies?.length ?? 0;
      const updated = await refreshSynergies(slug, llm.synergies).catch(() => null);
      reportUpdated = updated !== null;
      const found = (updated?.synergies?.length ?? 0) - (llm.synergies === "more" ? before : 0);
      reply = !updated
        ? `${reply}\n\n(I couldn't search for synergies just now.)`
        : llm.synergies === "more" && found <= 0
          ? `${reply}\n\n(I didn't find any new ones this time.)`
          : `${reply}\n\n(${found} ${llm.synergies === "more" ? "new " : ""}${found === 1 ? "synergy" : "synergies"} in the Synergies section.)`;
    }
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
    ? await validateChanges(
        deck,
        report,
        proposed,
        {
          total: meta.options.budgetTotal ?? null,
          perCard: meta.options.budgetPerCard ?? null,
        },
        target,
      )
    : [];
  const assistant: DeckChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: reply,
    at: new Date().toISOString(),
    ...(changes.length ? { changes, target } : {}),
    ...(rerun ? { rerun } : {}),
    ...(reportUpdated ? { reportUpdated } : {}),
  };
  history.push(assistant);
  await writeChat(slug, history);
  return assistant;
}

/**
 * When the doc's last message proposed a re-run that hasn't started, asks the decision model whether
 * this reply agrees to it. Returns the proposing message if so.
 */
async function confirmsPendingRerun(history: DeckChatMessage[], message: string) {
  const last = history.slice(0, -1).findLast((m) => m.role === "assistant");
  if (!last?.rerun || last.rerun.jobId || !llmEnabled()) return null;
  const answers = await decide(
    `The assistant proposed re-running a deck optimizer with new settings (${last.rerun.summary}) and asked: "${last.content}"\nThe user replied: "${message}"`,
    [],
    [
      {
        name: "confirms",
        instructions:
          "The user's reply agrees to go ahead with the proposed re-run now, without asking for anything different.",
      },
    ],
  ).catch(() => new Map<string, number>());
  return (answers.get("confirms") ?? 0) >= CONFIRM_THRESHOLD ? last : null;
}

/** Saves the proposed settings and starts the optimizer; the proposal remembers the job. */
export async function startChatRerun(
  slug: string,
  messageId: string,
  history?: DeckChatMessage[],
): Promise<string> {
  const messages = history ?? (await readChat(slug));
  const message = messages.find((m) => m.id === messageId);
  if (!message?.rerun) throw new HttpError(404, "No re-run proposed in that message.");
  if (message.rerun.jobId) throw new HttpError(409, "That re-run already started.");
  const meta = await readMeta(slug);
  meta.options = { ...meta.options, ...message.rerun.options };
  await writeMeta(meta);
  const jobId = startOptimize(slug).id;
  message.rerun = { ...message.rerun, jobId };
  if (!history) await writeChat(slug, messages);
  return jobId;
}

/**
 * Validates and applies changes to the current list, then brings every section that names cards up
 * to date: stats, simulation, bracket, combos, mana suggestions, swaps, synergies and card previews.
 */
export async function applyDeckChanges(
  slug: string,
  proposed: DeckChange[],
  request: string,
  target: EditTarget = "optimized",
): Promise<{ report: Report; changes: DeckChange[] }> {
  const meta = await readMeta(slug);
  const report = await readReport(slug);
  if (!report) throw new HttpError(409, "Optimize the deck before editing it.");
  const editsOriginal = target === "original" && Boolean(report.original);
  const budget = {
    total: meta.options.budgetTotal ?? null,
    perCard: meta.options.budgetPerCard ?? null,
  };
  const { deck } = await loadDeck(slug, "optimized.txt");
  const { deck: submitted } = await loadDeck(slug, "initial.txt");
  const changes = await validateChanges(
    editsOriginal ? submitted : deck,
    report,
    proposed.filter((c) => c.ok),
    budget,
    editsOriginal ? "original" : "optimized",
  );
  const valid = changes.filter((c) => c.ok);
  if (!valid.length) throw new HttpError(409, "None of those changes are valid any more.");

  const edits: DeckEdit[] = [
    ...(report.edits ?? []),
    {
      at: new Date().toISOString(),
      request,
      ...(editsOriginal ? { target: "original" as const } : {}),
      changes: valid.map((c) => ({
        action: c.action,
        name: c.name,
        qty: c.qty,
        reason: c.reason,
      })),
    },
  ];
  // Editing the submitted list rebuilds the suggested deck from it, keeping the swaps that still apply.
  const initial = editsOriginal ? applyChanges(submitted, valid) : submitted;
  const rebased = editsOriginal
    ? rebaseSwaps(initial, report.swaps, new Map(deck.slots.map((s) => [s.card.name, s.card])))
    : { deck: applyChanges(deck, valid), swaps: report.swaps };
  const next = rebased.deck;

  const commanders = next.commanders.map((c) => c.name);
  const identity = identityOf(next.commanders);
  const legalMain = (d: Deck) =>
    d.slots
      .filter((s) => s.card.colorIdentity.every((c) => identity.includes(c)))
      .map((s) => s.card.name);
  const isCommander = meta.format === "commander";
  const [est, found, before] = await Promise.all([
    estimateBracket(commanders, legalMain(next)).catch(() => null),
    findCombos(commanders, legalMain(next), identity).catch(() => null),
    editsOriginal ? recomputeOriginal(report, initial, legalMain(initial), isCommander) : null,
  ]);
  const avgLands = report.edhrec?.avgLands ?? null;
  const after = snapshot(next, avgLands, isCommander, twoCardCombos(est));
  const assessed = report.bracket && assessBracket(next, est, after.sim, report.bracket.target);
  // Edits can complete or break combos; if the search fails, keep only those that still hold.
  const combos =
    found ??
    fallbackCombos(
      { present: report.combosPresent, oneAway: report.combosOneAway },
      next,
      assessed?.combos,
    );
  const bracketTarget = report.bracket?.target ?? 4;
  const manaSuggestions = isCommander
    ? await suggestManaFixes({
        deck: next,
        identity,
        avgLands,
        budgetPerCard: budget.perCard,
        violation: makeViolation({
          rules: BRACKETS[bracketTarget],
          target: bracketTarget,
          flagOf: (c) => flagsFor(c, est),
          budgetTotal: budget.total,
        }),
        locked: new Set([...meta.options.locked, ...commanders]),
      }).catch(() => report.manaSuggestions ?? [])
    : [];
  const present = keepPresentSynergies(report.synergies, next);
  const added = valid
    .filter((c) => c.action === "add" && next.slots.some((s) => s.card.name === c.name))
    .map((c) => c.name);
  const newSynergies =
    llmEnabled() && added.length && present
      ? await findSynergies(next, combos.present, present, added).catch(() => [])
      : [];
  const bracket = report.bracket && {
    ...report.bracket,
    ...(before ? { before: before.bracket } : {}),
    after: assessed!,
  };
  const updated: Report = {
    ...report,
    ...(before ? { before: before.snapshot, original: before.original } : {}),
    after,
    combosPresent: combos.present,
    combosOneAway: combos.oneAway.slice(0, 20),
    decklist: toDecklist(next, initial),
    bracket: bracket && refreshBracketLists(bracket, next),
    manaSuggestions,
    swaps: reconcileSwaps(
      rebased.swaps,
      initial,
      next,
      edits.filter((e) => e.target !== "original"),
    ),
    synergies: present && [...present, ...newSynergies],
    edits,
  };
  updated.cardIndex = await buildCardIndex(
    updated,
    valid.flatMap((c) => (c.card ? [c.card] : [])),
  );
  await writeResults(slug, updated, { commanders, entries: toEntries(next) });
  if (editsOriginal) await writeInitial(slug, commanders, toEntries(initial));
  return { report: updated, changes };
}

/** Stats, bracket and combos of an edited submitted list, as the pipeline computes them. */
async function recomputeOriginal(
  report: Report,
  initial: Deck,
  legalMain: string[],
  isCommander: boolean,
) {
  const commanders = initial.commanders.map((c) => c.name);
  const identity = identityOf(initial.commanders);
  const [est, found] = await Promise.all([
    estimateBracket(commanders, legalMain).catch(() => null),
    findCombos(commanders, legalMain, identity).catch(() => null),
  ]);
  const snap = snapshot(initial, null, isCommander, twoCardCombos(est));
  const bracket = report.bracket
    ? assessBracket(initial, est, snap.sim, report.bracket.target)
    : undefined;
  const o = report.original!;
  const combos =
    found ??
    fallbackCombos(
      { present: o.combosPresent, oneAway: o.combosOneAway },
      initial,
      bracket?.combos,
    );
  return {
    snapshot: snap,
    bracket,
    original: {
      decklist: toDecklist(initial, initial),
      combosPresent: combos.present,
      combosOneAway: combos.oneAway.slice(0, 20),
    },
  };
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
  const { report, changes } = await applyDeckChanges(
    slug,
    message.changes,
    request,
    message.target,
  );
  history[index] = { ...message, changes, applied: true };
  await writeChat(slug, history);
  return { report, message: history[index] };
}

/**
 * Re-runs the synergy search for the current list (e.g. after edits added new cards), or with
 * "more" keeps the current synergies and adds new ones.
 */
export async function refreshSynergies(
  slug: string,
  mode: "again" | "more" = "again",
): Promise<Report> {
  const report = await readReport(slug);
  if (!report) throw new HttpError(409, "Optimize the deck first.");
  if (!llmEnabled()) throw new HttpError(409, "Finding synergies needs an LLM configured.");
  const { deck } = await loadDeck(slug, "optimized.txt");
  const current = keepPresentSynergies(report.synergies, deck) ?? [];
  const synergies =
    mode === "more"
      ? [...current, ...(await findSynergies(deck, report.combosPresent, current))]
      : await findSynergies(deck, report.combosPresent);
  const updated: Report = { ...report, synergies };
  updated.cardIndex = await buildCardIndex(updated);
  const commanders = deck.commanders.map((c) => c.name);
  await writeResults(slug, updated, { commanders, entries: toEntries(deck) });
  return updated;
}

export async function applyManaSuggestion(slug: string, id: string): Promise<Report> {
  const report = await readReport(slug);
  const suggestion = report?.manaSuggestions?.find((m) => m.id === id);
  if (!suggestion) throw new HttpError(404, "That suggestion is no longer available.");
  return (await applyDeckChanges(slug, suggestion.changes, `Mana base: ${suggestion.reason}`))
    .report;
}
