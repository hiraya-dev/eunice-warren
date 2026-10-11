import { expect, test } from "@playwright/test";

test.describe("Paper footer", () => {
  test("renders the sign-off, date, decorative images, and top link", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/404");

    await expect(page.locator(".footer_signoff")).toContainText("island hopping");
    await expect(page.locator(".footer_signoff")).toContainText("see you in Boracay");
    await expect(page.locator(".footer_date")).toHaveText("01.14.27");
    await expect(page.locator(".footer_date")).toHaveCSS("font-size", "336px");
    await expect(page.locator(".footer_top-link")).toHaveCSS("font-size", "16px");
    const footer = page.locator("[data-footer-parallax-inner]");
    const contentLeft = await footer.evaluate((element) => {
      const styles = getComputedStyle(element);
      return element.getBoundingClientRect().left + Number.parseFloat(styles.paddingLeft);
    });
    const fromLeft = await page.locator(".footer_signoff > span:first-child").evaluate((element) => element.getBoundingClientRect().left);
    expect(Math.abs(fromLeft - contentLeft)).toBeLessThanOrEqual(4);
    const images = await page.locator(".footer_stamp img, .footer_cluster img").all();
    expect(images).toHaveLength(4);
    for (const image of images) await expect(image).toHaveAttribute("alt", "");
    await expect(page.getByRole("link", { name: "Back to top" })).toHaveAttribute("href", "#");
  });

  test("keeps the date inside the viewport at mobile widths", async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/404");

      const date = page.locator(".footer_date");
      const metrics = await date.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { fontSize: getComputedStyle(element).fontSize, right: rect.right };
      });

      if (viewport.width === 390) expect(Number.parseFloat(metrics.fontSize)).toBeCloseTo(119, 0);
      expect(metrics.right).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    }
  });

  test("moves the footer continuously into place while scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/example-components");
    const footerTop = await page.locator("[data-footer-parallax]").evaluate((element) => element.getBoundingClientRect().top + scrollY);
    await page.mouse.wheel(0, Math.max(0, footerTop - 900));

    const samples: Array<{ y: number; opacity: number }> = [];
    for (let index = 0; index < 24; index += 1) {
      samples.push(await page.locator("[data-footer-parallax-inner]").evaluate((inner) => {
        const transform = getComputedStyle(inner).transform;
        const match = transform.match(/^matrix\([^,]+, [^,]+, [^,]+, [^,]+, [^,]+, ([^)]+)\)$/);
        return {
          y: match ? Number(match[1]) : 0,
          opacity: Number(getComputedStyle(document.querySelector("[data-footer-parallax-dark]")!).opacity),
        };
      }));
      await page.mouse.wheel(0, 80);
      await page.waitForTimeout(20);
    }

    const footerHeight = await page.locator("[data-footer-parallax-inner]").evaluate((element) => element.getBoundingClientRect().height);
    expect(samples[0].y).toBeLessThan(-footerHeight * 0.1);
    expect(samples.at(-1)?.y).toBeGreaterThan(-footerHeight * 0.02);
    expect(samples.at(-1)?.opacity).toBeLessThan(samples[0].opacity);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].y).toBeGreaterThanOrEqual(samples[index - 1].y - 3);
    }
  });

  test("does not animate the footer under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/example-components");
    await page.mouse.wheel(0, 1200);

    await expect(page.locator("[data-footer-parallax-inner]")).toHaveCSS("transform", "none");
    await expect(page.locator("[data-footer-parallax-dark]")).toHaveCSS("opacity", "0");
  });
});
