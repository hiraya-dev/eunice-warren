import { expect, test } from "@playwright/test";

const sampleWhile = async (page: import("@playwright/test").Page, delta: number) => {
  const values: { navy: number; blue: number }[] = [];
  for (let index = 0; index < 20; index += 1) {
    await page.mouse.wheel(0, delta);
    values.push(
      await page.evaluate(() => {
        const readX = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)!;
          return new DOMMatrix(getComputedStyle(element).transform).e;
        };
        return {
          navy: readX(".ribbons_ribbon-navy [data-marquee-collection-target]"),
          blue: readX(".ribbons_ribbon-blue [data-marquee-collection-target]"),
        };
      }),
    );
    await page.waitForTimeout(30);
  }
  return values;
};

const movement = (values: number[]) => Math.sign(values.at(-1)! - values[0]);

const localCoverage = (element: Element) => {
  const ribbon = element as HTMLElement;
  const scroll = ribbon.querySelector<HTMLElement>("[data-marquee-scroll-target]")!;
  const scrollTransform = new DOMMatrix(getComputedStyle(scroll).transform).e;
  const collections = Array.from(
    ribbon.querySelectorAll<HTMLElement>("[data-marquee-collection-target]"),
  );
  const ranges = collections.map((collection) => {
    const collectionTransform = new DOMMatrix(getComputedStyle(collection).transform).e;
    const left = scroll.offsetLeft + scrollTransform + collection.offsetLeft + collectionTransform;
    return [left, left + collection.offsetWidth] as const;
  }).sort(([leftA], [leftB]) => leftA - leftB);
  const hasNoInteriorGap = ranges.every(
    // offsetLeft/offsetWidth round to whole pixels while transforms do not.
    ([left], index) => index === 0 || left <= ranges[index - 1][1] + 2,
  );
  return ranges[0][0] <= 0 &&
    ranges.at(-1)![1] >= ribbon.clientWidth &&
    hasNoInteriorGap;
};

test.describe("ribbon marquee", () => {
  test("follows explore and hides duplicated collections from assistive tech", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#ribbons")).toHaveCount(1);
    await expect(page.locator("#ribbons .ribbons_ribbon")).toHaveCount(2);
    expect(
      await page.evaluate(
        () =>
          Boolean(
            document.querySelector("#explore")!.compareDocumentPosition(document.querySelector("#ribbons")!) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
      ),
    ).toBeTruthy();
    await expect(page.locator("#ribbons [data-marquee-collection-target]").nth(1)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(page.locator("#ribbons [data-marquee-collection-target]").nth(1)).toHaveAttribute("inert", "");
  });

  test("moves in each base direction and reverses while scrolling up", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.evaluate(() => {
      const section = document.querySelector<HTMLElement>("#ribbons")!;
      window.scrollTo(0, section.offsetTop - (innerHeight - section.offsetHeight) / 2);
    });
    await page.waitForTimeout(100);

    const down = await sampleWhile(page, 40);
    expect(movement(down.map((value) => value.navy))).toBe(-1);
    expect(movement(down.map((value) => value.blue))).toBe(1);
    await expect(page.locator(".ribbons_ribbon-navy")).toHaveAttribute("data-marquee-status", "normal");
    await expect(page.locator(".ribbons_ribbon-blue")).toHaveAttribute("data-marquee-status", "normal");

    const up = await sampleWhile(page, -40);
    expect(movement(up.map((value) => value.navy))).toBe(1);
    expect(movement(up.map((value) => value.blue))).toBe(-1);
    await expect(page.locator(".ribbons_ribbon-navy")).toHaveAttribute("data-marquee-status", "inverted");
    await expect(page.locator(".ribbons_ribbon-blue")).toHaveAttribute("data-marquee-status", "inverted");
  });

  test("stays static, has no JS clones, and remains filled with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("#ribbons [data-marquee-collection-target]")).toHaveCount(4);
    expect(await page.locator(".ribbons_ribbon-navy").evaluate(localCoverage)).toBeTruthy();
    expect(await page.locator(".ribbons_ribbon-blue").evaluate(localCoverage)).toBeTruthy();
    const initial = await page.locator(".ribbons_ribbon-navy [data-marquee-collection-target]").first().evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).e,
    );
    await page.waitForTimeout(1000);
    const final = await page.locator(".ribbons_ribbon-navy [data-marquee-collection-target]").first().evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).e,
    );
    expect(final).toBe(initial);
  });

  test("keeps seams covered at every supported width", async ({ page }) => {
    for (const width of [1920, 1440, 900, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const ribbonLocators = page.locator("#ribbons .ribbons_ribbon");
      const samples: boolean[] = [];
      const started = Date.now();
      while (Date.now() - started < 2000) {
        samples.push(
          ...(await Promise.all(
            [0, 1].map((index) => ribbonLocators.nth(index).evaluate(localCoverage)),
          )),
        );
        await page.waitForTimeout(100);
      }
      expect(samples.every(Boolean), `seam gap at ${width}px`).toBeTruthy();
    }
  });

  test("matches responsive type, rotation, and vertical geometry", async ({ page }) => {
    for (const [width, fontSize, navyRotation, blueRotation] of [
      [1440, 96, 3, -3],
      [768, 48, 4, -4],
      [900, 57.43, 3.81, -3.81],
      [1100, 71.71, 3.48, -3.48],
      [390, 48, 4, -4],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const section = page.locator("#ribbons");
      const sectionBox = await section.boundingBox();
      expect(sectionBox).not.toBeNull();
      for (const [selector, rotation] of [[".ribbons_ribbon-navy", navyRotation], [".ribbons_ribbon-blue", blueRotation]] as const) {
        const ribbon = page.locator(`#ribbons ${selector}`);
        const actualFontSize = await ribbon.locator(".ribbons_word").first().evaluate(
          (element) => parseFloat(getComputedStyle(element).fontSize),
        );
        expect(Math.abs(actualFontSize - fontSize)).toBeLessThan(0.5);
        const actualRotation = await ribbon.evaluate((element) => parseFloat(getComputedStyle(element).rotate));
        expect(actualRotation).toBeCloseTo(rotation, 1);
        const box = await ribbon.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(sectionBox!.y - 2);
        expect(box!.y + box!.height).toBeLessThanOrEqual(sectionBox!.y + sectionBox!.height + 2);
      }
      const zIndexes = await page.locator("#ribbons .ribbons_ribbon").evaluateAll((ribbons) =>
        ribbons.map((ribbon) => Number.parseInt(getComputedStyle(ribbon).zIndex, 10) || 0),
      );
      expect(zIndexes[0]).toBeGreaterThan(zIndexes[1]);
    }
  });
});
