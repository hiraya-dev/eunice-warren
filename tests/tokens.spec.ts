import { expect, test } from "@playwright/test";

test.describe("design tokens", () => {
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

  test("uses the light theme page background", async ({ page }) => {
    await page.goto("/404");

    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
      )
      .toBe("rgb(245, 239, 227)");
  });
});

test.describe("design tokens at the mobile minimum", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test("uses the minimum display size", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCSS("font-size", "80px");
  });
});
