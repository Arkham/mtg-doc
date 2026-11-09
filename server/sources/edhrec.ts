import { config } from "../config.ts";

export interface EdhrecCard {
  name: string;
  synergy: number;
  inclusion: number;
  numDecks: number;
  list: string;
}

export interface EdhrecData {
  url: string;
  numDecks: number | null;
  avgLands: number | null;
  avgBasics: number | null;
  themes: string[];
  /** Keyed by `edhrecKey`. */
  cards: Map<string, EdhrecCard>;
}

/** EDHREC names double-faced cards by their front face only. */
export const edhrecKey = (name: string) => name.split(" // ")[0].toLowerCase();

export const slugify = (name: string) =>
  name
    .split(" // ")[0]
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");

interface CardView {
  name: string;
  synergy?: number;
  num_decks?: number;
  potential_decks?: number;
  inclusion?: number;
}

interface EdhrecPage {
  land?: number;
  basic?: number;
  panels?: { taglinks?: { value: string; count: number }[] };
  container?: {
    json_dict?: {
      card?: { num_decks?: number };
      cardlists?: { header: string; tag: string; cardviews: CardView[] }[];
    };
  };
}

/** EDHREC page suffix for each bracket's filtered recommendations. */
export const BRACKET_PAGE: Record<number, string> = {
  1: "exhibition",
  2: "core",
  3: "upgraded",
  4: "optimized",
  5: "cedh",
};

async function fetchPage(slug: string, variant?: string): Promise<EdhrecPage | null> {
  const path = variant ? `${slug}/${variant}` : slug;
  const res = await fetch(`https://json.edhrec.com/pages/commanders/${path}.json`, {
    headers: { "user-agent": config.userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const page = (await res.json()) as EdhrecPage & { redirect?: string };
  if (page.redirect) {
    const target = page.redirect.replace(/^\/commanders\//, "").split("/")[0];
    return target !== slug ? fetchPage(target, variant) : null;
  }
  return page;
}

export async function getCommanderData(
  commanders: string[],
  variant?: string,
): Promise<EdhrecData | null> {
  const slugs = commanders.map(slugify);
  const candidates =
    slugs.length > 1
      ? [[...slugs].sort().join("-"), slugs.join("-"), [...slugs].reverse().join("-")]
      : slugs;
  for (const slug of [...new Set(candidates)]) {
    const page = await fetchPage(slug, variant);
    if (!page?.container?.json_dict) continue;
    const cards = new Map<string, EdhrecCard>();
    for (const list of page.container.json_dict.cardlists ?? []) {
      for (const cv of list.cardviews) {
        const key = edhrecKey(cv.name);
        if (cards.has(key)) continue;
        const inclusion =
          cv.potential_decks && cv.num_decks !== undefined ? cv.num_decks / cv.potential_decks : 0;
        cards.set(key, {
          name: cv.name,
          synergy: cv.synergy ?? 0,
          inclusion,
          numDecks: cv.num_decks ?? 0,
          list: list.header,
        });
      }
    }
    return {
      url: `https://edhrec.com/commanders/${slug}${variant ? `/${variant}` : ""}`,
      numDecks: page.container.json_dict.card?.num_decks ?? null,
      avgLands: page.land ?? null,
      avgBasics: page.basic ?? null,
      themes: (page.panels?.taglinks ?? []).slice(0, 8).map((t) => t.value),
      cards,
    };
  }
  return null;
}
