import { expect, test } from "@playwright/test";

test.describe("entourage section", () => {
  test("follows wedding and uses the desktop programme layout", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const order = await page.evaluate(() => {
      const wedding = document.querySelector("#wedding")!;
      const entourage = document.querySelector("#entourage")!;
      return wedding.compareDocumentPosition(entourage) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();

    const positions = await page.evaluate(() => {
      const boxes = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).map((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top, left: box.left, width: box.width };
      });
      return {
        principal: boxes(".entourage_principal-sponsors .entourage_role"),
        secondary: boxes(".entourage_secondary-sponsors .entourage_role"),
        honour: boxes(".entourage_bridal-party .entourage_row:first-child .entourage_role"),
      };
    });
    expect(positions.principal[0].top).toBe(positions.principal[1].top);
    expect(positions.secondary).toHaveLength(3);
    expect(positions.secondary[1].left).toBeGreaterThan(positions.secondary[0].left);
    expect(positions.secondary[2].left).toBeGreaterThan(positions.secondary[1].left);
    expect(positions.honour).toHaveLength(3);
    expect(positions.honour[0].top).toBe(positions.honour[1].top);
    expect(positions.honour[1].top).toBe(positions.honour[2].top);

    const heading = await page.locator("#entourage h2").evaluate((element) => {
      const style = getComputedStyle(element);
      const section = element.closest("section")!;
      return {
        height: element.getBoundingClientRect().height,
        lineHeight: parseFloat(style.lineHeight),
        fontSize: style.fontSize,
        headingWidth: element.scrollWidth,
        sectionWidth: section.clientWidth,
      };
    });
    expect(heading.height).toBeLessThan(heading.lineHeight * 2.5);
    expect(heading.headingWidth).toBeLessThanOrEqual(heading.sectionWidth);
    expect(heading.fontSize).toBe("120px");
  });

  test("matches the mobile programme layout", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const positions = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return {
        ninong: box(".entourage_principal-sponsors .entourage_role:nth-child(1)"),
        ninang: box(".entourage_principal-sponsors .entourage_role:nth-child(2)"),
        candle: box(".entourage_secondary-sponsors .entourage_role:nth-child(1)"),
        veil: box(".entourage_secondary-sponsors .entourage_role:nth-child(2)"),
        cord: box(".entourage_secondary-sponsors .entourage_role:nth-child(3)"),
      };
    });
    expect(positions.ninang.top).toBeGreaterThan(positions.ninong.bottom);
    expect(positions.cord.top).toBeGreaterThan(positions.candle.bottom);
    expect(positions.cord.left + positions.cord.width / 2).toBeCloseTo(195, 0);
    expect(positions.veil.left).toBeGreaterThan(positions.candle.left);
  });

  test("keeps the heading to two lines and inside the section below desktop", async ({ page }) => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: width === 320 ? 800 : 844 });
      await page.goto("/");
      const dimensions = await page.locator("#entourage").evaluate((section) => {
        const heading = section.querySelector("h2")!;
        const style = getComputedStyle(heading);
        return {
          height: heading.getBoundingClientRect().height,
          lineHeight: parseFloat(style.lineHeight),
          headingWidth: heading.scrollWidth,
          sectionWidth: section.clientWidth,
        };
      });
      expect(dimensions.height).toBeLessThan(dimensions.lineHeight * 2.5);
      expect(dimensions.headingWidth).toBeLessThanOrEqual(dimensions.sectionWidth);
    }
  });

  test("fades groups in on scroll and stays visible for reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect.poll(() => page.locator(".entourage_bridal-party [data-fade-in-item]").last().evaluate((item) => Number.parseFloat(getComputedStyle(item).opacity))).toBeLessThan(1);

    const blocks = page.locator("#entourage .entourage_block");
    for (let index = 0; index < await blocks.count(); index += 1) {
      const block = blocks.nth(index);
      const items = block.locator("[data-fade-in-item]");
      const itemCount = await items.count();
      await block.scrollIntoViewIfNeeded();
      await expect.poll(() => items.evaluateAll((elements) => elements.map((item) => getComputedStyle(item).opacity))).toEqual(Array(itemCount).fill("1"));
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const itemCount = await page.locator("#entourage [data-fade-in-item]").count();
    await expect.poll(() => page.locator("#entourage [data-fade-in-item]").evaluateAll((items) => items.map((item) => getComputedStyle(item).opacity))).toEqual(Array(itemCount).fill("1"));
  });
});
