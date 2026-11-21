/** Pure helpers for chat-driven deck edits: command parsing, validation order and application. */
import type { Card, DeckChange } from "../../shared/types.ts";
import { isBasicLand } from "../sources/scryfall.ts";
import { type Deck, cloneDeck } from "./deck.ts";

export interface ProposedChange {
  action: "add" | "remove";
  name: string;
  qty: number;
  reason: string;
  /** Split from the previous name at a comma; may belong to it ("Nekusar, the Mindrazer"). */
  afterComma?: boolean;
}

const VERB = /^(add|include|put in|remove|cut|drop|take out|swap|replace)\b/i;

function splitNames(list: string): { name: string; afterComma: boolean }[] {
  const out: { name: string; afterComma: boolean }[] = [];
  const parts = list.split(/(\s*,\s*|\s+and\s+|\s*&\s*)/i);
  for (let i = 0; i < parts.length; i += 2) {
    const name = parts[i]
      .trim()
      .replace(/^(?:a|an|the)\s+/i, "")
      .replace(/[.!?]+$/, "");
    if (!name) continue;
    out.push({ name, afterComma: i > 0 && parts[i - 1].trim() === "," });
  }
  return out;
}

function withQty(raw: string): { name: string; qty: number } {
  const m = raw.match(/^(\d+)\s*x?\s+(.+)$/i);
  return m ? { qty: Math.max(1, Number(m[1])), name: m[2].trim() } : { qty: 1, name: raw };
}

/**
 * Understands simple edit commands without an LLM: "add X", "remove 2 Forest",
 * "swap X for Y", "replace X with Y", several clauses joined by ";" or new lines.
 * Returns null when the text isn't a recognizable command.
 */
export function parseCommand(text: string): ProposedChange[] | null {
  const clauses = text
    .split(/\s*(?:;|\n|\bthen\b|\band\s+(?=(?:add|remove|cut|drop|swap|replace)\b))\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!clauses.length || !clauses.every((c) => VERB.test(c))) return null;
  const out: ProposedChange[] = [];
  for (const clause of clauses) {
    const swap = clause.match(/^(?:swap|replace)\s+(.+?)\s+(?:for|with)\s+(.+)$/i);
    if (swap) {
      const out1 = withQty(swap[1].trim());
      const in1 = withQty(swap[2].trim());
      out.push({ action: "remove", ...out1, reason: "Requested swap" });
      out.push({ action: "add", ...in1, reason: "Requested swap" });
      continue;
    }
    const m = clause.match(/^(add|include|put in|remove|cut|drop|take out)\s+(.+)$/i);
    if (!m) return null;
    const action = /^(add|include|put in)$/i.test(m[1]) ? "add" : "remove";
    for (const n of splitNames(m[2])) {
      out.push({
        action,
        ...withQty(n.name),
        reason: "Requested",
        ...(n.afterComma ? { afterComma: true } : {}),
      });
    }
  }
  return out;
}

/**
 * Re-joins names split at a comma when the joined name is a real card, e.g. "Lathril" + "Blade of
 * the Elves". `isCard` decides (deck lookup for removals, card database for additions).
 */
export function joinCommaNames(
  changes: ProposedChange[],
  isCard: (name: string, action: ProposedChange["action"]) => boolean,
): ProposedChange[] {
  const out: ProposedChange[] = [];
  for (const c of changes) {
    const prev = out.at(-1);
    const joined = prev ? `${prev.name}, ${c.name}` : "";
    if (c.afterComma && prev && prev.action === c.action && isCard(joined, c.action)) {
      out[out.length - 1] = { ...prev, name: joined };
    } else {
      const { afterComma: _, ...rest } = c;
      out.push(rest);
    }
  }
  return out;
}

/** Applies validated changes, removals first so adds are checked against the trimmed deck. */
export function applyChanges(deck: Deck, changes: DeckChange[]): Deck {
  const next = cloneDeck(deck);
  const ordered = [
    ...changes.filter((c) => c.action === "remove"),
    ...changes.filter((c) => c.action === "add"),
  ];
  for (const c of ordered) {
    if (!c.ok || !c.card) continue;
    const slot = next.slots.find((s) => s.card.name === c.card!.name);
    if (c.action === "remove") {
      if (!slot) continue;
      slot.qty -= c.qty;
      if (slot.qty <= 0) next.slots.splice(next.slots.indexOf(slot), 1);
    } else if (slot) {
      slot.qty += c.qty;
    } else {
      next.slots.push({ card: c.card, qty: c.qty });
    }
  }
  return next;
}

/** Why a card can't be added on structural grounds (singleton, legality, identity), or null. */
export function structuralProblem(card: Card, deck: Deck, identity: string[]): string | null {
  if (!card.legalCommander) return "not legal in Commander";
  if (!card.colorIdentity.every((c) => identity.includes(c)))
    return "outside the commander's color identity";
  if (deck.commanders.some((c) => c.name === card.name)) return "it's your commander";
  if (!isBasicLand(card.name) && deck.slots.some((s) => s.card.name === card.name))
    return "already in the deck (Commander decks are singleton)";
  return null;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

/**
 * Edit distance where swapping two neighbouring letters counts as one edit (optimal string
 * alignment), since that's the most common typo in card names.
 */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Finds the deck card a name refers to: exact (case/punctuation-insensitive), front face of a
 * double-faced card, or a close typo (within 20% of the name's length).
 */
export function matchInDeck(name: string, deck: Deck): Card | null {
  const target = normalize(name);
  if (!target) return null;
  const cards = deck.slots.map((s) => s.card);
  const exact = cards.find(
    (c) => normalize(c.name) === target || normalize(c.name.split(" // ")[0]) === target,
  );
  if (exact) return exact;
  let best: { card: Card; d: number } | null = null;
  for (const card of cards) {
    const d = distance(target, normalize(card.name.split(" // ")[0]));
    if (!best || d < best.d) best = { card, d };
  }
  return best && best.d <= Math.max(1, Math.floor(target.length * 0.2)) ? best.card : null;
}
