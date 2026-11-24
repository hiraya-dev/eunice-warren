import { expect, test } from "@playwright/test";
import { reveal } from "./helpers/reveal";

// The visual column, each schedule row and the footer reveal through the shared fade-in (L-029).
// Scroll to the section, then wait for every one of them so a tab click or a measurement
// never lands on a hidden or still-rising item.
const revealWedding = async (page: import("@playwright/test").Page) => {
  await page.locator("#wedding").scrollIntoViewIfNeeded();
  await reveal(page.locator(".wedding_visual-column"));
  for (const tab of await page.locator('#wedding [role="tab"]').all()) await reveal(tab);
  await reveal(page.locator(".wedding_footer"));
};

test.describe("wedding schedule tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
  });

  test("starts with panel 01 visible and advances autoplay after entering view", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    await revealWedding(page);
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText(/Ceremony/);
    await expect(page.locator("#wedding-panel-1")).toBeVisible();
    await expect(page.locator("#wedding-panel-2")).toBeHidden();
    const first = await page.locator('[data-tabs="item-progress"]').first().evaluate((el) => getComputedStyle(el).transform);
    await page.waitForTimeout(500);
    const second = await page.locator('[data-tabs="item-progress"]').first().evaluate((el) => getComputedStyle(el).transform);
    expect(second).not.toBe(first);
    await expect.poll(() => page.locator('[role="tab"][aria-selected="true"]').getAttribute("id"), { timeout: 7000 }).toBe("wedding-tab-2");
  });

  test("supports click and roving keyboard navigation", { tag: ["@smoke", "@single"] }, async ({ page }) => {
    await revealWedding(page);
    await page.locator("#wedding-tab-3").click();
    await expect(page.locator("#wedding-tab-3")).toHaveAttribute("aria-selected", "true");
    await page.locator("#wedding-tab-3").press("ArrowLeft");
    await expect(page.locator("#wedding-tab-2")).toHaveAttribute("aria-selected", "true");
    await page.locator("#wedding-tab-2").press("Home");
    await expect(page.locator("#wedding-tab-1")).toHaveAttribute("aria-selected", "true");
  });

  test("swaps the complete polaroid at each tab's resting tilt", { tag: ["@single"] }, async ({ page }) => {
    await revealWedding(page);
    const expectedTilts = [-3, 2.5, -1.5, -3];
    const waitForSettledPanel = (panelNumber: number) => expect.poll(async () => page.locator('[role="tabpanel"][data-tabs="visual-item"]').evaluateAll((panels) => {
      const visiblePanels = panels.filter((panel) => !(panel as HTMLElement).hidden);
      const activePanel = visiblePanels[0] as HTMLElement | undefined;
      return {
        count: visiblePanels.length,
        id: activePanel?.id,
        opacity: activePanel ? getComputedStyle(activePanel).opacity : "",
      };
    }), { timeout: 5000 }).toEqual({ count: 1, id: `wedding-panel-${panelNumber}`, opacity: "1" });
    const readTilt = (panelNumber: number) => page.locator(`#wedding-panel-${panelNumber}`).evaluate((el) => {
      const transform = getComputedStyle(el).transform;
      if (transform === "none") return 0;
      const values = transform.match(/matrix(?:3d)?\(([^)]+)\)/)?.[1].split(",").map(Number) ?? [];
      return Math.atan2(values[1], values[0]) * (180 / Math.PI);
    });

    await waitForSettledPanel(1);
    const tilts = [await readTilt(1)];
    for (const tabNumber of [2, 3, 1]) {
      await page.locator(`#wedding-tab-${tabNumber}`).click();
      await expect(page.locator(`#wedding-tab-${tabNumber}`)).toHaveAttribute("aria-selected", "true");
      await waitForSettledPanel(tabNumber);
      tilts.push(await readTilt(tabNumber));
    }

    tilts.forEach((tilt, index) => expect(Math.abs(tilt - expectedTilts[index])).toBeLessThanOrEqual(0.5));
    expect(tilts[0]).not.toBeCloseTo(tilts[1], 1);
    expect(tilts[1]).not.toBeCloseTo(tilts[2], 1);
    expect(tilts[2]).not.toBeCloseTo(tilts[3], 1);
  });

  test("stacks the visual above the schedule below desktop", { tag: ["@single"] }, async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await revealWedding(page);
      const boxes = await page.evaluate(() => {
        const visual = document.querySelector<HTMLElement>(".wedding_visual-column")!.getBoundingClientRect();
        const schedule = document.querySelector<HTMLElement>(".wedding_content")!.getBoundingClientRect();
        return { visualRight: visual.right, scheduleLeft: schedule.left, visualBottom: visual.bottom, scheduleTop: schedule.top };
      });
      if (width >= 992) expect(boxes.scheduleLeft).toBeGreaterThan(boxes.visualRight - 1);
      else expect(boxes.scheduleTop).toBeGreaterThanOrEqual(boxes.visualBottom);
    }
  });

  test("disables autoplay but keeps reduced-motion switching interactive", { tag: ["@single"] }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await revealWedding(page);
    // Autoplay would drive the active tab's progress bar from scaleX(0); sample it over 500ms of wall-clock time (10% of the 5s duration).
    const scales = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const bar = document.querySelector<HTMLElement>('#wedding [data-tabs="item-progress"]')!;
          const readings: number[] = [];
          const started = performance.now();
          const sample = () => {
            readings.push(new DOMMatrix(getComputedStyle(bar).transform).a);
            if (performance.now() - started < 500) setTimeout(sample, 50);
            else resolve(readings);
          };
          sample();
        }),
    );
    expect(scales.length).toBeGreaterThan(4);
    expect(Math.max(...scales)).toBe(0);
    await expect(page.locator("#wedding-tab-1")).toHaveAttribute("aria-selected", "true");
    await page.locator("#wedding-tab-3").click();
    await expect(page.locator("#wedding-tab-3")).toHaveAttribute("aria-selected", "true");
  });

  test("gives the meta column room: locations wrap to two lines and titles never overflow", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    for (const width of [320, 375, 390, 481, 768, 991]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      const rows = await page.locator("#wedding .wedding_row").evaluateAll((items) => items.map((row) => {
        const lines = (element: Element) => element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight);
        const meta = row.querySelector(".wedding_meta")!.getBoundingClientRect();
        const tab = row.querySelector(".wedding_tab")!.getBoundingClientRect();
        const title = row.querySelector(".wedding_tab-title")!;
        const overflow = Array.from(title.children).map((child) => {
          const range = document.createRange();
          range.selectNodeContents(child);
          return range.getBoundingClientRect().right - title.getBoundingClientRect().right;
        });
        return {
          location: Math.round(lines(row.querySelector(".wedding_location")!)),
          time: Math.round(lines(row.querySelector(".wedding_time")!)),
          metaRight: meta.right,
          rowRight: row.getBoundingClientRect().right,
          clear: meta.left - tab.right,
          overflow: Math.max(...overflow),
          align: getComputedStyle(row.querySelector(".wedding_meta")!).textAlign,
        };
      }));
      for (const row of rows) {
        expect(row.location, `${width}px location lines`).toBeLessThanOrEqual(2);
        expect(row.time).toBe(1);
        expect(row.align).toBe("right");
        expect(Math.abs(row.metaRight - row.rowRight)).toBeLessThanOrEqual(1);
        expect(row.clear).toBeGreaterThanOrEqual(0);
        expect(row.overflow, `${width}px title overflow`).toBeLessThanOrEqual(1);
      }
    }
  });
});
