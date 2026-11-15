import type {
  BracketAssessment,
  Combo,
  DeckSnapshot,
  DecklistCard,
  PlayGuide,
  Report,
} from "../shared/types.ts";
import { BRACKETS } from "./analysis/bracket.ts";

const GROUPS = [
  "Commander",
  "Creature",
  "Planeswalker",
  "Battle",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
  "Other",
];

const cell = (s: unknown) => String(s).replace(/\|/g, "/").replace(/\n/g, " ");
const pct = (n: number) => `${n}%`;
/** Model-written markdown sits under a ### heading, so its own headings start at ####. */
const nested = (text: string) =>
  text.replace(/^(#{1,6})(?=\s)/gm, (h) => "#".repeat(Math.min(6, Math.max(4, h.length + 2))));
const money = (n: number) => `$${Math.round(n)}`;

function table(cols: string[], rows: unknown[][]): string[] {
  return [
    `|${cols.map((c) => (c ? ` ${c} ` : " ")).join("|")}|`,
    `|${cols.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
    "",
  ];
}

/** A full list grouped by type, cheapest first, so readers (and agents) get every card. */
function decklist(title: string, cards: DecklistCard[], markNew = false): string[] {
  const total = cards.reduce((n, c) => n + c.qty, 0);
  const out = [`### ${title} (${total} cards)`, ""];
  for (const g of GROUPS) {
    const group = cards
      .filter((c) => c.group === g)
      .sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name));
    if (!group.length) continue;
    out.push(`#### ${g} (${group.reduce((n, c) => n + c.qty, 0)})`, "");
    for (const c of group)
      out.push(
        `- ${c.qty} ${c.name}${c.manaCost ? ` ${c.manaCost}` : ""}${markNew && (c.isNew || c.delta > 0) ? " _(new)_" : ""}`,
      );
    out.push("");
  }
  return out;
}

const comboLine = (c: Combo) => `- [${c.cards.join(" + ")}](${c.url}): ${c.produces.join(", ")}`;
const oneAwayLine = (c: Combo, suggested?: Set<string>) =>
  `- Add **${c.missing[0]}** to complete [${c.cards.join(" + ")}](${c.url}): ${c.produces.join(", ")}${suggested?.has(c.missing[0]) ? " (one of the suggested swaps in Part 2 adds it)" : ""}`;

function list(title: string, items: string[], empty?: string): string[] {
  if (!items.length) return empty ? [`### ${title}`, "", empty, ""] : [];
  return [`### ${title}`, "", ...items, ""];
}

/** Numbers for one deck: mana, goldfish and roles, as label/value rows. */
function statRows(s: DeckSnapshot): [string, string | number][] {
  return [
    ["Cards", s.totalCards],
    ["Price", money(s.totalPriceUsd)],
    ["Lands", `${s.mana.landCount} (recommended ${s.mana.recommendedLands})`],
    ["Average mana value of spells", s.mana.avgCmc],
    ["Ramp pieces", s.mana.rampCount],
    ["Lands that enter tapped", s.mana.tappedLands.length],
    ...s.mana.colors.map((c): [string, string] => [
      `Lands making ${c.color}`,
      `${c.landSources} (target ${c.targetSources})`,
    ]),
    ["Mulligan rate", pct(s.sim.mulliganRate)],
    ...[2, 3, 4, 5].map((t): [string, string] => [
      `Land drop on turn ${t}`,
      pct(s.sim.landDropByTurn[t]),
    ]),
    ["Commander cast on curve", pct(s.sim.commanderOnCurve)],
    ["All colors by turn 3", pct(s.sim.allColorsByTurn3)],
    ["Mana available on turn 4", s.sim.avgManaTurn4],
    ["Mana screw (under 3 lands on turn 4)", pct(s.sim.screwRate)],
    ["Flood (10+ lands seen by turn 7)", pct(s.sim.floodRate)],
    ...s.roles.map((r): [string, string | number] => [
      `Role: ${r.role}`,
      r.target !== null ? `${r.count} (target ${r.target})` : r.count,
    ]),
  ];
}

/** An easy-to-read guide to piloting one of the decks. */
function guideLines(title: string, g: PlayGuide): string[] {
  const bullets = (label: string, xs: string[]) =>
    xs.length ? [`**${label}**`, "", ...xs.map((x) => `- ${x}`), ""] : [];
  return [
    `### ${title}`,
    "",
    g.summary,
    "",
    ...bullets("Early game", g.early),
    ...bullets("Mid game", g.mid),
    ...bullets("Late game", g.late),
    ...bullets("How it wins", g.winConditions),
    ...bullets(
      "Key cards",
      g.keyCards.map((k) => `${k.name}: ${k.why}`),
    ),
    ...(g.mulligan ? [`**Mulligan:** ${g.mulligan}`, ""] : []),
    ...bullets("Watch out for", g.watchOut),
  ];
}

function bracketLines(a: BracketAssessment, target: number | null, minTurns: number): string[] {
  const out: string[] = [];
  if (target !== null) out.push(`Checked against the rules of bracket ${target}:`, "");
  for (const c of a.checks) out.push(`- ${c.ok ? "✅" : "❌"} **${c.label}:** ${c.detail}`);
  if (a.gameChangers.length) out.push(`- Game Changers: ${a.gameChangers.join(", ")}`);
  if (a.massLandDenial.length) out.push(`- Mass land denial: ${a.massLandDenial.join(", ")}`);
  if (a.extraTurns.length) out.push(`- Extra turns: ${a.extraTurns.join(", ")}`);
  for (const c of a.combos.filter((x) => x.twoCard))
    out.push(
      `- Two-card combo: ${c.cards.join(" + ")}${c.earlyPct !== null ? ` (${c.earlyPct}% of games assembled before turn ${minTurns})` : ""}`,
    );
  out.push("");
  return out;
}

/**
 * The report for agents and other plain readers. It keeps the deck as its owner submitted it
 * (Part 1) apart from everything the doc suggests (Part 2), so nothing suggested is mistaken for
 * a card the deck already plays.
 */
export function renderMarkdown(r: Report): string {
  const lines: string[] = [];
  const b = r.before;
  const a = r.after;
  const o = r.original;
  const suggestions = !r.suggestionsHidden;
  const name = r.commanders.join(" + ") || r.slug;
  const ownBracket = r.bracket ? BRACKETS[r.bracket.before.bracket] : null;

  lines.push(`# ${name}: Commander deck report`, "");
  lines.push(
    suggestions
      ? `> **How to read this report.** Part 1 is the deck exactly as its owner submitted it: the cards they play today, with its stats, bracket, combos and synergies. Part 2 is what the mtg doc suggests changing: ${r.swaps.length} optional ${r.swaps.length === 1 ? "swap" : "swaps"}, what they would change, and the deck they would make. Nothing in Part 2 is in the deck yet: when asked what the deck plays, use Part 1.`
      : "> **How to read this report.** It describes the deck exactly as its owner submitted it: the cards they play today, with its stats, bracket, combos and synergies.",
    "",
  );
  lines.push(`- Commander: ${name}`);
  lines.push(`- Deck as submitted: ${b.totalCards} cards, about ${money(b.totalPriceUsd)}`);
  if (r.bracket && ownBracket)
    lines.push(`- Bracket as submitted: ${r.bracket.before.bracket} (${ownBracket.name})`);
  if (r.themes.length) lines.push(`- Themes: ${r.themes.join(", ")}`);
  lines.push(`- Generated: ${r.generatedAt}${r.model ? ` with ${r.model}` : ""}`);
  if (r.edhrec)
    lines.push(
      `- EDHREC: ${r.edhrec.url}${r.edhrec.numDecks ? ` (${r.edhrec.numDecks.toLocaleString("en-US")} decks)` : ""}`,
    );
  lines.push("");

  // ---- Part 1: the deck as submitted ----
  lines.push("## Part 1: The deck as submitted", "");
  if (o) lines.push(...decklist("Decklist", o.decklist));
  if (r.howToPlay?.original) lines.push(...guideLines("How to play", r.howToPlay.original));
  lines.push("### Stats", "", ...table(["", "Value"], statRows(b)));
  for (const i of b.mana.issues) lines.push(`- ⚠️ ${i}`);
  if (b.mana.issues.length) lines.push("");
  if (b.mana.tappedLands.length)
    lines.push(`Lands that enter tapped: ${b.mana.tappedLands.join(", ")}`, "");
  if (b.mana.colorlessLands.length)
    lines.push(`Lands that only make colorless: ${b.mana.colorlessLands.join(", ")}`, "");
  lines.push(
    `Goldfish numbers come from ${b.sim.games.toLocaleString("en-US")} solo games with a free mulligan and greedy land and ramp plays.`,
    "",
  );

  if (r.bracket && ownBracket) {
    const rb = r.bracket;
    lines.push(`### Bracket ${rb.before.bracket}: ${ownBracket.name}`, "");
    lines.push(
      `Power ${rb.before.power} of 100. Bracket ${rb.before.bracket} games are expected to last at least ${ownBracket.minTurns} turns.`,
      "",
    );
    lines.push(...bracketLines(rb.before, rb.target, rb.minTurns));
  }

  const present = o?.combosPresent ?? (suggestions ? [] : r.combosPresent);
  const oneAway = o?.combosOneAway ?? (suggestions ? [] : r.combosOneAway);
  lines.push(...list("Combos in the deck", present.map(comboLine), "None found."));
  const submitted = new Set(o?.decklist.map((c) => c.name));
  const incoming = new Set(
    suggestions ? r.swaps.map((s) => s.in).filter((n) => !submitted.has(n)) : [],
  );
  lines.push(
    ...list(
      "Combos one card away",
      oneAway.slice(0, 10).map((c) => oneAwayLine(c, incoming)),
    ),
  );
  const inDeck = (cards: string[]) => !o || cards.every((n) => submitted.has(n));
  const synergies = r.synergies ?? [];
  lines.push(
    ...list(
      "Synergies",
      synergies
        .filter((s) => inDeck(s.cards))
        .map((s) => `- **${s.title}** (${s.cards.join(" + ")}): ${s.explanation}`),
    ),
  );

  // ---- Part 2: the doc's suggestions ----
  if (suggestions) {
    const rb = r.bracket;
    const opts = [
      rb && `bracket ${rb.target} (${rb.name})`,
      rb && `${rb.tone} tone`,
      r.options.budgetTotal && `a total budget of $${r.options.budgetTotal}`,
      r.options.budgetPerCard && `at most $${r.options.budgetPerCard} per card`,
    ].filter(Boolean);
    lines.push("## Part 2: The doc's suggestions (not in the deck yet)", "");
    lines.push(
      `These are optional changes to the deck in Part 1${opts.length ? `, aiming for ${opts.join(", ")}` : ""}. Making all of them gives the suggested decklist at the end of this part.`,
      "",
    );
    if (r.strategy) lines.push("### Strategy", "", nested(r.strategy), "");
    if (r.howToPlay?.optimized)
      lines.push(...guideLines("How to play the suggested deck", r.howToPlay.optimized));

    lines.push(
      `### Suggested swaps (${r.swaps.length})`,
      "",
      ...table(
        ["#", "Cut", "Add", "Category", "Why"],
        r.swaps.map((s, i) => [
          i + 1,
          s.out,
          s.in,
          s.fromChat ? "chat edit" : s.category,
          s.reason,
        ]),
      ),
    );
    const alternatives = r.swaps.filter((s) => s.alternatives?.length);
    if (alternatives.length) {
      lines.push("Other cards that could take the same slot:", "");
      for (const s of alternatives)
        lines.push(`- Instead of ${s.in}: ${s.alternatives!.map((x) => x.name).join(", ")}`);
      lines.push("");
    }
    lines.push(
      ...list(
        "More land swaps to consider",
        (r.manaSuggestions ?? []).map(
          (m) =>
            `- ${m.changes.map((c) => `${c.action === "add" ? "Add" : "Cut"} ${c.name}`).join(", ")}: ${m.reason}`,
        ),
      ),
    );

    const now = statRows(b);
    const next = new Map(statRows(a));
    lines.push(
      "### What the swaps change",
      "",
      ...table(
        ["", "Deck as submitted", "With the swaps"],
        [
          ...(rb
            ? [
                ["Bracket", rb.before.bracket, rb.after.bracket],
                ["Power (0-100)", rb.before.power, rb.after.power],
              ]
            : []),
          ...now.map(([label, value]) => [label, value, next.get(label) ?? "-"]),
        ],
      ),
    );
    for (const i of a.mana.issues) lines.push(`- ⚠️ After the swaps: ${i}`);
    if (a.mana.issues.length) lines.push("");

    if (rb) {
      lines.push(`### Bracket after the swaps: ${rb.after.bracket}`, "");
      lines.push(
        `Power ${rb.after.power} of 100, ${rb.after.position} in bracket ${rb.target} (${rb.name}).`,
        "",
      );
      lines.push(...bracketLines(rb.after, rb.target, rb.minTurns));
      lines.push(
        ...list(
          "Strong cards skipped to stay in the bracket",
          rb.excluded.map((e) => `- ${e.name}: ${e.reason}`),
        ),
      );
    }

    const had = new Set((o?.combosPresent ?? []).map((c) => c.id));
    const has = new Set(r.combosPresent.map((c) => c.id));
    const near = new Set((o?.combosOneAway ?? []).map((c) => c.id));
    lines.push(
      ...list("Combos the swaps add", r.combosPresent.filter((c) => !had.has(c.id)).map(comboLine)),
      ...list(
        "Combos the swaps break",
        (o?.combosPresent ?? []).filter((c) => !has.has(c.id)).map(comboLine),
      ),
      ...list(
        "New combos one card away",
        r.combosOneAway
          .filter((c) => !near.has(c.id))
          .slice(0, 10)
          .map((c) => oneAwayLine(c)),
      ),
      ...list(
        "Synergies the swaps add",
        synergies
          .filter((s) => !inDeck(s.cards))
          .map((s) => `- **${s.title}** (${s.cards.join(" + ")}): ${s.explanation}`),
      ),
    );

    if (r.decklist) {
      lines.push(...decklist("Suggested decklist", r.decklist, true));
      lines.push("Cards marked _(new)_ are the ones the swaps add.", "");
    }

    if (r.edits?.length) {
      lines.push("### Changes from chat", "");
      for (const e of r.edits)
        lines.push(
          `- ${e.at.slice(0, 10)}${e.target === "original" ? " (made in the deck as submitted)" : ""}${e.request ? ` “${cell(e.request)}”` : ""}: ${e.changes.map((c) => `${c.action === "add" ? "+" : "−"}${c.qty > 1 ? `${c.qty} ` : ""}${c.name}`).join(", ")}`,
        );
      lines.push("");
    }
  }

  if (r.research || r.warnings.length) {
    lines.push("## Background", "");
    if (r.research) {
      lines.push("### Web research about the commander", "", nested(r.research.summary), "");
      for (const s of r.research.sources) lines.push(`- [${s.title}](${s.url})`);
      lines.push("");
    }
    lines.push(
      ...list(
        "Warnings",
        r.warnings.map((w) => `- ${w}`),
      ),
    );
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}
