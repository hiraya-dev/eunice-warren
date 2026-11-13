import { expect, test } from "@playwright/test";

test.describe("attire section", () => {
  test("contains the packing list and named colour swatches", { tag: ["@single"] }, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#attire")).toHaveCount(1);
    await expect.poll(() => page.locator("#attire .attire_list li").count()).toBeGreaterThan(0);
    const swatches = page.locator("#attire .attire_swatch-item");
    await expect.poll(() => swatches.count()).toBeGreaterThan(0);
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

  test("links from the wedding card", { tag: ["@single"] }, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".wedding_dress-link")).toHaveAttribute("href", "#attire");
  });
});
