/**
 * Import first in every test file: isolates tests from the developer's .env and puts fakes in place
 * of the network (see fakes/index.ts).
 * Module evaluation order guarantees this runs before server config is read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installFakes } from "./fakes/index.ts";

process.env.LLM_API_KEY = "";
process.env.LLM_WEB_SEARCH = "false";
process.env.LLM_RETRY_DELAY_MS = "0";
// Edits' refreshes run right away, unless a test is about waiting for them.
process.env.REFRESH_DELAY_MS ??= "0";
process.env.LLM_BASE_URL = "https://llm.test/v1";
// Blank rather than unset: src/server/config.ts only reads `.env` for keys missing from the environment.
for (const key of [
  "LLM_MODEL",
  "LLM_VISION_MODEL",
  "LLM_SEARCH_MODEL",
  "LLM_DECISION_MODEL",
  "LLM_SERVICE_TIER",
  "LLM_REASONING",
]) {
  process.env[key] = "";
}
// The fakes need no rate limiting.
process.env.SCRYFALL_MIN_INTERVAL_MS = "0";
process.env.SCRYFALL_LIMITED_INTERVAL_MS = "0";
process.env.DECKS_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "mtg-doc-test-"));

installFakes();
