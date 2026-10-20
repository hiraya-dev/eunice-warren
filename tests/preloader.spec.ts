import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const preloader = (page: import("@playwright/test").Page) => page.locator("[data-preloader]");

test.describe("guest preloader", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows on a first visit with focus in the input", async ({ page }) => {
    await expect(preloader(page)).toBeVisible();
    await expect(preloader(page).locator("[data-preloader-name]")).toBeFocused();
  });

  test("finds a guest, remembers them, and pre-fills RSVP", async ({ page }) => {
    await preloader(page).locator("[data-preloader-name]").fill("Mateo Cruz");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page).getByRole("heading", { name: "Welcome, The Cruz Family." })).toBeVisible();
    await expect(preloader(page)).toContainText("Your invitation admits 4");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ew-guest-v1") || "null"))).toMatchObject({
      name: "Mateo Cruz",
      householdName: "The Cruz Family",
      seats: 4,
    });
    await expect(page.locator("[data-rsvp-name]")).toHaveValue("Mateo Cruz");
  });

  test("shows safe not-found copy without other guest names", async ({ page }) => {
    await preloader(page).locator("[data-preloader-name]").fill("Nobody Example");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page)).toContainText("Hmm, we can't find that name.");
    await expect(preloader(page)).toContainText("Check the spelling, or try the name on your invitation.");
    await expect(preloader(page)).not.toContainText("The Cruz Family");
    await expect(preloader(page)).not.toContainText("Mateo Cruz");
  });

  test("just browsing persists dismissal", async ({ page }) => {
    await preloader(page).getByRole("button", { name: "Just browsing" }).click();
    await expect(preloader(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await page.reload();
    await expect(preloader(page)).toHaveCount(0);
  });

  test("Escape closes it", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(preloader(page)).toHaveCount(0);
  });

  test("locks page scrolling while open and restores it after closing", async ({ page }) => {
    await page.mouse.wheel(0, 1200);
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await preloader(page).getByRole("button", { name: "Just browsing" }).click();
    await expect(preloader(page)).toHaveCount(0);
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("reduced motion does not animate the envelope transform", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const envelope = preloader(page).locator(".preloader_stage");
    await page.keyboard.press("Escape");
    await expect(envelope).toHaveCSS("animation-name", "none");
  });

  test("fits a 390px viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
