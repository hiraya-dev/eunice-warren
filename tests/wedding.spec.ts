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

  test("marks the wedding heading for the shared fade-in", async ({ page }) => {
    const header = page.locator(".wedding_header");
    await expect(header).toHaveAttribute("data-fade-in", "");
    await expect(header.locator("[data-fade-in-item]")).toHaveCount(1);
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

  test("swaps the complete polaroid at each tab's resting tilt", async ({ page }) => {
    await page.locator("#wedding").scrollIntoViewIfNeeded();
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

test.describe("wedding dress card", () => {
  test("keeps the paper texture continuous through the torn edge", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const dress = page.locator(".wedding_dress");
      await dress.scrollIntoViewIfNeeded();
      const box = await dress.boundingBox();
      if (!box) throw new Error("Dress card is not visible");
      const screenshot = (await page.screenshot({
        clip: { x: box.x, y: box.y, width: box.width, height: box.height + 24 },
      })).toString("base64");
      const luminance = await page.evaluate(async ({ screenshot }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${screenshot}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D context unavailable");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const columns = Array.from({ length: Math.round(canvas.width * 0.4) }, (_, index) => Math.round(canvas.width * 0.55) + index);
        const readLuminance = (x: number, y: number) => {
          const offset = (y * canvas.width + x) * 4;
          return 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
        };
        const boundaries = columns.map((x) => {
          for (let y = canvas.height - 1; y >= 0; y -= 1) {
            if (readLuminance(x, y) > 228) return y;
          }
          throw new Error("Could not find the paper edge");
        });
        const boundary = [...boundaries].sort((a, b) => a - b)[Math.floor(boundaries.length / 2)];
        const mean = (start: number, end: number) => {
          let total = 0;
          let count = 0;
          for (let y = start; y < end; y += 1) {
            for (const x of columns) {
              total += readLuminance(x, y);
              count += 1;
            }
          }
          return total / count;
        };
        // Sample each column just inside its own edge; the tear is jagged, so a shared row would hit background.
        const edgeSamples = columns.flatMap((x, index) => [4, 5, 6].map((inset) => readLuminance(x, boundaries[index] - inset)));
        const edge = edgeSamples.reduce((total, value) => total + value, 0) / edgeSamples.length;
        return { body: mean(boundary - 36, boundary - 30), edge };
      }, { screenshot });

      expect(Math.abs(luminance.body - luminance.edge), `texture discontinuity at ${width}px`).toBeLessThan(3);
      await expect(page.locator(".wedding_torn")).toHaveCount(0);
    }
  });
});
