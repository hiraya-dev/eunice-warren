import { expect, test, type Page } from "@playwright/test";

const fixture = `
  <div style="height: 700px" aria-hidden="true"></div>
  <div id="parallax-default" data-parallax="trigger" style="height: 200px; background: red"></div>
  <div style="height: 700px" aria-hidden="true"></div>
  <div id="parallax-target-trigger" data-parallax="trigger" style="height: 200px; background: red">
    <div id="parallax-target" data-parallax="target" style="height: 100%; background: blue"></div>
  </div>
  <div style="height: 700px" aria-hidden="true"></div>
  <div id="parallax-horizontal" data-parallax="trigger" data-parallax-direction="horizontal" style="height: 200px; background: red"></div>
  <div style="height: 700px" aria-hidden="true"></div>
  <div id="parallax-disabled" data-parallax="trigger" data-parallax-disable="mobileLandscape" style="height: 200px; background: red"></div>
  <div style="height: 1200px" aria-hidden="true"></div>
`;

async function injectFixture(page: Page) {
  await page.route("**/example-components", async (route) => {
    if (route.request().resourceType() !== "document") {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: body.replace("</main>", `${fixture}</main>`),
    });
  });
}

async function scrollToFixture(page: Page, id: string) {
  const top = await page
    .locator(`#${id}`)
    .evaluate(
      (element: HTMLElement) => element.getBoundingClientRect().top + scrollY,
    );
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  await page.mouse.wheel(0, Math.max(0, top - 300) * devicePixelRatio);
  await page.waitForTimeout(250);
}

function transformAxis(element: HTMLElement, axis: string) {
  const transform = getComputedStyle(element).transform;
  if (transform === "none") return 0;
  const matrix = new DOMMatrix(transform);
  return axis === "x" ? matrix.m41 : matrix.m42;
}

test.describe("global parallax", () => {
  test("scrubs a default trigger continuously while scrolling", async ({
    page,
  }) => {
    await injectFixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/example-components");
    await scrollToFixture(page, "parallax-default");

    const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      samples.push(
        await page.locator("#parallax-default").evaluate(transformAxis, "y"),
      );
      await page.mouse.wheel(0, 60 * devicePixelRatio);
      await page.waitForTimeout(20);
    }

    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(10);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeLessThanOrEqual(samples[index - 1] + 3);
    }
  });

  test("animates a target child while leaving its trigger untransformed", async ({
    page,
  }) => {
    await injectFixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/example-components");
    await scrollToFixture(page, "parallax-target-trigger");
    await page.mouse.wheel(
      0,
      240 * (await page.evaluate(() => window.devicePixelRatio)),
    );
    await page.waitForTimeout(100);

    await expect(page.locator("#parallax-target-trigger")).toHaveCSS(
      "transform",
      "none",
    );
    await expect
      .poll(() => page.locator("#parallax-target").evaluate(transformAxis, "y"))
      .not.toBe(0);
  });

  test("uses x translation for horizontal parallax", async ({ page }) => {
    await injectFixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/example-components");
    await scrollToFixture(page, "parallax-horizontal");
    await page.mouse.wheel(
      0,
      240 * (await page.evaluate(() => window.devicePixelRatio)),
    );
    await expect
      .poll(
        () =>
          page
            .locator("#parallax-horizontal")
            .evaluate((element: HTMLElement) => {
              const value = getComputedStyle(element).transform;
              const matrix =
                value === "none" ? new DOMMatrix() : new DOMMatrix(value);
              return Math.abs(matrix.m41) > 10 && matrix.m42 === 0;
            }),
        { timeout: 5000 },
      )
      .toBe(true);
  });

  test("disables mobileLandscape parallax at 390px but animates at 1440px", async ({
    page,
  }) => {
    await injectFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/example-components");
    await scrollToFixture(page, "parallax-disabled");
    await page.mouse.wheel(
      0,
      240 * (await page.evaluate(() => window.devicePixelRatio)),
    );
    await page.waitForTimeout(100);
    await expect(page.locator("#parallax-disabled")).toHaveCSS(
      "transform",
      "none",
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await scrollToFixture(page, "parallax-disabled");
    await page.mouse.wheel(
      0,
      240 * (await page.evaluate(() => window.devicePixelRatio)),
    );
    await expect
      .poll(() =>
        page.locator("#parallax-disabled").evaluate(transformAxis, "y"),
      )
      .not.toBe(0);
  });

  test("does not transform triggers when reduced motion is enabled", async ({
    page,
  }) => {
    await injectFixture(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/example-components");
    await scrollToFixture(page, "parallax-default");
    await page.mouse.wheel(
      0,
      500 * (await page.evaluate(() => window.devicePixelRatio)),
    );
    await page.waitForTimeout(100);

    await expect(page.locator("#parallax-default")).toHaveCSS(
      "transform",
      "none",
    );
  });
});
