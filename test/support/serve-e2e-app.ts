/**
 * Playwright web server for the e2e suite's local app: the real dev server, offline and without
 * an LLM, on a decks folder seeded with optimized decks (lathril-blade-of-the-elves, -2 and -3),
 * so tests that start from a report don't each import and optimize one, and can run side by side.
 * Each is made as the import flow makes it (bracket 3, max, $300, Sol Ring kept); tests that change
 * a deck each have their own.
 */
import "./env.ts";
import { optimizeFixtureDeck } from "./sample.ts";

const options = { bracket: 3, tone: "max", budgetTotal: 300, locked: ["Sol Ring"] } as const;
for (let i = 0; i < 3; i++)
  await optimizeFixtureDeck("lathril-overpowered.txt", { ...options, locked: [...options.locked] });
await import("../../server/index.ts");
