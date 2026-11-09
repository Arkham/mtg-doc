import type { Color, SimResult } from "../../shared/types.ts";
import { COLORS } from "../../shared/types.ts";
import { type Deck, identityOf } from "./deck.ts";
import { landColors, pipsOf } from "./mana.ts";

const MAX_TURN = 8;
const ALL_MASK = 0b11111;
const bit = (c: Color) => 1 << COLORS.indexOf(c);
const maskOf = (cs: Color[]) => cs.reduce((m, c) => m | bit(c), 0);

const enum Kind {
  Land = 0,
  Rock = 1,
  Dork = 2,
  LandRamp = 3,
  Spell = 4,
}

/**
 * Library encoded as parallel typed arrays so each game only shuffles an index array.
 * mask: colors produced (lands/rocks) or fetched (land ramp).
 */
interface Encoded {
  kind: Uint8Array;
  cost: Uint8Array;
  mask: Uint8Array;
  tapped: Uint8Array;
  size: number;
}

function encode(deck: Deck): Encoded {
  const identity = identityOf(deck.commanders);
  const idMask = maskOf(identity) || ALL_MASK;
  const rows: [Kind, number, number, number][] = [];
  for (const { card, qty } of deck.slots) {
    let row: [Kind, number, number, number];
    if (card.isLand) {
      const colors = landColors(card, identity);
      row = [Kind.Land, 0, colors.length ? maskOf(colors) : 0, card.entersTapped ? 1 : 0];
    } else if (card.roles.includes("ramp") && card.cmc <= 4 && card.producedMana.length) {
      const colors = card.producedMana.filter((m): m is Color => (COLORS as string[]).includes(m));
      const mask = (colors.length ? maskOf(colors) : 0) & idMask;
      row = [/\bCreature\b/.test(card.typeLine) ? Kind.Dork : Kind.Rock, card.cmc, mask, 0];
    } else if (
      card.roles.includes("ramp") &&
      card.cmc <= 4 &&
      /search your library for[^.]*land/i.test(card.oracleText)
    ) {
      row = [Kind.LandRamp, card.cmc, idMask, 1];
    } else {
      row = [Kind.Spell, Math.min(card.cmc, 255), 0, 0];
    }
    for (let i = 0; i < qty; i++) rows.push(row);
  }
  const size = rows.length;
  const enc: Encoded = {
    kind: new Uint8Array(size),
    cost: new Uint8Array(size),
    mask: new Uint8Array(size),
    tapped: new Uint8Array(size),
    size,
  };
  rows.forEach(([k, c, m, t], i) => {
    enc.kind[i] = k;
    enc.cost[i] = c;
    enc.mask[i] = m;
    enc.tapped[i] = t;
  });
  return enc;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Can sources (each one mana of its mask) pay the colored pips? Bipartite matching via augmenting paths. */
function canPay(sources: number[], pipList: number[], generic: number): boolean {
  if (sources.length < pipList.length + generic) return false;
  const owner = new Int32Array(sources.length).fill(-1);
  const tryAssign = (pip: number, seen: Uint8Array): boolean => {
    for (let s = 0; s < sources.length; s++) {
      if (seen[s] || !(sources[s] & pipList[pip])) continue;
      seen[s] = 1;
      if (owner[s] < 0 || tryAssign(owner[s], seen)) {
        owner[s] = pip;
        return true;
      }
    }
    return false;
  };
  for (let p = 0; p < pipList.length; p++) {
    if (!tryAssign(p, new Uint8Array(sources.length))) return false;
  }
  return true;
}

export function simulate(deck: Deck, games = 10_000, seed = 42): SimResult {
  const enc = encode(deck);
  const rand = mulberry32(seed);
  const identity = identityOf(deck.commanders);
  const idMask = maskOf(identity);

  // Commander requirement: hardest commander to cast, pips expanded to per-pip masks.
  const cmdr = [...deck.commanders].sort((a, b) => b.cmc - a.cmc)[0];
  const cmdrPips: number[] = [];
  let cmdrGeneric = 0;
  if (cmdr) {
    const pips = pipsOf(cmdr.manaCost);
    for (const c of COLORS) for (let i = 0; i < Math.floor(pips[c]); i++) cmdrPips.push(bit(c));
    cmdrGeneric = Math.max(0, Math.round(cmdr.cmc) - cmdrPips.length);
  }
  const cmdrCmc = cmdr ? Math.round(cmdr.cmc) : 0;

  const order = new Uint16Array(enc.size);
  const landDrop = new Float64Array(MAX_TURN + 1);
  const cmdrBy = new Float64Array(MAX_TURN + 1);
  let mulligans = 0;
  let onCurve = 0;
  let allColors3 = 0;
  let mana4 = 0;
  let screw = 0;
  let flood = 0;

  for (let g = 0; g < games; g++) {
    for (let i = 0; i < enc.size; i++) order[i] = i;
    for (let i = enc.size - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    const isLand = (idx: number) => enc.kind[idx] === Kind.Land;
    let top = 7;
    let hand: number[] = Array.from(order.subarray(0, 7));
    let handLands = hand.filter(isLand).length;
    if (handLands < 2 || handLands > 5) {
      // Free first mulligan is standard in multiplayer Commander; then London mulligan to 6.
      mulligans++;
      hand = Array.from(order.subarray(7, 14));
      top = 14;
      handLands = hand.filter(isLand).length;
      if (handLands < 2 || handLands > 5) {
        hand = Array.from(order.subarray(14, 21));
        top = 21;
        handLands = hand.filter(isLand).length;
        let bottomIdx = -1;
        for (let i = 0; i < hand.length; i++) {
          const c = hand[i];
          if (
            handLands > 3
              ? isLand(c)
              : !isLand(c) && (bottomIdx < 0 || enc.cost[c] > enc.cost[hand[bottomIdx]])
          ) {
            bottomIdx = i;
            if (handLands > 3) break;
          }
        }
        if (bottomIdx >= 0) {
          if (isLand(hand[bottomIdx])) handLands--;
          hand.splice(bottomIdx, 1);
        }
      }
    }

    const sources: number[] = [];
    let pendingSources: number[] = [];
    let landsInPlay = 0;
    let landsSeen = handLands;
    let castTurn = 0;
    const skipFirstDraw = rand() < 0.25;

    for (let turn = 1; turn <= MAX_TURN; turn++) {
      sources.push(...pendingSources);
      pendingSources = [];
      if (!(turn === 1 && skipFirstDraw) && top < enc.size) {
        const drawn = order[top++];
        hand.push(drawn);
        if (isLand(drawn)) landsSeen++;
      }

      let haveColors = sources.reduce((m, s) => m | s, 0);
      let landIdx = -1;
      let bestScore = -1;
      for (let i = 0; i < hand.length; i++) {
        const c = hand[i];
        if (!isLand(c)) continue;
        const adds = enc.mask[c] & ~haveColors & idMask;
        const score =
          (enc.tapped[c] ? 0 : 4) + (adds ? 2 + popcount(adds) : 0) + (enc.mask[c] ? 1 : 0);
        if (score > bestScore) {
          bestScore = score;
          landIdx = i;
        }
      }
      if (landIdx >= 0) {
        const c = hand.splice(landIdx, 1)[0];
        landsInPlay++;
        const m = enc.mask[c] || 0b100000;
        if (enc.tapped[c]) pendingSources.push(m);
        else sources.push(m);
      }
      if (landsInPlay >= turn) landDrop[turn]++;

      let available = sources.length;
      if (!castTurn && cmdr && available >= cmdrCmc && canPay(sources, cmdrPips, cmdrGeneric)) {
        castTurn = turn;
        available -= cmdrCmc;
      }
      // Greedily deploy cheapest ramp with remaining mana.
      const ramp = hand
        .map((c, i) => [c, i] as const)
        .filter(
          ([c]) =>
            enc.kind[c] === Kind.Rock || enc.kind[c] === Kind.Dork || enc.kind[c] === Kind.LandRamp,
        )
        .sort((a, b) => enc.cost[a[0]] - enc.cost[b[0]]);
      const played: number[] = [];
      for (const [c, i] of ramp) {
        if (enc.cost[c] > available) break;
        available -= enc.cost[c];
        played.push(i);
        const m = enc.mask[c] || 0b100000;
        if (enc.kind[c] === Kind.Rock) {
          sources.push(m);
          available++;
        } else pendingSources.push(m);
      }
      for (const i of played.sort((a, b) => b - a)) hand.splice(i, 1);

      haveColors = sources.reduce((m, s) => m | s, 0) | pendingSources.reduce((m, s) => m | s, 0);
      if (turn === 3 && (haveColors & idMask) === idMask) allColors3++;
      if (turn === 4) {
        mana4 += sources.length + pendingSources.length;
        if (landsInPlay < 3) screw++;
      }
      if (turn === 7 && landsSeen >= 10) flood++;
    }
    if (castTurn) cmdrBy[castTurn]++;
    if (castTurn && castTurn <= Math.max(1, cmdrCmc)) onCurve++;
  }

  const pct = (n: number) => Math.round((n / games) * 1000) / 10;
  const landDropByTurn: Record<number, number> = {};
  const commanderByTurn: Record<number, number> = {};
  let cumulative = 0;
  for (let t = 1; t <= MAX_TURN; t++) {
    landDropByTurn[t] = pct(landDrop[t]);
    cumulative += cmdrBy[t];
    commanderByTurn[t] = pct(cumulative);
  }
  return {
    games,
    mulliganRate: pct(mulligans),
    landDropByTurn,
    commanderOnCurve: pct(onCurve),
    commanderByTurn,
    allColorsByTurn3: pct(allColors3),
    avgManaTurn4: Math.round((mana4 / games) * 100) / 100,
    screwRate: pct(screw),
    floodRate: pct(flood),
  };
}

function popcount(n: number) {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}
