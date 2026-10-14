import { expect, test, type Page } from "@playwright/test";

test.describe("stay section", () => {
  const waitForFrame = async (page: Page) => {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };

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

  test("scrubs the pinned desktop timeline and reverses its step states", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const steps = page.locator("#stay [data-step-timeline-item]");
    expect(await steps.evaluateAll((items) => items.map((item) => item.getAttribute("data-status")))).toEqual(["inactive", "inactive", "inactive"]);

    const start = await page.locator("#stay .stay_directions").evaluate((directions) => {
      const box = directions.getBoundingClientRect();
      return box.top + window.scrollY + box.height / 2 - window.innerHeight / 2;
    });
    const positions: Array<{ top: number; fill: number; line: number; fillCrossAxis: number; trackCrossAxis: number }> = [];
    for (const offset of [120, 420, 720]) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), start + offset);
      await waitForFrame(page);
      positions.push(await page.locator("#stay .stay_directions").evaluate((directions) => ({
        top: directions.getBoundingClientRect().top,
        fill: directions.querySelector<HTMLElement>("[data-step-timeline-fill]")!.getBoundingClientRect().width,
        line: directions.querySelector<HTMLElement>("[data-step-timeline-line]")!.getBoundingClientRect().width,
        fillCrossAxis: directions.querySelector<HTMLElement>("[data-step-timeline-fill]")!.getBoundingClientRect().height,
        trackCrossAxis: directions.querySelector<HTMLElement>("[data-step-timeline-fill-track]")!.getBoundingClientRect().height,
      })));
    }

    expect(Math.max(...positions.map((position) => position.top)) - Math.min(...positions.map((position) => position.top))).toBeLessThan(3);
    expect(positions[1].fill).toBeGreaterThan(0);
    expect(positions[1].fill).toBeLessThan(positions[1].line);
    expect(positions[1].fillCrossAxis).toBeGreaterThan(0);
    expect(positions[1].trackCrossAxis).toBeGreaterThan(0);
    const midStates = await steps.evaluateAll((items) => items.map((item) => item.getAttribute("data-status")));
    expect(midStates[0]).toBe("active");
    expect(midStates[2]).toBe("inactive");

    await page.evaluate(() => window.scrollTo(0, document.querySelector("#stay")!.getBoundingClientRect().bottom + window.scrollY + window.innerHeight));
    await waitForFrame(page);
    expect(await steps.evaluateAll((items) => items.map((item) => item.getAttribute("data-status")))).toEqual(["active", "active", "active"]);

    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), start + 120);
    await waitForFrame(page);
    await expect(steps.nth(2)).toHaveAttribute("data-status", "inactive");
  });

  test("activates mobile steps as the vertical fill reaches them", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const line = page.locator("#stay [data-step-timeline-line]");
    const lineTop = await line.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);

    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), lineTop - 421);
    await waitForFrame(page);
    await expect(page.locator("#stay [data-step-timeline-item]").first()).toHaveAttribute("data-status", "active");

    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), lineTop - 180);
    await waitForFrame(page);
    const middleStates = await page.locator("#stay [data-step-timeline-item]").evaluateAll((items) => items.map((item) => item.getAttribute("data-status")));
    expect(middleStates[0]).toBe("active");
    expect(middleStates[2]).toBe("inactive");
    const mobileLineSizes = await page.locator("#stay").evaluate((stay) => ({
      fillCrossAxis: stay.querySelector<HTMLElement>("[data-step-timeline-fill]")!.getBoundingClientRect().width,
      trackCrossAxis: stay.querySelector<HTMLElement>("[data-step-timeline-fill-track]")!.getBoundingClientRect().width,
    }));
    expect(mobileLineSizes.fillCrossAxis).toBeGreaterThan(0);
    expect(mobileLineSizes.trackCrossAxis).toBeGreaterThan(0);

    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), lineTop + 250);
    await waitForFrame(page);
    await expect(page.locator("#stay [data-step-timeline-item]").last()).toHaveAttribute("data-status", "active");
  });

  test("shows the complete timeline without a pin when reduced motion is requested", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await expect(page.locator("#stay [data-step-timeline-item]")).toHaveCount(3);
    expect(await page.locator("#stay [data-step-timeline-item]").evaluateAll((items) => items.map((item) => item.getAttribute("data-status")))).toEqual(["active", "active", "active"]);
    const reducedWidths = await page.locator("#stay").evaluate((stay) => ({
      fill: stay.querySelector<HTMLElement>("[data-step-timeline-fill]")!.getBoundingClientRect().width,
      line: stay.querySelector<HTMLElement>("[data-step-timeline-line]")!.getBoundingClientRect().width,
    }));
    expect(reducedWidths.fill).toBeCloseTo(reducedWidths.line, 0);
    expect(await page.locator("#stay .stay_directions").evaluate((directions) => directions.parentElement?.classList.contains("pin-spacer"))).toBeFalsy();
  });
});
