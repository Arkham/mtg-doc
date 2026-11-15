import sharp from "sharp";
import type { Page } from "@playwright/test";
import { STATIC_URL, expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

const OVERPOWERED = "lathril-blade-of-the-elves";
const OPTIMIZED = `${OVERPOWERED}/optimized`;
/** Published without the doc's suggestions (see serve-static.ts). */
const PRIVATE = "lathril-blade-of-the-elves-2";

/** Drags a finger across the open card sheet, then lifts it (which also fires a click). */
const swipe = (page: Page, from: number, to: number) =>
  page.evaluate(
    ({ from, to }) => {
      const el = document.querySelector(".card-sheet")!;
      const at = (type: string, x: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: "touch",
            isPrimary: true,
            clientX: x,
            clientY: 400,
          }),
        );
      at("pointerdown", from);
      for (let i = 1; i <= 6; i++) at("pointermove", from + ((to - from) * i) / 6);
      at("pointerup", to);
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    { from, to },
  );

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

  test("the top bar's search shows which decks run a card, from any page", async ({
    page,
    isMobile,
  }) => {
    await page.goto(STATIC_URL);
    await expect(page.getByLabel("Card name")).toHaveCount(0);
    await page.getByRole("button", { name: "Find a card" }).click();
    const overlay = page.getByRole("dialog", { name: "Find a card" });
    const search = overlay.getByLabel("Card name");
    await expect(search).toBeFocused();
    await expect(overlay).toContainText("Type a card name to see which of the 2 decks run it.");
    await search.fill("sol rin");
    const hit = overlay.locator(".card-hits li").first();
    await expect(hit.locator(".card-hit-name")).toContainText("Sol Ring");
    await expect(hit.locator(".card-hit-name")).toContainText("2 decks");
    await expect(hit.locator(".deck-chip")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    if (page.viewportSize()!.width <= 520) {
      // Full screen on phones.
      const box = (await overlay.boundingBox())!;
      expect(box.width).toBe(page.viewportSize()!.width);
    }
    // The card previews like cards anywhere else.
    await expect(hit.getByRole("link", { name: "Sol Ring" })).toBeVisible();
    await search.fill("definitely not a card");
    await expect(overlay.getByText("No deck runs a card matching")).toBeVisible();
    await search.fill("sol ring");
    await overlay.locator(".deck-chip").first().click();
    await expect(overlay).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: /Lathril, Blade of the Elves/ }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/decks\/lathril-blade-of-the-elves(-2)?\/$/);

    // From a deck page too, and Escape or Cancel closes it.
    await page.getByRole("button", { name: "Find a card" }).click();
    await expect(overlay.getByLabel("Card name")).toBeFocused();
    await expectNoHorizontalOverflow(page);
    if (isMobile) await overlay.getByRole("button", { name: "Cancel" }).click();
    else await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    if (!isMobile) {
      await page.keyboard.press("/");
      await expect(overlay.getByLabel("Card name")).toBeFocused();
    }
  });

  test("report shows bracket, swaps, deck list and mana sections", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OPTIMIZED}`);
    await expect(
      page.getByRole("heading", { level: 1, name: /Lathril, Blade of the Elves/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bracket 3: Upgraded" })).toBeVisible();
    await expect(page.locator(".checks li.bad")).toHaveCount(0);
    // The decklist section shows the swaps that made it at the tap of a button.
    const decklist = page.locator("#decklist");
    await expect(decklist.getByRole("heading", { name: "Decklist", exact: true })).toBeVisible();
    await expect(decklist.locator(".deck-group li.new").first()).toBeVisible();
    await expect(page.locator("#swaps")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cut cards" })).toHaveCount(0);
    await decklist.getByRole("button", { name: /^Show swaps \d+$/ }).click();
    await expect(decklist.getByRole("heading", { name: "Swaps", exact: true })).toBeVisible();
    await expect(decklist.locator(".swap").first()).toBeVisible();
    await expect(decklist.locator(".side-label", { hasText: "Cut" }).first()).toBeVisible();
    await expect(decklist.locator(".deck-group")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await decklist.getByRole("button", { name: "Show decklist" }).click();
    await expect(decklist.locator(".deck-group li.new").first()).toBeVisible();
    await expect(decklist.locator(".swap")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mana base", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Goldfish simulation" })).toBeVisible();
    await expect(page.locator(".mana-advice h3").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we changed" })).toBeVisible();
    await expect(page.getByText("Re-run with different options")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("the ♛ sits level with the capitals of its label", async ({ page }) => {
    // Measured on rendered pixels: box metrics differ between the glyph's font and the text's.
    await page.goto(STATIC_URL);
    const label = page.locator(".home-hero .hero-role");
    const glyphWidth = await label.evaluate(
      (el) => el.querySelector("span")!.getBoundingClientRect().width,
    );
    const shot = await label.screenshot({ scale: "device" });
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const scale = info.width / (await label.boundingBox())!.width;
    const inkCentre = (x0: number, x1: number) => {
      const ys: number[] = [];
      for (let y = 0; y < info.height; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * info.width + x) * info.channels;
          if (data[i] > 150 && data[i + 1] > 110 && data[i + 2] < 140) {
            ys.push(y);
            break;
          }
        }
      return (Math.min(...ys) + Math.max(...ys)) / 2 / scale;
    };
    const split = Math.round((glyphWidth + 1) * scale);
    const glyph = inkCentre(0, split);
    const caps = inkCentre(split + Math.round(2 * scale), info.width);
    expect(Math.abs(glyph - caps)).toBeLessThan(0.75);
  });

  test("the commander card tilts with a foil highlight, in the header and full size", async ({
    page,
    isMobile,
  }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    const card = page.locator(".hero-card");
    const rotation = (el: Element) => getComputedStyle(el).transform;
    if (!isMobile) {
      const box = (await card.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
      await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.15);
      await expect(card).toHaveClass(/tilting/);
      // Hover must not cancel the tilt.
      await expect.poll(() => card.evaluate(rotation)).not.toBe("none");
    }
    await (isMobile ? card.tap() : card.click());
    const sheet = page.getByRole("dialog");
    const big = sheet.locator(".sheet-card.tilt");
    await expect(big.locator(".foil")).toHaveCount(1);
    const box = (await big.boundingBox())!;
    await big.dispatchEvent("pointermove", {
      pointerType: isMobile ? "touch" : "mouse",
      clientX: box.x + box.width * 0.2,
      clientY: box.y + box.height * 0.8,
    });
    await expect(big).toHaveClass(/tilting/);
    expect(await big.evaluate((el) => el.style.getPropertyValue("--ry"))).toMatch(/^-/);
    // Tapping the card tilts it rather than closing the viewer.
    await big.click({ position: { x: 10, y: 10 } });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
  });

  test("the link in the address bar is readable without JavaScript", async ({ page, request }) => {
    // Old hash links move onto the deck's real URL.
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    await expect(page.locator(".hero")).toBeVisible();
    await expect(page).toHaveURL(`${STATIC_URL}decks/${OVERPOWERED}/`);
    await expect(page.locator(".agent-fallback")).toHaveCount(0);
    await page.getByRole("link", { name: "See the optimized deck" }).click();
    await expect(page).toHaveURL(`${STATIC_URL}decks/${OVERPOWERED}/optimized/`);
    await page.getByRole("link", { name: "Pre-game summary" }).click();
    await expect(page.locator(".rule0-name")).toBeVisible();

    // Whatever URL the app shows is a page with the full report, for readers that don't run
    // JavaScript (AI agents get a link copied from the address bar).
    const shown = page.url();
    expect(shown).toBe(`${STATIC_URL}decks/${OVERPOWERED}/optimized/rule0/`);
    const text = await (await request.get(shown)).text();
    expect(text).toContain("<h1>Lathril, Blade of the Elves: Commander deck report</h1>");
    expect(text).toContain("Suggested decklist");
    const shell = await (await request.get(STATIC_URL)).text();
    expect(shell).toContain(`href="decks/${OVERPOWERED}/"`);

    // Each of those pages boots the app at its route, and back goes where it came from.
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/optimized/`);
    await expect(page.getByRole("heading", { name: "The plan" })).toBeVisible();
    await expect(page.locator(".agent-fallback")).toHaveCount(0);
    await page.getByRole("tab", { name: "Your deck" }).click();
    await expect(page).toHaveURL(`${STATIC_URL}decks/${OVERPOWERED}/`);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "The plan" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(STATIC_URL);
    await expect(page.locator(".deck-card")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
  });

  test("opens on the deck as submitted, with a toggle to the optimized view", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OVERPOWERED}`);
    const toggle = page.getByRole("tablist", { name: "Which deck" });
    await expect(toggle.getByRole("tab", { name: "Your deck" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("heading", { name: "Your deck", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Show swaps/ })).toHaveCount(0);
    await expect(page.locator(".section-nav").getByRole("button", { name: "Swaps" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "New cards" })).toHaveCount(0);
    // The original list has the cards the optimizer cut, and its stats aren't compared.
    await expect(page.locator("#sim th", { hasText: "Before" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "See the optimized deck" }).click();
    await expect(page).toHaveURL(/\/optimized\/$/);
    await expect(toggle.getByRole("tab", { name: /Optimized/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("heading", { name: "The plan" })).toBeVisible();
    await page.getByRole("button", { name: /^Show swaps/ }).click();
    await expect(page.locator("#decklist .swap").first()).toBeVisible();
    await toggle.getByRole("tab", { name: "Your deck" }).click();
    await expect(page.locator("#decklist .swap")).toHaveCount(0);
    await expect(page.locator("#decklist .deck-group li").first()).toBeVisible();
  });

  test("the top bar fits a phone even with wider fonts", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    await expect(page.getByRole("tablist", { name: "Which deck" })).toBeVisible();
    // Linux and larger text settings render wider than macOS; Verdana stands in for them.
    await page.addStyleTag({ content: "* { font-family: Verdana, sans-serif !important; }" });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("button", { name: "Find a card" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  });

  test("reading the decklist, switching views doesn't move the list at all", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    const list = page.locator("#decklist");
    await list.locator(".deck-group li").first().waitFor();
    // Partway into the cards, as if reading them.
    await list.evaluate((el) => {
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop);
      const top = el.getBoundingClientRect().top + scrollY - margin + 120;
      window.scrollTo({ top, behavior: "instant" });
    });
    const toggle = page.getByRole("tablist", { name: "Which deck" });
    for (const tab of [/Optimized/, /Your deck/, /Optimized/]) {
      // Where the list toolbar sits on every frame from before the tap until it settles.
      await page.evaluate(() => {
        const w = window as unknown as { listTops: number[] };
        w.listTops = [];
        const t0 = performance.now();
        const sample = () => {
          const bar = document.querySelector("#decklist .list-toolbar");
          if (bar) w.listTops.push(bar.getBoundingClientRect().top);
          if (performance.now() - t0 < 600) requestAnimationFrame(sample);
        };
        sample();
      });
      await toggle.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(700);
      const tops = await page.evaluate(
        () => (window as unknown as { listTops: number[] }).listTops,
      );
      expect(
        Math.max(...tops) - Math.min(...tops),
        `${tab}: ${tops.join(", ")}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("switching between the two views stays on the section being read", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    const nav = page.locator(".section-nav");
    // Read partway into the section, as if scrolled there by hand.
    await page.locator("#sim").evaluate((el) => {
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop);
      window.scrollTo({
        top: el.getBoundingClientRect().top + scrollY - margin + 40,
        behavior: "instant",
      });
      window.dispatchEvent(new Event("wheel"));
    });
    await expect(nav.locator("button.active")).toHaveText("Goldfish");
    const toggle = page.getByRole("tablist", { name: "Which deck" });
    await toggle.getByRole("tab", { name: /Optimized/ }).click();
    await expect(page.getByRole("heading", { name: "The plan" })).toBeAttached();
    await expect(page.locator("#sim")).toBeInViewport();
    await expect(nav.locator("button.active")).toHaveText("Goldfish");
    await toggle.getByRole("tab", { name: "Your deck" }).click();
    await expect(page.getByRole("heading", { name: "Your deck", level: 2 })).toBeAttached();
    await expect(page.locator("#sim")).toBeInViewport();
    // Going to another page still starts at the top.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator(".deck-card").first()).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
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
    await list.getByRole("tab", { name: "List" }).click();
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
    await expect(page.getByRole("button", { name: "Copy decklist" })).toBeEnabled();
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
      // The deck list is a gallery: swipe on to the next card in the list.
      const second = await page.locator(".deck-group li .card-name a").nth(1).textContent();
      await swipe(page, 300, 80);
      await expect(sheet).toHaveAttribute("aria-label", second!);
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
    await page.goto(`${STATIC_URL}#/deck/${OPTIMIZED}`);
    const imagesTab = page.getByRole("tab", { name: "Images" });
    await (isMobile ? imagesTab.tap() : imagesTab.click());
    const tiles = page.locator(".deck-image");
    await expect(tiles.first()).toBeVisible();
    expect(await tiles.count()).toBeGreaterThan(60);
    await expect(page.locator(".deck-image-qty").first()).toHaveText(/^×\d+$/);
    await expectNoHorizontalOverflow(page);

    if (page.viewportSize()!.width <= 520) {
      // Two across on phones, so card text stays legible.
      const columns = await page
        .locator(".deck-images ul")
        .first()
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(2);
    }
    await expect(page.locator(".deck-image-new").first()).toContainText(/new|\+\d/);

    const names = await tiles
      .locator("img")
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("alt")));
    const first = tiles.first().getByRole("button");
    await (isMobile ? first.tap() : first.click());
    const sheet = page.getByRole("dialog");
    await expect(sheet).toHaveAttribute("aria-label", names[0]!);
    await expect(sheet.locator(".sheet-position")).toHaveText(/^1 \/ \d+$/);
    if (isMobile) {
      await swipe(page, 300, 80);
      await expect(sheet).toHaveAttribute("aria-label", names[1]!);
      await swipe(page, 80, 300);
      await expect(sheet).toHaveAttribute("aria-label", names[0]!);
      // A drag too short to swipe springs back instead of closing the sheet.
      await swipe(page, 200, 180);
      await expect(sheet).toHaveAttribute("aria-label", names[0]!);
    } else {
      await page.keyboard.press("ArrowRight");
      await expect(sheet).toHaveAttribute("aria-label", names[1]!);
      await sheet.getByRole("button", { name: "Previous card" }).click();
      await expect(sheet).toHaveAttribute("aria-label", names[0]!);
      await expect(sheet.getByRole("button", { name: "Previous card" })).toBeDisabled();
    }
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();

    await page.reload();
    await expect(page.getByRole("tab", { name: "Images" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(tiles.first()).toBeVisible();
  });

  test("a deck published without suggestions shows only the deck as submitted", async ({
    page,
  }) => {
    await page.goto(STATIC_URL);
    await expect(page.locator(".deck-card").nth(1).locator(".deck-suggest")).toHaveCount(0);

    // Even a link to the optimized view lands on the deck as submitted.
    await page.goto(`${STATIC_URL}#/deck/${PRIVATE}/optimized`);
    await expect(
      page.getByRole("heading", { level: 1, name: /Lathril, Blade of the Elves/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Decklist", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Optimized/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Your deck" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Show swaps/ })).toHaveCount(0);
    await expect(page.locator(".swap")).toHaveCount(0);
    await expect(page.getByText(/The doc prescribes/)).toHaveCount(0);
    await page.locator(".menu summary").click();
    await expect(page.getByRole("link", { name: /Original list/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Optimized list/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("pre-game summary and back navigation", async ({ page }) => {
    await page.goto(`${STATIC_URL}#/deck/${OPTIMIZED}`);
    await page.getByRole("link", { name: "Pre-game summary" }).click();
    await expect(page.locator(".rule0-name")).toHaveText("Upgraded");
    // The back label is the button's text size, with its chevron level with it.
    const back = page.getByRole("button", { name: "Back" });
    const [label, button] = await Promise.all([
      back.locator(".back-label").evaluate((el) => getComputedStyle(el).fontSize),
      back.evaluate((el) => getComputedStyle(el).fontSize),
    ]);
    expect(label).toBe(button);
    const [icon, text] = await Promise.all([
      back.locator("svg").boundingBox(),
      back.locator(".back-label").boundingBox(),
    ]);
    expect(Math.abs(icon!.y + icon!.height / 2 - (text!.y + text!.height / 2))).toBeLessThan(3);
    await expect(page.getByText("6+ turns")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Bracket 3: Upgraded" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Decks" })).toBeVisible();
  });
});
