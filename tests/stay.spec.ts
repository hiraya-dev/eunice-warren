import { expect, test } from "@playwright/test";

test.describe("stay section", () => {
  test("follows entourage and uses the desktop directions layout", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const order = await page.evaluate(() => document.querySelector("#entourage")!.compareDocumentPosition(document.querySelector("#stay")!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order).toBeTruthy();
    const steps = await page.locator("#stay .stay_step").evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return { top: box.top, left: box.left }; }));
    expect(steps[0].top).toBe(steps[1].top);
    expect(steps[1].top).toBe(steps[2].top);
    expect(steps[1].left).toBeGreaterThan(steps[0].left);
    expect(steps[2].left).toBeGreaterThan(steps[1].left);
    await expect(page.locator("#stay .stay_title")).toHaveCSS("font-size", "120px");
  });

  test("stacks the directions and fits the mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const result = await page.evaluate(() => {
      const steps = Array.from(document.querySelectorAll<HTMLElement>("#stay .stay_step")).map((item) => item.getBoundingClientRect().top);
      return { steps, scrollWidth: document.documentElement.scrollWidth };
    });
    expect(result.steps[1]).toBeGreaterThan(result.steps[0]);
    expect(result.steps[2]).toBeGreaterThan(result.steps[1]);
    expect(result.scrollWidth).toBeLessThanOrEqual(390);
    expect(await page.locator("#stay .stay_map svg").evaluateAll((maps) => maps.every((map) => map.getAttribute("aria-hidden") === "true"))).toBeTruthy();
    expect(await page.locator("#stay .stay_map-mobile").evaluate((map) => map.getBoundingClientRect().height)).toBeLessThan(260);
  });
});
