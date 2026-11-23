import { expect, test } from "@playwright/test";
import { fakeFixtures } from "../src/lib/rsvp/store.ts";

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

  test("shows the blank envelope again after a skipped visit", { tag: ["@single"] }, async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("ew-guest-v2", JSON.stringify({ skipped: true, at: "2026-01-01T00:00:00.000Z" })));
    await page.reload();
    await expect(preloader(page)).toBeVisible();
    await expect(preloader(page).getByRole("heading", { name: "A letter is waiting for you." })).toBeVisible();
    await expect(preloader(page).locator("[data-preloader-name]")).toHaveValue("");
  });

  test("welcomes a remembered guest without looking them up", { tag: ["@single"] }, async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("ew-guest-v2", JSON.stringify({ name: "Mateo Cruz", householdName: "Cruz Family", seats: 4, at: "2026-01-01T00:00:00.000Z" })));
    const requests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("rsvp.find")) requests.push(request.url()); });
    await page.reload();
    const overlay = preloader(page);
    await expect(overlay.getByRole("heading", { name: "Welcome back, Cruz Family." })).toBeVisible();
    await expect(overlay.locator("[data-preloader-name]")).toHaveValue("Cruz Family");
    await expect(overlay.locator("[data-preloader-name]")).toHaveAttribute("readonly", "");
    await expect(overlay.locator("[data-preloader-name]")).toHaveClass(/is-found/);
    await expect(overlay.locator("[data-preloader-not-you]")).toBeVisible();
    await expect(overlay.locator("[data-preloader-admits]")).toBeHidden();
    await overlay.getByRole("button", { name: "Open my letter" }).click();
    await expect(overlay).toHaveCount(0);
    expect(requests).toHaveLength(0);
  });

  test("lets a remembered guest choose a different name", { tag: ["@single"] }, async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("ew-guest-v2", JSON.stringify({ name: "Mateo Cruz", householdName: "Cruz Family", seats: 4, at: "2026-01-01T00:00:00.000Z" })));
    await page.reload();
    const overlay = preloader(page);
    await overlay.getByRole("button", { name: "Write your own name" }).click();
    await expect(overlay.getByRole("heading", { name: "A letter is waiting for you." })).toBeVisible();
    await expect(overlay.locator("[data-preloader-name]")).toHaveValue("");
    await expect(overlay.locator("[data-preloader-name]")).not.toHaveAttribute("readonly", "");
    await expect(overlay.locator("[data-preloader-name]")).not.toHaveClass(/is-found/);
  });

  test("keeps the remembered guest after opening the letter", { tag: ["@single"] }, async ({ page }) => {
    const guest = { name: "Mateo Cruz", householdName: "Cruz Family", seats: 4, at: "2026-01-01T00:00:00.000Z" };
    await page.evaluate((value) => localStorage.setItem("ew-guest-v2", JSON.stringify(value)), guest);
    await page.reload();
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ew-guest-v2") || "null"))).toEqual(guest);
  });

  test("finds a guest, remembers them, and pre-fills RSVP", { tag: ["@smoke"] }, async ({ page }) => {
    await preloader(page).locator("[data-preloader-name]").fill("Mateo Cruz");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page).getByRole("heading", { name: "Welcome, Cruz Family." })).toBeVisible();
    await expect(preloader(page)).toContainText("Your invitation admits 4");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ew-guest-v2") || "null"))).toMatchObject({
      name: "Mateo Cruz",
      householdName: "Cruz Family",
      seats: 4,
    });
    await expect(page.locator("[data-rsvp-name]")).toHaveValue("Mateo Cruz");
  });

  test("uses the display name and removes the legacy guest key", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ew-guest-v1", JSON.stringify({ name: "Private Label" })));
    await page.reload();
    await preloader(page).locator("[data-preloader-name]").fill("Liza Santos");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page).getByRole("heading", { name: "Welcome, Santos Family." })).toBeVisible();
    await expect(preloader(page).locator("[data-preloader-name]")).toHaveValue("Santos Family");
    await expect(preloader(page)).not.toContainText("Santos_Manila");
    await expect(preloader(page)).not.toContainText("Manila");
    await expect(preloader(page)).not.toContainText("santos");
    await expect.poll(() => page.evaluate(() => ({ guest: JSON.parse(localStorage.getItem("ew-guest-v2") || "null"), raw: localStorage.getItem("ew-guest-v2"), legacy: localStorage.getItem("ew-guest-v1") }))).toMatchObject({ guest: { householdName: "Santos Family", seats: 2 }, legacy: null });
    const raw = await page.evaluate(() => localStorage.getItem("ew-guest-v2") ?? "");
    expect(raw).not.toContain("Santos_Manila");
    expect(raw).not.toContain("Manila");
    expect(raw).not.toContain('"santos"');
  });

  test("fits real long-name and twelve-seat welcomes at 390 and 320", { tag: ["@single"] }, async ({ page }) => {
    const fixtures = fakeFixtures.filter((fixture) => fixture.id === "teachaburanatapaporn" || fixture.id === "long-display");
    for (const fixture of fixtures) for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      const overlay = preloader(page);
      await overlay.locator("[data-preloader-name]").fill(fixture.members[0]);
      await overlay.getByRole("button", { name: "Open my letter" }).click();
      await expect(overlay.getByRole("heading", { name: `Welcome, ${fixture.householdName}.` })).toBeVisible();
      await expect(overlay.locator("[data-preloader-name]")).toHaveValue(fixture.householdName);
      await expect(overlay.locator("[data-preloader-admits]")).toContainText(String(fixture.seats));
      await expect(overlay).not.toContainText(fixture.label);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const bounds = await overlay.evaluate((root) => {
        const stage = root.querySelector<HTMLElement>(".preloader_stage")!.getBoundingClientRect();
        const input = root.querySelector<HTMLElement>("[data-preloader-name]")!.getBoundingClientRect();
        return { stageLeft: stage.left, stageRight: stage.right, inputLeft: input.left, inputRight: input.right };
      });
      expect(bounds.inputLeft).toBeGreaterThanOrEqual(bounds.stageLeft - 1);
      expect(bounds.inputRight).toBeLessThanOrEqual(bounds.stageRight + 1);
    }
  });

  test("shows safe not-found copy without other guest names", { tag: ["@single"] }, async ({ page }) => {
    await preloader(page).locator("[data-preloader-name]").fill("Nobody Example");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page)).toContainText("Hmm, we can't find that name.");
    await expect(preloader(page)).toContainText("Check the spelling, or try the name on your invitation.");
    await expect(preloader(page)).not.toContainText("Cruz Family");
    await expect(preloader(page)).not.toContainText("Mateo Cruz");
  });

  test("suggests one safe near match before revealing the invitation", { tag: ["@single"] }, async ({ page }) => {
    await preloader(page).locator("[data-preloader-name]").fill("Matoe Cruz");
    await preloader(page).getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader(page).getByRole("heading", { name: "Did you mean Mateo Cruz?" })).toBeVisible();
    await expect(preloader(page)).toContainText("Tap yes if that's the name on your invitation.");
    await expect(preloader(page)).not.toContainText("Cruz Family");
    await preloader(page).getByRole("button", { name: "Yes, that's me" }).click();
    await expect(preloader(page).getByRole("heading", { name: "Welcome, Cruz Family." })).toBeVisible();
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
    await expect(preloader(page)).toBeVisible();
  });

  test("reveals the hero when just browsing closes the preloader", { tag: ["@single"] }, async ({ page }) => {
    const heroTitle = page.locator("[data-hero-text-item]").nth(1);
    await expect(heroTitle).toHaveCSS("visibility", "hidden");
    await preloader(page).getByRole("button", { name: "Just browsing" }).click();
    await expect(preloader(page)).toHaveCount(0);
    await expect(heroTitle).toHaveCSS("visibility", "visible");
    await expect(heroTitle).toHaveCSS("opacity", "1");
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
    await expect(preloader(page).locator("[data-preloader-name]")).toBeFocused();
    const animationName = await page.evaluate(() => {
      const envelope = document.querySelector<HTMLElement>("[data-preloader] .preloader_stage");
      if (!envelope) throw new Error("Preloader envelope was not found");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return getComputedStyle(envelope).animationName;
    });
    expect(animationName).toBe("none");
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
