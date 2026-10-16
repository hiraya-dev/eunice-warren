import { test, expect } from "@playwright/test";

const fixture = "tests/fixtures/tiny.jpg";

test.describe("With Love guest uploads", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("[data-with-love-upload]").scrollIntoViewIfNeeded();
  });

  test("shows the empty state and disables pinning until all required fields are present", async ({ page }) => {
    const form = page.locator("[data-with-love-form]");
    await expect(page.locator("[data-sent]")).not.toBeVisible();
    await expect(form.locator("[data-photo-empty]")).toBeVisible();
    await expect(form.locator("[data-submit]")).toBeDisabled();
    await form.locator("[data-message]").fill("A little note");
    await expect(form.locator("[data-counter]")).toHaveText("13 / 140");
    await form.locator("[data-name]").fill("Guest");
    await expect(form.locator("[data-submit]")).toBeDisabled();
    await form.locator("[data-photo-input]").setInputFiles(fixture);
    await expect(form.locator("[data-photo-preview]")).toBeVisible();
    await expect(form.locator("[data-change-photo]")).toBeVisible();
    await expect(form.locator("[data-submit]")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("loads samples, hides hidden notes, and fills to six cards", async ({ page }) => {
    const list = page.locator("[data-stacked-cards-list]");
    await expect(list.locator("> [data-stacked-cards-item]")).toHaveCount(6);
    await expect(list.locator("[data-note-id=hidden-test-note]")).toHaveCount(0);
  });

  test("pins a note, puts it on top, and resets to empty", async ({ page }) => {
    const form = page.locator("[data-with-love-form]");
    await form.locator("[data-photo-input]").setInputFiles(fixture);
    await form.locator("[data-message]").fill("See you by the shore!");
    await form.locator("[data-name]").fill("Mia");
    await form.locator("[data-city]").fill("Cebu");
    await form.locator("[data-submit]").click();
    await expect(page.locator("[data-sent]")).toBeVisible();
    await expect(page.locator("[data-sent]")).toContainText("Salamat, Mia!");
    await expect(page.locator("[data-stacked-cards-list] > :first-child")).toContainText("See you by the shore!");
    await page.locator("[data-another]").click();
    await expect(form).toBeVisible();
    await expect(form.locator("[data-photo-empty]")).toBeVisible();
    await expect(form.locator("[data-message]")).toHaveValue("");
  });

  test("keeps values and announces a server error", async ({ page }) => {
    const form = page.locator("[data-with-love-form]");
    await form.locator("[data-photo-input]").setInputFiles(fixture);
    await form.locator("[data-message]").fill("Keep this note");
    await form.locator("[data-name]").fill("Error Test");
    await form.locator("[data-submit]").click();
    await expect(form.locator("[data-form-error]")).toHaveText("Something went wrong — please try again.");
    await expect(form.locator("[data-message]")).toHaveValue("Keep this note");
    await expect(form.locator("[data-name]")).toHaveValue("Error Test");
  });
});
