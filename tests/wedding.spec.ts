import { expect, test } from "@playwright/test";

test.describe("wedding schedule tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
  });

  test("starts with panel 01 visible and advances autoplay after entering view", async ({ page }) => {
    await page.locator("#wedding").scrollIntoViewIfNeeded();
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText(/Ceremony/);
    await expect(page.locator("#wedding-panel-1")).toBeVisible();
    await expect(page.locator("#wedding-panel-2")).toBeHidden();
    const first = await page.locator('[data-tabs="item-progress"]').first().evaluate((el) => getComputedStyle(el).transform);
    await page.waitForTimeout(500);
    const second = await page.locator('[data-tabs="item-progress"]').first().evaluate((el) => getComputedStyle(el).transform);
    expect(second).not.toBe(first);
    await expect.poll(() => page.locator('[role="tab"][aria-selected="true"]').getAttribute("id"), { timeout: 7000 }).toBe("wedding-tab-2");
  });

  test("supports click and roving keyboard navigation", async ({ page }) => {
    await page.locator("#wedding").scrollIntoViewIfNeeded();
    await page.locator("#wedding-tab-3").click();
    await expect(page.locator("#wedding-tab-3")).toHaveAttribute("aria-selected", "true");
    await page.locator("#wedding-tab-3").press("ArrowLeft");
    await expect(page.locator("#wedding-tab-2")).toHaveAttribute("aria-selected", "true");
    await page.locator("#wedding-tab-2").press("Home");
    await expect(page.locator("#wedding-tab-1")).toHaveAttribute("aria-selected", "true");
  });

  test("stacks the visual above the schedule below desktop", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const boxes = await page.evaluate(() => {
        const visual = document.querySelector<HTMLElement>(".wedding_visual-column")!.getBoundingClientRect();
        const schedule = document.querySelector<HTMLElement>(".wedding_content")!.getBoundingClientRect();
        return { visualRight: visual.right, scheduleLeft: schedule.left, visualBottom: visual.bottom, scheduleTop: schedule.top };
      });
      if (width >= 992) expect(boxes.scheduleLeft).toBeGreaterThan(boxes.visualRight - 1);
      else expect(boxes.scheduleTop).toBeGreaterThanOrEqual(boxes.visualBottom);
    }
  });

  test("disables autoplay but keeps reduced-motion switching interactive", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.locator("#wedding").scrollIntoViewIfNeeded();
    await page.waitForTimeout(7000);
    await expect(page.locator("#wedding-tab-1")).toHaveAttribute("aria-selected", "true");
    await page.locator("#wedding-tab-3").click();
    await expect(page.locator("#wedding-tab-3")).toHaveAttribute("aria-selected", "true");
  });
});
