import { expect, test } from "@playwright/test";

const links = [
  ["Invitation", "/#invitation"],
  ["The wedding", "/#wedding"],
  ["Entourage", "/#entourage"],
  ["Explore", "/#explore"],
  ["With love", "/#with-love"],
  ["Playlist", "/#playlist"],
  ["FAQ", "/#faq"],
] as const;

const waitForPanelTransition = async (page: import("@playwright/test").Page, open: boolean) => {
  const panel = page.locator("#site-navigation-panel");
  const clipPath = open
    ? "polygon(0px 0px, 100% 0px, 100% 100%, 0px 100%)"
    : "polygon(0px 0px, 100% 0px, 100% 0px, 0px 0px)";
  await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).clipPath), { timeout: 3000 }).toBe(clipPath);
  if (open) {
    await expect.poll(() => panel.locator(".navigation_link").first().evaluate((element) => getComputedStyle(element).transform), { timeout: 3000 }).toMatch(/^matrix\(1, [-\d.e]+, [-\d.e]+, 1, 0, 0\)$/); // rests at rotate(.001deg), translate 0
  }
};

test.describe("Eunice & Warren navigation", () => {
  for (const width of [1440, 390]) {
    test(`opens, closes, and traps focus at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/");

      const panel = page.locator("#site-navigation-panel");
      const toggle = page.locator('[data-navigation-toggle="toggle"]');
      await expect(page.locator(".nav_menu")).toHaveCount(0);
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(panel).toHaveAttribute("aria-hidden", "true");
      await expect(page.locator(".nav_wrap .nav_link")).toHaveCount(0);

      await toggle.click();
      await waitForPanelTransition(page, true);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(toggle).toHaveAttribute("aria-label", "Close menu");
      await expect(panel).toHaveAttribute("aria-hidden", "false");
      await expect(panel).toBeVisible();
      await expect(panel.locator(".navigation_link").first()).toBeFocused();
      await expect(page.locator("html")).toHaveCSS("overflow", "hidden");

      await page.keyboard.press("Shift+Tab");
      await expect(toggle).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(panel.locator(".navigation_link").first()).toBeFocused();
      if (width >= 992) {
        for (let index = 1; index < links.length; index += 1) await page.keyboard.press("Tab");
        await expect(panel.locator(".navigation_link").last()).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(page.locator(".nav_rsvp")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(toggle).toBeFocused();
      } else {
        await panel.locator(".navigation_rsvp").focus();
        await page.keyboard.press("Tab");
        await expect(toggle).toBeFocused();
        await expect(panel.locator(".navigation_link").first()).toBeInViewport();
        await expect(panel.locator(".navigation_link").first()).toBeVisible();
        expect(await panel.locator(".navigation_item").evaluateAll((items) => items.every((item) => item.scrollTop === 0))).toBe(true);
      }

      await toggle.click();
      await waitForPanelTransition(page, false);
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
      await expect(panel).toHaveAttribute("aria-hidden", "true");

      await toggle.click();
      await waitForPanelTransition(page, true);
      await page.keyboard.press("Escape");
      await waitForPanelTransition(page, false);
      await expect(toggle).toBeFocused();

      await toggle.click();
      await waitForPanelTransition(page, true);
      await panel.locator(".navigation_link").nth(1).click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    });
  }

  test("opens instantly with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator('[data-navigation-toggle="toggle"]').click();
    const panel = page.locator("#site-navigation-panel");
    await expect(panel).toHaveCSS("clip-path", "polygon(0px 0px, 100% 0px, 100% 100%, 0px 100%)");
    await expect(page.locator(".nav_wrap")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".nav_wrap")).toHaveCSS("background-image", "none");
    await expect(panel.locator(".navigation_link").first()).toBeFocused();
    await page.locator('[data-navigation-toggle="toggle"]').click();
    await expect(panel).toHaveCSS("clip-path", "polygon(0px 0px, 100% 0px, 100% 0px, 0px 0px)");
    await expect(page.locator(".nav_wrap")).toHaveCSS("background-color", "rgb(245, 239, 227)");
  });

  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    test(`shows the wipe through the bar and removes the scrollbar gutter at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");

    const toggle = page.locator('[data-navigation-toggle="toggle"]');
    await toggle.click();
    await expect.poll(() => page.evaluate(() => {
      const panelStyle = getComputedStyle(document.querySelector<HTMLElement>("#site-navigation-panel")!);
      const headerStyle = getComputedStyle(document.querySelector<HTMLElement>(".nav_wrap")!);
      const match = panelStyle.clipPath.match(/100% ([\d.]+)%/);
      const bottom = match ? Number(match[1]) : 100;
      return bottom > 5 && bottom < 90 && headerStyle.backgroundColor === "rgba(0, 0, 0, 0)" && headerStyle.backgroundImage === "none";
    }), { timeout: 3000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>("#site-navigation-panel")!;
      return document.documentElement.clientWidth === window.innerWidth && panel.getBoundingClientRect().width === window.innerWidth;
    }), { timeout: 3000 }).toBe(true);
    });
  }


  test("keeps the expected link destinations in the full-screen panel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    for (const [name, href] of links) {
      await expect(page.locator(".navigation_link", { hasText: name })).toHaveAttribute("href", href);
    }
  });

  test("keeps the toggle light through close and keeps navigation geometry stable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const samples = await page.evaluate(() => new Promise<Array<{
      elapsed: number;
      color: string;
      toggleLeft: number;
      rsvpLeft: number;
      nowPlayingLeft: number;
      panelBottom: number;
      closeElapsed: number;
    }>>((resolve) => {
      const panel = document.querySelector<HTMLElement>("#site-navigation-panel")!;
      const started = performance.now();
      let closeStarted = 0;
      const getSample = () => {
        const panelPath = getComputedStyle(panel).clipPath.match(/100% ([\d.]+)%/);
        const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return {
          elapsed: performance.now() - started,
          color: getComputedStyle(document.querySelector<HTMLElement>(".nav_toggle-button")!).color,
          toggleLeft: rect(".nav_toggle-button").left,
          rsvpLeft: rect(".nav_rsvp").left,
          nowPlayingLeft: rect(".nav_now-playing").left,
          panelBottom: panelPath ? Number(panelPath[1]) : 0,
          closeElapsed: closeStarted ? performance.now() - closeStarted : -1,
        };
      };
      document.querySelector<HTMLButtonElement>('[data-navigation-toggle="toggle"]')!.click();
      const frames: Array<ReturnType<typeof getSample>> = [];
      const tick = () => {
        frames.push(getSample());
        if (!closeStarted && performance.now() - started >= 1200) {
          closeStarted = performance.now();
          document.querySelector<HTMLButtonElement>('[data-navigation-toggle="toggle"]')!.click();
        }
        if (!closeStarted || performance.now() - closeStarted < 1200) requestAnimationFrame(tick);
        else resolve(frames);
      };
      requestAnimationFrame(tick);
    }));

    const closingSamples = samples.filter((sample) => sample.closeElapsed >= 0);
    expect(closingSamples.filter((sample) => sample.closeElapsed < 550).length).toBeGreaterThan(5);
    expect(closingSamples.filter((sample) => sample.closeElapsed < 550).every((sample) => sample.color === "rgb(245, 239, 227)")).toBe(true);
    expect(closingSamples.some((sample) => sample.closeElapsed > 750 && sample.color === "rgb(31, 47, 92)")).toBe(true);
    const initial = samples[0];
    for (const sample of samples) {
      expect(Math.abs(sample.toggleLeft - initial.toggleLeft)).toBeLessThan(0.5);
      expect(Math.abs(sample.rsvpLeft - initial.rsvpLeft)).toBeLessThan(0.5);
      expect(Math.abs(sample.nowPlayingLeft - initial.nowPlayingLeft)).toBeLessThan(0.5);
    }
    expect(samples.some((sample) => sample.panelBottom > 5 && sample.panelBottom < 95)).toBe(true);
  });

  test("keeps the mobile toggle fixed and the fading actions in place", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const toggle = page.locator('[data-navigation-toggle="toggle"]');
    const samples = await page.evaluate(() => new Promise<Array<{ toggleLeft: number; rsvpLeft: number; nowPlayingLeft: number; rsvpOpacity: string; nowPlayingOpacity: string }>>((resolve) => {
      const toggle = document.querySelector<HTMLButtonElement>('[data-navigation-toggle="toggle"]')!;
      const read = () => {
        const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return {
          toggleLeft: rect(".nav_toggle-button").left,
          rsvpLeft: rect(".nav_rsvp").left,
          nowPlayingLeft: rect(".nav_now-playing").left,
          rsvpOpacity: getComputedStyle(document.querySelector<HTMLElement>(".nav_rsvp")!).opacity,
          nowPlayingOpacity: getComputedStyle(document.querySelector<HTMLElement>(".nav_now-playing")!).opacity,
        };
      };
      const frames: Array<ReturnType<typeof read>> = [];
      const started = performance.now();
      toggle.click();
      const tick = () => {
        frames.push(read());
        if (performance.now() - started < 1200) requestAnimationFrame(tick);
        else resolve(frames);
      };
      requestAnimationFrame(tick);
    }));
    const initial = samples[0];
    for (const sample of samples) {
      expect(Math.abs(sample.toggleLeft - initial.toggleLeft)).toBeLessThan(0.5);
      if (Number(sample.rsvpOpacity) > 0) expect(Math.abs(sample.rsvpLeft - initial.rsvpLeft)).toBeLessThan(0.5);
      if (Number(sample.nowPlayingOpacity) > 0) expect(Math.abs(sample.nowPlayingLeft - initial.nowPlayingLeft)).toBeLessThan(0.5);
    }

    await expect(page.locator(".nav_toggle-close")).toBeVisible();
    await expect(page.locator(".nav_toggle-menu")).toBeHidden();
    await toggle.click();
    await expect(page.locator(".nav_toggle-label")).toBeHidden();
  });

  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    test(`keeps the palm clear of every link label at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.locator('[data-navigation-toggle="toggle"]').click();
      await waitForPanelTransition(page, true);
      expect(await page.evaluate(() => {
        const stamp = document.querySelector<HTMLElement>(".navigation_palm")!.getBoundingClientRect();
        return Array.from(document.querySelectorAll<HTMLElement>(".navigation_label-text")).every((link) => {
          const rect = link.getBoundingClientRect();
          return rect.right <= stamp.left || rect.left >= stamp.right || rect.bottom <= stamp.top || rect.top >= stamp.bottom;
        });
      })).toBe(true);
    });
  }
});
