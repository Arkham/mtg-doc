import type { Report } from "../../shared/types.ts";
import { refsIn } from "../../shared/card-refs.ts";
import { guideTexts, withGuideText } from "./play-guide.ts";

const GUIDE_DECK = { original: "the deck as submitted", optimized: "the suggested deck" } as const;

/** A piece of model-written text in a report, by where it lives. */
export interface ReportText {
  id: string;
  /** What the text is about, for the reviewer. */
  kind: string;
  text: string;
}

/** A contradiction between a text and the report's facts, with the text rewritten to fix it. */
export interface TextFix {
  id: string;
  quote: string;
  problem: string;
  /** The whole text, corrected; null drops a synergy that can't be true at all. */
  fixed: string | null;
}

/** Every text in the report the model wrote and the doc can correct (land-swap reasons are code's). */
export function reportTexts(r: Report): ReportText[] {
  return [
    ...(r.strategy
      ? [{ id: "strategy", kind: "strategy for the suggested deck", text: r.strategy }]
      : []),
    ...r.swaps.map((s, i) => ({
      id: `swap-${i}`,
      kind: `reason for the swap cut ${s.out} → add ${s.in}`,
      text: s.reason,
    })),
    ...(r.synergies ?? []).map((s, i) => ({
      id: `synergy-${i}`,
      kind: `synergy "${s.title}" between ${s.cards.join(" + ")}`,
      text: s.explanation,
    })),
    ...(["original", "optimized"] as const).flatMap((which) => {
      const guide = r.howToPlay?.[which];
      return guide
        ? guideTexts(guide).map((t) => ({
            id: `guide-${which}-${t.key}`,
            kind: `how-to-play guide for ${GUIDE_DECK[which]}, ${t.key}${t.key.startsWith("keyCards.") ? ` (${guide.keyCards[Number(t.key.split(".")[1])].name})` : ""}`,
            text: t.text,
          }))
        : [];
    }),
  ];
}

const names = (cards: { name: string; qty: number }[]) =>
  cards.map((c) => (c.qty > 1 ? `${c.qty} ${c.name}` : c.name)).join("; ");

/** What deterministic code established about the deck, for checking the texts against. */
export function reportFacts(r: Report): string {
  const b = r.bracket;
  const combos = (cs: { cards: string[] }[]) =>
    cs.map((c) => c.cards.join(" + ")).join("; ") || "none";
  const stats = (label: string, s: Report["before"]) =>
    `${label}: ${s.totalCards} cards, $${Math.round(s.totalPriceUsd)}, ${s.mana.landCount} lands (recommended ${s.mana.recommendedLands}), average mana value ${s.mana.avgCmc}, ${s.mana.rampCount} ramp pieces, ${s.mana.tappedLands.length} lands entering tapped, roles ${s.roles.map((x) => `${x.role} ${x.count}`).join(", ")}.`;
  return [
    `Commander: ${r.commanders.join(" + ")}.`,
    `Deck as submitted (what the owner plays today): ${names(r.original.decklist)}.`,
    r.decklist && `Suggested deck (after all the swaps): ${names(r.decklist)}.`,
    `Swaps (cut → add): ${r.swaps.map((s) => `${s.out} → ${s.in}`).join("; ") || "none"}.`,
    stats("Deck as submitted", r.before),
    stats("Suggested deck", r.after),
    `Combos in the deck as submitted: ${combos(r.original.combosPresent)}.`,
    `Combos in the suggested deck: ${combos(r.combosPresent)}.`,
    b &&
      `Target bracket ${b.target} (${b.name}), tone ${b.tone}. The deck as submitted reads as bracket ${b.before.bracket}, Game Changers: ${b.before.gameChangers.join(", ") || "none"}. The suggested deck reads as bracket ${b.after.bracket}, Game Changers: ${b.after.gameChangers.join(", ") || "none"}${b.gameChangerLimit !== null ? ` (limit ${b.gameChangerLimit})` : ""}; checks: ${b.after.checks.map((c) => `${c.label} ${c.ok ? "ok" : "fails"} (${c.detail})`).join("; ")}.`,
    r.options.budgetTotal && `Total budget: $${r.options.budgetTotal}.`,
    r.options.budgetPerCard && `Budget per card: $${r.options.budgetPerCard}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Whether a rewrite is a plausible minimal fix rather than a different text: not empty, not
 * drastically shorter or longer than what it replaces, and naming no card the original didn't.
 * A fix only takes a false claim out; a new card name means the model is inventing instead.
 */
export function plausibleFix(
  original: string,
  fixed: string | null,
  id: string,
  cards: string[] = [],
): boolean {
  if (fixed === null) return id.startsWith("synergy-");
  const t = fixed.trim();
  if (!t || t === original.trim()) return false;
  if (t.length < original.length * 0.4 || t.length > original.length * 2 + 80) return false;
  const had = new Set(refsIn(original).map((n) => n.toLowerCase()));
  if (refsIn(t).some((n) => !had.has(n.toLowerCase()))) return false;
  return !cards.some((c) => t.includes(c) && !original.includes(c));
}

/** Every card name the report knows. */
export function knownCards(r: Report): string[] {
  return [
    ...new Set([
      ...r.commanders,
      ...Object.keys(r.cardIndex),
      ...r.original.decklist.map((c) => c.name),
      ...r.decklist.map((c) => c.name),
      ...r.swaps.flatMap((s) => [s.out, s.in, ...(s.alternatives ?? []).map((a) => a.name)]),
    ]),
  ];
}

/** The report with the fixes applied to its texts; a null fix drops that synergy. */
export function applyTextFixes(r: Report, fixes: TextFix[]): Report {
  const byId = new Map(fixes.map((f) => [f.id, f.fixed]));
  const howToPlay = r.howToPlay && { ...r.howToPlay };
  for (const f of fixes) {
    const m = /^guide-(original|optimized)-(.+)$/.exec(f.id);
    const guide = m && howToPlay?.[m[1] as "original" | "optimized"];
    if (guide && f.fixed !== null)
      howToPlay![m[1] as "original" | "optimized"] = withGuideText(guide, m[2], f.fixed.trim());
  }
  const fixed = (id: string, text: string) => {
    const f = byId.get(id);
    return f === undefined || f === null ? text : f.trim();
  };
  return {
    ...r,
    strategy: fixed("strategy", r.strategy),
    swaps: r.swaps.map((s, i) => ({ ...s, reason: fixed(`swap-${i}`, s.reason) })),
    ...(howToPlay ? { howToPlay } : {}),
    synergies: r.synergies
      ?.map((s, i) => ({ s, id: `synergy-${i}` }))
      .filter(({ id }) => byId.get(id) !== null)
      .map(({ s, id }) => ({ ...s, explanation: fixed(id, s.explanation) })),
  };
}
