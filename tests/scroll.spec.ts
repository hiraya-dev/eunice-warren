import { expect, test } from "@playwright/test";

test.describe("site-wide smooth scroll", () => {
  test("initializes Lenis and smooth-scrolls the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/\blenis\b/);

    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("stops Lenis while the navigation menu is open", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator('[data-navigation-toggle="toggle"]');
    await toggle.click();
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");

    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);

    await toggle.click();
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  });

  test("keeps native scrolling for reduced-motion users", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveClass(/\blenis\b/);

    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  for (const reducedMotion of [false, true]) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      test(`clears the navigation for hash anchors at ${viewport.width}px${reducedMotion ? " with reduced motion" : ""}`, async ({ page }) => {
        if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize(viewport);
        await page.goto("/example-components");
        await page.evaluate(() => {
          const link = document.createElement("a");
          link.href = "#showcase";
          link.textContent = "Showcase";
          document.body.append(link);
          link.click();
        });

        const scrollPadding = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockStart));
        await expect.poll(() => page.evaluate((padding) => {
          const target = document.querySelector<HTMLElement>("#showcase")!;
          return Math.abs(target.getBoundingClientRect().top - padding);
        }, scrollPadding), { timeout: 10000 }).toBeLessThanOrEqual(2);

        const positions = await page.evaluate(() => ({
          targetTop: document.querySelector<HTMLElement>("#showcase")!.getBoundingClientRect().top,
          navigationBottom: document.querySelector<HTMLElement>(".nav_wrap")!.getBoundingClientRect().bottom,
        }));
        expect(positions.targetTop).toBeGreaterThanOrEqual(positions.navigationBottom);
      });
    }
  }

  test("skip link focuses main with Lenis active", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/\blenis\b/);
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });
});
