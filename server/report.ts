import type { Report } from "../shared/types.ts";

export function renderMarkdown(r: Report): string {
  const lines: string[] = [];
  const b = r.before;
  const a = r.after;
  lines.push(`# ${r.commanders.join(" + ") || r.slug}`, "");
  lines.push(`_Generated ${r.generatedAt}${r.model ? ` with ${r.model}` : ""}_`, "");
  lines.push("## Strategy", "", r.strategy, "");
  if (r.themes.length) lines.push(`**Themes:** ${r.themes.join(", ")}`, "");

  lines.push("## Swaps", "", "| Out | In | Category | Why |", "|---|---|---|---|");
  for (const s of r.swaps)
    lines.push(`| ${s.out} | ${s.in} | ${s.category} | ${s.reason.replace(/\|/g, "/")} |`);
  lines.push("");

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
  for (const n of r.manaNotes) lines.push(`- ${n}`);
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
