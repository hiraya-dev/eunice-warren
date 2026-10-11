import { expect, test } from "@playwright/test";

test.describe("full-screen menu hover", () => {
  test("dims sibling rows and rolls the focused label", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator('[data-navigation-toggle="toggle"]').click();
    const stay = page.locator(".navigation_link", { hasText: "Stay" });
    const supportsHover = await page.evaluate(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    await page.mouse.move(0, 0);
    await stay.hover();

    if (supportsHover) {
      await expect.poll(() => page.locator(".navigation_item").evaluateAll((items) => items.filter((_item, index) => index !== 1).every((item) => getComputedStyle(item).opacity === "0.15"))).toBe(true);
      await expect.poll(() => stay.locator(".navigation_label-text").evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
    } else {
      await expect(page.locator(".navigation_item")).toHaveCount(5);
      await expect.poll(() => page.locator(".navigation_item").evaluateAll((items) => items.every((item) => getComputedStyle(item).opacity === "1"))).toBe(true);
      await expect.poll(() => stay.locator(".navigation_label-text").evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    }
  });

  test("does not dim rows from programmatic focus after a mouse open", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.mouse.move(0, 0);
    await page.locator('[data-navigation-toggle="toggle"]').click();
    await expect.poll(() => page.locator(".navigation_item").evaluateAll((items) => items.every((item) => getComputedStyle(item).opacity === "1"))).toBe(true);
  });

  test("does not dim or roll under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.locator('[data-navigation-toggle="toggle"]').click();
    const stay = page.locator(".navigation_link", { hasText: "Stay" });
    await stay.hover();
    await expect(page.locator(".navigation_item").first()).toHaveCSS("opacity", "1");
    await expect.poll(() => stay.locator(".navigation_label-text").evaluate((element) => getComputedStyle(element).transform)).toBe("none");
  });
});
