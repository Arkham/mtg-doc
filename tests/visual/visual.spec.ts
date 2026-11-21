import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

const STATIC_URL = "http://127.0.0.1:4184/mtg-doc/";
const APP_URL = "http://127.0.0.1:5219/";
const DECK = "lathril-blade-of-the-elves";
/** Published without the doc's suggestions on the static site; no chat in the app. */
const OTHER = "lathril-blade-of-the-elves-2";

const deckText = fs.readFileSync(
  path.resolve(import.meta.dirname, "../fixtures/decks/lathril-overpowered.txt"),
  "utf8",
);

/** Scryfall's image sizes, so placeholders take the same room as the real images. */
const sizeOf = (url: string): [number, number] =>
  url.includes("art_crop") ? [626, 457] : [488, 680];

const placeholders = new Map<string, Promise<Buffer>>();
/** A flat image whose color comes from its URL: deterministic, offline, and tells cards apart. */
function placeholder(url: string) {
  if (!placeholders.has(url)) {
    const [r, g, b] = createHash("sha1").update(url).digest();
    const [width, height] = sizeOf(url);
    placeholders.set(
      url,
      sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
        .png()
        .toBuffer(),
    );
  }
  return placeholders.get(url)!;
}

const test = base.extend({
  page: async ({ page }, provide) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
      const url = route.request().url();
      if (route.request().resourceType() !== "image") return route.abort();
      if (url.includes("svgs.scryfall.io"))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#888"/></svg>',
        });
      return route.fulfill({ contentType: "image/png", body: await placeholder(url) });
    });
    await provide(page);
  },
});

/** Waits until nothing on the page is still loading or moving. */
async function settle(page: Page) {
  // After a frame: the app may still be drawing what the last click changed.
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const img of document.querySelectorAll<HTMLImageElement>("img[loading=lazy]"))
      img.loading = "eager";
  });
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)),
      ),
    );
    // Two frames, so layout from the last image is painted.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/**
 * The rendered DOM as indented text: what the user's browser lays out, independent of the
 * framework that built it. Elements that only add behaviour (`mtg-*` custom elements) are left
 * out with their attributes' `data-mtg-*` hooks, overlays are listed after the page wherever
 * they're mounted, and form fields show their live values rather than their attributes.
 */
function serializeDom(root: Element | null) {
  const OVERLAYS = ".card-preview, .card-sheet, .search-overlay, .modal-backdrop";
  const lines: string[] = [];
  const overlays: Element[] = [];
  const styleOf = (value: string) =>
    value
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => d.replace(/\s*:\s*/, ": "))
      .sort()
      .join("; ");
  const attrsOf = (el: Element) => {
    const out: string[] = [];
    for (const a of [...el.attributes].sort((x, y) => x.name.localeCompare(y.name))) {
      if (a.name.startsWith("data-mtg-")) continue;
      if (["value", "checked", "selected"].includes(a.name) && "value" in el) continue;
      out.push(a.name === "style" ? `style="${styleOf(a.value)}"` : `${a.name}="${a.value}"`);
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      out.push(`.value=${JSON.stringify(el.value)}`);
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio"))
      out.push(`.checked=${el.checked}`);
    if (el instanceof HTMLSelectElement) out.push(`.value=${JSON.stringify(el.value)}`);
    if (el instanceof HTMLDetailsElement) out.push(`.open=${el.open}`);
    return out.length ? ` ${out.join(" ")}` : "";
  };
  const walk = (node: Node, depth: number, top: boolean) => {
    let text = "";
    const flush = () => {
      if (text) lines.push(`${"  ".repeat(depth)}${JSON.stringify(text)}`);
      text = "";
    };
    const visit = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        // Whitespace between the page template's tags isn't part of the app.
        if (n.parentNode !== document.body || n.textContent?.trim()) text += n.textContent ?? "";
        return;
      }
      if (!(n instanceof Element)) return;
      const tag = n.tagName.toLowerCase();
      if (["script", "style", "link", "template"].includes(tag)) return;
      if (tag.startsWith("mtg-")) {
        n.childNodes.forEach(visit);
        return;
      }
      if (top && n.matches(OVERLAYS)) {
        overlays.push(n);
        return;
      }
      flush();
      lines.push(`${"  ".repeat(depth)}<${tag}${attrsOf(n)}>`);
      walk(n, depth + 1, top);
    };
    node.childNodes.forEach(visit);
    flush();
  };
  if (!root) return "";
  walk(root, 0, true);
  for (const o of overlays) {
    lines.push("--- overlay");
    const wrapper = document.createElement("div");
    wrapper.append(o.cloneNode(true));
    walk(wrapper, 0, false);
  }
  return lines.join("\n") + "\n";
}

async function checkDom(page: Page, name: string, selector?: string) {
  const dom = await page.evaluate(
    ([fn, sel]) =>
      new Function(`return (${fn})(arguments[0])`)(
        sel ? document.querySelector(sel) : document.body,
      ),
    [serializeDom.toString(), selector ?? null] as const,
  );
  expect(dom).toMatchSnapshot(`${name}.dom.txt`);
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await settle(page);
  await checkDom(page, name);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: opts.fullPage ?? true });
}

async function shotOf(locator: Locator, name: string, selector: string) {
  await settle(locator.page());
  await checkDom(locator.page(), name, selector);
  await expect(locator).toHaveScreenshot(`${name}.png`);
}

/** Scrolls back to the top and waits for any smooth scroll to finish. */
async function waitForScroll(page: Page) {
  await expect
    .poll(async () => {
      const a = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(100);
      return a === (await page.evaluate(() => window.scrollY));
    })
    .toBe(true);
}

const tap = (locator: Locator, isMobile: boolean) => (isMobile ? locator.tap() : locator.click());

test.describe("static site", () => {
  test("home", async ({ page }) => {
    await page.goto(STATIC_URL);
    await expect(page.locator(".deck-card")).toHaveCount(2);
    await shot(page, "static-home");
  });

  test("deck as submitted", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/`);
    await expect(page.getByRole("heading", { name: "Your deck", level: 2 })).toBeVisible();
    await shot(page, "static-deck");
  });

  test("optimized deck", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/optimized/`);
    await expect(page.getByRole("heading", { name: "Optimized deck" })).toBeVisible();
    await shot(page, "static-optimized");
  });

  test("optimized deck, swaps and why", async ({ page, isMobile }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/optimized/`);
    await tap(page.getByRole("button", { name: /^Show swaps/ }), isMobile);
    await tap(page.locator(".plan-why summary"), isMobile);
    await page.locator("#research summary").click();
    await expect(page.locator("#decklist .swap").first()).toBeVisible();
    await shot(page, "static-swaps");
  });

  test("decklist as images", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("mtg-doc:decklist-view", "images"));
    await page.goto(`${STATIC_URL}decks/${DECK}/optimized/`);
    await expect(page.locator(".deck-image").first()).toBeVisible();
    await shot(page, "static-images");
  });

  test("deck published without suggestions", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${OTHER}/`);
    await expect(page.getByRole("heading", { name: "Decklist", exact: true })).toBeVisible();
    await shot(page, "static-private");
  });

  test("how to play", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/optimized/`);
    await page.locator(".hero-actions").getByRole("button", { name: "How to play" }).click();
    await expect(page.getByRole("dialog", { name: "How to play" })).toBeVisible();
    await shot(page, "static-how-to-play", { fullPage: false });
  });

  test("card search", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/`);
    await page.getByRole("button", { name: "Find a card" }).click();
    const overlay = page.getByRole("dialog", { name: "Find a card" });
    await expect(overlay).toContainText("Type a card name");
    await shot(page, "static-search-empty", { fullPage: false });
    await overlay.getByLabel("Card name").fill("elf");
    await expect(overlay.locator(".card-hits li").first()).toBeVisible();
    await shot(page, "static-search", { fullPage: false });
  });

  test("export menu", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/`);
    await page.locator(".menu > summary").click();
    await expect(page.getByRole("button", { name: /Copy cards to add/ })).toBeVisible();
    await shot(page, "static-export", { fullPage: false });
  });

  test("card preview", async ({ page, isMobile }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/`);
    const name = page.locator(".deck-group li .card-name a").nth(3);
    await name.scrollIntoViewIfNeeded();
    if (isMobile) {
      await name.tap();
      await expect(page.getByRole("dialog")).toBeVisible();
    } else {
      const box = (await name.boundingBox())!;
      await page.mouse.move(box.x + 5, box.y + 5);
      await expect(page.locator(".card-preview")).toBeVisible();
    }
    await shot(page, "static-preview", { fullPage: false });
  });

  test("commander full size", async ({ page, isMobile }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/`);
    await tap(page.locator(".hero-card"), isMobile);
    await expect(page.locator(".sheet-card")).toBeVisible();
    await page.mouse.move(0, 0);
    await shot(page, "static-commander", { fullPage: false });
  });

  test("combos one card away", async ({ page, isMobile }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/optimized/`);
    const combos = page.locator("#combos");
    await tap(combos.getByRole("tab", { name: /1 card away/ }), isMobile);
    const all = combos.getByRole("button", { name: /Show all/ });
    if (await all.count()) await tap(all, isMobile);
    await shotOf(combos, "static-combos-away", "#combos");
  });

  test("section nav", async ({ page, isMobile }) => {
    await page.goto(`${STATIC_URL}decks/${DECK}/`);
    await tap(page.locator(".section-nav").getByRole("button", { name: "Goldfish" }), isMobile);
    await expect(page.locator("#sim")).toBeInViewport();
    await waitForScroll(page);
    await expect(page.locator(".section-nav button.active")).toHaveText("Goldfish");
    await shot(page, "static-section-nav", { fullPage: false });
  });
});

test.describe("local app", () => {
  test("home", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator(".deck-card")).toHaveCount(2);
    await shot(page, "app-home");
  });

  test("review", async ({ page, isMobile }) => {
    await page.goto(APP_URL);
    await page.locator("textarea.decklist").fill(deckText);
    await page.getByRole("button", { name: "Analyze deck" }).click();
    await expect(page.getByRole("heading", { name: "Check the cards" })).toBeVisible();
    await shot(page, "app-review");
    await tap(page.getByRole("button", { name: /Needs attention/ }), isMobile);
    await tap(page.locator(".disclosure > summary"), isMobile);
    await expect(page.locator(".card-row")).toHaveCount(2);
    await shot(page, "app-review-issues");
  });

  test("optimizing", async ({ page, isMobile }) => {
    const traces = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/trace.json"), "utf8"),
    );
    let which: "running" | "done" = "running";
    // The map moves on with the clock: stopped, every frame is the same.
    await page.clock.install({ time: new Date("2025-01-01T12:00:00Z") });
    await page.clock.pauseAt(new Date("2025-01-01T12:00:01Z"));
    // No stream: a 204 tells the browser not to reconnect.
    await page.route("**/api/jobs/visual-job/events", (route) => route.fulfill({ status: 204 }));
    await page.route("**/api/jobs/visual-job", (route) =>
      route.fulfill({
        json: { id: "visual-job", slug: DECK, status: which, steps: [], trace: traces[which] },
      }),
    );
    // Elm draws on animation frames, which only come as the stopped clock is moved on.
    const until = async (check: () => Promise<unknown>) =>
      expect
        .poll(async () => {
          await page.clock.runFor(100);
          return check().then(
            () => true,
            () => false,
          );
        })
        .toBe(true);
    const still = async (name: string) => {
      // Past how far the page moves the clock on from the latest trace, so it's always as far, and
      // past a finished run's finale, so it's over.
      await page.clock.runFor(5000);
      await checkDom(page, name);
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    };

    await page.goto(`${APP_URL}#/job/${DECK}/visual-job`);
    await until(() => expect(page.locator("mtg-run-map")).toBeVisible({ timeout: 1 }));
    await expect(page.locator(".run-pill")).toHaveText("Second-guessing the swaps…");
    await still("app-progress");

    await tap(page.getByRole("button", { name: "Timeline", exact: true }), isMobile);
    await until(() => expect(page.locator(".run-row").first()).toBeVisible({ timeout: 1 }));
    await tap(page.locator(".run-row-button", { hasText: "Review swaps" }), isMobile);
    await until(() =>
      expect(page.locator(".run-row.selected")).toContainText("Review swaps", { timeout: 1 }),
    );
    await still("app-progress-timeline");

    which = "done";
    await page.goto("about:blank");
    await page.goto(`${APP_URL}#/job/${DECK}/visual-job`);
    await until(() => expect(page.locator(".run-summary")).toBeVisible({ timeout: 1 }));
    await expect(page.getByRole("link", { name: "See the optimized deck" })).toHaveAttribute(
      "href",
      /optimized$/,
    );
    await still("app-progress-done");
  });

  test("replaying a saved run", async ({ page, isMobile }) => {
    const { done } = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/trace.json"), "utf8"),
    );
    await page.clock.install({ time: new Date("2025-01-01T12:00:00Z") });
    await page.clock.pauseAt(new Date("2025-01-01T12:00:01Z"));
    await page.route(`**/api/decks/${DECK}/run`, (route) =>
      route.fulfill({ json: { startedAt: "2025-01-01T11:00:00Z", status: "done", trace: done } }),
    );
    const until = async (check: () => Promise<unknown>) =>
      expect
        .poll(async () => {
          await page.clock.runFor(100);
          return check().then(
            () => true,
            () => false,
          );
        })
        .toBe(true);
    const still = async (name: string) => {
      await page.clock.runFor(500);
      await checkDom(page, name);
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    };

    await page.goto(`${APP_URL}#/deck/${DECK}/run`);
    await until(() => expect(page.locator(".run-player")).toBeVisible({ timeout: 1 }));
    // Paused while the doc reviews the swaps, with a model request in flight.
    await tap(page.getByRole("button", { name: "Pause" }), isMobile);
    await page.locator(".run-scrub input").evaluate((el: HTMLInputElement) => {
      el.value = "23000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await until(() => expect(page.locator(".run-time")).toContainText("00:23.0", { timeout: 1 }));
    await expect(page.locator(".run-pill")).toHaveText("Second-guessing the swaps…");
    await still("app-replay");

    await tap(page.getByRole("button", { name: "Timeline", exact: true }), isMobile);
    await until(() => expect(page.locator(".run-row").first()).toBeVisible({ timeout: 1 }));
    await still("app-replay-timeline");
  });

  test("deck and optimized deck", async ({ page }) => {
    await page.goto(`${APP_URL}#/deck/${DECK}`);
    await expect(page.getByRole("heading", { name: "Your deck", level: 2 })).toBeVisible();
    await shot(page, "app-deck");
    await page.getByRole("tab", { name: /Optimized/ }).click();
    await expect(page.getByRole("heading", { name: "Optimized deck" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "app-optimized");
  });

  test("re-run options and target bracket", async ({ page, isMobile }) => {
    await page.goto(`${APP_URL}#/deck/${DECK}/optimized`);
    await tap(page.getByRole("button", { name: "Change and re-run" }), isMobile);
    await shotOf(page.locator(".rerun-panel"), "app-rerun", ".rerun-panel");
    await page.locator("#bracket").getByLabel("Target bracket").selectOption("2");
    await expect(page.getByRole("button", { name: "Re-run for bracket 2" })).toBeVisible();
    await shotOf(page.locator("#bracket"), "app-target-bracket", "#bracket");
  });

  test("chat", async ({ page }) => {
    await page.goto(`${APP_URL}#/deck/${DECK}/optimized`);
    await page.getByRole("button", { name: /Ask the doc/ }).click();
    await expect(page.locator(".chat-rerun")).toBeVisible();
    await shot(page, "app-chat", { fullPage: false });
    // An earlier reply, which names cards in its text.
    await page
      .locator(".chat-msg.assistant .chat-bubble", { hasText: "Simple edits always work" })
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(page, "app-chat-earlier", { fullPage: false });
    await page.getByRole("button", { name: "Clear chat" }).click();
    await expect(page.getByRole("alertdialog", { name: "Clear chat" })).toBeVisible();
    await shot(page, "app-chat-clear", { fullPage: false });
  });

  test("empty chat", async ({ page }) => {
    await page.goto(`${APP_URL}#/deck/${OTHER}`);
    await page.getByRole("button", { name: /Ask the doc/ }).click();
    await expect(page.locator(".chat-empty")).toBeVisible();
    await shot(page, "app-chat-empty", { fullPage: false });
  });

  /** The deck as if changes were in progress: its detail and its status say so. */
  async function changing(page: Page, status: Record<string, unknown>) {
    // While it's changing the page polls; every poll gets the same answer.
    const detail = await (await page.request.get(`${APP_URL}api/decks/${DECK}`)).json();
    await page.route(`**/api/decks/${DECK}`, (route) =>
      route.fulfill({ json: { ...detail, ...status } }),
    );
    await page.route(`**/api/decks/${DECK}/status`, (route) =>
      route.fulfill({ json: { savedAt: detail.savedAt, ...status } }),
    );
    await page.goto(`${APP_URL}#/deck/${DECK}`);
    await expect(page.locator(".updating-note")).toBeVisible();
  }

  test("updating after a change", async ({ page }) => {
    await changing(page, { updating: true });
    await shot(page, "app-updating", { fullPage: false });
  });

  test("waiting for the edits to stop", async ({ page }) => {
    await changing(page, { refreshInMs: 23_400 });
    await expect(page.locator(".updating-note")).toContainText("updates in 24s");
    await shot(page, "app-refresh-waiting", { fullPage: false });
  });

  test("working out what the edits changed", async ({ page }) => {
    await changing(page, { refreshing: true });
    await shot(page, "app-refreshing", { fullPage: false });
  });
});
