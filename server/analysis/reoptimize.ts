/**
 * What a change to the suggested deck made worse, in the terms the optimizer fixes: land count,
 * color sources, role counts, bracket checks and budget. Used to decide whether to offer a re-run.
 */
import type { Report } from "../../shared/types.ts";

export interface Gap {
  key: string;
  /** How far off the deck is; a gap that grew got worse. */
  size: number;
  text: string;
}

/** Shortfalls small enough to ignore: one land or one role card either way is noise. */
const SLACK = 1;

export function optimizationGaps(r: Report): Gap[] {
  const gaps: Gap[] = [];
  const m = r.after.mana;
  const landGap = Math.abs(m.landCount - m.recommendedLands);
  if (landGap > SLACK)
    gaps.push({
      key: "lands",
      size: landGap,
      text: `${m.landCount} lands, ${m.landCount < m.recommendedLands ? "under" : "over"} the recommended ${m.recommendedLands}`,
    });
  for (const c of m.colors) {
    const short = c.targetSources - c.landSources;
    if (short > SLACK)
      gaps.push({
        key: `color:${c.color}`,
        size: short,
        text: `${c.landSources} ${c.color} sources, ${short} under the target ${c.targetSources}`,
      });
  }
  for (const role of r.after.roles) {
    if (role.target === null || role.role === "land") continue;
    const short = role.target - role.count;
    if (short > SLACK)
      gaps.push({
        key: `role:${role.role}`,
        size: short,
        text: `${role.count} ${role.role} cards, ${short} under the typical ${role.target}`,
      });
  }
  for (const check of r.bracket?.after.checks ?? [])
    if (!check.ok)
      gaps.push({
        key: `bracket:${check.label}`,
        size: 1,
        text: `bracket ${r.bracket!.target} check "${check.label}" fails (${check.detail})`,
      });
  const budget = r.options.budgetTotal;
  if (budget !== null && r.after.totalPriceUsd > budget)
    gaps.push({
      key: "budget",
      size: r.after.totalPriceUsd - budget,
      text: `$${Math.round(r.after.totalPriceUsd)}, over the $${budget} budget`,
    });
  return gaps;
}

/** Gaps the change opened or widened; ones the deck already had aren't the change's doing. */
export function worsenedGaps(before: Report, after: Report): Gap[] {
  const was = new Map(optimizationGaps(before).map((g) => [g.key, g.size]));
  return optimizationGaps(after).filter((g) => g.size > (was.get(g.key) ?? 0));
}
