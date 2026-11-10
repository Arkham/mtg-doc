import { STATIC_URL, expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

const OVERPOWERED = "lathril-blade-of-the-elves";
const OPTIMIZED = `${OVERPOWERED}/optimized`;

test.describe("static site", () => {
  test("gallery lists published decks with bracket badges", async ({ page }) => {
    await page.goto(STATIC_URL);
    await expect(page.getByRole("heading", { name: "Decks" })).toBeVisible();
    const cards = page.locator(".deck-card");
    await expect(cards).toHaveCount(2);
    // Cards describe the decks as submitted; the optimizer's swaps are only a suggestion.
    await expect(page.locator(".deck-card .bracket-badge")).toHaveText(["4", "2"]);
    await expect(page.locator(".deck-card").first().locator(".deck-suggest")).toHaveText(
      /\d+ suggested swaps? for bracket 3/,
    );
    await expect(
      page.getByRole("heading", { name: "The doc will see your deck now." }),
    ).toBeVisible();
    await expect(page).toHaveTitle("mtg doc");
    await expect(page.locator(".brand")).toHaveText("mtg doc");
    await expect(page.getByText("Analyze a deck")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("report shows bracket, swaps, deck list and mana sections", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OPTIMIZED}`);
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
    await expect(page.locator(".mana-advice h3").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we changed" })).toBeVisible();
    await expect(page.getByText("Re-run with different options")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("crown labels line up with their capitals", async ({ page }) => {
    const offset = (sel: string) =>
      page
        .locator(sel)
        .first()
        .evaluate((el) => {
          const crown = el.querySelector("svg")!.getBoundingClientRect();
          const caps = el.querySelector("span")!.getBoundingClientRect();
          return Math.abs(crown.top + crown.height / 2 - (caps.top + caps.height / 2));
        });
    await page.goto(STATIC_URL);
    expect(await offset(".home-hero .hero-role")).toBeLessThan(1);
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    expect(await offset(".hero .hero-role")).toBeLessThan(1);
  });

  test("published content is readable without JavaScript", async ({ page, request }) => {
    const page1 = await request.get(new URL(`decks/${OVERPOWERED}/`, STATIC_URL).href);
    expect(page1.ok()).toBe(true);
    const text = await page1.text();
    expect(text).toContain("Lathril, Blade of the Elves");
    expect(text).not.toContain("<script");
    const shell = await (await request.get(STATIC_URL)).text();
    expect(shell).toContain(`href="decks/${OVERPOWERED}/"`);
    // In a browser the app takes over from the fallback.
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    await expect(page.locator(".hero")).toBeVisible();
    await expect(page.locator(".agent-fallback")).toHaveCount(0);
  });

  test("opens on the deck as submitted, with a toggle to the optimized view", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    const toggle = page.getByRole("tablist", { name: "Which deck" });
    await expect(toggle.getByRole("tab", { name: "Your deck" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("heading", { name: "Your deck", level: 2 })).toBeVisible();
    await expect(page.locator("#swaps")).toHaveCount(0);
    await expect(page.locator(".section-nav").getByRole("button", { name: "Swaps" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "New cards" })).toHaveCount(0);
    // The original list has the cards the optimizer cut, and its stats aren't compared.
    await expect(page.locator("#sim th", { hasText: "Before" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "See the optimized deck" }).click();
    await expect(page).toHaveURL(/\/optimized$/);
    await expect(toggle.getByRole("tab", { name: /Optimized/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("heading", { name: "The plan" })).toBeVisible();
    await expect(page.locator("#swaps")).toBeVisible();
    await toggle.getByRole("tab", { name: "Your deck" }).click();
    await expect(page.locator("#swaps")).toHaveCount(0);
  });

  test("combos list shows those in the deck and one card away together", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OPTIMIZED}`);
    const combos = page.locator("#combos");
    const present = combos.locator(".combo-row.present");
    const away = combos.locator(".combo-row.away");
    await expect(present.first()).toContainText("In your deck");
    await expect(away.first()).toContainText("1 card away");
    await expect(away.first().locator(".combo-partners li").first()).toContainText("with");
    const showAll = combos.getByRole("button", { name: /Show all \d+ cards/ });
    if (await showAll.count()) await showAll.click();
    const names = await away.locator(".combo-title strong").allTextContents();
    expect(new Set(names).size).toBe(names.length);

    await combos.getByRole("tab", { name: /In deck/ }).click();
    await expect(away).toHaveCount(0);
    await expect(present.first()).toBeVisible();
    await combos.getByRole("tab", { name: /1 card away/ }).click();
    await expect(present).toHaveCount(0);
    await expect(away.first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("mana symbols load from the site itself", async ({ page }) => {
    // External requests are blocked in tests, so a rendered symbol proves it's bundled.
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    const symbol = page.locator("#decklist .mana-cost img").first();
    await expect(symbol).toHaveAttribute("src", /^\.?\/?symbols\/[\w]+\.svg$/);
    await expect
      .poll(() => symbol.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
  });

  test("hovering a card thumbnail shows a full-size preview", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "hover previews need a mouse");
    await page.goto(`${STATIC_URL}#/deck/${OPTIMIZED}`);
    const thumb = page.locator("#combos .combo-thumbs .card-name:last-child .card-thumb").first();
    await thumb.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await thumb.hover();
    // Portaled to <body> so thumbnail styles can't shrink it (external images are blocked here).
    const preview = page.locator("body > .card-preview");
    await expect(preview).toHaveAttribute("src", /cards\.scryfall\.io/);
    expect(await preview.evaluate((el) => getComputedStyle(el).width)).toBe("244px");
  });

  test("optimized deck list marks new cards in a muted color, the original doesn't", async ({
    page,
  }) => {
    await page.goto(`${STATIC_URL}#/deck/${OPTIMIZED}`);
    const list = page.locator("#decklist");
    await expect(list.locator("li.new").first()).toBeVisible();
    await expect(list.locator(".badge.new").first()).toBeVisible();
    await expect(list.getByRole("button", { name: "New cards" })).toHaveCount(0);
    const color = await list
      .locator("li.new .card-name a")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe("rgb(169, 205, 182)");

    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    await expect(list.locator(".deck-group li").first()).toBeVisible();
    await expect(list.locator("li.new")).toHaveCount(0);
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

  test("deck list can be shown as card images, and the choice is remembered", async ({
    page,
    isMobile,
  }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    const imagesTab = page.getByRole("tab", { name: "Images" });
    await (isMobile ? imagesTab.tap() : imagesTab.click());
    const tiles = page.locator(".deck-image");
    await expect(tiles.first()).toBeVisible();
    expect(await tiles.count()).toBeGreaterThan(60);
    await expect(page.locator(".deck-image-qty").first()).toHaveText(/^×\d+$/);
    await expectNoHorizontalOverflow(page);

    const first = tiles.first().getByRole("button");
    await (isMobile ? first.tap() : first.click());
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

    await page.reload();
    await expect(page.getByRole("tab", { name: "Images" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(tiles.first()).toBeVisible();
  });

  test("pre-game summary and back navigation", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OPTIMIZED}`);
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
