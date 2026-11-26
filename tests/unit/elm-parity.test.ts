/**
 * The Elm app against what it has to agree with: every saved report, chat and deck summary decodes
 * with the decoders generated from src/shared/types.ts, and number formatting and name sorting match
 * JavaScript, which the server and the old UI used.
 */
import "../support/env.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import vm from "node:vm";
import { config } from "../../src/server/config.ts";
import { tool } from "../../scripts/tools.ts";
import { listDecks } from "../../src/server/storage.ts";
import { type Route, routeHref } from "../../src/web/routes.ts";
import { TASK_LABELS } from "../../src/shared/run-copy.ts";
import { isBasicLand } from "../../src/shared/basics.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DECKS = path.join(ROOT, "decks");

interface Worker {
  ports: {
    request: { send(v: unknown): void };
    respond: { subscribe(fn: (v: unknown) => void): void };
  };
}

let worker: Worker;
let pending: ((v: unknown) => void) | null = null;
const ask = (request: unknown) =>
  new Promise<unknown>((resolve) => {
    pending = resolve;
    worker.ports.request.send(request);
  });

before(() => {
  // A copy of elm.json that also sees tests/support, so the worker builds against the app's modules.
  const dir = path.join(ROOT, "elm-stuff", "parity");
  fs.mkdirSync(dir, { recursive: true });
  const elmJson = JSON.parse(fs.readFileSync(path.join(ROOT, "elm.json"), "utf8"));
  elmJson["source-directories"] = [path.join(ROOT, "src/web"), path.join(ROOT, "tests/support")];
  fs.writeFileSync(path.join(dir, "elm.json"), JSON.stringify(elmJson));
  const out = path.join(dir, "parity.js");
  execFileSync(
    tool("elm"),
    ["make", path.join(ROOT, "tests/support/Parity.elm"), "--output", out],
    { cwd: dir, stdio: ["ignore", "ignore", "inherit"] },
  );
  // Elm's output attaches itself to the script's global object.
  const sandbox: { Elm?: { Parity: { init(): Worker } }; setTimeout: typeof setTimeout } = {
    setTimeout,
  };
  vm.runInNewContext(fs.readFileSync(out, "utf8"), sandbox, { filename: out });
  worker = sandbox.Elm!.Parity.init();
  worker.ports.respond.subscribe((v) => {
    const resolve = pending;
    pending = null;
    resolve?.(v);
  });
});

const decodes = async (type: string, json: unknown, label: string) =>
  assert.equal(await ask({ kind: "decode", type, json }), null, label);

describe("Elm decoders", () => {
  test("decode every saved deck's report and chat", async () => {
    const slugs = fs
      .readdirSync(DECKS)
      .filter((d) => fs.existsSync(path.join(DECKS, d, "report.json")));
    assert.ok(slugs.length > 0);
    for (const slug of slugs) {
      const report = JSON.parse(fs.readFileSync(path.join(DECKS, slug, "report.json"), "utf8"));
      await decodes("report", report, `${slug}/report.json`);
      const chat = path.join(DECKS, slug, "chat.json");
      if (fs.existsSync(chat))
        await decodes("chat", JSON.parse(fs.readFileSync(chat, "utf8")), `${slug}/chat.json`);
    }
  });

  test("decode the deck list as the server sends it", async () => {
    const previous = config.decksDir;
    config.decksDir = DECKS;
    try {
      await decodes("decks", JSON.parse(JSON.stringify(await listDecks())), "listDecks()");
    } finally {
      config.decksDir = previous;
    }
  });
});

describe("Elm formatting and sorting", () => {
  test("toFixed matches JavaScript", async () => {
    const values = [0, -0, 0.5, 1.005, 0.125, 2.675, 1e-7, 123456.789, -1.5, 37.965];
    for (let i = 0; i < 4000; i++) {
      const scale = 10 ** Math.floor(Math.random() * 6);
      values.push((Math.random() - 0.3) * scale, Math.round(Math.random() * 100000) / 1000);
    }
    const cases = values.flatMap((x) => [0, 1, 2].map((d) => [d, x] as [number, number]));
    const elm = (await ask({ kind: "toFixed", cases })) as string[];
    cases.forEach(([d, x], i) => assert.equal(elm[i], x.toFixed(d), `(${x}).toFixed(${d})`));
  });

  test("card names sort like localeCompare", async () => {
    const names = new Set<string>();
    for (const slug of fs.readdirSync(DECKS)) {
      const file = path.join(DECKS, slug, "report.json");
      if (!fs.existsSync(file)) continue;
      const report = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const name of Object.keys(report.cardIndex ?? {})) names.add(name);
    }
    const list = [...names];
    assert.ok(list.length > 100);
    const elm = (await ask({ kind: "sort", names: list })) as string[];
    const js = [...list].sort((a, b) => a.localeCompare(b));
    const at = js.findIndex((n, i) => elm[i] !== n);
    assert.equal(
      at,
      -1,
      `first difference: ${JSON.stringify(js.slice(at, at + 3))} vs ${JSON.stringify(elm.slice(at, at + 3))}`,
    );
  });
  test("knows the same basic lands as the server", async () => {
    const names = [
      "Plains",
      "Island",
      "Swamp",
      "Mountain",
      "Forest",
      "Wastes",
      "Snow-Covered Island",
      "Snow-Covered Wastes",
      "Forest Bear",
      "snow-covered island",
      "Island Sanctuary",
      "Snow-Covered",
    ];
    const elm = JSON.parse(JSON.stringify(await ask({ kind: "isBasicLand", names }))) as Record<
      string,
      boolean
    >;
    for (const name of names) assert.equal(elm[name], isBasicLand(name), name);
  });
});

describe("Elm routes", () => {
  test("link where src/web/routes.ts puts each page, locally and on the published site", async () => {
    const routes: Route[] = [
      { page: "home" },
      { page: "review" },
      { page: "deck", slug: "lathril", view: "current" },
      { page: "deck", slug: "lathril", view: "optimized" },
      { page: "job", slug: "lathril", jobId: "j1" },
    ];
    for (const isStatic of [false, true])
      assert.deepEqual(
        [...((await ask({ kind: "href", isStatic, routes })) as string[])],
        routes.map((r) => routeHref(r, isStatic)),
      );
  });
});

describe("Elm run copy", () => {
  test("calls each task of a run what src/shared/run-copy.ts does", async () => {
    // An id the Elm app doesn't know would come back as itself.
    const ids = Object.keys(TASK_LABELS);
    // From the worker's own context: compared as data.
    const elm = JSON.parse(JSON.stringify(await ask({ kind: "taskLabels", ids })));
    assert.deepEqual(elm, TASK_LABELS);
  });
});
