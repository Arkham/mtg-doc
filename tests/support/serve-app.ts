/**
 * Playwright web server for the visual suite's local-app pages: the real dev server, offline and
 * without an LLM, on a decks folder seeded with two optimized decks and a chat history.
 */
import "./env.ts";
import { chatAboutDeck } from "../../src/server/chat.ts";
import { updateChat } from "../../src/server/chat-history.ts";
import { optimizeFixtureDeck } from "./sample.ts";
import { PINNED_AT, pinReport } from "./visual-seed.ts";

const overpowered = await optimizeFixtureDeck("lathril-overpowered.txt", {
  bracket: 3,
  tone: "max",
  budgetTotal: 300,
});
await pinReport(overpowered.slug, { rich: true });
const casual = await optimizeFixtureDeck("lathril.txt", {
  bracket: 2,
  tone: "casual",
  maxSwaps: 8,
});
await pinReport(casual.slug);

// Without an LLM the doc answers simple edits; mark one applied and offer a re-run after it.
const proposal = await chatAboutDeck(overpowered.slug, "swap Sol Ring for Mind Stone");
await chatAboutDeck(overpowered.slug, "what should I cut?");
const applied = await chatAboutDeck(overpowered.slug, "remove 2 Forest");
await updateChat(overpowered.slug, (ms) => [
  ...ms.map((m) => ({ ...m, at: PINNED_AT, ...(m.id === applied.id ? { applied: true } : {}) })),
  {
    id: "rerun-offer",
    role: "assistant" as const,
    content:
      "That change left the deck with 34 lands, under the recommended 37. I can re-run the optimizer to rebalance the rest of the deck around your changes, keeping your edits. Want me to?",
    at: PINNED_AT,
    rerun: { options: {}, summary: "the current settings, keeping your edits", keepEdits: true },
  },
]);
if (!proposal.changes?.length) throw new Error("The seeded chat proposed no changes");

await import("../../src/server/index.ts");
