import { expect, test } from "@playwright/test";

type MotionSample = {
  navy: { x: number; width: number };
  blue: { x: number; width: number };
};

const waitForStatusWhileWheeling = async (
  page: import("@playwright/test").Page,
  delta: number,
  expected: "normal" | "inverted",
) => {
  const deadline = Date.now() + 3000;
  let statuses: (string | null)[] = [];

  while (Date.now() < deadline) {
    await page.mouse.wheel(0, delta);
    statuses = await page.locator("#ribbons .ribbons_ribbon").evaluateAll((ribbons) =>
      ribbons.map((ribbon) => ribbon.getAttribute("data-marquee-status")),
    );
    if (statuses.every((status) => status === expected)) return;
    await page.waitForTimeout(40);
  }

  expect(statuses, `ribbon status did not become ${expected} while wheeling`).toEqual([
    expected,
    expected,
  ]);
};

const sampleWhileWheeling = async (
  page: import("@playwright/test").Page,
  delta: number,
) => {
  const sampling = page.evaluate(() =>
    new Promise<MotionSample[]>((resolve) => {
      const samples: MotionSample[] = [];
      const started = performance.now();
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        return {
          x: new DOMMatrix(getComputedStyle(element).transform).e,
          width: element.offsetWidth,
        };
      };
      const sample = () => {
        samples.push({
          navy: read(".ribbons_ribbon-navy [data-marquee-collection-target]"),
          blue: read(".ribbons_ribbon-blue [data-marquee-collection-target]"),
        });
        if (performance.now() - started >= 650) resolve(samples);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }),
  );

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await page.mouse.wheel(0, delta);
    if (await Promise.race([sampling.then(() => true), page.waitForTimeout(40).then(() => false)])) break;
  }
  return sampling;
};

const assertDirection = (
  samples: MotionSample[],
  ribbon: keyof MotionSample,
  expectedSign: -1 | 1,
) => {
  const deltas = samples.slice(1).flatMap((sample, index) => {
    const previous = samples[index][ribbon];
    const current = sample[ribbon];
    const delta = current.x - previous.x;
    return delta !== 0 && Math.abs(delta) <= current.width / 4 ? [delta] : [];
  });
  expect(deltas.length, `${ribbon} had too few valid motion samples`).toBeGreaterThanOrEqual(10);

  const matching = deltas.filter((delta) => Math.sign(delta) === expectedSign).length;
  expect(
    matching / deltas.length,
    `${ribbon} moved in the wrong direction for too many samples`,
  ).toBeGreaterThanOrEqual(0.8);
};

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
    // Many wheel/sample round trips; under parallel load each one can take hundreds of ms.
    test.slow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.evaluate(() => {
      const section = document.querySelector<HTMLElement>("#ribbons")!;
      window.scrollTo(0, section.offsetTop - (innerHeight - section.offsetHeight) / 2);
    });
    await page.waitForTimeout(100);

    await waitForStatusWhileWheeling(page, 40, "normal");
    await expect(page.locator(".ribbons_ribbon-navy")).toHaveAttribute("data-marquee-status", "normal");
    await expect(page.locator(".ribbons_ribbon-blue")).toHaveAttribute("data-marquee-status", "normal");
    const downSamples = await sampleWhileWheeling(page, 40);
    assertDirection(downSamples, "navy", -1);
    assertDirection(downSamples, "blue", 1);

    await waitForStatusWhileWheeling(page, -40, "inverted");
    await expect(page.locator(".ribbons_ribbon-navy")).toHaveAttribute("data-marquee-status", "inverted");
    await expect(page.locator(".ribbons_ribbon-blue")).toHaveAttribute("data-marquee-status", "inverted");
    const upSamples = await sampleWhileWheeling(page, -40);
    assertDirection(upSamples, "navy", 1);
    assertDirection(upSamples, "blue", -1);
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
