import { expect, test } from "@playwright/test";

test.describe("grain backgrounds and Paper buttons", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("uses the light grain on the root background", async ({ page }) => {
    await page.goto("/404");

    const styles = await page.evaluate(() => {
      const computed = getComputedStyle(document.documentElement);
      return {
        image: computed.backgroundImage,
        size: computed.backgroundSize,
      };
    });

    expect(styles.image).toContain("grain-light");
    expect(styles.size).toBe("512px 512px");
  });

  test("uses the themed grain and Paper button variants", async ({ page }) => {
    await page.goto("/example-components");

    const theme = page.locator('[class*="theme-brand"], [class*="theme-dark"]').first();
    await expect(theme).toHaveCSS("background-size", "512px 512px");
    await expect(theme).toHaveCSS("background-image", /grain-(brand|dark)/);

    const primary = page.getByRole("button", { name: "Primary", exact: true });
    await expect(primary).toHaveCSS("border-radius", "0px");
    await expect(primary).toHaveCSS("font-weight", "500");
    await expect(page.getByRole("button", { name: "Pill", exact: true })).toHaveCSS(
      "border-radius",
      /\d{3,}px/,
    );
    await expect(page.getByRole("link", { name: "Link", exact: true })).toHaveCSS(
      "font-family",
      /^"?PP Fraktion Mono/,
    );
    await expect(page.getByRole("link", { name: "Link", exact: true })).toHaveCSS(
      "text-transform",
      "uppercase",
    );

    for (const [name, expectedHeight] of [
      ["Primary", 52],
      ["Pill", 40],
      ["Secondary", 52],
    ] as const) {
      const height = await page
        .getByRole("button", { name, exact: true })
        .evaluate((button) => button.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(expectedHeight - 1);
      expect(height).toBeLessThanOrEqual(expectedHeight + 1);
    }
  });
});
