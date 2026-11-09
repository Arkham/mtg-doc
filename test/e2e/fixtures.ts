import { test as base, expect, type Page } from "@playwright/test";

export const STATIC_URL = "http://127.0.0.1:4174/mtg-doc/";
export const APP_URL = "http://127.0.0.1:5199/";

/** Blocks third-party requests (card images, mana symbols) so UI tests are offline and stable. */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    await provide(page);
  },
});

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(1);
}

export { expect };
