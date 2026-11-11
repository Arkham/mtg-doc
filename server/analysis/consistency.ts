/**
 * Whole-report consistency check: every section that names cards must agree with the deck list.
 * Saving a report runs it, so a code path that forgets to update a section fails loudly instead of
 * publishing a report that contradicts itself.
 */
import type { DecklistCard, Report } from "../../shared/types.ts";
import { isBasicLand } from "../sources/scryfall.ts";

type Counts = Map<string, number>;

const countsOf = (list: { name: string; qty: number }[]): Counts => {
  const m: Counts = new Map();
  for (const c of list) m.set(c.name, (m.get(c.name) ?? 0) + c.qty);
  return m;
};

/** Copies in `a` beyond what `b` has. */
function minus(a: Counts, b: Counts): Counts {
  const out: Counts = new Map();
  for (const [name, qty] of a) {
    const extra = qty - (b.get(name) ?? 0);
    if (extra > 0) out.set(name, extra);
  }
  return out;
}

const describe = (m: Counts) =>
  [...m]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, q]) => (q > 1 ? `${q} ${n}` : n))
    .join(", ") || "nothing";

const sameCounts = (a: Counts, b: Counts) =>
  a.size === b.size && [...a].every(([n, q]) => b.get(n) === q);

/**
 * Problems with a report, as sentences naming the section and cards; empty when consistent.
 * `optimized` is the list being saved alongside it, when there is one.
 */
export function checkReport(
  r: Report,
  optimized?: { commanders: string[]; entries: { name: string; qty: number }[] },
): string[] {
  const problems: string[] = [];
  const list = r.decklist;
  if (!list) return problems;
  const current = countsOf(list);
  const has = (name: string) => current.has(name);

  if (optimized) {
    const saved = countsOf([
      ...optimized.commanders.map((name) => ({ name, qty: 1 })),
      ...optimized.entries,
    ]);
    if (!sameCounts(saved, current))
      problems.push(
        `Deck list: differs from the saved list (only in the report: ${describe(minus(current, saved))}; only in the list: ${describe(minus(saved, current))}).`,
      );
  }
  const total = list.reduce((n, c) => n + c.qty, 0);
  if (r.after.totalCards !== total)
    problems.push(`Stats: ${r.after.totalCards} cards, but the deck list has ${total}.`);

  if (r.original) {
    const initial = countsOf(r.original.decklist);
    const cut = minus(initial, current);
    const added = minus(current, initial);
    const swapOuts = countsOf(r.swaps.map((s) => ({ name: s.out, qty: 1 })));
    const swapIns = countsOf(r.swaps.map((s) => ({ name: s.in, qty: 1 })));
    if (!sameCounts(swapOuts, cut))
      problems.push(
        `Swaps: cut ${describe(swapOuts)}, but the list cut ${describe(cut)} from the submitted deck.`,
      );
    if (!sameCounts(swapIns, added))
      problems.push(
        `Swaps: add ${describe(swapIns)}, but the list added ${describe(added)} to the submitted deck.`,
      );
    for (const c of list) {
      const delta = c.qty - (initial.get(c.name) ?? 0);
      const isNew = !initial.has(c.name);
      if (c.delta !== delta || c.isNew !== isNew)
        problems.push(
          `Deck list: ${c.name} is marked ${c.isNew ? "new" : "not new"} with change ${c.delta}, but the submitted deck makes it ${isNew ? "new" : "not new"} with change ${delta}.`,
        );
    }
    checkCombos(problems, "Combos in the deck as submitted", r.original.combosPresent, (n) =>
      initial.has(n),
    );
  }

  for (const s of r.swaps)
    for (const a of s.alternatives ?? [])
      if (has(a.name))
        problems.push(`Swaps: ${a.name} is suggested instead of ${s.in}, but it's in the deck.`);

  checkCombos(problems, "Combos", r.combosPresent, has);
  for (const c of r.combosOneAway) {
    const missing = c.missing.filter((n) => !has(n));
    if (missing.length !== c.missing.length)
      problems.push(
        `Combos one card away: ${c.cards.join(" + ")} lists ${c.missing.join(", ")} as missing, but the deck has it.`,
      );
    const absent = c.cards.filter((n) => !c.missing.includes(n) && !has(n));
    if (absent.length)
      problems.push(
        `Combos one card away: ${c.cards.join(" + ")} needs ${absent.join(", ")} besides the missing piece.`,
      );
  }

  for (const s of r.synergies ?? []) {
    const absent = s.cards.filter((n) => !has(n));
    if (absent.length)
      problems.push(`Synergies: “${s.title}” uses ${absent.join(", ")}, which isn't in the deck.`);
  }

  const b = r.bracket;
  if (b) {
    for (const name of [...b.after.gameChangers, ...b.after.massLandDenial, ...b.after.extraTurns])
      if (!has(name)) problems.push(`Bracket: counts ${name}, which isn't in the deck.`);
    checkCombos(problems, "Bracket combos", b.after.combos, has);
    for (const e of b.excluded)
      if (has(e.name))
        problems.push(
          `Bracket: ${e.name} is listed as skipped to stay in the bracket, but it's in the deck.`,
        );
    for (const g of b.gameChangerOptions)
      if (g.inDeck !== has(g.name))
        problems.push(
          `Bracket: Game Changer ${g.name} is marked ${g.inDeck ? "in" : "not in"} the deck, but it ${has(g.name) ? "is" : "isn't"}.`,
        );
  }

  for (const m of r.manaSuggestions ?? [])
    for (const c of m.changes) {
      if (c.action === "remove" && !has(c.name))
        problems.push(`Mana suggestions: cuts ${c.name}, which isn't in the deck.`);
      if (c.action === "add" && has(c.name) && !isBasicLand(c.name))
        problems.push(`Mana suggestions: adds ${c.name}, which is already in the deck.`);
    }

  checkGroups(problems, list);
  return problems;
}

function checkCombos(
  problems: string[],
  section: string,
  combos: { cards: string[] }[],
  has: (name: string) => boolean,
) {
  for (const c of combos) {
    const absent = c.cards.filter((n) => !has(n));
    if (absent.length)
      problems.push(
        `${section}: ${c.cards.join(" + ")} needs ${absent.join(", ")}, which isn't in the deck.`,
      );
  }
}

function checkGroups(problems: string[], list: DecklistCard[]) {
  const seen = new Set<string>();
  for (const c of list) {
    if (seen.has(c.name)) problems.push(`Deck list: ${c.name} appears twice.`);
    seen.add(c.name);
    if (c.qty > 1 && !isBasicLand(c.name))
      problems.push(`Deck list: ${c.qty} copies of ${c.name} in a singleton deck.`);
  }
}
