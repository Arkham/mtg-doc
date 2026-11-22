/**
 * A fake Commander Spellbook: combos found in, or one card away from, whatever list it's sent, and
 * a bracket estimate from card flags and those combos. Its data is a short list of real combos and
 * of the cards Spellbook flags (`tests/fixtures/fakes/spellbook.json`).
 */
import fs from "node:fs";
import path from "node:path";

interface Variant {
  id: string;
  uses: { card: { name: string } }[];
  produces: { feature: { name: string } }[];
  bracketTag: string | null;
  popularity: number;
  /** How Spellbook's estimate classifies it; worked out from what it makes when absent. */
  classified?: Classification;
}

interface Classification {
  relevant: boolean;
  definitelyTwoCard: boolean;
  arguablyTwoCard: boolean;
  lock: boolean;
  extraTurn: boolean;
  massLandDenial: boolean;
}

interface Flags {
  gameChanger?: boolean;
  massLandDenial?: boolean;
  extraTurn?: boolean;
  banned?: boolean;
}

const db = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../../fixtures/fakes/spellbook.json"), "utf8"),
) as { combos: Variant[]; cards: Record<string, Flags> };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const listed = (body: RequestInit["body"]) => {
  const { commanders, main } = JSON.parse(String(body)) as Record<string, { card: string }[]>;
  return [...commanders, ...main].map((c) => c.card);
};

const missingFrom = (v: Variant, deck: Set<string>) =>
  v.uses.filter((u) => !deck.has(u.card.name)).length;

const byPopularity = (a: Variant, b: Variant) =>
  b.popularity - a.popularity || a.id.localeCompare(b.id);

function classification(v: Variant): Classification {
  if (v.classified) return v.classified;
  const makes = v.produces.map((p) => p.feature.name).join(" ");
  return {
    relevant: true,
    definitelyTwoCard: v.uses.length <= 2,
    arguablyTwoCard: false,
    lock: /\block\b/i.test(makes),
    extraTurn: /extra turn|infinite turns/i.test(makes),
    massLandDenial: /destroy all lands|land destruction/i.test(makes),
  };
}

/** The estimate's deck tag: Bracket-breaker, Ruthless, Spicy, Powerful or Exhibition. */
function tag(flags: Flags[], combos: { combo: Variant; c: Classification }[]) {
  const relevant = combos.filter(({ c }) => c.relevant);
  const gameChangers = flags.filter((f) => f.gameChanger).length;
  if (flags.some((f) => f.banned)) return "B";
  if (
    gameChangers > 3 ||
    flags.some((f) => f.massLandDenial || f.extraTurn) ||
    relevant.some(
      ({ combo, c }) => combo.bracketTag === "R" || c.lock || c.extraTurn || c.massLandDenial,
    )
  )
    return "R";
  if (relevant.length) return "S";
  return gameChangers ? "P" : "E";
}

export function spellbook(url: URL, init?: RequestInit): Response {
  const deck = new Set(listed(init?.body));
  if (url.pathname === "/find-my-combos") {
    const combos = [...db.combos].sort(byPopularity);
    return json({
      results: {
        included: combos.filter((v) => missingFrom(v, deck) === 0),
        almostIncluded: combos.filter((v) => missingFrom(v, deck) === 1),
        almostIncludedByAddingColors: [],
        includedByChangingCommanders: [],
        almostIncludedByChangingCommanders: [],
        almostIncludedByAddingColorsAndChangingCommanders: [],
      },
    });
  }
  if (url.pathname === "/estimate-bracket") {
    const cards = [...deck].map((name) => ({
      card: { name },
      gameChanger: false,
      massLandDenial: false,
      extraTurn: false,
      banned: false,
      ...db.cards[name],
    }));
    const combos = db.combos
      .filter((v) => missingFrom(v, deck) === 0)
      .sort(byPopularity)
      .map((combo) => ({ combo, c: classification(combo) }));
    return json({
      bracketTag: tag(cards, combos),
      cards,
      combos: combos.map(({ combo, c }) => ({ combo, ...c })),
    });
  }
  throw new Error(`Fake Commander Spellbook has no ${url.pathname}`);
}
