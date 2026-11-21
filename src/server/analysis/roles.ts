import type { Card, Role } from "../../shared/types.ts";

type RoleInput = Pick<Card, "typeLine" | "oracleText" | "isLand" | "producedMana" | "cmc" | "name">;

const RULES: [Role, RegExp][] = [
  [
    "wipe",
    /\b(destroy|exile) all\b|\ball (other )?creatures get -|deals? \d+ damage to each creature|each (player|opponent) sacrifices (all|each)|return all (nonland )?permanents/i,
  ],
  ["counter", /\bcounter target\b/i],
  [
    "removal",
    /\b(destroy|exile) (up to (one|two|three) )?target\b|deals? (\d+|x) damage to (any target|target (creature|planeswalker|permanent))|target (player|opponent) sacrifices|return target (nonland )?(creature|permanent|artifact|enchantment)[^.]* to its owner's hand|fights? (target|another|up to)/i,
  ],
  [
    "draw",
    /\bdraws? (a|an additional|two|three|four|five|x|that many|cards equal)\b[^.]*cards?|\bdraw cards\b|look at the top [^.]* put [^.]* into your hand|exile the top [^.]* you may play/i,
  ],
  [
    "tutor",
    /search your library for (a|an|up to (one|two|three)) (?!(basic )?lands?\b)(?!(forest|island|swamp|mountain|plains)\b)[^.]*card/i,
  ],
  [
    "protection",
    /\b(gains?|have|has) (hexproof|indestructible|shroud|protection)|phases? out|can't be (countered|the target)/i,
  ],
  ["recursion", /return (target|up to [^ ]+ target|all|each) [^.]*from (your|a) graveyard/i],
  [
    "wincon",
    /you win the game|each opponent loses \d+ life|loses the game|infinite|extra (turn|combat)/i,
  ],
];

const LAND_RAMP =
  /search your library for (up to (one|two|three) )?(a |an )?(basic )?(land|forest|island|swamp|mountain|plains)[^.]*(onto the battlefield|put (it|them) onto)|put (a|up to [^ ]+) land cards? from your hand onto the battlefield|you may play (an additional land|two additional lands)/i;

export function classifyRoles(card: RoleInput): Role[] {
  if (card.isLand) return ["land"];
  const text = card.oracleText;
  const roles = new Set<Role>();
  const makesMana =
    /\{T\}[^.]*: Add \{|: Add (\{|one mana|two mana|three mana|X mana|mana)|Add (one|two|three) mana/i.test(
      text,
    ) && card.producedMana.length > 0;
  const treasure = /create[^.]*treasure token/i.test(text);
  const costReducer = /spells you cast cost \{\d\} less/i.test(text);
  if (makesMana || treasure || LAND_RAMP.test(text) || costReducer) roles.add("ramp");
  for (const [role, re] of RULES) if (re.test(text)) roles.add(role);
  if (roles.has("wipe")) roles.delete("removal");
  if (roles.size === 0) roles.add("other");
  return [...roles];
}

/** Rule-of-thumb role targets for a 100-card commander deck. */
export const ROLE_TARGETS: Partial<Record<Role, number>> = {
  ramp: 10,
  draw: 10,
  removal: 8,
  wipe: 2,
  counter: 0,
  tutor: 0,
  protection: 3,
  recursion: 2,
};

/** Cheap ramp/draw, as used in Karsten's land-count formula. */
export function isCheapAccel(card: Card) {
  return card.cmc <= 2 && (card.roles.includes("ramp") || card.roles.includes("draw"));
}
