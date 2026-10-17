import { expect, test } from "@playwright/test";

test.describe("pre-wedding section", () => {
  test("renders in the home page sequence with the event details", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#pre-wedding");

    await expect(section).toBeVisible();
    await expect(section.locator("h2")).toHaveText(/Before\s+we fly/);
    for (const copy of ["Malihan", "San Celestino", "Lipa City, Batangas", "Sat, Jan 9, 2027", "Lunch", "Till late"]) {
      await expect(section).toContainText(copy);
    }
    await section.locator(".prewedding_cta").scrollIntoViewIfNeeded();
    await expect(section.locator("a").filter({ hasText: "Get directions" })).toBeVisible();
    await expect(section.locator("a").filter({ hasText: "Add Jan 9 to your calendar" })).toBeVisible();
    await expect(section.locator("button, [role=button]").filter({ hasText: /rsvp/i })).toHaveCount(0);
    await expect(section).not.toContainText(/[\u2013\u2014]/);
    const order = await page.evaluate(() => {
      const wedding = document.querySelector("#wedding")!;
      const preWedding = document.querySelector("#pre-wedding")!;
      const entourage = document.querySelector("#entourage")!;
      return {
        weddingBeforePreWedding: Boolean(wedding.compareDocumentPosition(preWedding) & Node.DOCUMENT_POSITION_FOLLOWING),
        preWeddingBeforeEntourage: Boolean(preWedding.compareDocumentPosition(entourage) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(order).toEqual({ weddingBeforePreWedding: true, preWeddingBeforeEntourage: true });
  });

  for (const width of [390, 320]) {
    test(`does not overflow horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test("stacks the postcard and details on mobile and separates them on desktop", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const boxes = await page.evaluate(() => {
        const postcard = document.querySelector<HTMLElement>(".prewedding_postcard")!.getBoundingClientRect();
        const details = document.querySelector<HTMLElement>(".prewedding_details")!.getBoundingClientRect();
        return { postcardRight: postcard.right, postcardBottom: postcard.bottom, detailsLeft: details.left, detailsTop: details.top };
      });
      if (width >= 992) expect(boxes.detailsLeft).toBeGreaterThan(boxes.postcardRight - 1);
      else expect(boxes.detailsTop).toBeGreaterThanOrEqual(boxes.postcardBottom);
    }
  });
});
