import { expect, test } from "@playwright/test";

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

// Playwright's headless Chromium hides scrollbars by default; show them so the scroll lock
// and its padding compensation are tested against a real, always-visible scrollbar.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test.describe("classic scrollbar navigation", () => {

  test("keeps the panel full width and anchors stable through close", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const before = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      toggleRight: document.querySelector<HTMLElement>(".nav_toggle-button")!.getBoundingClientRect().right,
      logoX: document.querySelector<HTMLElement>(".nav_logo")!.getBoundingClientRect().x,
      bodyPaddingRight: document.body.style.paddingRight,
    }));
    if (testInfo.project.name === "chromium") expect(before.innerWidth - before.clientWidth).toBeGreaterThan(0);

    // Record every animation frame of a transition, then assert across all of them; polling can
    // step straight over the ~150ms in which the wipe crosses the middle of the screen.
    const recordFrames = () => page.evaluate(() => new Promise<Array<{ bottom: number; clientWidth: number; innerWidth: number; panelWidth: number; toggleRight: number; logoX: number; barBackground: string }>>((resolve) => {
      const frames: Array<{ bottom: number; clientWidth: number; innerWidth: number; panelWidth: number; toggleRight: number; logoX: number; barBackground: string }> = [];
      const panel = document.querySelector<HTMLElement>("#site-navigation-panel")!;
      // Click from inside the page so the recording starts with the transition, not after
      // a round trip that can outlast it under load.
      document.querySelector<HTMLButtonElement>('[data-navigation-toggle="toggle"]')!.click();
      const started = performance.now();
      const tick = () => {
        const match = getComputedStyle(panel).clipPath.match(/100% ([\d.]+)%/);
        frames.push({
          bottom: match ? Number(match[1]) : 0,
          clientWidth: document.documentElement.clientWidth,
          innerWidth: window.innerWidth,
          panelWidth: panel.getBoundingClientRect().width,
          toggleRight: document.querySelector<HTMLElement>(".nav_toggle-button")!.getBoundingClientRect().right,
          logoX: document.querySelector<HTMLElement>(".nav_logo")!.getBoundingClientRect().x,
          barBackground: getComputedStyle(document.querySelector<HTMLElement>(".nav_wrap")!).backgroundColor,
        });
        if (performance.now() - started < 1500) requestAnimationFrame(tick);
        else resolve(frames);
      };
      requestAnimationFrame(tick);
    }));
    const expectStable = (frames: Awaited<ReturnType<typeof recordFrames>>) => {
      const moving = frames.filter((frame) => frame.bottom > 5 && frame.bottom < 95);
      expect(moving.length).toBeGreaterThan(3);
      for (const frame of frames) {
        expect(frame.clientWidth).toBe(frame.innerWidth);
        expect(frame.panelWidth).toBe(frame.innerWidth);
        expect(Math.abs(frame.toggleRight - before.toggleRight)).toBeLessThan(0.5);
        expect(Math.abs(frame.logoX - before.logoX)).toBeLessThan(0.5);
      }
      return moving;
    };

    const opening = recordFrames();
    const openingMoving = expectStable(await opening);
    expect(openingMoving.every((frame) => frame.barBackground === "rgba(0, 0, 0, 0)")).toBe(true);
    await waitForPanelTransition(page, true);

    const closing = recordFrames();
    // The last frames can land after the unlock, once the panel has fully retracted.
    expectStable((await closing).filter((frame) => frame.bottom > 1));

    await waitForPanelTransition(page, false);
    await expect.poll(() => page.evaluate((expected) => document.documentElement.clientWidth === expected.clientWidth && document.body.style.paddingRight === "", before), { timeout: 3000 }).toBe(true);
    await expect.poll(() => page.evaluate((expected) => {
      const toggleRight = document.querySelector<HTMLElement>(".nav_toggle-button")!.getBoundingClientRect().right;
      const logoX = document.querySelector<HTMLElement>(".nav_logo")!.getBoundingClientRect().x;
      return Math.abs(toggleRight - expected.toggleRight) < 0.5 && Math.abs(logoX - expected.logoX) < 0.5;
    }, before), { timeout: 3000 }).toBe(true);
  });
});

test("keeps the page texture still when the scroll lock removes the scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // A strip of bare page texture at the bottom, clear of the hero's keepsakes.
  const strip = { x: 600, y: 860, width: 200, height: 30 };
  const before = await page.screenshot({ clip: strip });
  // Open and freeze the panel fully clipped, so the strip still shows the page behind it.
  await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#site-navigation-panel")!;
    panel.style.transition = "none";
    document.querySelector<HTMLButtonElement>('[data-navigation-toggle="toggle"]')!.click();
    panel.style.clipPath = "polygon(0 0, 100% 0, 100% 0, 0 0)";
  });
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(1440);
  expect((await page.screenshot({ clip: strip })).equals(before)).toBe(true);

  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#site-navigation-panel")!.style.removeProperty("clip-path");
    document.querySelector<HTMLButtonElement>('[data-navigation-toggle="toggle"]')!.click();
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.backgroundPosition)).toBe("");
  expect((await page.screenshot({ clip: strip })).equals(before)).toBe(true);
});
