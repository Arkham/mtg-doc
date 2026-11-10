import type { DecklistCard, Report } from "../shared/types.ts";

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

/** A full list grouped by type, cheapest first, so readers (and agents) get every card. */
function decklistSection(title: string, cards: DecklistCard[], markNew = false): string[] {
  const total = cards.reduce((n, c) => n + c.qty, 0);
  const out = [`## ${title} (${total} cards)`, ""];
  for (const g of GROUPS) {
    const group = cards
      .filter((c) => c.group === g)
      .sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name));
    if (!group.length) continue;
    out.push(`### ${g} (${group.reduce((n, c) => n + c.qty, 0)})`, "");
    for (const c of group)
      out.push(
        `- ${c.qty} ${c.name}${c.manaCost ? ` ${c.manaCost}` : ""}${markNew && (c.isNew || c.delta > 0) ? " _(new)_" : ""}`,
      );
    out.push("");
  }
  return out;
}

export function renderMarkdown(r: Report): string {
  const lines: string[] = [];
  const b = r.before;
  const a = r.after;
  lines.push(`# ${r.commanders.join(" + ") || r.slug}`, "");
  lines.push(`_Generated ${r.generatedAt}${r.model ? ` with ${r.model}` : ""}_`, "");
  lines.push("## Strategy", "", r.strategy, "");
  if (r.themes.length) lines.push(`**Themes:** ${r.themes.join(", ")}`, "");

  if (r.bracket) {
    const b = r.bracket;
    lines.push(`## Bracket ${b.target}: ${b.name}`, "");
    lines.push(
      `Tone: ${b.tone}. Before: bracket ${b.before.bracket} (power ${b.before.power}). After: bracket ${b.after.bracket} (power ${b.after.power}, ${b.after.position} ${b.name}). Expect at least ${b.minTurns} turns.`,
      "",
    );
    for (const c of b.after.checks)
      lines.push(`- ${c.ok ? "✅" : "❌"} **${c.label}:** ${c.detail}`);
    if (b.after.gameChangers.length)
      lines.push(`- Game Changers: ${b.after.gameChangers.join(", ")}`);
    for (const c of b.after.combos.filter((x) => x.twoCard))
      lines.push(
        `- Combo: ${c.cards.join(" + ")}${c.earlyPct !== null ? ` (${c.earlyPct}% assembled before turn ${b.minTurns})` : ""}`,
      );
    if (b.excluded.length) {
      lines.push("", "Skipped to stay in the bracket:");
      for (const e of b.excluded) lines.push(`- ${e.name}: ${e.reason}`);
    }
    lines.push("");
  }

  lines.push("## Mana base", "", "| | Before | After |", "|---|---|---|");
  lines.push(
    `| Lands | ${b.mana.landCount} | ${a.mana.landCount} (recommended ${a.mana.recommendedLands}) |`,
  );
  lines.push(`| Avg mana value | ${b.mana.avgCmc} | ${a.mana.avgCmc} |`);
  lines.push(`| Ramp | ${b.mana.rampCount} | ${a.mana.rampCount} |`);
  lines.push(`| Tapped lands | ${b.mana.tappedLands.length} | ${a.mana.tappedLands.length} |`);
  for (const c of a.mana.colors) {
    const bc = b.mana.colors.find((x) => x.color === c.color);
    lines.push(
      `| ${c.color} sources (target ${c.targetSources}) | ${bc?.landSources ?? "-"} | ${c.landSources} |`,
    );
  }
  lines.push("");
  const manaChanges = r.swaps.filter(
    (s) => s.category === "mana" && s.inCard?.isLand && s.outCard?.isLand,
  );
  if (manaChanges.length) {
    lines.push("Mana base changes:", "");
    for (const s of manaChanges) lines.push(`- ${s.out} → ${s.in}: ${s.reason}`);
    lines.push("");
  }
  for (const m of r.manaSuggestions ?? []) {
    lines.push(
      `- Suggested: ${m.changes.map((c) => `${c.action === "add" ? "+" : "−"}${c.name}`).join(", ")}: ${m.reason}`,
    );
  }
  for (const i of a.mana.issues) lines.push(`- ⚠️ ${i}`);
  lines.push("");

  lines.push(
    "## Goldfish simulation",
    "",
    `${a.sim.games.toLocaleString()} games each.`,
    "",
    "| | Before | After |",
    "|---|---|---|",
  );
  lines.push(`| Mulligan rate | ${b.sim.mulliganRate}% | ${a.sim.mulliganRate}% |`);
  for (const t of [2, 3, 4, 5])
    lines.push(
      `| Land drop on turn ${t} | ${b.sim.landDropByTurn[t]}% | ${a.sim.landDropByTurn[t]}% |`,
    );
  lines.push(`| Commander on curve | ${b.sim.commanderOnCurve}% | ${a.sim.commanderOnCurve}% |`);
  lines.push(`| All colors by turn 3 | ${b.sim.allColorsByTurn3}% | ${a.sim.allColorsByTurn3}% |`);
  lines.push(`| Mana on turn 4 | ${b.sim.avgManaTurn4} | ${a.sim.avgManaTurn4} |`);
  lines.push(`| Screw (<3 lands T4) | ${b.sim.screwRate}% | ${a.sim.screwRate}% |`);
  lines.push(`| Flood (10+ lands seen by T7) | ${b.sim.floodRate}% | ${a.sim.floodRate}% |`, "");

  lines.push("## Roles", "", "| Role | Before | After | Target |", "|---|---|---|---|");
  for (const role of a.roles) {
    const br = b.roles.find((x) => x.role === role.role);
    lines.push(`| ${role.role} | ${br?.count ?? 0} | ${role.count} | ${role.target ?? ""} |`);
  }
  lines.push("");

  if (r.combosPresent.length) {
    lines.push("## Combos in the deck", "");
    for (const c of r.combosPresent)
      lines.push(`- [${c.cards.join(" + ")}](${c.url}): ${c.produces.join(", ")}`);
    lines.push("");
  }
  if (r.combosOneAway.length) {
    lines.push("## Combos one card away", "");
    for (const c of r.combosOneAway.slice(0, 10))
      lines.push(
        `- add **${c.missing[0]}** → [${c.cards.join(" + ")}](${c.url}): ${c.produces.join(", ")}`,
      );
    lines.push("");
  }
  if (r.synergies?.length) {
    lines.push("## Synergies", "");
    for (const syn of r.synergies)
      lines.push(`- **${syn.title}** (${syn.cards.join(" + ")}): ${syn.explanation}`);
    lines.push("");
  }

  lines.push("## Swaps", "", "| Out | In | Category | Why |", "|---|---|---|---|");
  for (const s of r.swaps)
    lines.push(
      `| ${s.out} | ${s.in} | ${s.fromChat ? "chat edit" : s.category} | ${s.reason.replace(/\|/g, "/")} |`,
    );
  lines.push("");

  if (r.edits?.length) {
    lines.push("## Changes from chat", "");
    for (const e of r.edits) {
      lines.push(
        `- ${e.at.slice(0, 10)}${e.request ? ` “${e.request.replace(/\n/g, " ")}”` : ""}: ${e.changes.map((c) => `${c.action === "add" ? "+" : "−"}${c.qty > 1 ? `${c.qty} ` : ""}${c.name}`).join(", ")}`,
      );
    }
    lines.push("");
  }

  if (r.original) lines.push(...decklistSection("Deck list as submitted", r.original.decklist));
  if (r.decklist) lines.push(...decklistSection("Suggested deck list", r.decklist, true));

  if (r.research) {
    lines.push("## Web research", "", r.research.summary, "");
    for (const s of r.research.sources) lines.push(`- [${s.title}](${s.url})`);
    lines.push("");
  }
  if (r.warnings.length) {
    lines.push("## Warnings", "");
    for (const w of r.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  lines.push(
    `Totals: ${b.totalCards} → ${a.totalCards} cards, $${b.totalPriceUsd} → $${a.totalPriceUsd}`,
  );
  if (r.edhrec) lines.push("", `EDHREC: ${r.edhrec.url}`);
  return lines.join("\n") + "\n";
}
