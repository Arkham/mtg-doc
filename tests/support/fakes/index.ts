/**
 * Fakes for the outside services, in place of the network: Scryfall, Commander Spellbook and
 * EDHREC answer from small databases of real data in `tests/fixtures/fakes`, whatever the app
 * asks; local traffic (the app under test) passes through. Anything else fails, loudly: a test
 * that talks to the LLM stubs it itself.
 */
import fs from "node:fs";
import path from "node:path";
import { scryfall } from "./scryfall.ts";
import { spellbook } from "./spellbook.ts";

const isLocal = (url: URL) => url.hostname === "127.0.0.1" || url.hostname === "localhost";

const EDHREC = path.resolve(import.meta.dirname, "../../fixtures/fakes/edhrec");

/** EDHREC's commander pages: the saved ones; any other is missing, as EDHREC answers (403). */
function edhrec(url: URL): Response {
  const file = path.join(EDHREC, url.pathname.replace(/^\/pages\/commanders\//, ""));
  if (!file.startsWith(EDHREC) || !fs.existsSync(file))
    return new Response("<Error><Code>AccessDenied</Code></Error>", {
      status: 403,
      headers: { "content-type": "application/xml" },
    });
  return new Response(fs.readFileSync(file), { headers: { "content-type": "application/json" } });
}

const SERVICES: Record<string, (url: URL, init?: RequestInit) => Response> = {
  "api.scryfall.com": scryfall,
  "backend.commanderspellbook.com": spellbook,
  "json.edhrec.com": edhrec,
};

export function installFakes() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (isLocal(url)) return original(input, init);
    try {
      const service = SERVICES[url.host];
      if (!service) throw new Error(`No fake for ${init?.method ?? "GET"} ${url.href}`);
      return service(url, init);
    } catch (err) {
      // A server the browser suites drive would only log this from some background job, and the
      // page would wait on it until the test times out: stop instead, so every test fails at once.
      if (process.env.FAKES_FATAL) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
      throw err;
    }
  };
}
