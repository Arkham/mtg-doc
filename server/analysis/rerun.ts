import type { OptimizeOptions, RerunOptions, RerunProposal } from "../../shared/types.ts";
import { BRACKETS } from "./bracket.ts";

const TONES: Record<OptimizeOptions["tone"], string> = {
  max: "max power",
  balanced: "balanced",
  casual: "casual",
};

const money = (n: number | null | undefined) => (n ? `$${n}` : "none");

/** Keeps only valid settings that differ from the current ones; empty means "same settings again". */
export function normalizeRerun(
  raw: RerunOptions | null,
  current: OptimizeOptions,
): RerunOptions | null {
  if (!raw) return null;
  const out: RerunOptions = {};
  if (
    raw.bracket !== undefined &&
    raw.bracket !== current.bracket &&
    (raw.bracket === null || BRACKETS[raw.bracket])
  )
    out.bracket = raw.bracket;
  if (raw.budgetTotal !== undefined && raw.budgetTotal !== current.budgetTotal)
    out.budgetTotal = raw.budgetTotal;
  if (raw.budgetPerCard !== undefined && raw.budgetPerCard !== current.budgetPerCard)
    out.budgetPerCard = raw.budgetPerCard;
  if (raw.maxSwaps !== undefined && raw.maxSwaps !== current.maxSwaps) out.maxSwaps = raw.maxSwaps;
  if (raw.tone !== undefined && raw.tone !== current.tone) out.tone = raw.tone;
  if (raw.webResearch !== undefined && raw.webResearch !== current.webResearch)
    out.webResearch = raw.webResearch;
  return out;
}

/** Plain-language list of what a re-run changes, e.g. "bracket 2 (Core), deck budget $300". */
export function describeRerun(o: RerunOptions): string {
  const parts: string[] = [];
  if (o.bracket !== undefined)
    parts.push(
      o.bracket === null
        ? "the bracket it already fits"
        : `bracket ${o.bracket} (${BRACKETS[o.bracket].name})`,
    );
  if (o.budgetTotal !== undefined) parts.push(`deck budget ${money(o.budgetTotal)}`);
  if (o.budgetPerCard !== undefined) parts.push(`per-card budget ${money(o.budgetPerCard)}`);
  if (o.maxSwaps !== undefined) parts.push(`up to ${o.maxSwaps} swaps`);
  if (o.tone !== undefined) parts.push(`${TONES[o.tone]} tone`);
  if (o.webResearch !== undefined) parts.push(`web research ${o.webResearch ? "on" : "off"}`);
  return parts.join(", ") || "the current settings";
}

export const makeRerun = (
  raw: RerunOptions | null,
  current: OptimizeOptions,
): RerunProposal | undefined => {
  const options = normalizeRerun(raw, current);
  return options ? { options, summary: describeRerun(options) } : undefined;
};
