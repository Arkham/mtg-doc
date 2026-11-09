import { STATIC_URL, expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

const OVERPOWERED = "lathril-blade-of-the-elves";

test.describe("static site", () => {
  test("gallery lists published decks with bracket badges", async ({ page }) => {
    await page.goto(STATIC_URL);
    await expect(page.getByRole("heading", { name: "Decks" })).toBeVisible();
    const cards = page.locator(".deck-card");
    await expect(cards).toHaveCount(2);
    await expect(page.locator(".deck-card .bracket-badge")).toHaveText(["3", "2"]);
    await expect(page.getByText("Analyze a deck")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("report shows bracket, swaps, deck list and mana sections", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    await expect(
      page.getByRole("heading", { level: 1, name: /Lathril, Blade of the Elves/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bracket 3: Upgraded" })).toBeVisible();
    await expect(page.locator(".checks li.bad")).toHaveCount(0);
    await expect(page.locator(".swap").first()).toBeVisible();
    await expect(page.locator(".side-label", { hasText: "Cut" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Deck list", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mana base", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Goldfish simulation" })).toBeVisible();
    await expect(page.getByText("Re-run with different options")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("section nav scrolls and highlights the active section", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    await page.locator(".section-nav").getByRole("button", { name: "Mana" }).click();
    await expect(page.locator("#mana")).toBeInViewport();
    await expect(page.locator(".section-nav button.active")).toHaveText("Mana");
    // Scrolling by hand hands control back to the position-based highlight.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("wheel"));
      window.scrollTo(0, 0);
    });
    await expect(page.locator(".section-nav button.active")).toHaveText("Bracket");
  });

  test("export menu offers lists and the pull list", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    await expect(page.getByRole("button", { name: "Copy deck list" })).toBeEnabled();
    await page.locator(".menu > summary").click();
    await expect(page.getByRole("button", { name: /Copy cards to add/ })).toBeVisible();
    const optimized = page.getByRole("link", { name: /Optimized list/ });
    await expect(optimized).toHaveAttribute("href", `data/decks/${OVERPOWERED}/optimized.txt`);
    const res = await page.request.get(
      new URL(`data/decks/${OVERPOWERED}/optimized.txt`, STATIC_URL).href,
    );
    expect(await res.text()).toMatch(/^Commander\n1 Lathril, Blade of the Elves\n/);
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await expect(page.getByRole("button", { name: /Copy cards to add/ })).toBeHidden();
  });

  test("card names open a preview", async ({ page, isMobile }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    const name = page.locator(".deck-group li .card-name a").first();
    await name.scrollIntoViewIfNeeded();
    if (isMobile) {
      await name.tap();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "Close" }).tap();
      await expect(sheet).toBeHidden();
    } else {
      await name.hover();
      await page.mouse.move((await name.boundingBox())!.x + 5, (await name.boundingBox())!.y + 5);
      // Images are blocked in tests, so check the preview element rather than its pixels.
      await expect(page.locator(".card-preview")).toHaveAttribute("src", /cards\.scryfall\.io/);
    }
  });

  test("pre-game summary and back navigation", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    await page.getByRole("link", { name: "Pre-game summary" }).click();
    await expect(page.locator(".rule0-name")).toHaveText("Upgraded");
    await expect(page.getByText("6+ turns")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Bracket 3: Upgraded" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Decks" })).toBeVisible();
  });
});
