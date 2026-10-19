import { expect, test } from "@playwright/test";

test.describe("attire section", () => {
  test("follows the wedding section and contains the packing list", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#attire")).toHaveCount(1);
    const order = await page.locator("#wedding, #attire").evaluateAll((sections) => sections.map((section) => section.id));
    expect(order).toEqual(["wedding", "attire"]);
    await expect(page.locator("#attire .attire_list li")).toHaveCount(5);
    await expect(page.locator("#attire .attire_swatch-name")).toHaveText(["Tiffany blue", "Champagne", "Gold"]);
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
