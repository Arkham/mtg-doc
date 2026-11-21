/**
 * Local development: elm-watch hot-reloads the Elm app into public/elm/ while the API server (with
 * Vite for the rest) restarts on server changes. Ctrl+C stops both.
 */
import { spawn } from "node:child_process";

const run = (command: string, args: string[]) =>
  spawn(command, args, { stdio: "inherit", env: process.env });

const elm = run("node_modules/.bin/elm-watch", ["hot"]);
const server = run("node_modules/.bin/tsx", [
  "watch",
  "--clear-screen=false",
  "--ignore",
  "decks/**",
  "--ignore",
  "src/**",
  "server/index.ts",
]);
const stop = () => {
  elm.kill();
  server.kill();
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
elm.on("exit", stop);
server.on("exit", stop);
