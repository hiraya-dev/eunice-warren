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
    await expect(page.locator(".invitation_circle")).toHaveCSS("clip-path", "none");
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
