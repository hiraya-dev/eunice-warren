import { expect, test } from "@playwright/test";

test.describe("explore section", () => {
  test("follows stay, renders four notes, and has no filter chips", async ({
    page,
  }) => {
    await page.goto("/");
    const order = await page.evaluate(
      () =>
        document
          .querySelector("#stay")!
          .compareDocumentPosition(document.querySelector("#explore")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(order).toBeTruthy();
    await expect(page.locator("#explore [data-gsap-slider-item]")).toHaveCount(
      4,
    );
    await expect(
      page.locator("#explore [data-gsap-slider-control]"),
    ).toHaveCount(4);
    await expect(page.locator("#explore")).not.toContainText("FILTER");
    await expect(
      page.locator("#explore [data-gsap-slider-init]"),
    ).toHaveAttribute("aria-label", "Field notes");
  });

  test("uses header controls on desktop and moves the track", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(
      page.locator("#explore .explore_controls-header"),
    ).toBeVisible();
    await expect(page.locator("#explore .explore_counter")).toBeHidden();
    const track = page.locator("#explore [data-gsap-slider-list]");
    const initialX = await track.evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).e,
    );
    await page
      .locator(
        "#explore .explore_controls-header [data-gsap-slider-control=next]",
      )
      .click();
    await expect
      .poll(() =>
        track.evaluate(
          (element) => new DOMMatrix(getComputedStyle(element).transform).e,
        ),
      )
      .toBeLessThan(initialX);
  });

  test("shows the mobile counter and reaches the final note", async ({
    page,
  }) => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const counter = page.locator("#explore .explore_counter");
      const controls = page.locator("#explore .explore_controls-footer");
      const next = controls.locator("[data-gsap-slider-control=next]");
      const prev = controls.locator("[data-gsap-slider-control=prev]");
      const readCounter = () =>
        counter.evaluate((element) => {
          const match = element.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
          return { current: Number(match?.[1]), total: Number(match?.[2]) };
        });
      await expect.poll(readCounter).toMatchObject({ current: 1 });
      const total = (await readCounter()).total;
      expect(total).toBe(width === 390 ? 4 : 3);

      let current = 1;
      while (await next.isEnabled()) {
        await next.click();
        current += 1;
        await expect.poll(readCounter).toEqual({ current, total });
        await expect(prev).toBeEnabled();
      }

      expect((await readCounter()).current).toBe(total);
      await expect(next).toBeDisabled();
    }
  });

  test("responds continuously to a pointer drag", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    const track = page.locator("#explore [data-gsap-slider-list]");
    await track.scrollIntoViewIfNeeded();
    const card = page.locator("#explore [data-gsap-slider-item]").first();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const y = box!.y + Math.min(80, box!.height / 2);
    const before = await track.evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).e,
    );
    await page.mouse.move(startX, y);
    await page.mouse.down();
    let previous = before;
    for (let step = 1; step <= 5; step += 1) {
      await page.mouse.move(startX - step * 30, y, { steps: 1 });
      const during = await track.evaluate(
        (element) => new DOMMatrix(getComputedStyle(element).transform).e,
      );
      expect(during).toBeLessThan(previous);
      previous = during;
    }
    await page.mouse.up();
    await expect
      .poll(() =>
        track.evaluate((element) =>
          Math.round(new DOMMatrix(getComputedStyle(element).transform).e),
        ),
      )
      .toBe(-314);
  });

  test("pins card widths and prevents horizontal page overflow", async ({
    page,
  }) => {
    for (const [width, expected] of [
      [1440, 400],
      [390, 290],
      [320, 280],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const cardWidth = await page
        .locator("#explore [data-gsap-slider-item]")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(cardWidth).toBeCloseTo(expected, 0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(768);
  });
});
