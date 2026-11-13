import { expect, test } from "@playwright/test";

test.describe("attire section", () => {
  test("contains the packing list and three named colour swatches", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#attire")).toHaveCount(1);
    await expect(page.locator("#attire .attire_list li")).toHaveCount(5);
    const swatches = page.locator("#attire .attire_swatch-item");
    await expect(swatches).toHaveCount(3);
    for (const swatch of await swatches.all()) {
      const name = await swatch.locator(".attire_swatch-name").textContent();
      expect(name?.trim()).toBeTruthy();
      // A swatch is a flat colour or a gradient, so it needs one or the other.
      const fill = await swatch.locator(".attire_swatch").evaluate((element) => {
        const { backgroundColor, backgroundImage } = getComputedStyle(element);
        return { backgroundColor, backgroundImage };
      });
      const hasColour = fill.backgroundColor !== "rgba(0, 0, 0, 0)" && fill.backgroundColor !== "transparent";
      expect(hasColour || fill.backgroundImage !== "none").toBe(true);
    }
  });

  test("keeps the page within the viewport and links from the wedding card", async ({ page }) => {
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator(".wedding_dress-link")).toHaveAttribute("href", "#attire");
    }
  });
});
