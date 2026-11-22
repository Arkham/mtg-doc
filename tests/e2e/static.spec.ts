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

  test("back from a deck, the deck list is where it was left, by the browser or the Back button", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto(STATIC_URL);
    const last = page.locator(".deck-card").last();
    await last.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => scrollY);
    expect(y).toBeGreaterThan(100);
    for (const back of [
      () => page.goBack(),
      () => page.getByRole("button", { name: "Back" }).click(),
    ]) {
      await last.click();
      await expect(page.locator(".hero")).toBeVisible();
      // A deck opens at its top.
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
      // Every frame from here: whether the list shows anywhere but where it was left, or its loader.
      await page.evaluate((y) => {
        const w = window as unknown as { flashed: string[] };
        w.flashed = [];
        let frames = 0;
        const look = () => {
          if (document.querySelector(".loading")) w.flashed.push("loading");
          else if (document.querySelector(".deck-grid") && scrollY !== y)
            w.flashed.push(`at ${scrollY}`);
          if (++frames < 90) requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }, y);
      await back();
      await expect(last).toBeVisible();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
      expect(
        await page.evaluate(() => (window as unknown as { flashed: string[] }).flashed),
      ).toEqual([]);
    }
    // Forward again, the deck is where it was left too.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await last.click();
    await expect(page.locator(".hero")).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
    await page.goBack();
    await expect(last).toBeVisible();
    await page.goForward();
    await expect(page.locator(".hero")).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(600);
  });

  test("the home page starts with the deck list: no fetch for it, nor for the search", async ({
    page,
  }) => {
    const listed: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("data/decks.json")) listed.push(page.url());
    });
    await page.goto(STATIC_URL);
    await expect(page.locator(".deck-card")).toHaveCount(2);
    await page.getByRole("button", { name: "Find a card" }).click();
    await expect(page.locator(".search-results")).toContainText("which of the 2 decks run it");
    expect(listed).toEqual([]);
    // A deck's page doesn't carry the list: its search fetches it.
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    await page.getByRole("button", { name: "Find a card" }).click();
    await expect(page.locator(".search-results")).toContainText("which of the 2 decks run it");
    expect(listed).toHaveLength(1);
  });

  test("the deck list fetches the decks on screen ahead of a tap, as their pages will ask", async ({
    page,
  }) => {
    // Routing turns off the HTTP cache these requests warm, so this checks they are the ones the
    // deck's page makes.
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    await page.goto(STATIC_URL);
    const own = (url: string) => url.replace(STATIC_URL, "");
    const ahead = [
      `data/decks/${OVERPOWERED}/detail.json`,
      `data/decks/${OVERPOWERED}/optimized.txt`,
    ];
    await expect.poll(() => ahead.filter((u) => requested.map(own).includes(u))).toEqual(ahead);
    const before = requested.length;
    await page.locator(".deck-card").first().locator(".deck-card-body").click({ force: true });
    await expect(page.locator(".hero")).toBeVisible();
    const opened = requested.slice(before).map(own);
    for (const url of ahead) expect(opened).toContain(url);
  });

  test("the commander's name on a deck card previews the card; the rest of it opens the deck", async ({
    page,
    isMobile,
  }) => {
    await page.goto(STATIC_URL);
    const card = page.locator(".deck-card").first();
    const name = card.locator(".deck-art-name .card-name a");
    await expect(name).toHaveText("Lathril, Blade of the Elves");
    if (isMobile) {
      await name.tap();
      await expect(page.locator(".card-sheet img")).toHaveAttribute(
        "src",
        /cards\.scryfall\.io\/normal/,
      );
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.locator(".card-sheet")).toHaveCount(0);
    } else {
      await name.hover();
      await expect(page.locator(".card-preview")).toHaveAttribute(
        "src",
        /cards\.scryfall\.io\/normal/,
      );
    }
    expect(page.url()).toBe(STATIC_URL);
    await card.locator(".deck-card-body").click({ force: true });
    await expect(page.locator(".hero")).toBeVisible();
  });

  test("the deck's actions are all the same height", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    const actions = page.locator(".hero-actions > button, .hero-actions .menu > summary");
    await expect(actions).toHaveCount(3);
    const heights = await actions.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    expect(heights).toHaveLength(3);
    expect(new Set(heights).size).toBe(1);
  });

  test("on a phone the view toggle sits in the middle of the top bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    const box = (await page.getByRole("tablist", { name: "Which deck" }).boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThanOrEqual(1);
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
    await expect(page.getByText("Run it again")).toHaveCount(0);
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

    // Whatever URL the app shows is a page with the full report, for readers that don't run
    // JavaScript (AI agents get a link copied from the address bar).
    const shown = page.url();
    const text = await (await request.get(shown)).text();
    expect(text).toContain("<h1>Lathril, Blade of the Elves: Commander deck report</h1>");
    expect(text).toContain("Suggested decklist");
    expect(text).toContain("How to play the suggested deck");
    const shell = await (await request.get(STATIC_URL)).text();
    expect(shell).toContain(`href="decks/${OVERPOWERED}/"`);

    // Each of those pages boots the app at its route, and back goes where it came from.
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/optimized/`);
    await expect(page.getByRole("heading", { name: "Optimized deck" })).toBeVisible();
    await expect(page.locator(".agent-fallback")).toHaveCount(0);
    await page.getByRole("tab", { name: "Your deck" }).click();
    await expect(page).toHaveURL(`${STATIC_URL}decks/${OVERPOWERED}/`);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Optimized deck" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Optimized deck" })).toBeVisible();
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

  test("card images keep their place before they load, so the page doesn't jump", async ({
    page,
  }) => {
    // Images that never arrive: the page must look the same as when they do.
    await page.route(/\.(jpg|png|webp)(\?|$)/, (route) =>
      route.request().url().includes("scryfall") ? route.abort() : route.continue(),
    );
    await page.goto(`${STATIC_URL}decks/${OPTIMIZED}/`);
    await expect(page.locator(".hero-card img").first()).toBeAttached();
    for (const selector of [".hero-card img", ".card-thumb"]) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.height / box!.width, selector).toBeCloseTo(88 / 63, 1);
    }
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
    await expect(page.getByRole("heading", { name: "Optimized deck" })).toBeAttached();
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

  test("a section jumped to stays put, under the sticky bars, however often the views switch", async ({
    page,
  }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    const nav = page.locator(".section-nav");
    const combos = page.locator("#combos");
    const top = () => combos.evaluate((el) => el.getBoundingClientRect().top);
    const margin = await combos.evaluate((el) => parseFloat(getComputedStyle(el).scrollMarginTop));
    // The jump scrolls smoothly, and may start a few frames later: wait until it has landed, under
    // the sticky bars and still.
    await nav.getByRole("button", { name: "Combos" }).click();
    let at = NaN;
    await expect
      .poll(async () => {
        const was = at;
        at = await top();
        return Math.abs(at - was) < 0.5 && Math.abs(at - margin) <= 2;
      })
      .toBe(true);
    const toggle = page.getByRole("tablist", { name: "Which deck" });
    // Back and forth, each time landing where it was: not a pixel lower each time until another
    // section counts as the one being read.
    for (let i = 0; i < 6; i++) {
      await toggle.getByRole("tab", { name: i % 2 ? "Your deck" : /Optimized/ }).click();
      await expect(toggle.getByRole("tab", { selected: true })).toContainText(
        i % 2 ? "Your deck" : "Optimized",
      );
      expect(Math.abs((await top()) - at), `switch ${i + 1}`).toBeLessThanOrEqual(1);
      await expect(nav.locator("button.active")).toHaveText("Combos");
    }
  });

  test("a reload comes back to the section being read, without showing the top first", async ({
    page,
  }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    await page.locator("#combos").evaluate((el) => {
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop);
      window.scrollTo({
        top: el.getBoundingClientRect().top + scrollY - margin + 40,
        behavior: "instant",
      });
    });
    const at = await page.locator("#combos").evaluate((el) => el.getBoundingClientRect().top);
    // Every frame of the reloaded page, from its first: whether the top of the report (the hero,
    // with the commander's art) is on screen.
    await page.addInitScript(() => {
      const w = window as unknown as { heroShown: boolean; frames: number };
      w.heroShown = false;
      w.frames = 0;
      const look = () => {
        const hero = document.querySelector(".hero")?.getBoundingClientRect();
        if (hero && hero.bottom > 0 && hero.top < innerHeight) w.heroShown = true;
        if (++w.frames < 180) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.reload();
    await expect(page.locator("#combos")).toBeAttached();
    await expect
      .poll(() => page.locator("#combos").evaluate((el) => el.getBoundingClientRect().top))
      .toBeCloseTo(at, 0);
    expect(await page.evaluate(() => (window as unknown as { heroShown: boolean }).heroShown)).toBe(
      false,
    );
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

  test("the bracket shows the top three two-card combos, links to the rest, and none when there are none", async ({
    page,
  }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/optimized/`);
    const bracket = page.locator("#bracket");
    await expect(bracket.locator(".combo-speed li")).toHaveCount(3);
    await bracket.getByRole("link", { name: /See all \d+ in Combos/ }).click();
    await expect(page.locator("#combos")).toBeInViewport();
    await expect(page.locator(".section-nav button.active")).toHaveText("Combos");
    expect(page.url()).not.toContain("#");
    // The deck as submitted has none: no heading over an empty list.
    await page
      .getByRole("tablist", { name: "Which deck" })
      .getByRole("tab", { name: "Your deck" })
      .click();
    await expect(bracket.getByRole("heading", { name: "Two-card combos" })).toHaveCount(0);
  });

  test("a tab's count stays on its label's line, even with wider fonts", async ({ page }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/`);
    await expect(page.locator("#combos")).toBeAttached();
    // Linux and larger text settings render wider than macOS; Verdana stands in for them.
    await page.addStyleTag({ content: "* { font-family: Verdana, sans-serif !important; }" });
    const lines = await page
      .locator(".segmented button > span:has(> .count)")
      .evaluateAll((spans) => spans.map((s) => s.getClientRects().length));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((n) => n === 1)).toBe(true);
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
    // Drawn outside the thumbnail so its styles can't shrink it (external images are blocked here).
    const preview = page.locator(".card-preview");
    await expect(preview.locator("xpath=ancestor::*[contains(@class, 'card-name')]")).toHaveCount(
      0,
    );
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
    const optimized = page.getByRole("link", { name: /Download the optimized deck/ });
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
    await expect(page.getByRole("link", { name: /Download your deck/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Download the optimized deck/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("How to play opens over the page, for the deck on screen, without changing the URL", async ({
    page,
    isMobile,
  }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/optimized/`);
    // Next to the deck's other actions, and only there.
    const button = page.locator(".hero-actions").getByRole("button", { name: "How to play" });
    await expect(page.getByRole("button", { name: "How to play" })).toHaveCount(1);
    await expect(page.locator(".hero-actions").getByRole("button")).toHaveText([
      "How to play",
      "Copy decklist",
    ]);
    await button.click();
    const dialog = page.getByRole("dialog", { name: "How to play" });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(`${STATIC_URL}decks/${OVERPOWERED}/optimized/`);
    await expect(dialog).toContainText("The suggested elves: faster mana, the same drain finish.");
    await expect(dialog.getByRole("heading", { name: /Early game/ })).toBeVisible();
    await expect(dialog.getByText("Keep three lands and a mana elf.")).toBeVisible();
    // Card names in the guide preview, like anywhere else.
    await expect(
      dialog.locator(".play-cards").getByRole("link", { name: "Lathril, Blade of the Elves" }),
    ).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Llanowar Elves" })).toBeVisible();
    // The table talk, as the old pre-game summary had it.
    await expect(dialog.getByText("6+ turns")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (page.viewportSize()!.width <= 640) {
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBe(page.viewportSize()!.width);
    }
    if (isMobile) await dialog.getByRole("button", { name: "Close" }).click();
    else await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Focus goes back where it was; WebKit doesn't focus a button that's tapped.
    if (!isMobile) await expect(button).toBeFocused();

    // On your deck, it's that deck's guide.
    await page
      .getByRole("tablist", { name: "Which deck" })
      .getByRole("tab", { name: "Your deck" })
      .click();
    await button.click();
    await expect(dialog).toContainText("Your elves: go wide, then drain the table with Lathril.");
    await dialog.getByRole("button", { name: "Close" }).click();

    // The back label is the button's text size, with its chevron level with it.
    const back = page.getByRole("button", { name: "Back" });
    const [label, size] = await Promise.all([
      back.locator(".back-label").evaluate((el) => getComputedStyle(el).fontSize),
      back.evaluate((el) => getComputedStyle(el).fontSize),
    ]);
    expect(label).toBe(size);
    const [icon, text] = await Promise.all([
      back.locator("svg").boundingBox(),
      back.locator(".back-label").boundingBox(),
    ]);
    if (await back.locator(".back-label").isVisible())
      expect(Math.abs(icon!.y + icon!.height / 2 - (text!.y + text!.height / 2))).toBeLessThan(3);
    await back.click();
    await expect(page.getByRole("heading", { name: "Decks" })).toBeVisible();
  });

  test("the optimized deck's summary is a short line, with the doc's reasoning a tap away", async ({
    page,
  }) => {
    await page.goto(`${STATIC_URL}decks/${OVERPOWERED}/optimized/`);
    const plan = page.locator(".panel", {
      has: page.getByRole("heading", { name: "Optimized deck" }),
    });
    await expect(plan.locator(".panel-desc")).toHaveText(
      /^How the deck plays with the doc's \d+ swaps, for bracket 3\.$/,
    );
    const why = plan.locator("details", { hasText: "Why these swaps" });
    await expect(why.locator("p")).toBeHidden();
    await why.locator("summary").click();
    await expect(why.locator("p")).toBeVisible();
  });
});
