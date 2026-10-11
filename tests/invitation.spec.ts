import { expect, test } from "@playwright/test";

test.describe("invitation section", () => {
  test("follows the hero", async ({ page }) => {
    await page.goto("/");
    expect(await page.locator("#hero").evaluate((element) => element.compareDocumentPosition(document.querySelector("#invitation")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  });

  test("uses the two-column layout only at desktop width", async ({ page }) => {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const positions = await page.evaluate(() => {
        const title = document.querySelector<HTMLElement>(".invitation_title")!.getBoundingClientRect();
        const note = document.querySelector<HTMLElement>(".invitation_note")!.getBoundingClientRect();
        return { titleRight: title.right, noteLeft: note.left, titleBottom: title.bottom, noteTop: note.top };
      });
      if (width >= 992) {
        expect(positions.noteLeft).toBeGreaterThan(positions.titleRight);
      } else {
        expect(positions.noteTop).toBeGreaterThanOrEqual(positions.titleBottom);
      }
    }
  });

  test("keeps the heading upright and narrow layouts inside the viewport", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.locator(".invitation_title")).toHaveCSS("font-style", "normal");
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test("fits the ticket route and stub labels at narrow widths", async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const metrics = await page.evaluate(() => {
        // offsetTop is layout position, unaffected by the ticket's -1.5deg rotation.
        const airports = [...document.querySelectorAll<HTMLElement>(".invitation_airport")].map((element) => element.offsetTop);
        const stubLabel = document.querySelector<HTMLElement>(".invitation_ticket-stub span")!.getBoundingClientRect();
        return { airportTopDelta: Math.abs(airports[0] - airports[1]), stubLabelHeight: stubLabel.height };
      });
      expect(metrics.airportTopDelta).toBeLessThanOrEqual(2);
      expect(metrics.stubLabelHeight).toBeLessThanOrEqual(20);
    }
  });

  test("uses the desktop calendar scale", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator(".invitation_date-current strong")).toHaveCSS("font-size", "120px");
  });

  test("shows the complete note and circle with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    for (const word of await page.locator(".invitation_word").all()) {
      await expect(word).toHaveCSS("color", "rgb(31, 47, 92)");
    }
    await expect(page.locator(".invitation_circle")).toBeVisible();
    const circle = await page.locator(".invitation_circle").evaluate((svg) => {
      const path = svg.querySelector<SVGPathElement>("[data-draw-scroll-path]")!;
      const style = getComputedStyle(path);
      const dashArray = style.strokeDasharray;
      const totalLength = path.getTotalLength();
      const dashLength = parseFloat(dashArray.split(/[ ,]+/)[0]);
      return {
        dashArray,
        dashOffset: style.strokeDashoffset,
        drawnFraction: Number.isFinite(dashLength) ? dashLength / totalLength : 1,
      };
    });
    expect(circle.dashArray === "none" || circle.drawnFraction >= 0.99).toBeTruthy();
    if (circle.dashArray !== "none") {
      expect(circle.drawnFraction).toBeGreaterThanOrEqual(0.99);
      expect(parseFloat(circle.dashOffset)).toBeCloseTo(0, 1);
    }
  });

  test("draws the circle forward and backward with scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto("/");

    const fraction = () => page.locator("[data-draw-scroll-path]").evaluate((element) => {
      const path = element as SVGPathElement;
      const style = getComputedStyle(path);
      if (style.strokeDasharray === "none") return 1;
      const dashLength = parseFloat(style.strokeDasharray.split(/[ ,]+/)[0]);
      return dashLength / path.getTotalLength();
    });

    // Start with the calendar just below the viewport so the samples span the whole draw
    // on every layout (the one-column page is much taller than 36 wheel steps).
    await page.evaluate(() => {
      const top = document.querySelector(".invitation_calendar")!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - window.innerHeight));
    });
    await page.waitForTimeout(300);

    const forward: number[] = [];
    for (let index = 0; index < 36; index += 1) {
      forward.push(await fraction());
      await page.mouse.wheel(0, 60);
      await page.waitForTimeout(20);
    }
    expect(forward[0]).toBeLessThan(0.2);
    expect(Math.max(...forward)).toBeGreaterThan(0.8);

    const backward: number[] = [];
    for (let index = 0; index < 36; index += 1) {
      backward.push(await fraction());
      await page.mouse.wheel(0, -60);
      await page.waitForTimeout(20);
    }
    expect(backward[0]).toBeGreaterThan(0.8);
    expect(backward[backward.length - 1]).toBeLessThan(0.2);
  });

  test("reveals note words progressively during scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto("/");
    const note = page.locator(".invitation_note");
    await note.scrollIntoViewIfNeeded();
    const samples: string[][] = [];
    for (let index = 0; index < 12; index += 1) {
      samples.push(await page.locator(".invitation_word").evaluateAll((words) => words.map((word) => getComputedStyle(word).color)));
      await page.mouse.wheel(0, 45);
      await page.waitForTimeout(20);
    }
    expect(new Set(samples.flat()).size).toBeGreaterThan(1);
  });
});
