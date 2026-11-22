import fs from "node:fs";
import path from "node:path";
import { APP_URL, LLM_APP_URL, expect, test } from "./fixtures.ts";

const deckText = fs.readFileSync(
  path.resolve(import.meta.dirname, "../fixtures/decks/lathril-overpowered.txt"),
  "utf8",
);

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.describe("local app", () => {
  test("the review page without cards read to check goes back home", async ({ page }) => {
    await page.goto(`${APP_URL}#/review`);
    await expect(page.getByRole("heading", { name: "Analyze a deck" })).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
  });

  test("the photo drop zone opens the file picker, except from a photo or its remove button", async ({
    page,
  }) => {
    await page.goto(LLM_APP_URL);
    await page.getByRole("tab", { name: "Photo" }).click();
    let pickers = 0;
    page.on("filechooser", () => pickers++);
    await page.locator(".dropzone input[type=file]").setInputFiles([
      { name: "a.png", mimeType: "image/png", buffer: PNG },
      { name: "b.png", mimeType: "image/png", buffer: PNG },
    ]);
    const photos = page.locator(".thumbs figure");
    await expect(photos).toHaveCount(2);
    await photos.first().locator("img").click();
    await photos.first().getByRole("button", { name: "Remove photo" }).click();
    await expect(photos).toHaveCount(1);
    await page.getByRole("button", { name: "+ Add photo" }).click();
    await expect.poll(() => pickers).toBe(1);
    await page.waitForTimeout(300);
    expect(pickers, "only the Add photo button opened one").toBe(1);
  });

  test("paste a list → review → optimize to bracket 3 → report", async ({ page }) => {
    test.slow();
    await page.goto(APP_URL);
    await expect(page.getByRole("heading", { name: "Analyze a deck" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Photo" })).toBeDisabled();

    await page.locator("textarea.decklist").fill(deckText);
    await page.getByRole("button", { name: "Analyze deck" }).click();

    await expect(page.getByRole("heading", { name: "Check the cards" })).toBeVisible();
    await expect(page).toHaveURL(/#\/review$/);
    await expect(page.locator(".status-chip").first()).toHaveText("100 / 100 cards");
    await expect(page.getByText("2 off-color")).toBeVisible();
    await expect(page.locator(".commander-pick")).toContainText("Lathril, Blade of the Elves");

    await page.getByRole("button", { name: /Needs attention/ }).click();
    await expect(page.locator(".card-row")).toHaveCount(2);
    await expect(page.locator(".card-row").first()).toContainText("Outside the commander’s colors");

    await page.getByRole("button", { name: /^All/ }).click();
    const row = page.locator(".card-row").filter({ has: page.locator('input[value="Sol Ring"]') });
    await row.getByRole("button", { name: /Keep/ }).click();
    await expect(row.locator(".lock")).toHaveAttribute("aria-pressed", "true");

    await page.locator(".disclosure > summary").click();
    await page.getByLabel("Target bracket").selectOption("3");
    await page.getByLabel("Deck budget ($)").fill("300");
    await expect(page.locator(".disclosure summary")).toContainText("deck ≤ $300");
    // The settings share a row, but the Push control's options never spill out of its box.
    const spill = await page.locator(".grid4 .segmented").evaluate((el) => {
      const box = el.getBoundingClientRect();
      return Math.max(
        ...[...el.querySelectorAll("button")].map(
          (b) => b.getBoundingClientRect().right - box.right,
        ),
      );
    });
    expect(spill).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "Save & optimize" }).click();
    await expect(page.getByRole("heading", { name: "Optimizing your deck" })).toBeVisible();
    // The run, live on its map, then a link to what it made, which opens by itself.
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("mtg-run-map")).toBeVisible();
    const link = page.getByRole("link", { name: "See the optimized deck" });
    await expect(link).toBeVisible({ timeout: 180_000 });
    await expect(link).toHaveAttribute("href", /\/optimized$/);
    await expect(page.getByRole("heading", { name: "Optimized deck" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bracket 3: Upgraded" })).toBeVisible();

    // The run is saved with the deck, and replays: it plays by itself, pauses, and moves to any
    // moment by button or key.
    await page.getByRole("link", { name: "▶ Replay how the doc made it" }).click();
    await expect(
      page.getByRole("heading", { name: "How the doc optimized this deck" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.locator(".run-kicker")).toHaveText("Paused");
    const time = page.locator(".run-time");
    await page.getByRole("button", { name: "Back to the start" }).click();
    await expect(time).toContainText("00:00.0");
    // The run on the fakes takes well under a second: step a tenth at a time.
    await page.keyboard.press(".");
    await expect(time).toContainText("00:00.1 /");
    await page.keyboard.press("Space");
    await expect(page.locator(".run-kicker")).toHaveText("Replay");
    await page.getByRole("button", { name: "4×" }).click();
    // At the end a replay just says so: it has its own controls, and the deck is a tap on Back.
    await expect(page.locator(".run-pill")).toHaveText("GG!");
    await expect(page.locator(".run-summary")).toHaveCount(0);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Optimized deck" })).toBeVisible();
    await expect(page.locator(".checks li.bad")).toHaveCount(0);
    // Running it again starts from this run's settings, and can be called off.
    await expect(page.locator(".rerun-panel")).toContainText(
      "up to 15 swaps · deck ≤ $300 · bracket 3",
    );
    await page.getByRole("button", { name: "Change and re-run" }).click();
    await expect(page.getByLabel("Deck budget ($)")).toHaveValue("300");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Change and re-run" })).toBeVisible();

    // The target bracket can be changed from the bracket panel; it only re-runs on a second tap.
    const aim = page.locator("#bracket").getByLabel("Target bracket");
    await expect(aim).toHaveValue("3");
    await expect(page.getByRole("button", { name: /Re-run for bracket/ })).toHaveCount(0);
    await aim.selectOption("2");
    await expect(page.getByRole("button", { name: "Re-run for bracket 2" })).toBeVisible();
    await aim.selectOption("3");

    // Chat: propose a swap, apply it, and see the report update.
    await page.getByRole("button", { name: /Ask the doc/ }).click();
    await expect(page.getByRole("complementary", { name: "Deck chat" })).toBeVisible();
    const message = page.getByLabel("Message");
    await message.fill("swap Sol Ring for Mind Stone");
    await message.press("Enter");
    const proposal = page.locator(".chat-msg.assistant .chat-changes").last();
    await expect(proposal).toContainText("Sol Ring");
    await expect(proposal).toContainText("Mind Stone");
    // Card names in a reply are previews too, like cards anywhere else on the page. With no LLM
    // configured the reply is the help text, which names Sol Ring and Mind Stone.
    await message.fill("what should I cut?");
    await message.press("Enter");
    const reply = page.locator(".chat-msg.assistant .chat-bubble").last();
    const mentioned = reply.getByRole("link", { name: "Sol Ring" }).first();
    await expect(mentioned).toBeVisible();
    await mentioned.hover();
    await expect(page.locator(".card-preview")).toHaveAttribute("src", /^https:/);
    // The change is made in the background: the request returns at once, the UI shows progress.
    const queued = page.waitForResponse((r) => /\/chat\/[^/]+\/apply$/.test(r.url()));
    await proposal.getByRole("button", { name: "Apply 2 changes" }).click();
    expect((await queued).status()).toBe(202);
    await expect(proposal).toContainText("Applied", { timeout: 30_000 });
    await expect(page.locator(".updating-note")).toHaveCount(0, { timeout: 30_000 });

    // Cutting lands opens a gap the optimizer would fix: the doc offers a re-run that keeps edits.
    await message.fill("remove 3 Forest");
    await message.press("Enter");
    const cut = page.locator(".chat-msg.assistant .chat-changes", { hasText: "3× Forest" });
    await cut.getByRole("button", { name: "Apply 1 change" }).click();
    await expect(cut).toContainText("Applied", { timeout: 30_000 });
    const offer = page.locator(".chat-rerun").last();
    await expect(offer).toContainText("Keeps your edits");
    await expect(offer.getByRole("button", { name: "Re-run" })).toBeVisible();
    await expect(page.locator(".chat-msg.assistant .chat-bubble").last()).toContainText(
      /lands, under the recommended/,
    );
    await page.getByRole("button", { name: "Close chat" }).click();
    const decklist = page.locator("#decklist");
    await decklist.getByRole("button", { name: /^Show swaps/ }).click();
    await expect(page.locator(".edit-log")).toContainText("Mind Stone");
    await decklist.getByRole("button", { name: "Show decklist" }).click();
    await expect(page.locator(".deck-group li.new").filter({ hasText: "Mind Stone" })).toHaveCount(
      1,
    );

    // Any swap the doc suggests can be made in the deck as submitted.
    await decklist.getByRole("button", { name: /^Show swaps/ }).click();
    const swaps = decklist.locator(".swap");
    await expect(swaps.first()).toBeVisible();
    const before = await swaps.count();
    const first = swaps.first();
    const added = await first.locator(".mini-card.in .mini-card-name").innerText();
    await first.getByRole("button", { name: /^Apply .* to your deck$/ }).click();
    await expect(swaps).toHaveCount(before - 1, { timeout: 30_000 });
    await page.getByRole("tab", { name: "Your deck" }).click();
    await expect(page.locator(".deck-group li").filter({ hasText: added })).not.toHaveCount(0);
    await page.getByRole("tab", { name: /Optimized/ }).click();

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator(".deck-card")).toContainText(["Lathril, Blade of the Elves"]);
  });

  test("review groups cards by type, adds cards with Enter and previews on hover", async ({
    page,
  }) => {
    await page.goto(APP_URL);
    await page.locator("textarea.decklist").fill(deckText);
    await page.getByRole("button", { name: "Analyze deck" }).click();
    await expect(page.getByRole("heading", { name: "Check the cards" })).toBeVisible();

    const heads = page.locator(".group-head");
    await expect(heads.first()).toContainText("Creature");
    await expect(heads.filter({ hasText: "Land" })).toHaveCount(1);
    // Rows show their mana cost and each group runs cheapest first.
    await expect(page.locator(".card-row .card-row-cost .mana-cost").first()).toBeVisible();
    const costsByGroup = await page.locator(".card-rows > li").evaluateAll((items) => {
      const groups: Record<string, number[]> = {};
      let current = "";
      for (const li of items) {
        if (li.classList.contains("group-head")) current = li.textContent ?? "";
        else
          (groups[current] ??= []).push(
            [...li.querySelectorAll(".card-row-cost img")].reduce(
              (n, img) => n + (Number(img.getAttribute("alt")?.replace(/[{}]/g, "")) || 1),
              0,
            ),
          );
      }
      return Object.values(groups);
    });
    expect(costsByGroup.length).toBeGreaterThan(2);
    for (const costs of costsByGroup) expect(costs).toEqual([...costs].sort((a, b) => a - b));
    await expect(page.locator(".status-chip").first()).toHaveText("100 / 100 cards");

    const add = page.getByLabel("Add a card");
    await add.fill("Lightning Greavs");
    await add.press("Enter");
    // The flash lasts 1.6s, so read the flashed row's name and note in one go while it's on.
    const flashed = () =>
      page.locator(".card-row.flash").evaluateAll((rows) =>
        rows.map((r) => ({
          name: r.querySelector<HTMLInputElement>("input.name")?.value,
          qty: r.querySelector<HTMLInputElement>("input.qty")?.value,
          printed: r.textContent?.includes("printed") ?? false,
        })),
      );
    await expect.poll(flashed).toEqual([{ name: "Lightning Greaves", qty: "1", printed: false }]);
    await expect(add).toHaveValue("");
    await expect(add).toBeFocused();
    await expect(page.locator(".status-chip").first()).toHaveText("101 / 100 cards");

    await add.fill("Forest");
    await add.press("Enter");
    await expect
      .poll(async () => (await flashed()).map((r) => r.name !== "Forest" || r.qty === "1"))
      .toEqual([false]);

    await add.fill("Definitely Not A Magic Card");
    await add.press("Enter");
    await expect(page.locator(".add-error")).toContainText("Couldn't find");

    const row = page.locator(".card-row").filter({ has: page.locator('input[value="Sol Ring"]') });
    await row.hover({ position: { x: 400, y: 20 } });
    await expect(page.locator(".card-preview")).toHaveAttribute("src", /cards\.scryfall\.io/);
  });

  test("decks that couldn't be loaded say so, rather than that there are none", async ({
    page,
  }) => {
    await page.route("**/api/decks", (route) =>
      route.fulfill({ status: 500, json: { error: "The disk is on fire" } }),
    );
    await page.goto(APP_URL);
    await expect(page.getByText("Couldn't load the decks")).toBeVisible();
    await expect(page.getByText("No decks yet")).toHaveCount(0);
  });

  test("text list with no commander shows a helpful prompt", async ({ page }) => {
    await page.goto(APP_URL);
    await page.locator("textarea.decklist").fill("1 Sol Ring\n1 Arcane Signet");
    await page.getByRole("button", { name: "Analyze deck" }).click();
    await page.getByRole("button", { name: "Other" }).click();
    await page.getByRole("button", { name: "Commander" }).click();
    await expect(page.getByText("Pick a commander to continue")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save & optimize" })).toBeDisabled();
  });
});

test.describe("local app with a model", () => {
  test("the doc's chat reply appears as it's written, then becomes the full message", async ({
    page,
  }) => {
    await page.goto(`${LLM_APP_URL}#/deck/lathril-blade-of-the-elves/optimized`);
    await page.getByRole("button", { name: /Ask the doc/ }).click();
    // Every text the reply bubble shows while it's written.
    await page.evaluate(() => {
      const w = window as unknown as { shown: string[] };
      w.shown = [];
      new MutationObserver(() => {
        const text = document.querySelector(".chat-bubble.streaming")?.textContent;
        if (text && text !== w.shown.at(-1)) w.shown.push(text);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const message = page.getByLabel("Message");
    await message.fill("Give me a fairer mana rock");
    await message.press("Enter");

    // The reply, still being written, before the rest of the answer arrives.
    const streaming = page.locator(".chat-bubble.streaming");
    await expect(streaming).toContainText("Stub chat");
    await expect(page.locator(".chat-changes")).toHaveCount(0);

    // Then the saved message, with the changes it proposes.
    await expect(streaming).toHaveCount(0, { timeout: 30_000 });
    const reply = page.locator(".chat-msg.assistant").last();
    await expect(reply.locator(".chat-bubble")).toHaveText(
      "Stub chat: trade Sol Ring for a fairer rock.",
    );
    await expect(reply.locator(".chat-changes")).toContainText("Mind Stone");
    await expect(reply.getByRole("button", { name: "Apply 2 changes" })).toBeVisible();
    const full = "Stub chat: trade Sol Ring for a fairer rock.";
    const shown = await page.evaluate(() => (window as unknown as { shown: string[] }).shown);
    expect(shown.length, shown.join(" | ")).toBeGreaterThan(3);
    shown.forEach((text, i) => {
      expect(full.startsWith(text), text).toBe(true);
      if (i) expect(text.length).toBeGreaterThan(shown[i - 1].length);
    });

    // Closing the chat mid-reply doesn't lose it: it's in the history when the chat opens again.
    await message.fill("Give me a fairer mana rock");
    await message.press("Enter");
    await expect(streaming).toBeVisible();
    await page.getByRole("button", { name: "Close chat" }).click();
    await page.getByRole("button", { name: /Ask the doc/ }).click();
    await expect(page.locator(".chat-msg.assistant .chat-changes")).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(page.locator(".chat-msg.user")).toHaveCount(2);
  });
});

test.describe("local app, editing a deck", () => {
  test("the chat can be cleared, after a yes", async ({ page }) => {
    await page.goto(`${LLM_APP_URL}#/deck/lathril-blade-of-the-elves-3`);
    await page.getByRole("button", { name: /Ask the doc/ }).click();
    const message = page.getByLabel("Message");
    await message.fill("Give me a fairer mana rock");
    await message.press("Enter");
    await expect(page.locator(".chat-msg.assistant .chat-changes")).toBeVisible({
      timeout: 30_000,
    });

    const clear = page.getByRole("button", { name: "Clear chat" });
    await clear.click();
    const confirm = page.getByRole("alertdialog", { name: "Clear chat" });
    await expect(confirm).toContainText("Your deck and its report stay as they are.");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.locator(".chat-msg")).toHaveCount(2);

    await clear.click();
    await confirm.getByRole("button", { name: "Clear chat" }).click();
    await expect(page.locator(".chat-empty")).toBeVisible();
    await expect(page.locator(".chat-msg")).toHaveCount(0);
    await expect(clear).toHaveCount(0, { timeout: 1_000 });

    // Still empty when the chat opens again.
    await page.getByRole("button", { name: "Close chat" }).click();
    await page.getByRole("button", { name: /Ask the doc/ }).click();
    await expect(page.locator(".chat-empty")).toBeVisible();
  });

  test("edits show in the list at once; the rest of the report follows once they stop", async ({
    page,
  }) => {
    await page.goto(`${LLM_APP_URL}#/deck/lathril-blade-of-the-elves-2/optimized`);
    const decklist = page.locator("#decklist");
    await decklist.getByRole("button", { name: /^Show swaps/ }).click();
    const swaps = decklist.locator(".swap");
    await expect(swaps.first()).toBeVisible();
    const before = await swaps.count();

    // Every note the page shows from here on.
    await page.evaluate(() => {
      const w = window as unknown as { notes: string[] };
      w.notes = [];
      new MutationObserver(() => {
        const note = document.querySelector(".updating-note")?.textContent?.trim();
        if (note && w.notes.at(-1) !== note) w.notes.push(note);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    // Two of the doc's swaps, one after the other: each goes in at once.
    for (let i = 1; i <= 2; i++) {
      await swaps
        .first()
        .getByRole("button", { name: /^Apply .* to your deck$/ })
        .click();
      await expect(swaps).toHaveCount(before - i, { timeout: 30_000 });
    }
    // Then the rest is worked out, once, and the page shows it without a reload.
    const status = `${LLM_APP_URL}api/decks/lathril-blade-of-the-elves-2/status`;
    await expect
      .poll(
        async () => {
          const s = await (await page.request.get(status)).json();
          return s.changes.kind === "settled";
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(page.locator(".updating-note")).toHaveCount(0);
    await expect(swaps).toHaveCount(before - 2);
    // While the rest waited for the edits to stop, the page didn't count it down.
    const notes = await page.evaluate(() => (window as unknown as { notes: string[] }).notes);
    expect(notes.filter((n) => /updates in/.test(n))).toEqual([]);
  });
});
