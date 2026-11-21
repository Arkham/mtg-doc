/**
 * Playwright web server for UI that needs a model (streamed chat replies): the dev server with
 * the Responses API stand-in, streaming slowly enough to watch a reply arrive.
 */
import "./env.ts";
import { startLlmStub } from "./llm-stub.ts";

const stub = await startLlmStub({ streamDelayMs: 60 });
process.env.LLM_BASE_URL = stub.url;
process.env.LLM_API_KEY = "stub-key";
process.env.LLM_MODEL = "test-model";
process.env.LLM_DECISION_MODEL = "test-decision-model";
const { optimizeFixtureDeck } = await import("./sample.ts");
await optimizeFixtureDeck("lathril.txt", { bracket: 3, tone: "balanced", maxSwaps: 4 });
// More decks, one per test that changes them, since tests run side by side.
await optimizeFixtureDeck("lathril-overpowered.txt", { bracket: 3, tone: "max", budgetTotal: 300 });
await optimizeFixtureDeck("lathril.txt", { bracket: 3, tone: "balanced", maxSwaps: 4 });
await import("../../server/index.ts");
