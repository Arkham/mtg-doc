/**
 * Builds the Elm app: into public/elm/ with elm-watch (`--optimize` for production), or into a file
 * of its own (`buildElmTo`, `--to <file>`) for the test servers and the static site, so they never
 * overwrite what `pnpm dev` is serving there. Builds wait for each other: two Elm compilers sharing
 * elm-stuff/ can corrupt it, and the test servers build at the same time.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "./tools.ts";

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

/** The newest change to anything a build reads. */
function newestInput(): number {
  let newest = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".elm")) newest = Math.max(newest, fs.statSync(file).mtimeMs);
    }
  };
  walk(path.join(ROOT, "src"));
  for (const file of ["elm.json", "scripts/elm-postprocess.js"])
    newest = Math.max(newest, fs.statSync(path.join(ROOT, file)).mtimeMs);
  return newest;
}

/**
 * Builds the app into `output`, unless it's already newer than every source, so the several test
 * servers that start together build it once.
 */
export async function buildElmTo(output: string, optimize: boolean) {
  await lock();
  try {
    const built = fs.statSync(output, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (built > newestInput()) return;
    // Elm only writes to a file named .js or .html.
    const tmp = `${output}.${process.pid}.tmp.js`;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync(
      tool("elm"),
      ["make", "src/web/Main.elm", "--output", tmp, ...(optimize ? ["--optimize"] : [])],
      { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
    );
    if (optimize) {
      const { default: postprocess } = await import("./elm-postprocess.js");
      const code = await postprocess({
        code: fs.readFileSync(tmp, "utf8"),
        compilationMode: "optimize",
      });
      fs.writeFileSync(tmp, code);
    }
    fs.renameSync(tmp, output);
  } finally {
    fs.rmSync(LOCK, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const to = process.argv.indexOf("--to");
  if (to !== -1)
    await buildElmTo(path.resolve(ROOT, process.argv[to + 1]), process.argv.includes("--optimize"));
  else await buildElm(process.argv.includes("--optimize"));
}
