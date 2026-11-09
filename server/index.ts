import path from "node:path";
import express from "express";
import { createApp } from "./app.ts";
import { config, llmEnabled } from "./config.ts";

const app = createApp();

if (process.env.NODE_ENV === "production") {
  const dist = path.join(config.root, "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: config.root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(config.port, config.host, () => {
  console.log(
    `mtg-doc running at http://${config.host === "0.0.0.0" ? "<this-machine-ip>" : "localhost"}:${config.port}`,
  );
  if (!llmEnabled())
    console.log("LLM_API_KEY not set: image recognition and AI swaps are disabled.");
});
