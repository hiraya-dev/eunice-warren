import { expect, test } from "@playwright/test";

test.describe("Paper footer", () => {
  test("renders the sign-off, date, decorative images, and top link", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/404");

    await expect(page.locator(".footer_signoff")).toBeVisible();
    expect((await page.locator(".footer_signoff").textContent())?.trim()).toBeTruthy();
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
    await expect(page.getByRole("link", { name: "Back to top" })).toHaveAttribute("href", "#hero");
  });

  test("keeps the date inside the viewport at mobile widths", { tag: ["@single"] }, async ({ page }) => {
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

  test("moves the footer continuously into place while scrolling", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/example-components");
    const footerTop = await page.locator("[data-footer-parallax]").evaluate((element) => element.getBoundingClientRect().top + scrollY);
    const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    await page.mouse.wheel(0, Math.max(0, footerTop - 900) * devicePixelRatio);

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
      await page.mouse.wheel(0, 80 * devicePixelRatio);
      await page.waitForTimeout(20);
    }

    const footerHeight = await page.locator("[data-footer-parallax-inner]").evaluate((element) => element.getBoundingClientRect().height);
    await expect.poll(() => page.locator("[data-footer-parallax-inner]").evaluate((inner) => {
      const transform = getComputedStyle(inner).transform;
      const match = transform.match(/^matrix\([^,]+, [^,]+, [^,]+, [^,]+, [^,]+, ([^)]+)\)$/);
      return match ? Number(match[1]) : 0;
    }), { timeout: 3000 }).toBeGreaterThan(-footerHeight * 0.02);
    const settled = await page.locator("[data-footer-parallax-inner]").evaluate((inner) => {
      const transform = getComputedStyle(inner).transform;
      const match = transform.match(/^matrix\([^,]+, [^,]+, [^,]+, [^,]+, [^,]+, ([^)]+)\)$/);
      return {
        y: match ? Number(match[1]) : 0,
        opacity: Number(getComputedStyle(document.querySelector("[data-footer-parallax-dark]")!).opacity),
      };
    });
    expect(samples[0].y).toBeLessThan(-footerHeight * 0.1);
    expect(settled.y).toBeGreaterThan(-footerHeight * 0.02);
    expect(settled.opacity).toBeLessThan(samples[0].opacity);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].y).toBeGreaterThanOrEqual(samples[index - 1].y - 3);
    }
  });

  test("does not animate the footer under reduced motion", { tag: ["@single"] }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/example-components");
    await page.mouse.wheel(0, 1200);

    await expect(page.locator("[data-footer-parallax-inner]")).toHaveCSS("transform", "none");
    await expect(page.locator("[data-footer-parallax-dark]")).toHaveCSS("opacity", "0");
  });

  test("stacks the contacts on three left-aligned lines on mobile and keeps one line on desktop", { tag: ["@single"] }, async ({ page }) => {
    const measure = () => page.evaluate(() => {
      const contact = document.querySelector<HTMLElement>(".footer_contact")!;
      const parts = Array.from(contact.querySelectorAll<HTMLElement>(".footer_contact-lead, .footer_contact-person")).map((part) => {
        const box = part.getBoundingClientRect();
        const link = part.querySelector("a")?.getBoundingClientRect();
        return { left: box.left, top: box.top, bottom: box.bottom, linkTop: link?.top ?? null, linkBottom: link?.bottom ?? null };
      });
      const separator = contact.querySelector<HTMLElement>(".footer_contact-separator")!;
      const hashtag = document.querySelector(".footer_hashtag")!.getBoundingClientRect();
      const top = document.querySelector(".footer_top-link")!.getBoundingClientRect();
      return {
        parts,
        separatorDisplay: getComputedStyle(separator).display,
        separatorHidden: separator.getAttribute("aria-hidden"),
        hashtag: { left: hashtag.left, right: hashtag.right, center: (hashtag.top + hashtag.bottom) / 2 },
        top: { left: top.left, right: top.right, center: (top.top + top.bottom) / 2 },
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    for (const width of [320, 390, 481, 767]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/404");
      const mobile = await measure();
      expect(mobile.parts).toHaveLength(3);
      expect(mobile.separatorDisplay).toBe("none");
      expect(mobile.separatorHidden).toBe("true");
      for (const part of mobile.parts) expect(Math.abs(part.left - mobile.parts[0].left)).toBeLessThanOrEqual(1);
      for (let index = 1; index < mobile.parts.length; index += 1) expect(mobile.parts[index].top).toBeGreaterThanOrEqual(mobile.parts[index - 1].bottom - 1);
      for (const part of mobile.parts.slice(1)) {
        expect(part.linkTop).toBeGreaterThanOrEqual(part.top - 1);
        expect(part.linkBottom).toBeLessThanOrEqual(part.bottom + 1);
      }
      expect(Math.abs(mobile.hashtag.center - mobile.top.center)).toBeLessThanOrEqual(4);
      expect(mobile.hashtag.right).toBeLessThan(mobile.top.left);
      expect(mobile.top.right).toBeLessThanOrEqual(width);
      expect(mobile.scrollWidth).toBeLessThanOrEqual(width);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/404");
    const desktop = await measure();
    expect(desktop.separatorDisplay).not.toBe("none");
    expect(desktop.parts[1].left).toBeGreaterThan(desktop.parts[0].left);
    expect(desktop.parts[2].left).toBeGreaterThan(desktop.parts[1].left);
    for (const part of desktop.parts) expect(Math.abs(part.top - desktop.parts[0].top)).toBeLessThanOrEqual(2);
  });
});
