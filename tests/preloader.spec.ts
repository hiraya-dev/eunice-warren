import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const preloader = (page: import("@playwright/test").Page) => page.locator("[data-preloader]");

test.describe("guest preloader", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows on a first visit with focus in the input", { tag: ["@single"] }, async ({ page }) => {
    await expect(preloader(page)).toBeVisible();
    await expect(preloader(page).locator("[data-preloader-name]")).toBeFocused();
  });

  test("finds a guest, remembers them, and pre-fills RSVP", { tag: ["@smoke"] }, async ({ page }) => {
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

  test("shows safe not-found copy without other guest names", { tag: ["@single"] }, async ({ page }) => {
    await preloader(page).locator("[data-preloader-name]").fill("Nobody Example");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page)).toContainText("Hmm, we can't find that name.");
    await expect(preloader(page)).toContainText("Check the spelling, or try the name on your invitation.");
    await expect(preloader(page)).not.toContainText("The Cruz Family");
    await expect(preloader(page)).not.toContainText("Mateo Cruz");
  });

  test("suggests one safe near match before revealing the invitation", { tag: ["@single"] }, async ({ page }) => {
    await preloader(page).locator("[data-preloader-name]").fill("Matoe Cruz");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page).getByRole("heading", { name: "Did you mean Mateo Cruz?" })).toBeVisible();
    await expect(preloader(page)).toContainText("Tap yes if that's the name on your invitation.");
    await expect(preloader(page)).not.toContainText("The Cruz Family");
    await preloader(page).getByRole("button", { name: "Yes, that's me" }).click();
    await expect(preloader(page).getByRole("heading", { name: "Welcome, The Cruz Family." })).toBeVisible();
  });

  test("can reject a suggested name and try again", { tag: ["@single"] }, async ({ page }) => {
    const name = preloader(page).locator("[data-preloader-name]");
    await name.fill("Matoe Cruz");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page).getByRole("button", { name: "No, let me try again" })).toBeVisible();
    await preloader(page).getByRole("button", { name: "No, let me try again" }).click();
    await expect(name).toHaveValue("");
    await expect(name).toBeFocused();
    await expect(preloader(page).getByRole("heading", { name: "A letter is waiting for you." })).toBeVisible();
  });

  test("returns to the ask state when a suggestion is edited", { tag: ["@single"] }, async ({ page }) => {
    const overlay = preloader(page);
    const name = overlay.locator("[data-preloader-name]");
    await name.fill("Matoe Cruz");
    await overlay.getByRole("button", { name: "Open my letter" }).click();
    await expect(overlay.getByRole("heading", { name: "Did you mean Mateo Cruz?" })).toBeVisible();
    await name.fill("Nobody Example");
    await expect(overlay.getByRole("heading", { name: "A letter is waiting for you." })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Open my letter" })).toBeVisible();
  });

  test("just browsing persists dismissal", { tag: ["@single"] }, async ({ page }) => {
    await preloader(page).getByRole("button", { name: "Just browsing" }).click();
    await expect(preloader(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await page.reload();
    await expect(preloader(page)).toHaveCount(0);
  });

  test("Escape closes it", { tag: ["@single"] }, async ({ page }) => {
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

  test("reduced motion does not animate the envelope transform", { tag: ["@single"] }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const envelope = preloader(page).locator(".preloader_stage");
    await page.keyboard.press("Escape");
    await expect(envelope).toHaveCSS("animation-name", "none");
  });

  // The envelope picks its layout by its own width, so a window just above the phone breakpoint
  // must not stack the stamp, postmark, label, input and button on top of each other.
  test("keeps the envelope parts from overlapping at every width", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    const parts = [
      ".preloader_par-avion",
      ".preloader_stamp-ew",
      ".preloader_postmark",
      "[data-preloader-label]",
      "[data-preloader-name]",
      ".preloader_address > .preloader_hint",
      ".preloader_hint-mobile",
      ".preloader_not-you",
      ".preloader_message",
      ".preloader_primary",
    ];
    const assertNoOverlap = async (overlay: import("@playwright/test").Locator, width: number) => {
      const boxes = await overlay.evaluate((root, selectors) => selectors.flatMap((selector) => {
        const element = root.querySelector(selector);
        if (!element || element.getClientRects().length === 0) return [];
        const { left, top, right, bottom } = element.getBoundingClientRect();
        return [{ selector, left, top, right, bottom }];
      }), parts);
      expect(boxes.length, `${width}px`).toBeGreaterThanOrEqual(6);
      for (const [index, a] of boxes.entries()) {
        for (const b of boxes.slice(index + 1)) {
          if (a.selector === ".preloader_stamp-ew" && b.selector === ".preloader_postmark") continue;
          const apart = a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
          expect(apart, `${width}px: ${a.selector} overlaps ${b.selector}`).toBe(true);
        }
      }
    };
    for (const [width, height] of [[390, 844], [488, 1000], [600, 1000], [640, 1000], [720, 1000], [768, 1024], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const overlay = preloader(page);
      await expect(overlay.locator("[data-preloader-name]")).toBeFocused();
      // Wait for the settle to finish and the webfonts to load, so every box is final.
      await expect(overlay.locator(".preloader_stage")).toHaveCSS("transform", "none");
      await page.evaluate(() => document.fonts.ready);
      await assertNoOverlap(overlay, width);
      if (width === 390 || width === 1440) {
        await overlay.locator("[data-preloader-name]").fill("Matoe Cruz");
        await overlay.getByRole("button", { name: "Open my letter" }).click();
        await expect(overlay.getByRole("heading", { name: "Did you mean Mateo Cruz?" })).toBeVisible();
        await assertNoOverlap(overlay, width);
      }
    }
  });
});
