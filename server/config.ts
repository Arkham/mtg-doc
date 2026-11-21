import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Loads `.env` with `${VAR}` expansion so secrets can be referenced from the shell instead of copied. */
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] !== undefined) continue;
    const value = rawValue
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, v) => process.env[v] ?? "");
    process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, ".env"));

const env = (k: string) => process.env[k]?.trim() || undefined;

export type ReasoningEffort = "low" | "medium" | "high";

export const config = {
  root: ROOT,
  port: Number(env("PORT") ?? 5173),
  host: env("HOST") ?? "127.0.0.1",
  decksDir: path.resolve(ROOT, env("DECKS_DIR") ?? "decks"),
  llm: {
    baseUrl: (env("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: env("LLM_API_KEY"),
    /** The model that does all the work; there's no AI without one. */
    model: env("LLM_MODEL"),
    /** How hard the model thinks, on every request. */
    reasoning: (env("LLM_REASONING") ?? "low") as ReasoningEffort,
    visionModel: env("LLM_VISION_MODEL") ?? env("LLM_MODEL"),
    /** Model used with the Responses API web_search tool. */
    searchModel: env("LLM_SEARCH_MODEL") ?? env("LLM_MODEL"),
    webSearch: (env("LLM_WEB_SEARCH") ?? "true") !== "false",
    /** Classifier for yes/no checks via the Decisions API (POST /decisions). */
    decisionModel: env("LLM_DECISION_MODEL"),
    /**
     * Whether yes/no checks go to the Decisions API: only with a model for it, and not for
     * providers without one (LLM_DECISIONS=false). Otherwise `decide` asks LLM_MODEL.
     */
    decisions: Boolean(env("LLM_DECISION_MODEL")) && (env("LLM_DECISIONS") ?? "true") !== "false",
    retryDelayMs: Number(env("LLM_RETRY_DELAY_MS") ?? 2000),
    /** Sent as `service_tier` with every Responses API request when set (e.g. "fast"). */
    serviceTier: env("LLM_SERVICE_TIER"),
  },
  userAgent: "mtg-doc/0.1 (local)",
  /** How long edits must stop before their slower consequences are worked out (see refresh.ts). */
  refreshDelayMs: Number(env("REFRESH_DELAY_MS") ?? 30_000),
  /** Scryfall's hard limits: 2/s for search, named and collection; 10/s for everything else. */
  scryfallIntervalMs: {
    limited: Number(env("SCRYFALL_LIMITED_INTERVAL_MS") ?? 520),
    other: Number(env("SCRYFALL_MIN_INTERVAL_MS") ?? 110),
  },
};

export const llmEnabled = () => Boolean(config.llm.apiKey && config.llm.model);
