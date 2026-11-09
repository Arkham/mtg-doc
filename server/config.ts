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

export const config = {
  root: ROOT,
  port: Number(env("PORT") ?? 5173),
  host: env("HOST") ?? "127.0.0.1",
  decksDir: path.resolve(ROOT, env("DECKS_DIR") ?? "decks"),
  llm: {
    baseUrl: (env("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: env("LLM_API_KEY"),
    model: env("LLM_MODEL") ?? "gpt-5.4",
    visionModel: env("LLM_VISION_MODEL") ?? env("LLM_MODEL") ?? "gpt-5.4",
    searchModel: env("LLM_SEARCH_MODEL"),
  },
  userAgent: "mtg-deck-doctor/0.1 (local)",
};

export const llmEnabled = () => Boolean(config.llm.apiKey);
