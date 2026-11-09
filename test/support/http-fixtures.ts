import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Record/replay for outbound HTTP so tests are offline and deterministic.
 * FIXTURES=record hits the real APIs and stores responses; the default replays them and fails on
 * anything unrecorded. Local traffic (the app under test) always passes through.
 */
export const FIXTURE_DIR = path.resolve(import.meta.dirname, "../fixtures/http");

interface Recording {
  method: string;
  url: string;
  status: number;
  contentType: string | null;
  text: string;
}

const isLocal = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url);

export function fixtureKey(method: string, url: string, body: string) {
  return createHash("sha1").update(`${method} ${url}\n${body}`).digest("hex").slice(0, 20);
}

export function installHttpFixtures(
  mode = process.env.FIXTURES === "record" ? "record" : "replay",
) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (isLocal(url)) return real(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    const file = path.join(FIXTURE_DIR, `${fixtureKey(method, url, body)}.json.gz`);

    if (mode === "record") {
      const res = await real(input, init);
      const text = await res.text();
      const rec: Recording = {
        method,
        url,
        status: res.status,
        contentType: res.headers.get("content-type"),
        text,
      };
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(rec)));
      return new Response(text, {
        status: res.status,
        headers: { "content-type": rec.contentType ?? "" },
      });
    }

    if (!fs.existsSync(file)) {
      throw new Error(
        `No HTTP fixture for ${method} ${url} (${path.basename(file)}). Run: pnpm test:record`,
      );
    }
    const rec = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()) as Recording;
    return new Response(rec.text, {
      status: rec.status,
      headers: { "content-type": rec.contentType ?? "application/json" },
    });
  };
}
