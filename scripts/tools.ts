/**
 * The Elm tools elm-tooling installs (elm, elm-format, ...): the copy `pnpm install` put in
 * node_modules/.bin, or the one on PATH, which the Nix dev shell provides in the same versions.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

export function tool(name: string): string {
  const local = path.join(ROOT, "node_modules/.bin", name);
  return fs.existsSync(local) ? local : name;
}
