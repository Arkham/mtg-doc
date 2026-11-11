import "../support/env.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { checkReport } from "../../server/analysis/consistency.ts";
import { config } from "../../server/config.ts";
import { setHideSuggestions } from "../../server/storage.ts";
import type { Report } from "../../shared/types.ts";
import { optimizeFixtureDeck } from "../support/sample.ts";

describe("static site export", () => {
  test("builds a self-contained site with relative paths and deck data", async () => {
    const { slug } = await optimizeFixtureDeck("lathril-overpowered.txt", {
      bracket: 3,
      tone: "max",
      budgetTotal: 300,
    });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-doc-site-"));
    execFileSync(process.execPath, ["--import", "tsx", "scripts/build-static.ts", "--out", out], {
      cwd: config.root,
      env: { ...process.env, DECKS_DIR: config.decksDir },
      stdio: "pipe",
    });

    const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
    assert.match(html, /src="\.\/assets\/index-[\w-]+\.js"/, "assets use relative URLs");
    assert.ok(fs.existsSync(path.join(out, "symbols/G.svg")), "mana symbols ship with the site");
    assert.match(html, /<title>mtg doc<\/title>/);
    for (const f of [
      ".nojekyll",
      "manifest.webmanifest",
      "apple-touch-icon.png",
      "icon-64.png",
      "icon-96.png",
    ]) {
      assert.ok(fs.existsSync(path.join(out, f)), `${f} exists`);
    }

    // Everything is readable without JavaScript: an llms.txt index, a fallback inside the app
    // shell (hash links never reach the server) and a plain page per deck.
    const llms = fs.readFileSync(path.join(out, "llms.txt"), "utf8");
    assert.match(llms, new RegExp(`\\[Lathril, Blade of the Elves\\]\\(decks/${slug}/\\)`));
    assert.match(
      html,
      new RegExp(`<div id="root"><main class="agent-fallback">.*href="decks/${slug}/"`),
    );
    assert.match(html, /rel="alternate" type="text\/plain" href="llms.txt"/);
    const page = fs.readFileSync(path.join(out, `decks/${slug}/index.html`), "utf8");
    assert.doesNotMatch(page, /<script/);
    assert.match(page, /<h1>Lathril, Blade of the Elves<\/h1>/);
    assert.match(page, /Deck list as submitted \(100 cards\)/);
    assert.match(page, /Suggested deck list/);
    assert.match(page, new RegExp(`href="../../#/deck/${slug}"`));

    const decks = JSON.parse(fs.readFileSync(path.join(out, "data/decks.json"), "utf8"));
    assert.ok(
      decks.some(
        (d: { slug: string; targetBracket: number; swapCount: number }) =>
          d.slug === slug && d.targetBracket === 3 && d.swapCount > 0,
      ),
    );
    const detail = JSON.parse(
      fs.readFileSync(path.join(out, `data/decks/${slug}/detail.json`), "utf8"),
    );
    assert.equal(detail.report.bracket.target, 3);
    for (const f of ["initial.txt", "optimized.txt", "report.md"]) {
      assert.ok(fs.existsSync(path.join(out, `data/decks/${slug}/${f}`)), `${f} exported`);
    }
    assert.ok(
      !fs.existsSync(path.join(out, `data/decks/${slug}/uploads`)),
      "photos are never published",
    );

    const js = fs.readdirSync(path.join(out, "assets")).find((f) => f.endsWith(".js"))!;
    assert.ok(
      !fs.readFileSync(path.join(out, "assets", js), "utf8").includes('/api/recognize"'),
      "static build has no upload flow wired to an API",
    );
  });

  test("a deck published without suggestions shows only the deck as submitted", async () => {
    const { slug, report } = await optimizeFixtureDeck("lathril.txt", {
      bracket: 2,
      tone: "casual",
      maxSwaps: 8,
    });
    await setHideSuggestions(slug, true);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-doc-site-"));
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/build-static.ts", "--out", out, "--only", slug],
      { cwd: config.root, env: { ...process.env, DECKS_DIR: config.decksDir }, stdio: "pipe" },
    );
    const dir = path.join(out, "data/decks", slug);
    const raw = fs.readFileSync(path.join(dir, "detail.json"), "utf8");
    const published = JSON.parse(raw).report as Report;
    assert.equal(published.suggestionsHidden, true);
    assert.deepEqual(published.swaps, []);
    assert.deepEqual(published.decklist, report.original!.decklist);
    assert.deepEqual(published.after, report.before);
    assert.equal(published.strategy, "", "the plan describes the doc's changes");
    assert.deepEqual(checkReport(published), []);

    // No card that only the suggestions mention is published anywhere.
    const submitted = new Set(report.original!.decklist.map((c) => c.name));
    const suggested = report.swaps.map((s) => s.in).filter((n) => !submitted.has(n));
    assert.ok(suggested.length > 0);
    const markdown = fs.readFileSync(path.join(dir, "report.md"), "utf8");
    const page = fs.readFileSync(path.join(out, "decks", slug, "index.html"), "utf8");
    for (const name of suggested)
      for (const [file, text] of [
        ["detail.json", raw],
        ["report.md", markdown],
        ["index.html", page],
      ])
        assert.ok(!text.includes(JSON.stringify(name).slice(1, -1)), `${name} leaks in ${file}`);
    assert.ok(!fs.existsSync(path.join(dir, "optimized.txt")));
    assert.ok(fs.existsSync(path.join(dir, "initial.txt")));

    assert.match(markdown, /^## Deck list \(100 cards\)$/m);
    assert.match(markdown, /^\| \| Value \|$/m);
    assert.doesNotMatch(markdown, /## Swaps|Suggested deck list|Before|## Strategy/);
    const [summary] = JSON.parse(fs.readFileSync(path.join(out, "data/decks.json"), "utf8"));
    assert.equal(summary.swapCount, undefined);
    assert.doesNotMatch(fs.readFileSync(path.join(out, "llms.txt"), "utf8"), /suggested swaps/);
  });

  test("--only publishes a subset", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-doc-site-"));
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/build-static.ts", "--out", out, "--only", "nothing-here"],
      {
        cwd: config.root,
        env: { ...process.env, DECKS_DIR: config.decksDir },
        stdio: "pipe",
      },
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, "data/decks.json"), "utf8")), []);
  });
});
