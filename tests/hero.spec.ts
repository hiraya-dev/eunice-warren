import { expect, test } from "@playwright/test";

test.describe("keepsakes hero", () => {
  test("shows the desktop composition", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Eunice & Warren");
    await expect(page.locator("[data-hero-keepsake]")).toHaveCount(7);
    for (const keepsake of await page.locator("[data-hero-keepsake]").all()) await expect(keepsake).toBeVisible();
  });

  test("uses the compact composition on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(".hero_title span").first()).toBeVisible();
    await expect(page.locator(".hero_title span").nth(1)).toBeVisible();
    await expect(page.locator(".hero_sunset")).toBeHidden();
    await expect(page.locator(".hero_palm")).toBeHidden();
    const transform = await page.locator(".hero_couple").evaluate((element) => getComputedStyle(element).transform);
    const matrix = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(",").map(Number);
    expect(matrix).toBeTruthy();
    const angle = Math.atan2(matrix![1], matrix![0]) * (180 / Math.PI);
    expect(Math.abs(angle + 6)).toBeLessThan(0.5);
  });

  test("does not create horizontal overflow at narrow mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test("keepsakes are immediately visible with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("[data-hero-keepsake]").first()).toHaveCSS("opacity", "1");
  });

  test("centres the desktop text and uses the full title line box", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 912 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const metrics = await page.evaluate(() => {
      const hero = document.querySelector<HTMLElement>("#hero")!.getBoundingClientRect();
      const title = document.querySelector<HTMLElement>(".hero_title")!;
      const content = document.querySelector<HTMLElement>(".hero_content")!.getBoundingClientRect();
      return { heroTop: hero.top, heroHeight: hero.height, titleHeight: title.getBoundingClientRect().height, titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize), contentCentre: content.top + content.height / 2 };
    });
    expect(metrics.titleHeight).toBeGreaterThanOrEqual(metrics.titleFontSize * 1.05);
    // Paper centres the text block below 40px of top padding, so its centre sits ~20px under the section's.
    expect(Math.abs(metrics.contentCentre - (metrics.heroTop + metrics.heroHeight / 2 + 20))).toBeLessThan(24);
  });

  test("moves the style guide to its own noindex route", async ({ page }) => {
    const response = await page.goto("/style-guide");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText("Style Guide");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });
});
