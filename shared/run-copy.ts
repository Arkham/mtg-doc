/**
 * What each task of an optimizer run is called. A run's trace names its tasks by id only; the
 * words are the frontend's. The Elm app has the same names in src/RunCopy.elm (with what the pill
 * over the map says while each runs), kept equal by test/unit/elm-parity.test.ts.
 */
export const TASK_LABELS: Record<string, string> = {
  start: "Load the deck",
  spellbook: "Combos & bracket",
  baseline: "Goldfish",
  edhrec: "EDHREC",
  baselineMana: "Mana base",
  research: "Web research",
  landPool: "Land options",
  gameChangers: "Game Changers",
  knownUpgrades: "Look up candidates",
  upgrades: "Find upgrades",
  review: "Review swaps",
  verified: "Fix mana & verify",
  submittedChecks: "Your list as submitted",
  synergies: "Synergies",
  draft: "How-to-play guides",
  checked: "Contradictions",
  saved: "Save",
};

/** A task's name, or its id for one this version doesn't know. */
export const taskLabel = (id: string) => TASK_LABELS[id] ?? id;
