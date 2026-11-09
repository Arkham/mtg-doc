import "../support/env.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { config } from "../../server/config.ts";
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
    assert.match(html, /<title>mtg-doc<\/title>/);
    for (const f of [".nojekyll", "manifest.webmanifest", "apple-touch-icon.png", "icon.svg"]) {
      assert.ok(fs.existsSync(path.join(out, f)), `${f} exists`);
    }

    const decks = JSON.parse(fs.readFileSync(path.join(out, "data/decks.json"), "utf8"));
    assert.ok(
      decks.some((d: { slug: string; bracket: number }) => d.slug === slug && d.bracket === 3),
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
