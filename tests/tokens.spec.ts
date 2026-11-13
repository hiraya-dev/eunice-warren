import { expect, test } from "@playwright/test";

test.describe("design tokens", { tag: ["@single"] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("uses the desktop type tokens on the home page", async ({ page }) => {
    await page.goto("/");

    const styles = await page.locator("h1").evaluate((heading) => {
      const computed = getComputedStyle(heading);
      const body = getComputedStyle(document.body);

      return {
        headingSize: computed.fontSize,
        headingFamily: computed.fontFamily,
        bodyFamily: body.fontFamily,
      };
    });

    expect(styles.headingSize).toBe("128px");
    expect(styles.headingFamily).toMatch(/^"?PP Editorial New/);
    expect(styles.bodyFamily).toMatch(/^"?PP Neue Montreal/);
  });

  test("uses the light theme background and light grain on the root", async ({ page }) => {
    await page.goto("/404");

    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
      )
      .toBe("rgb(245, 239, 227)");

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

test.describe("design tokens at the mobile minimum", { tag: ["@single"] }, () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test("uses the minimum display size", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCSS("font-size", "80px");
  });
});
