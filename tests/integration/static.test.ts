import "../support/env.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { checkReport } from "../../src/server/analysis/consistency.ts";
import { config } from "../../src/server/config.ts";
import { setHideSuggestions } from "../../src/server/storage.ts";
import type { Report } from "../../src/shared/types.ts";
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
    assert.match(html, /<base href=".\/" \/>/);
    for (const f of [
      ".nojekyll",
      "manifest.webmanifest",
      "apple-touch-icon.png",
      "icon-64.png",
      "icon-96.png",
    ]) {
      assert.ok(fs.existsSync(path.join(out, f)), `${f} exists`);
    }

    // Everything is readable without JavaScript: an llms.txt index, and every URL the app shows
    // is a real page with its content in plain HTML.
    const llms = fs.readFileSync(path.join(out, "llms.txt"), "utf8");
    assert.match(llms, new RegExp(`\\[Lathril, Blade of the Elves\\]\\(decks/${slug}/\\)`));
    assert.match(
      html,
      new RegExp(`<div id="root"><main class="agent-fallback">.*href="decks/${slug}/"`),
    );
    assert.match(html, /rel="alternate" type="text\/plain" href="llms.txt"/);
    for (const [route, base] of [
      [`decks/${slug}`, "../../"],
      [`decks/${slug}/optimized`, "../../../"],
    ]) {
      const page = fs.readFileSync(path.join(out, route, "index.html"), "utf8");
      assert.match(page, new RegExp(`<base href="${base}" />`), route);
      assert.match(page, /<div id="root"><main class="agent-fallback">/);
      assert.match(page, /<h1>Lathril, Blade of the Elves: Commander deck report<\/h1>/);
      assert.match(page, /Part 1: The deck as submitted/);
      assert.match(page, /Suggested decklist \(100 cards\)/);
      assert.match(page, new RegExp(`href="data/decks/${slug}/report.md"`));
    }

    assert.ok(!fs.existsSync(path.join(out, `decks/${slug}/rule0`)), "How to play is a dialog");
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

    // The run that made the report replays at its own page, readable without JavaScript too.
    const run = JSON.parse(fs.readFileSync(path.join(out, "data/decks", slug, "run.json"), "utf8"));
    assert.equal(run.status, "done");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(out, "data/decks", slug, "detail.json"), "utf8")).hasRun,
      true,
    );
    const runHtml = fs.readFileSync(path.join(out, "decks", slug, "run/index.html"), "utf8");
    assert.match(runHtml, /<base href="..\/..\/..\/" \/>/);
    assert.match(runHtml, /<h1>How the doc optimized Lathril, Blade of the Elves<\/h1>/);
    assert.match(runHtml, /<strong>Find upgrades<\/strong>: from [\d.]+s to [\d.]+s/);
    assert.match(runHtml, /requests: \d+ to Scryfall/);
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
    assert.ok(!fs.existsSync(path.join(dir, "run.json")), "the run is kept with the suggestions");
    assert.ok(!fs.existsSync(path.join(out, "decks", slug, "run")));
    assert.equal(JSON.parse(raw).hasRun, false);
    assert.ok(fs.existsSync(path.join(dir, "initial.txt")));

    assert.match(markdown, /^### Decklist \(100 cards\)$/m);
    assert.match(markdown, /^\| \| Value \|$/m);
    assert.doesNotMatch(markdown, /Part 2|Suggested|swaps|## Strategy/);
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
