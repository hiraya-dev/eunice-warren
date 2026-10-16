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
    await expect(page.locator("#stay .stay_compass")).toBeVisible();
    await expect(page.locator("#stay .stay_map")).toHaveCount(0);
    expect(await page.locator("#stay .stay_compass").evaluate((compass) => compass.getBoundingClientRect().width)).toBeCloseTo(460, 0);
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
    await expect(page.locator("#stay .stay_compass")).toBeVisible();
    await expect(page.locator("#stay .stay_compass")).toHaveCount(1);
    await expect(page.locator("#stay .stay_compass_wrap")).toHaveAttribute("aria-hidden", "true");
    expect(await page.locator("#stay .stay_compass").evaluate((compass) => compass.getBoundingClientRect().width)).toBeLessThanOrEqual(350);
    await expect(page.locator("#stay .stay_map")).toHaveCount(0);
  });

  test("follows the pointer and returns to the destination bearing", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "pointer follow only runs on hover-capable fine pointers");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const stay = page.locator("#stay");
    await stay.scrollIntoViewIfNeeded();
    const box = await stay.boundingBox();
    expect(box).not.toBeNull();
    const samples: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      await page.mouse.move(box!.x + 150 + index * 45, box!.y + 120 + index * 15);
      await page.waitForTimeout(60);
      samples.push(Number(await page.locator("#stay .stay_compass-needle").getAttribute("data-angle")));
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(5);
    await page.mouse.move(0, 0);
    await expect.poll(async () => Number(await page.locator("#stay .stay_compass-needle").getAttribute("data-angle")), { timeout: 2000 }).toBeCloseTo(22, 0);
  });

  test("swings in once and settles on the destination bearing on touch", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "touch entrance only runs without a fine pointer");
    await page.goto("/");
    const needle = page.locator("#stay .stay_compass-needle");
    await expect(needle).toHaveAttribute("data-angle", "22");
    await page.locator("#stay .stay_compass").scrollIntoViewIfNeeded();
    const samples: number[] = [];
    const start = Date.now();
    while (Date.now() - start < 600) {
      samples.push(Number(await needle.getAttribute("data-angle")));
      await page.waitForTimeout(30);
    }
    expect(samples.some((angle) => angle > 180)).toBeTruthy();
    expect(samples.every((angle) => angle < 90 || angle > 270)).toBeTruthy();
    await expect.poll(async () => Number(await needle.getAttribute("data-angle")), { timeout: 2500 }).toBeCloseTo(22, 0);
  });

  test("holds the destination bearing with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const stay = page.locator("#stay");
    await stay.scrollIntoViewIfNeeded();
    const box = await stay.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 100, box!.y + 100);
    await page.waitForTimeout(250);
    await expect(page.locator("#stay .stay_compass-needle")).toHaveAttribute("data-angle", "22");
  });
});
