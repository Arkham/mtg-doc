/**
 * Checks that every saved report agrees with its deck list in every section (swaps, combos,
 * synergies, bracket lists, mana suggestions...). Exits non-zero on any problem.
 *   node --import tsx scripts/check-decks.ts [slug...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../server/config.ts";
import { checkSavedDeck } from "../server/storage.ts";

const wanted = process.argv.slice(2);
const slugs = wanted.length
  ? wanted
  : (await fs.readdir(config.decksDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

let failed = 0;
for (const slug of slugs) {
  const problems = await checkSavedDeck(path.join(config.decksDir, slug));
  if (!problems.length) {
    console.log(`✓ ${slug}`);
    continue;
  }
  failed++;
  console.log(`✗ ${slug}`);
  for (const p of problems) console.log(`  - ${p}`);
}
process.exit(failed ? 1 : 0);
