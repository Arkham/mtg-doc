/**
 * Import first in every test file: isolates tests from the developer's .env and the network.
 * Module evaluation order guarantees this runs before server config is read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installHttpFixtures } from "./http-fixtures.ts";

process.env.LLM_API_KEY = "";
process.env.LLM_WEB_SEARCH = "false";
process.env.LLM_RETRY_DELAY_MS = "0";
process.env.LLM_BASE_URL = "https://llm.test/v1";
process.env.SCRYFALL_MIN_INTERVAL_MS = process.env.FIXTURES === "record" ? "110" : "0";
process.env.DECKS_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "mtg-doc-test-"));

installHttpFixtures();
