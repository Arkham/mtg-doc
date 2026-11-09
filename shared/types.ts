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

export interface OptimizeOptions {
  maxSwaps: number;
  budgetPerCard: number | null;
  bracket: number | null;
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
  swapCount?: number;
  landCount?: number;
  priceUsd?: number;
}

export interface Swap {
  out: string;
  in: string;
  category: "synergy" | "combo" | "mana" | "ramp" | "draw" | "interaction" | "curve" | "other";
  reason: string;
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
