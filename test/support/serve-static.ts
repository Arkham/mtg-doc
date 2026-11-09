/**
 * Playwright web server for the static-site suite: optimizes the fixture decks offline, exports the
 * static site and serves it under a sub-path (like GitHub Pages project sites).
 */
import "./env.ts";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { config } from "../../server/config.ts";
import { optimizeFixtureDeck } from "./sample.ts";

const PORT = Number(process.env.STATIC_PORT ?? 4174);
const BASE = "/mtg-doc/";

await optimizeFixtureDeck("lathril-overpowered.txt", { bracket: 3, tone: "max", budgetTotal: 300 });
await optimizeFixtureDeck("lathril.txt", { bracket: 2, tone: "casual", maxSwaps: 8 });

const out = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-doc-e2e-site-"));
execFileSync(process.execPath, ["--import", "tsx", "scripts/build-static.ts", "--out", out], {
  cwd: config.root,
  env: { ...process.env, DECKS_DIR: config.decksDir },
  stdio: "inherit",
});

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (!url.startsWith(BASE)) {
      res.writeHead(302, { location: BASE }).end();
      return;
    }
    let file = path.join(out, url.slice(BASE.length));
    if (!file.startsWith(out)) return void res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`static site on http://127.0.0.1:${PORT}${BASE}`));
