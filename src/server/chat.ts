import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Card,
  DeckChange,
  DeckChatMessage,
  DeckEdit,
  EditTarget,
  Report,
  Swap,
} from "../shared/types.ts";
import { BRACKETS, assessBracket, flagsFor } from "./analysis/bracket.ts";
import {
  type Deck,
  byName,
  cardsOf,
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
  applicableManaSuggestions,
  fallbackCombos,
  onSubmittedList,
  provisionalEstimate,
  realizedSwaps,
  rebaseSwaps,
  refreshBracketLists,
  reconcileSwaps,
} from "./analysis/reconcile.ts";
import { CARD_REFS_RULE, CardNameSchema, indexResolver } from "./analysis/prose.ts";
import { refsIn, resolveRefs } from "../shared/card-refs.ts";
import { makeRerun } from "./analysis/rerun.ts";
import { makeViolation } from "./analysis/search.ts";
import { llmEnabled } from "./config.ts";
import { enqueueEdit } from "./edit-queue.ts";
import { originalStats, scheduleRefresh } from "./refresh.ts";
import { patchMessage, readChat, updateChat } from "./chat-history.ts";
import { chatJson, chatJsonStream, decide } from "./llm.ts";
import { partialStringField } from "./analysis/partial-json.ts";
import { loadDeck, snapshot, startOptimize, twoCardCombos } from "./pipeline.ts";
import { buildCardIndex, isNamedCard, looksLikeNickname } from "./card-index.ts";
import { findSynergies, keepPresentSynergies } from "./synergies.ts";
import { keepGuidesTo } from "./play-guide.ts";
import { isBasicLand, lookupExact, lookupFuzzy } from "./sources/scryfall.ts";
import { estimateBracket } from "./sources/spellbook.ts";
import {
  HttpError,
  readMeta,
  readCards,
  readReport,
  setHideSuggestions,
  writeCards,
  writeInitial,
  writeMeta,
  writeResults,
} from "./storage.ts";

const SIMPLE_COMMANDS_HELP =
  "Simple edits always work: “add [[Arcane Signet]]”, “remove [[Sol Ring]]” or “swap [[Sol Ring]] for [[Mind Stone]]”.";
const HISTORY_FOR_MODEL = 12;

const ReplySchema = z.object({
  reply: z.string(),
  changes: z
    .array(
      z.object({
        action: z.enum(["add", "remove"]),
        name: CardNameSchema.pipe(z.string().min(1)),
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
  target: z.enum(["original", "optimized"]).nullable().catch(null).default(null),
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
        ? `The user is looking at their deck as submitted, before the doc's suggestions. The list below is that deck, and changes edit it; the suggested deck is then rebuilt from it, keeping the swaps that still apply. ${REAL_DECK} The doc's suggested deck is this list with the swaps below made; if the user asks to change the suggested deck instead, set "target" to "optimized" and write the changes against it.`
        : `The user is looking at the doc's suggested (optimized) deck. The list below is that deck, and changes edit it; their deck as submitted stays as it is. Their deck as submitted is this list with the swaps below undone (each swap's cut in place of its add). If the user asks to change their own deck as submitted ("my deck", "my original list", "the real deck"), or to apply the doc's swaps or suggested land swaps to it, set "target" to "original" and write the changes against that list: to apply a swap, remove its cut and add its add. ${REAL_DECK}`,
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

const REAL_DECK =
  "Their deck as submitted is their real deck, so the target bracket and budget don't limit changes to it; Commander's rules still do.";

const SYSTEM = `You are the mtg doc, an expert Commander (EDH) deckbuilding assistant chatting with the deck's owner.
Answer questions about the deck concisely and concretely. When the user asks for changes, propose them as
"changes": exact official English card names, "add" or "remove", quantities, and a short reason each.
Rules:
- Only propose changes when the user asks for edits (or clearly wants suggestions applied). Questions get answers only.
- Keep the deck at exactly 100 cards: pair every add with a remove unless the user explicitly says otherwise.
- Respect the commander's color identity, singleton (basics excepted), the target bracket and the budget. Every change is validated; invalid ones are rejected.
- Only remove cards that are in the current list.
- Keep "reply" short (2-5 sentences); mention the key trade-offs.
- In "reply" and each change's "reason": ${CARD_REFS_RULE} A change's "name" is the plain card name.
- If the user wants different optimizer settings (another target bracket, a total or per-card budget, more or fewer swaps, a different tone), propose re-running the optimizer instead of card changes: set "rerun" to only the settings that change and leave "changes" empty. In "reply", say what will change and ask them to confirm; the re-run replaces the current suggestions and chat edits. To re-run with the same settings, set "rerun" to {}. Otherwise set "rerun" to null.
- If the user asks to hide the doc's suggestions on the published site for this deck (publish only their deck as submitted), set "publishSuggestions" to false; to show them again, true. It applies right away and doesn't change the list; otherwise set it to null.
- If the user asks for synergies, set "synergies" to "more" to add new ones to those already found, or "again" to replace them with a fresh search. Either runs right away and doesn't change the list; otherwise set it to null.
- "changes" edit the list the user is looking at, unless they ask to change the other one (see below); then set "target" to that list. Otherwise set "target" to null.
Reply with JSON only: {"reply": string, "changes": [{"action": "add"|"remove", "name": string, "qty": number, "reason": string}], "target": null | "original" | "optimized", "rerun": null | {"bracket"?: 1-5, "budgetTotal"?: number | null, "budgetPerCard"?: number | null, "maxSwaps"?: number, "tone"?: "max"|"balanced"|"casual", "webResearch"?: boolean}, "synergies": null | "again" | "more", "publishSuggestions": null | boolean}`;

async function proposeWithLlm(
  deck: Deck,
  report: Report | null,
  history: DeckChatMessage[],
  target: EditTarget,
  suggestionsHidden: boolean,
  onReply?: (reply: string) => void,
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
  const messages = [
    {
      role: "system" as const,
      content: `${SYSTEM}\n\n${deckSummary(deck, report, target, suggestionsHidden)}`,
    },
    ...recent,
  ];
  if (!onReply) return chatJson(ReplySchema, messages);
  let shown = "";
  return chatJsonStream(ReplySchema, messages, (text) => {
    const reply = partialStringField(text, "reply");
    if (reply !== null && reply !== shown) onReply((shown = reply));
  });
}

/**
 * Resolves and checks proposed changes in application order. The suggested deck must also fit the
 * bracket and budget; the deck as submitted is the user's own, so only Commander's rules apply.
 */
/**
 * Checks proposed changes against the deck and its rules. `known` are cards already at hand (the
 * deck's saved ones, those a change carries): adding one of them needs no lookup, and its bracket
 * flags come from the report's own assessments, so only cards new to the deck reach Scryfall and
 * Commander Spellbook.
 */
async function validateChanges(
  deck: Deck,
  report: Report | null,
  proposed: ProposedChange[],
  budget: { total: number | null; perCard: number | null },
  target: EditTarget = "optimized",
  known: Map<string, Card> = new Map(),
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
  const lower = (n: string) => n.toLowerCase();
  const inDeck = byName(cardsOf(deck), lower);
  const knownByName = byName(known.values(), lower);
  const atHand = (n: string) => inDeck.get(lower(n)) ?? knownByName.get(lower(n));
  const unknown = addNames.filter((n) => !atHand(n));
  const exact = await lookupExact(unknown);
  const cards = new Map<string, Card | null>();
  for (const n of addNames) cards.set(n, atHand(n) ?? exact.get(n) ?? (await lookupFuzzy(n)));

  const fresh = unknown
    .map((n) => cards.get(n))
    .filter((c): c is Card => !!c && !isBasicLand(c.name));
  const est = fresh.length
    ? await estimateBracket(
        deck.commanders.map((c) => c.name),
        fresh.map((c) => c.name),
      ).catch(() => null)
    : null;
  // What the report already knows about the cards in its lists.
  const assessed = [report?.bracket?.before, report?.bracket?.after].flatMap((a) =>
    a ? [provisionalEstimate(a, deck)] : [],
  );
  const bracketTarget = report?.bracket?.target ?? 4;
  const flagCache = new Map<string, ReturnType<typeof flagsFor>>();
  const flagOf = (c: Card) => {
    if (!flagCache.has(c.name)) {
      const listed = assessed.find((e) => e?.cards.has(c.name));
      flagCache.set(c.name, flagsFor(c, est?.cards.has(c.name) ? est : (listed ?? est)));
    }
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

/**
 * Answers a message about a deck and saves both to its chat. With `onReply`, the model's reply is
 * passed along as it's written (unsettled: its card references are checked once it's done).
 */
export async function chatAboutDeck(
  slug: string,
  message: string,
  view: EditTarget = "optimized",
  { onReply }: { onReply?: (reply: string) => void } = {},
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

  const confirmed = await confirmsPendingProposal(history, message);
  if (confirmed?.changes) {
    // A yes to proposed card changes applies them, like the Apply button.
    const n = confirmed.changes.filter((c) => c.ok).length;
    const assistant: DeckChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: `On it: applying ${n} change${n === 1 ? "" : "s"}. The report updates as soon as they're in.`,
      at: new Date().toISOString(),
      reportUpdated: true,
    };
    await updateChat(slug, (ms) => [...ms, user, assistant]);
    try {
      await queueProposal(slug, confirmed.id);
    } catch (err) {
      assistant.content = `I couldn't apply those changes: ${err instanceof Error ? err.message : String(err)}`;
      await patchMessage(slug, assistant.id, () => assistant);
    }
    return assistant;
  }
  if (confirmed?.rerun) {
    const jobId = await startChatRerun(slug, confirmed.id);
    const assistant: DeckChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: `On it: re-optimizing for ${confirmed.rerun!.summary}. The report updates when the run finishes.`,
      at: new Date().toISOString(),
      rerun: { ...confirmed.rerun!, jobId },
    };
    await updateChat(slug, (ms) => [...ms, user, assistant]);
    return assistant;
  }

  let reply: string;
  let proposed: ProposedChange[];
  let rerun: DeckChatMessage["rerun"];
  let reportUpdated = false;
  let editTarget = target;
  const parsed = parseCommand(message);
  const llm = llmEnabled()
    ? await proposeWithLlm(
        deck,
        report,
        history,
        target,
        Boolean(meta.hideSuggestions),
        onReply,
      ).catch((err: unknown) => ({ error: err }))
    : null;
  if (llm && !("error" in llm)) {
    reply = llm.reply;
    rerun = makeRerun(llm.rerun, meta.options);
    proposed = rerun ? [] : llm.changes;
    // The user can ask to change the list they aren't looking at.
    if (llm.target && report?.original) editTarget = llm.target;
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
  const editDeck =
    editTarget === target
      ? deck
      : (await loadDeck(slug, editTarget === "optimized" ? "optimized.txt" : "initial.txt")).deck;
  const changes = proposed.length
    ? await validateChanges(
        editDeck,
        report,
        proposed,
        {
          total: meta.options.budgetTotal ?? null,
          perCard: meta.options.budgetPerCard ?? null,
        },
        editTarget,
        await readCards(slug),
      )
    : [];
  const settle = await (
    await refSettler(report, editDeck, changes)
  )([reply, ...changes.map((c) => c.reason)]);
  const assistant: DeckChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: settle(reply),
    at: new Date().toISOString(),
    ...(changes.length
      ? { changes: changes.map((c) => ({ ...c, reason: settle(c.reason) })), target: editTarget }
      : {}),
    ...(rerun ? { rerun } : {}),
    ...(reportUpdated ? { reportUpdated } : {}),
  };
  await updateChat(slug, (ms) => [...ms, user, assistant]);
  return assistant;
}

/**
 * Settles a reply's card references: a card the report, the deck or the changes know, or a real
 * Commander card named in full (`isNamedCard`); anything else goes back to being plain words.
 */
export async function refSettler(report: Report | null, deck: Deck, changes: DeckChange[]) {
  const known = indexResolver({
    ...report?.cardIndex,
    ...Object.fromEntries(
      [
        ...deck.commanders,
        ...deck.slots.map((s) => s.card),
        ...changes.flatMap((c) => c.card ?? []),
      ].map((c) => [c.name, true]),
    ),
  });
  const names = [
    ...Object.keys(report?.cardIndex ?? {}),
    ...deck.slots.map((s) => s.card.name),
    ...deck.commanders.map((c) => c.name),
  ];
  return async (texts: string[]) => {
    const around = [...names, ...texts.flatMap(refsIn)];
    const unknown = [...new Set(texts.flatMap(refsIn))].filter(
      (n) => !known(n) && !looksLikeNickname(n, around),
    );
    const real = unknown.length
      ? await lookupExact(unknown).catch(() => new Map<string, Card>())
      : new Map<string, Card>();
    return (text: string) =>
      resolveRefs(text, (n) => {
        const card = real.get(n);
        return known(n) ?? (card && isNamedCard(card, n) ? card.name : null);
      });
  };
}

/**
 * When the doc's last message proposed something still waiting for the user (a re-run that hasn't
 * started, or card changes not yet applied), asks the decision model whether this reply agrees to
 * it. Returns the proposing message if so.
 */
async function confirmsPendingProposal(history: DeckChatMessage[], message: string) {
  const last = history.slice(0, -1).findLast((m) => m.role === "assistant");
  if (!last || !llmEnabled()) return null;
  const pendingRerun = last.rerun && !last.rerun.jobId;
  const pendingChanges = !last.applied && !last.applying && last.changes?.some((c) => c.ok);
  if (!pendingRerun && !pendingChanges) return null;
  const proposal = pendingRerun
    ? `re-running a deck optimizer with ${last.rerun!.summary}`
    : `these deck changes: ${last
        .changes!.filter((c) => c.ok)
        .map((c) => `${c.action} ${c.name}`)
        .join(", ")}`;
  const answers = await decide(
    `The assistant proposed ${proposal} and said: "${last.content}"\nThe user replied: "${message}"`,
    [],
    [
      {
        name: "confirms",
        instructions: `The user's reply agrees to go ahead with the proposed ${pendingRerun ? "re-run" : "changes"} now, without asking for anything different.`,
      },
    ],
  ).catch(() => new Map<string, number>());
  return (answers.get("confirms") ?? 0) >= CONFIRM_THRESHOLD ? last : null;
}

/** Saves the proposed settings and starts the optimizer; the proposal remembers the job. */
export async function startChatRerun(slug: string, messageId: string): Promise<string> {
  const message = (await readChat(slug)).find((m) => m.id === messageId);
  if (!message?.rerun) throw new HttpError(404, "No re-run proposed in that message.");
  if (message.rerun.jobId) throw new HttpError(409, "That re-run already started.");
  const meta = await readMeta(slug);
  meta.options = { ...meta.options, ...message.rerun.options };
  await writeMeta(meta);
  const jobId = startOptimize(slug, { keepEdits: message.rerun.keepEdits }).id;
  await patchMessage(slug, messageId, (m) => ({ ...m, rerun: { ...m.rerun!, jobId } }));
  return jobId;
}

/**
 * Validates and applies changes to the current list, and brings every section that names cards up
 * to date with it at once: stats, simulation, bracket (from the last estimate), combos and
 * synergies that still hold, land swaps that still apply, swaps and card previews. What needs a
 * fresh look (bracket estimate, combo search, land suggestions, synergies with new cards, guides,
 * the contradiction check) is scheduled for when the edits stop (`scheduleRefresh`). With
 * `fromSuggested`, changes to the submitted list are written against the suggested deck (like a
 * mana suggestion) and carried over to it.
 */
export async function applyDeckChanges(
  slug: string,
  proposed: DeckChange[],
  request: string,
  target: EditTarget = "optimized",
  { fromSuggested = false }: { fromSuggested?: boolean } = {},
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
  const carried =
    editsOriginal && fromSuggested
      ? onSubmittedList(
          proposed.filter((c) => c.ok),
          submitted,
          report.swaps,
        )
      : { changes: proposed.filter((c) => c.ok), spent: [] as Swap[] };
  const known = await readCards(slug);
  for (const c of proposed) if (c.card) known.set(c.card.name, c.card);
  const changes = await validateChanges(
    editsOriginal ? submitted : deck,
    report,
    carried.changes,
    budget,
    editsOriginal ? "original" : "optimized",
    known,
  );
  const valid = changes.filter((c) => c.ok);
  if (!valid.length) throw new HttpError(409, "None of those changes are valid any more.");
  // Swaps the edit made in the submitted list are done, not dropped.
  const settled = editsOriginal
    ? [
        ...carried.spent,
        ...realizedSwaps(
          report.swaps.filter((s) => !carried.spent.includes(s)),
          valid,
        ),
      ]
    : [];

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
    ? rebaseSwaps(
        initial,
        report.swaps.filter((s) => !settled.includes(s)),
        new Map(deck.slots.map((s) => [s.card.name, s.card])),
      )
    : { deck: applyChanges(deck, valid), swaps: report.swaps };
  const next = rebased.deck;

  const commanders = next.commanders.map((c) => c.name);
  const isCommander = meta.format === "commander";
  const est = provisionalEstimate(report.bracket?.after, next);
  const before = editsOriginal
    ? originalStats(
        report,
        initial,
        isCommander,
        provisionalEstimate(report.bracket?.before, initial),
        null,
      )
    : null;
  const after = snapshot(next, report.edhrec?.avgLands ?? null, isCommander, twoCardCombos(est));
  const assessed = report.bracket && assessBracket(next, est, after.sim, report.bracket.target);
  const combos = fallbackCombos(
    { present: report.combosPresent, oneAway: report.combosOneAway },
    next,
    assessed?.combos,
  );
  const bracket = report.bracket && {
    ...report.bracket,
    ...(before ? { before: before.bracket! } : {}),
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
    manaSuggestions: applicableManaSuggestions(report.manaSuggestions, next),
    swaps: reconcileSwaps(
      rebased.swaps,
      initial,
      next,
      edits.filter((e) => e.target !== "original"),
    ),
    synergies: keepPresentSynergies(report.synergies, next),
    howToPlay: keepGuidesTo(report.howToPlay, { original: initial, optimized: next }),
    edits,
  };
  updated.cardIndex = await buildCardIndex(
    updated,
    valid.flatMap((c) => (c.card ? [c.card] : [])),
  );
  await writeResults(slug, updated, { commanders, entries: toEntries(next) });
  if (editsOriginal) await writeInitial(slug, commanders, toEntries(initial));
  await writeCards(slug, cardsOf(initial, next));
  await scheduleRefresh(slug, report, {
    droppedSwaps: report.swaps.length - settled.length - rebased.swaps.length,
    added: valid
      .filter((c) => c.action === "add" && next.slots.some((s) => s.card.name === c.name))
      .map((c) => c.name),
    original: editsOriginal,
    changes: valid,
  });
  return { report: updated, changes };
}

/** Starts applying the changes a chat message proposed; the message says when they're in. */
export async function applyChatChanges(
  slug: string,
  messageId: string,
): Promise<{ message: DeckChatMessage; editId: string }> {
  const editId = await queueProposal(slug, messageId);
  const message = (await readChat(slug)).find((m) => m.id === messageId)!;
  return { message, editId };
}

/**
 * Queues applying an assistant message's proposed changes, marking it as applying, and applied
 * once they're in. An offer to re-run, if they opened gaps, follows with the refresh.
 */
async function queueProposal(slug: string, messageId: string): Promise<string> {
  const history = await readChat(slug);
  const index = history.findIndex((m) => m.id === messageId);
  const message = history[index];
  if (!message?.changes?.length) throw new HttpError(404, "No changes to apply in that message.");
  if (message.applied) throw new HttpError(409, "Those changes were already applied.");
  if (message.applying) throw new HttpError(409, "Those changes are already being applied.");
  if (!message.changes.some((c) => c.ok))
    throw new HttpError(409, "None of those changes are valid any more.");
  const request =
    history
      .slice(0, index)
      .reverse()
      .find((m) => m.role === "user")?.content ?? "";
  const { status } = enqueueEdit(slug, "Apply chat changes", async () => {
    try {
      const result = await applyDeckChanges(slug, message.changes!, request, message.target);
      await updateChat(slug, (ms) =>
        ms.map((m) => {
          if (m.id !== messageId) return m;
          const { applying: _, applyError: __, ...rest } = m;
          return { ...rest, changes: result.changes, applied: true };
        }),
      );
    } catch (err) {
      await patchMessage(slug, messageId, (m) => {
        const { applying: _, ...rest } = m;
        return { ...rest, applyError: err instanceof Error ? err.message : String(err) };
      });
      throw err;
    }
  });
  await patchMessage(slug, messageId, (m) => {
    const { applyError: _, ...rest } = m;
    return { ...rest, applying: true };
  });
  return status.id;
}

/**
 * Re-runs the synergy search for the current list (e.g. after edits added new cards), or with
 * "more" keeps the current synergies and adds new ones.
 */
export function refreshSynergies(slug: string, mode: "again" | "more" = "again"): Promise<Report> {
  return enqueueEdit(slug, "Find synergies", () => findSynergiesAgain(slug, mode)).done;
}

async function findSynergiesAgain(slug: string, mode: "again" | "more"): Promise<Report> {
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

/**
 * Queues a suggested land swap for the deck as submitted (the suggested deck, for older reports);
 * returns the edit's id to poll.
 */
export async function applyManaSuggestion(slug: string, id: string): Promise<string> {
  const report = await readReport(slug);
  const suggestion = report?.manaSuggestions?.find((m) => m.id === id);
  if (!suggestion) throw new HttpError(404, "That suggestion is no longer available.");
  return enqueueEdit(slug, "Apply a land swap", () =>
    applyDeckChanges(
      slug,
      suggestion.changes,
      `Mana base: ${suggestion.reason}`,
      report!.original ? "original" : "optimized",
      { fromSuggested: true },
    ),
  ).status.id;
}

/**
 * Queues one of the doc's swaps for the deck as submitted (the suggested deck stays as it is);
 * returns the edit's id to poll.
 */
export async function applySwap(slug: string, out: string, add: string): Promise<string> {
  const report = await readReport(slug);
  const swap = report?.swaps.find((s) => s.out === out && s.in === add);
  if (!swap) throw new HttpError(404, "That swap is no longer suggested.");
  if (!report!.original)
    throw new HttpError(409, "Re-run the optimizer to apply swaps to your deck.");
  const change = (action: DeckChange["action"], name: string, card?: Card): DeckChange => ({
    action,
    name,
    qty: 1,
    reason: swap.reason,
    ok: true,
    ...(card ? { card } : {}),
  });
  return enqueueEdit(slug, "Apply a swap", () =>
    applyDeckChanges(
      slug,
      [change("remove", swap.out, swap.outCard), change("add", swap.in, swap.inCard)],
      `Swap: ${swap.out} → ${swap.in}`,
      "original",
    ),
  ).status.id;
}
