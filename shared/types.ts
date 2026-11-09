export type Color = "W" | "U" | "B" | "R" | "G";
export const COLORS: Color[] = ["W", "U", "B", "R", "G"];

export type Role =
  | "land"
  | "ramp"
  | "draw"
  | "removal"
  | "wipe"
  | "counter"
  | "tutor"
  | "protection"
  | "recursion"
  | "wincon"
  | "other";

export interface Card {
  name: string;
  oracleId: string;
  manaCost: string;
  cmc: number;
  typeLine: string;
  oracleText: string;
  colors: Color[];
  colorIdentity: Color[];
  producedMana: string[];
  isLand: boolean;
  /** Front face is a spell but the back face is a land (MDFC). */
  isMdfcLand: boolean;
  entersTapped: boolean;
  legalCommander: boolean;
  canBeCommander: boolean;
  gameChanger: boolean;
  priceUsd: number | null;
  image: string | null;
  imageArt: string | null;
  scryfallUri: string;
  roles: Role[];
}

export interface DeckEntry {
  qty: number;
  name: string;
}

export interface RecognizedEntry extends DeckEntry {
  /** Raw text read from the image, before name resolution. */
  raw: string;
  status: "exact" | "fuzzy" | "unresolved";
  card?: Card;
}

export interface RecognitionResult {
  format: "commander" | "other";
  formatConfidence: number;
  commanders: string[];
  commanderCards: Card[];
  commanderCandidates: string[];
  deckName: string | null;
  entries: RecognizedEntry[];
  notes: string[];
}

export type Tone = "max" | "balanced" | "casual";

export interface OptimizeOptions {
  maxSwaps: number;
  budgetPerCard: number | null;
  /** Target bracket; null keeps the deck in the bracket it already fits. */
  bracket: number | null;
  /** How hard to push within the bracket. */
  tone: Tone;
  locked: string[];
  webResearch: boolean;
}

export interface SaveDeckRequest {
  format: "commander" | "other";
  commanders: string[];
  deckName: string | null;
  entries: DeckEntry[];
  options: OptimizeOptions;
}

export interface DeckSummary {
  slug: string;
  commanders: string[];
  format: string;
  createdAt: string;
  hasReport: boolean;
  image: string | null;
  colorIdentity?: Color[];
  bracket?: number;
  swapCount?: number;
  landCount?: number;
  priceUsd?: number;
}

export interface Swap {
  out: string;
  in: string;
  category:
    "bracket" | "synergy" | "combo" | "mana" | "ramp" | "draw" | "interaction" | "curve" | "other";
  reason: string;
  /** Other strong options for the same slot. */
  alternatives?: { name: string; image: string | null; scryfallUri: string }[];
  outCard?: Card;
  inCard?: Card;
}

export interface ColorStat {
  color: Color;
  pips: number;
  pipShare: number;
  landSources: number;
  rampSources: number;
  targetSources: number;
}

export interface ManaReport {
  landCount: number;
  mdfcLands: number;
  recommendedLands: number;
  avgCmc: number;
  curve: Record<string, number>;
  colors: ColorStat[];
  tappedLands: string[];
  colorlessLands: string[];
  basics: Record<string, number>;
  rampCount: number;
  issues: string[];
}

export interface SimResult {
  games: number;
  mulliganRate: number;
  landDropByTurn: Record<number, number>;
  commanderOnCurve: number;
  commanderByTurn: Record<number, number>;
  allColorsByTurn3: number;
  avgManaTurn4: number;
  screwRate: number;
  floodRate: number;
  /** Cumulative % of games where each combo is assembled and castable by a given turn. */
  combos?: { cards: string[]; byTurn: Record<number, number> }[];
}

export interface RoleCount {
  role: Role;
  count: number;
  target: number | null;
}

export interface Combo {
  id: string;
  cards: string[];
  missing: string[];
  produces: string[];
  description: string;
  bracketTag: string | null;
  url: string;
}

export interface Research {
  summary: string;
  cardsMentioned: string[];
  sources: { title: string; url: string }[];
}

export interface DeckSnapshot {
  mana: ManaReport;
  sim: SimResult;
  roles: RoleCount[];
  totalCards: number;
  totalPriceUsd: number;
}

export interface BracketCombo {
  cards: string[];
  produces: string[];
  twoCard: boolean;
  tag: string | null;
  /** % of goldfish games assembled before the bracket's minimum game length. */
  earlyPct: number | null;
  url: string;
}

export interface BracketCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface BracketAssessment {
  /** Lowest bracket whose rules the deck satisfies. */
  bracket: number;
  spellbookTag: string | null;
  gameChangers: string[];
  massLandDenial: string[];
  extraTurns: string[];
  combos: BracketCombo[];
  /** 0-100 heuristic power estimate. */
  power: number;
  /** Where the deck sits inside the target bracket. */
  position: "low" | "mid" | "high";
  checks: BracketCheck[];
}

export interface BracketReport {
  target: number;
  name: string;
  minTurns: number;
  tone: Tone;
  before: BracketAssessment;
  after: BracketAssessment;
  gameChangerLimit: number | null;
  /** Best Game Changers not in the deck, for brackets with free slots. */
  gameChangerOptions: { name: string; score: number; inDeck: boolean }[];
  /** Strong cards the optimizer skipped to stay in the bracket. */
  excluded: { name: string; reason: string }[];
}

export interface Report {
  slug: string;
  commanders: string[];
  commanderCards: Card[];
  generatedAt: string;
  model: string | null;
  strategy: string;
  themes: string[];
  swaps: Swap[];
  manaNotes: string[];
  before: DeckSnapshot;
  after: DeckSnapshot;
  combosPresent: Combo[];
  combosOneAway: Combo[];
  research: Research | null;
  edhrec: { url: string; numDecks: number | null; avgLands: number | null } | null;
  warnings: string[];
  options: OptimizeOptions;
  bracket?: BracketReport;
  /** Optimized list with display data; absent in reports generated before it existed. */
  decklist?: DecklistCard[];
}

export interface DecklistCard {
  name: string;
  manaCost?: string;
  qty: number;
  group: string;
  cmc: number;
  image: string | null;
  scryfallUri: string;
  priceUsd: number | null;
  isNew: boolean;
  /** Quantity change vs the initial list (basics can go up or down). */
  delta: number;
}

export interface JobStep {
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  detail?: string;
}

export interface Job {
  id: string;
  slug: string;
  status: "running" | "done" | "error";
  steps: JobStep[];
  error?: string;
}
