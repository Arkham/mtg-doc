// Minifies Elm's output for production builds (elm-watch's postprocess hook, see elm-watch.json).
// Elm's helpers are pure, so the minifier may drop calls whose results go unused.
import { transform } from "esbuild";

const PURE = [
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
];

/** @type {import("elm-watch/elm-watch-node").Postprocess} */
export default async function postprocess({ code, compilationMode }) {
  if (compilationMode !== "optimize") return code;
  const { code: minified } = await transform(code, {
    minify: true,
    pure: PURE,
    target: "es2020",
  });
  return minified;
}
