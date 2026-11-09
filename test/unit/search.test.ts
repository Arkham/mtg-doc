import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Card, OptimizeOptions, RoleCount } from "../../shared/types.ts";
import { BRACKETS } from "../../server/analysis/bracket.ts";
import { type Deck, totalPrice } from "../../server/analysis/deck.ts";
import {
  type SolverCard,
  type SolverContext,
  makeViolation,
  solve,
  trimToBudget,
} from "../../server/analysis/search.ts";
import { NO_FLAGS, commander, solverCard, spell, testDeck } from "../support/cards.ts";

const OPTIONS: OptimizeOptions = {
  maxSwaps: 10,
  budgetPerCard: null,
  budgetTotal: null,
  bracket: 3,
  tone: "max",
  locked: [],
  webResearch: false,
};

function context(
  deck: Deck,
  scored: SolverCard[],
  candidates: SolverCard[],
  target = 3,
  budgetTotal: number | null = null,
): SolverContext {
  const all = new Map([...scored, ...candidates].map((s) => [s.card.name, s.flags]));
  const flagOf = (c: Card) => all.get(c.name) ?? NO_FLAGS;
  return {
    deck,
    identity: ["B", "G"],
    target,
    rules: BRACKETS[target],
    tone: "max",
    scored,
    candidates,
    budgetTotal,
    violation: makeViolation({ rules: BRACKETS[target], target, flagOf, budgetTotal }),
  };
}

/** Deck where every filler scores `fillerScore`, plus named extra cards. */
function scoredDeck(extra: SolverCard[] = [], fillerScore = 0.1) {
  const deck = testDeck(
    37,
    extra.map((s) => s.card),
  );
  const scored = deck.slots
    .filter((s) => !s.card.isLand)
    .map((s) => extra.find((e) => e.card.name === s.card.name) ?? solverCard(s.card, fillerScore));
  return { deck, scored };
}

const NO_ROLES: RoleCount[] = [];

describe("makeViolation", () => {
  const gc = (n: string) => solverCard(spell(n), 0.5, { gameChanger: true });
  test("enforces the Game Changer limit, letting a GC replace a GC", () => {
    const owned = [gc("GC 1"), gc("GC 2"), gc("GC 3")];
    const { deck, scored } = scoredDeck(owned);
    const extra = gc("GC 4");
    const v = context(deck, scored, [extra]).violation;
    assert.match(v(extra.card, deck)!, /all 3 Game Changer slots/);
    assert.equal(v(extra.card, deck, owned[0].card), null);
  });

  test("bracket 2 bans Game Changers, mass land denial and extra-turn chains", () => {
    const { deck, scored } = scoredDeck([solverCard(spell("Time Warp"), 0.2, { extraTurn: true })]);
    const cands = [
      gc("GC"),
      solverCard(spell("Armageddon"), 0.5, { massLandDenial: true }),
      solverCard(spell("Temporal Mastery"), 0.5, { extraTurn: true }),
    ];
    const v = context(deck, scored, cands, 2).violation;
    assert.match(v(cands[0].card, deck)!, /aren't allowed in bracket 2/);
    assert.match(v(cands[1].card, deck)!, /mass land denial/);
    assert.match(v(cands[2].card, deck)!, /extra turns/);
  });

  test("blocks banned cards and combo pieces the bracket forbids", () => {
    const { deck, scored } = scoredDeck();
    const banned = solverCard(spell("Banned"), 0.5, { banned: true });
    const v = makeViolation({
      rules: BRACKETS[2],
      target: 2,
      flagOf: (c) => (c.name === "Banned" ? banned.flags : NO_FLAGS),
      budgetTotal: null,
      blockedByCombo: new Map([["Staff", "completes Staff + Priest"]]),
    });
    assert.match(v(banned.card, deck)!, /banned/);
    assert.match(v(spell("Staff"), deck)!, /completes Staff \+ Priest/);
    assert.equal(scored.length > 0, true);
  });

  test("enforces the total budget but always allows cheaper swaps", () => {
    const pricey = spell("Pricey", { priceUsd: 40 });
    const { deck, scored } = scoredDeck([solverCard(spell("Owned", { priceUsd: 30 }), 0.1)]);
    const v = context(deck, scored, [], 3, 35).violation;
    assert.match(v(pricey, deck)!, /over the \$35 budget/);
    assert.equal(
      v(spell("Cheaper", { priceUsd: 5 }), deck, scored.find((s) => s.card.name === "Owned")!.card),
      null,
    );
  });
});

describe("solve", () => {
  test("upgrades the weakest cards with the best candidates, up to maxSwaps", () => {
    const { deck, scored } = scoredDeck([], 0.1);
    const cands = Array.from({ length: 6 }, (_, i) =>
      solverCard(spell(`Upgrade ${i}`), 0.9 - i * 0.05),
    );
    const result = solve(context(deck, scored, cands), { ...OPTIONS, maxSwaps: 4 }, NO_ROLES);
    assert.equal(result.swaps.length, 4);
    assert.deepEqual(
      result.swaps.map((s) => s.in.name),
      ["Upgrade 0", "Upgrade 1", "Upgrade 2", "Upgrade 3"],
    );
    assert.ok(result.swaps.every((s) => s.out.name.startsWith("Filler") && s.forced === null));
    assert.ok(result.swaps[0].alternatives.length > 0, "keeps runner-ups for the slot");
  });

  test("never cuts locked cards or the commander, and stops when nothing improves", () => {
    const pet = solverCard(spell("Pet Card"), -1);
    const { deck, scored } = scoredDeck([pet], 0.5);
    const result = solve(
      context(deck, scored, [solverCard(spell("Meh"), 0.3)]),
      { ...OPTIONS, locked: ["Pet Card"] },
      NO_ROLES,
    );
    assert.equal(result.swaps.length, 0);
    assert.ok(!result.swaps.some((s) => s.out.name === commander.name));
  });

  test("forces out Game Changers over the limit, keeping the best ones", () => {
    const gcs = [0.9, 0.8, 0.7, 0.2, 0.1].map((v, i) =>
      solverCard(spell(`GC ${i}`), v, { gameChanger: true }),
    );
    const { deck, scored } = scoredDeck(gcs);
    const result = solve(
      context(deck, scored, [
        solverCard(spell("Replacement A"), 0.3),
        solverCard(spell("Replacement B"), 0.25),
      ]),
      OPTIONS,
      NO_ROLES,
    );
    const forced = result.swaps.filter((s) => s.forced);
    assert.deepEqual(forced.map((s) => s.out.name).sort(), ["GC 3", "GC 4"]);
    assert.ok(forced.every((s) => /Game Changer limit/.test(s.forced!)));
  });

  test("forces out off-color cards with a same-type replacement", () => {
    const offColor = {
      ...solverCard(spell("Blue Card", { colorIdentity: ["U"] }), -5),
      offIdentity: true,
    };
    const { deck, scored } = scoredDeck([offColor]);
    const result = solve(
      context(deck, scored, [solverCard(spell("Green Card"), 0.2)]),
      OPTIONS,
      NO_ROLES,
    );
    assert.equal(result.swaps[0].out.name, "Blue Card");
    assert.equal(result.swaps[0].in.name, "Green Card");
  });

  test("upgrades a full Game Changer slot to a better Game Changer", () => {
    const gcs = [0.4, 0.4, 0.3].map((v, i) =>
      solverCard(spell(`GC ${i}`), v, { gameChanger: true }),
    );
    const { deck, scored } = scoredDeck(gcs, 0.6);
    const better = solverCard(spell("Better GC"), 0.95, { gameChanger: true });
    const result = solve(context(deck, scored, [better]), OPTIONS, NO_ROLES);
    assert.equal(result.swaps.length, 1);
    assert.equal(result.swaps[0].in.name, "Better GC");
    assert.equal(result.swaps[0].out.name, "GC 2");
  });

  test("lists strong cards it skipped and the best Game Changer options", () => {
    const { deck, scored } = scoredDeck();
    const armageddon = {
      ...solverCard(spell("Armageddon"), 0.9, { massLandDenial: true }),
      inclusion: 0.4,
    };
    const gc = { ...solverCard(spell("Rhystic"), 0.8, { gameChanger: true }), inclusion: 0.5 };
    const result = solve(context(deck, scored, [armageddon, gc], 2), OPTIONS, NO_ROLES);
    assert.deepEqual(result.excluded.map((e) => e.name).sort(), ["Armageddon", "Rhystic"]);
    assert.ok(result.gameChangerOptions.some((g) => g.name === "Rhystic" && !g.inDeck));
  });

  test("prefers role coverage when a role is short", () => {
    const { deck, scored } = scoredDeck([], 0.1);
    const removal = solverCard(spell("Removal", { oracleText: "Destroy target creature." }), 0.3);
    const vanilla = solverCard(spell("Vanilla"), 0.35);
    const targets: RoleCount[] = [{ role: "removal", count: 0, target: 8 }];
    const result = solve(
      context(deck, scored, [vanilla, removal]),
      { ...OPTIONS, maxSwaps: 1 },
      targets,
    );
    assert.equal(result.swaps[0].in.name, "Removal");
  });
});

describe("trimToBudget", () => {
  test("trades the worst value-per-dollar cards until the deck fits", () => {
    const pricey = solverCard(spell("Pricey", { priceUsd: 80 }), 0.5);
    const fair = solverCard(spell("Fair", { priceUsd: 20 }), 0.9);
    const { deck, scored } = scoredDeck([pricey, fair]);
    const cheap = solverCard(spell("Cheap", { priceUsd: 2 }), 0.45);
    const swaps = trimToBudget(
      context(deck, scored, [cheap], 3, 50),
      deck,
      new Set([commander.name]),
      NO_ROLES,
    );
    assert.equal(swaps.length, 1);
    assert.equal(swaps[0].out.name, "Pricey");
    assert.match(swaps[0].forced!, /\$50 deck budget/);
    assert.ok(totalPrice(deck) <= 50);
  });

  test("does nothing without a budget or when already under it", () => {
    const { deck, scored } = scoredDeck();
    assert.deepEqual(trimToBudget(context(deck, scored, []), deck, new Set(), NO_ROLES), []);
    assert.deepEqual(
      trimToBudget(context(deck, scored, [], 3, 1000), deck, new Set(), NO_ROLES),
      [],
    );
  });
});
