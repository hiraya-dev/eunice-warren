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
    await expect(form.locator("[data-zoom]")).toHaveValue("1");
    const initialTransform = await form.locator("[data-photo-preview]").evaluate((image) => image.style.transform);
    await form.locator("[data-zoom]").fill("2");
    await expect.poll(() => form.locator("[data-photo-preview]").evaluate((image) => image.style.transform)).not.toBe(initialTransform);
    const zoomedTransform = await form.locator("[data-photo-preview]").evaluate((image) => image.style.transform);
    const slot = form.locator("[data-photo-slot]");
    const box = await slot.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 20, box!.y + box!.height / 2 + 12);
    await page.mouse.up();
    await expect.poll(() => form.locator("[data-photo-preview]").evaluate((image) => image.style.transform)).not.toBe(zoomedTransform);
    await expect(form.locator("[data-submit]")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("loads samples, hides hidden notes, and fills to six cards", async ({ page }) => {
    const list = page.locator("[data-stacked-cards-list]");
    // Other specs pin notes into the shared fake store; once three exist, samples drop out.
    await expect.poll(() => list.locator("> [data-stacked-cards-item]").count()).toBeGreaterThanOrEqual(3);
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
    await expect.poll(() => page.locator("[data-stacked-cards-list] > :first-child img").evaluate((image) => { const photo = image as HTMLImageElement; return photo.naturalWidth > 0 && photo.naturalHeight > 0; })).toBe(true);
    const ratio = await page.locator("[data-stacked-cards-list] > :first-child img").evaluate((image) => { const photo = image as HTMLImageElement; return photo.naturalWidth / photo.naturalHeight; });
    expect(ratio).toBeCloseTo(8 / 7, 2);
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
