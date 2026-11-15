import type { PlayGuide } from "../../shared/types.ts";

/** Most bullets a guide shows per list, so it stays a quick read. */
export const GUIDE_LIMITS = { phase: 3, winConditions: 3, keyCards: 6, watchOut: 3 } as const;

/**
 * A guide kept to what holds for a deck: key cards resolved to its spelling (or dropped when it
 * doesn't run them), empty bullets gone, and every list cut to its limit.
 */
export function fitGuide(guide: PlayGuide, resolve: (name: string) => string | null): PlayGuide {
  const bullets = (xs: string[], n: number) =>
    xs
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, n);
  const seen = new Set<string>();
  const keyCards: PlayGuide["keyCards"] = [];
  for (const k of guide.keyCards) {
    const name = resolve(k.name);
    if (!name || seen.has(name) || !k.why.trim()) continue;
    seen.add(name);
    keyCards.push({ name, why: k.why.trim() });
  }
  return {
    summary: guide.summary.trim(),
    early: bullets(guide.early, GUIDE_LIMITS.phase),
    mid: bullets(guide.mid, GUIDE_LIMITS.phase),
    late: bullets(guide.late, GUIDE_LIMITS.phase),
    winConditions: bullets(guide.winConditions, GUIDE_LIMITS.winConditions),
    keyCards: keyCards.slice(0, GUIDE_LIMITS.keyCards),
    mulligan: guide.mulligan.trim(),
    watchOut: bullets(guide.watchOut, GUIDE_LIMITS.watchOut),
  };
}

/** A guide's texts, keyed by where they live, for the contradiction check. */
export function guideTexts(guide: PlayGuide): { key: string; text: string }[] {
  return [
    { key: "summary", text: guide.summary },
    ...(["early", "mid", "late", "winConditions", "watchOut"] as const).flatMap((list) =>
      guide[list].map((text, i) => ({ key: `${list}.${i}`, text })),
    ),
    ...guide.keyCards.map((k, i) => ({ key: `keyCards.${i}`, text: k.why })),
    { key: "mulligan", text: guide.mulligan },
  ];
}

/** The guide with one text replaced, by its key from `guideTexts`. */
export function withGuideText(guide: PlayGuide, key: string, text: string): PlayGuide {
  const [list, at] = key.split(".");
  const i = Number(at);
  if (list === "summary" || list === "mulligan") return { ...guide, [list]: text };
  if (list === "keyCards")
    return {
      ...guide,
      keyCards: guide.keyCards.map((k, j) => (j === i ? { ...k, why: text } : k)),
    };
  if (
    list === "early" ||
    list === "mid" ||
    list === "late" ||
    list === "winConditions" ||
    list === "watchOut"
  )
    return { ...guide, [list]: guide[list].map((x, j) => (j === i ? text : x)) };
  return guide;
}
