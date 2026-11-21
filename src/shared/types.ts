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
  power?: string;
  toughness?: string;
  loyalty?: string;
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
  /** Language the card is printed in (Scryfall code), from photo recognition. */
  lang?: string;
  /** Independent reading passes that saw this card. */
  votes?: number;
  /** 0-1: 1 when several passes agree, otherwise the verification probability. */
  confidence?: number;
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
  /** Max total price of the final deck (USD), including the commander. */
  budgetTotal: number | null;
  /** Target bracket; null keeps the deck in the bracket it already fits. */
  bracket: number | null;
  /** How hard to push within the bracket. */
  tone: Tone;
  locked: string[];
  /** Cards never to add: ones the user removed in chat, kept out by a re-run that keeps edits. */
  excluded?: string[];
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
  /** Stats of the deck as submitted; the swaps are only suggestions. */
  bracket?: number;
  landCount?: number;
  priceUsd?: number;
  swapCount?: number;
  /** Bracket the suggested swaps aim for. */
  targetBracket?: number;
  /** Every card in the deck as submitted, commanders included, for the card search. */
  cards: string[];
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
  /** Paired up after chat edits changed the list, rather than proposed by the optimizer. */
  fromChat?: boolean;
}

export interface ColorStat {
  color: Color;
  pips: number;
  pipShare: number;
  landSources: number;
  rampSources: number;
  targetSources: number;
  /** What sets the target: one card's heavy cost in this color, or the color's overall share. */
  targetReason?: "heaviest-card" | "share";
  /** The spell needing the most symbols of this color, with its cost. */
  heaviestCard?: { name: string; manaCost: string };
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

/** One add/remove proposed through chat, after validation. */
export interface DeckChange {
  action: "add" | "remove";
  name: string;
  qty: number;
  reason: string;
  ok: boolean;
  /** Why the change can't be applied, when `ok` is false. */
  problem?: string;
  card?: Card;
}

export type RerunOptions = Partial<
  Pick<
    OptimizeOptions,
    "bracket" | "budgetTotal" | "budgetPerCard" | "maxSwaps" | "tone" | "webResearch"
  >
>;

/** A re-run of the optimizer with changed settings, proposed in chat; starts only once confirmed. */
export interface RerunProposal {
  options: RerunOptions;
  summary: string;
  /** Start from the current suggestions with the user's chat edits kept, rather than afresh. */
  keepEdits?: boolean;
  /** Set once the user confirmed and the job started. */
  jobId?: string;
}

/** A change to a deck running in the background (see src/server/edit-queue.ts). */
export interface EditStatus {
  id: string;
  slug: string;
  label: string;
  state: "queued" | "running" | "done" | "failed";
  error?: string;
}

export interface DeckChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  changes?: DeckChange[];
  applied?: boolean;
  /** The changes are being made in the background; `applied` or `applyError` follows. */
  applying?: boolean;
  /** Why applying the changes failed, when it did. */
  applyError?: string;
  rerun?: RerunProposal;
  /** The list `changes` edit: the one on screen, unless the user asked to change the other. */
  target?: EditTarget;
  /** The doc changed the report directly (e.g. found synergies again); the client reloads it. */
  reportUpdated?: boolean;
}

export interface CardPreview {
  image: string | null;
  scryfallUri: string;
  priceUsd?: number | null;
}

/** A notable interaction between cards in the deck that isn't an infinite combo. */
export interface Synergy {
  title: string;
  cards: string[];
  explanation: string;
}

/** An easy-to-read guide to piloting one deck, written for players. */
export interface PlayGuide {
  /** What the deck does, in a sentence or two. */
  summary: string;
  /** Short bullets for each stage of a game. */
  early: string[];
  mid: string[];
  late: string[];
  winConditions: string[];
  /** Cards in this deck that matter most, and why. */
  keyCards: { name: string; why: string }[];
  /** What a keepable opening hand looks like. */
  mulligan: string;
  watchOut: string[];
}

/** A land swap proposed to improve the mana base, which the user can apply to their deck. */
export interface ManaSuggestion {
  id: string;
  reason: string;
  changes: DeckChange[];
}

/** Which list a chat edit changes: the deck as submitted, or the doc's suggested version. */
export type EditTarget = "original" | "optimized";

export interface DeckEdit {
  at: string;
  request: string;
  /** Set when the edit changed the deck as submitted; the suggestions were rebuilt from it. */
  target?: "original";
  changes: { action: "add" | "remove"; name: string; qty: number; reason: string }[];
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
  before: DeckSnapshot;
  after: DeckSnapshot;
  combosPresent: Combo[];
  combosOneAway: Combo[];
  research: Research | null;
  edhrec: { url: string; numDecks: number | null; avgLands: number | null } | null;
  warnings: string[];
  options: OptimizeOptions;
  bracket?: BracketReport;
  /** Changes applied through chat after optimization, oldest first. */
  edits?: DeckEdit[];
  /** The deck as submitted, for the default view; `before` and `bracket.before` hold its stats. */
  original?: { decklist: DecklistCard[]; combosPresent: Combo[]; combosOneAway: Combo[] };
  /** How to play the deck as submitted and the suggested one (needs an LLM). */
  howToPlay?: { original?: PlayGuide; optimized?: PlayGuide };
  /** Strong non-combo interactions in the deck (needs an LLM). */
  synergies?: Synergy[];
  /** Land swaps that would still improve the mana base; recomputed after every edit. */
  manaSuggestions?: ManaSuggestion[];
  /** Preview data for every card the report mentions, so any card name can show its image. */
  cardIndex?: Record<string, CardPreview>;
  /** Optimized list with display data; absent in reports generated before it existed. */
  decklist?: DecklistCard[];
  /** Published without the doc's suggestions: only the deck as submitted (see `withoutSuggestions`). */
  suggestionsHidden?: boolean;
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
  /** What the run is doing, task by task and request by request. */
  trace?: Trace;
}

/** An outside service a run calls. */
export type Service = "scryfall" | "spellbook" | "edhrec" | "model" | "decisions";

/**
 * One task in a run's graph, by id ("landPool"): what it's called is the frontend's
 * (src/shared/run-copy.ts). Times are in ms since the run started.
 */
export interface TraceTask {
  name: string;
  /** The tasks it waits for. */
  needs: string[];
  state: "waiting" | "running" | "done" | "failed";
  start?: number;
  end?: number;
}

/** A request to an outside service, and the task that made it. Times as in `TraceTask`. */
export interface TraceRequest {
  service: Service;
  /** What it asked, briefly: "look up 75 cards". */
  what: string;
  task?: string;
  start: number;
  end?: number;
  ok?: boolean;
}

/** A finished run, saved with its deck (`run.json`) so it can be replayed. */
export interface RunRecord {
  startedAt: string;
  status: "done" | "error";
  trace: Trace;
}

/** A run so far: its tasks and requests, taken `elapsed` ms after it started. */
export interface Trace {
  elapsed: number;
  tasks: TraceTask[];
  requests: TraceRequest[];
}

/** What the client needs to know about the server (`GET /api/config`). */
export interface AppConfig {
  llm: boolean;
  model: string;
  visionModel: string;
  webResearch: boolean;
}

/** A recognized deck, with the token that saves its photos alongside it. */
export interface Recognition extends RecognitionResult {
  uploadToken?: string;
}

/** Photo recognition running in the background (`GET /api/recognize/:id`). */
export interface RecognitionJob {
  id: string;
  status: "running" | "done" | "error";
  phase: string;
  done: number;
  total: number;
  result?: Recognition;
  error?: string;
}

/** One name looked up for the review screen (`POST /api/cards/resolve`). */
export interface ResolvedName {
  requested: string;
  card: Card | null;
  status: "exact" | "fuzzy" | "unresolved";
}

/** A deck's settings as the client sees them. */
export interface DeckDetailMeta {
  slug: string;
  format: string;
  commanders: string[];
  options: OptimizeOptions;
  createdAt: string;
  hideSuggestions?: boolean;
}

/** Changes to a deck still being worked out (`GET /api/decks/:slug/status`). */
export interface DeckStatus {
  /** Edits are still being made in the background; the report updates when they're in. */
  updating?: boolean;
  /** Edits are in; their slower parts (combos, synergies...) are worked out in this long. */
  refreshInMs?: number;
  /** Those slower parts are being worked out now. */
  refreshing?: boolean;
  /** When the report was last saved (ms since the epoch): it changed if this did. */
  savedAt?: number;
}

/** A deck with its report (`GET /api/decks/:slug`, or `detail.json` on the static site). */
export interface DeckDetail extends DeckStatus {
  meta: DeckDetailMeta;
  report: Report | null;
  initial: string;
  /** The deck's last optimizer run is saved, and can be replayed. */
  hasRun?: boolean;
}
