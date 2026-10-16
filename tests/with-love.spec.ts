import { expect, test } from "@playwright/test";

const order = (page: import("@playwright/test").Page) =>
  page.locator("#with-love [data-stacked-cards-list] > [data-note-id]");

test.describe("With love stack", () => {
  test("renders notes and cycles the top card with Shuffle", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#with-love")).toBeVisible();
    await expect(order(page)).toHaveCount(6);
    const first = await order(page).first().getAttribute("data-note-id");
    await page.locator('[data-stacked-cards-control="next"]').click();
    await expect.poll(() => order(page).first().getAttribute("data-note-id")).not.toBe(first);
    await expect(order(page).last()).toHaveAttribute("data-note-id", first!);
  });

  test("moves the top card after a large drag and ignores a small drag", async ({ page }) => {
    await page.goto("/");
    const top = order(page).first();
    const first = await top.getAttribute("data-note-id");
    await top.scrollIntoViewIfNeeded();
    const box = await top.boundingBox();
    expect(box).not.toBeNull();
    const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + box!.width * 0.06, point.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => order(page).first().getAttribute("data-note-id")).toBe(first);
    // Osmo hands control to the second card until the snap-back finishes.
    await expect.poll(() => top.evaluate((item) => (item as HTMLElement).style.pointerEvents)).toBe("auto");

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + box!.width * 0.6, point.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => order(page).last().getAttribute("data-note-id")).toBe(first);
  });

  test("uses the designed lettering colour and cycles with reduced motion", async ({ page }) => {
    await page.goto("/");
    const alpha = await page.locator(".with-love_word-with").evaluate((element) => {
      const color = getComputedStyle(element).color;
      return color.match(/\/\s*([\d.]+)\)?$/)?.[1] ?? color.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)?.[1];
    });
    expect(Number(alpha)).toBeCloseTo(0.5);
  });

  test("Shuffle still cycles when reduced motion is requested", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    const first = await order(page).first().getAttribute("data-note-id");
    await page.locator('[data-stacked-cards-control="next"]').click();
    await expect.poll(() => order(page).first().getAttribute("data-note-id")).not.toBe(first);
    await context.close();
  });
});
