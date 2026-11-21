/**
 * Builds the Elm app into public/elm/ (`--optimize` for production). Builds wait for each other:
 * two Elm compilers sharing elm-stuff/ can corrupt it, and the test servers build at the same time.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOCK = path.join(ROOT, "elm-stuff", "build.lock");
/** A lock older than this was left by a build that died. */
const STALE_MS = 5 * 60_000;

async function lock() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      return;
    } catch {
      const age =
        Date.now() - (fs.statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > STALE_MS) fs.rmSync(LOCK, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** Builds the app, then runs `then` (e.g. a bundler copying the output) before the next build. */
export async function buildElm(optimize: boolean, then?: () => Promise<unknown>) {
  await lock();
  try {
    execFileSync(
      path.join(ROOT, "node_modules/.bin/elm-watch"),
      ["make", ...(optimize ? ["--optimize"] : [])],
      { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
    );
    await then?.();
  } finally {
    fs.rmSync(LOCK, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await buildElm(process.argv.includes("--optimize"));
