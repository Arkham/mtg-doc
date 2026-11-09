import fs from "node:fs";
import path from "node:path";
import { APP_URL, expect, test } from "./fixtures.ts";

const deckText = fs.readFileSync(
  path.resolve(import.meta.dirname, "../fixtures/decks/lathril-overpowered.txt"),
  "utf8",
);

test.describe("local app", () => {
  test("paste a list → review → optimize to bracket 3 → report", async ({ page }) => {
    test.slow();
    await page.goto(APP_URL);
    await expect(page.getByRole("heading", { name: "Analyze a deck" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Photo" })).toBeDisabled();

    await page.locator("textarea.decklist").fill(deckText);
    await page.getByRole("button", { name: "Analyze deck" }).click();

    await expect(page.getByRole("heading", { name: "Check the cards" })).toBeVisible();
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

    await page.getByRole("button", { name: "Save & optimize" }).click();
    await expect(page.getByRole("heading", { name: "Optimizing your deck" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your deck", level: 2 })).toBeVisible({
      timeout: 180_000,
    });
    await page.getByRole("tab", { name: /Optimized/ }).click();
    await expect(page.getByRole("heading", { name: "Bracket 3: Upgraded" })).toBeVisible();
    await expect(page.locator(".checks li.bad")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Re-run with different options/ })).toBeVisible();

    // Chat: propose a swap, apply it, and see the report update.
    await page.getByRole("button", { name: /Ask mtg-doc/ }).click();
    await expect(page.getByRole("complementary", { name: "Deck chat" })).toBeVisible();
    const message = page.getByLabel("Message");
    await message.fill("swap Sol Ring for Mind Stone");
    await message.press("Enter");
    const proposal = page.locator(".chat-msg.assistant .chat-changes").last();
    await expect(proposal).toContainText("Sol Ring");
    await expect(proposal).toContainText("Mind Stone");
    await proposal.getByRole("button", { name: "Apply 2 changes" }).click();
    await expect(proposal).toContainText("Applied", { timeout: 30_000 });
    await expect(page.locator(".edit-log")).toContainText("Mind Stone");
    await page.getByRole("button", { name: "Close chat" }).click();
    await page.getByRole("button", { name: "New cards" }).click();
    await expect(page.locator(".deck-group li.new").filter({ hasText: "Mind Stone" })).toHaveCount(
      1,
    );

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
    await expect(page.locator(".card-row.flash input.name")).toHaveValue("Lightning Greaves");
    await expect(page.locator(".card-row.flash")).not.toContainText("printed");
    await expect(add).toHaveValue("");
    await expect(add).toBeFocused();
    await expect(page.locator(".status-chip").first()).toHaveText("101 / 100 cards");

    await add.fill("Forest");
    await add.press("Enter");
    await expect(page.locator(".card-row.flash input.qty")).not.toHaveValue("1");

    await add.fill("Definitely Not A Magic Card");
    await add.press("Enter");
    await expect(page.locator(".add-error")).toContainText("Couldn't find");

    const row = page.locator(".card-row").filter({ has: page.locator('input[value="Sol Ring"]') });
    await row.hover({ position: { x: 400, y: 20 } });
    await expect(page.locator(".card-preview")).toHaveAttribute("src", /cards\.scryfall\.io/);
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
