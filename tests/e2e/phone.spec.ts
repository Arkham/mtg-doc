import fs from "node:fs";
import path from "node:path";
import { APP_URL, expect, test } from "./fixtures.ts";

// A real run's trace (54s, so there's a way to go), as a deck's saved run.
const { done } = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/trace.json"), "utf8"),
);

test.describe("local app on a phone", () => {
  test("a replay keeps the step it's on in view, through taps, and after a drag", async ({
    page,
  }) => {
    await page.route("**/api/decks/phone-deck/run", (route) =>
      route.fulfill({ json: { startedAt: "2025-01-01T11:00:00Z", status: "done", trace: done } }),
    );
    await page.goto(`${APP_URL}#/deck/phone-deck/run`);
    const scrolled = () => page.evaluate(() => window.scrollY);

    // Tapping the player's controls isn't taking over: the page still goes down with the run.
    await page.getByRole("button", { name: "4×" }).tap();
    await page.getByRole("button", { name: "Pause" }).tap();
    await page.getByRole("button", { name: "Play" }).tap();
    await expect.poll(scrolled, { timeout: 15_000 }).toBeGreaterThan(300);

    // A drag back to the top takes over for a moment...
    await page.evaluate(() => {
      window.dispatchEvent(new Event("touchmove"));
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1_000);
    expect(await scrolled()).toBeLessThan(50);
    // ...then it picks up again, from wherever the run has got to.
    await expect.poll(scrolled, { timeout: 10_000 }).toBeGreaterThan(300);

    // Through the finale: up to where the golden path starts, then down it with the spark, to
    // the burst at its end.
    await page.locator(".run-scrub input").evaluate((el: HTMLInputElement) => {
      el.value = String(Number(el.max) - 1500);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const path: number[] = [];
    for (let i = 0; i < 50; i++) {
      path.push(await scrolled());
      await page.waitForTimeout(100);
    }
    await expect(page.locator(".run-pill")).toHaveText("GG!");
    const top = Math.min(...path);
    const trail = path.join(" ");
    expect(top, trail).toBeLessThan(path[0] - 300);
    expect(path.at(-1)!, trail).toBeGreaterThan(top + 300);
    expect(path.indexOf(top), trail).toBeLessThan(path.length - 5);
  });

  test("a replay keeps its speed when frames come slowly, and doesn't jump after a pause in them", async ({
    page,
  }) => {
    await page.route("**/api/decks/phone-deck/run", (route) =>
      route.fulfill({ json: { startedAt: "2025-01-01T11:00:00Z", status: "done", trace: done } }),
    );
    await page.goto(`${APP_URL}#/deck/phone-deck/run`);
    const clock = page.locator(".run-time");
    await expect(clock).toContainText("/");
    const at = async () => {
      const [m, s] = (await clock.innerText()).split(" / ")[0].split(":").map(Number);
      return m * 60 + s;
    };
    // No frames for a while, as when the tab is away: the replay doesn't jump ahead for it.
    const before = await at();
    await page.evaluate(() => {
      const until = performance.now() + 3_000;
      while (performance.now() < until);
    });
    expect((await at()) - before).toBeLessThan(1);

    // A few frames a second: the page is busy for most of every quarter second.
    await page.evaluate(() => {
      setInterval(() => {
        const until = performance.now() + 220;
        while (performance.now() < until);
      }, 250);
    });
    const from = await at();
    const wall = Date.now();
    await page.waitForTimeout(3_000);
    const played = (await at()) - from;
    const elapsed = (Date.now() - wall) / 1000;
    // At 2× (the default), nearly twice the time that passed.
    expect(played, `${played}s played in ${elapsed}s`).toBeGreaterThan(elapsed * 2 * 0.8);
  });
});
