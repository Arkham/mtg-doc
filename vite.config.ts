import { defineConfig } from "vite";

// Relative base so the static export works from any sub-path (e.g. GitHub Pages project sites).
// The Elm app is compiled by elm-watch into public/elm/, which hot-reloads it itself.
export default defineConfig({
  base: "./",
  server: { watch: { ignored: ["**/public/elm/**", "**/elm-stuff/**"] } },
});
