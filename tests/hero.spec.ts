import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const MUSIC = /BACKGROUND_MUSIC\s*=\s*\{\s*enabled:\s*true/.test(readFileSync("src/consts.ts", "utf8"));

test.describe("keepsakes hero", () => {
  for (const viewport of [{ width: 768, height: 1024 }, { width: 991, height: 760 }]) {
    test(`uses the desktop composition at ${viewport.width}px tablet width`, { tag: ["@single"] }, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");

      const metrics = await page.evaluate(() => {
        const box = (element: Element) => {
          const { top, right, bottom, left, height } = element.getBoundingClientRect();
          return { top, right, bottom, left, height };
        };
        const hero = document.querySelector<HTMLElement>("#hero")!.getBoundingClientRect();
        const text = [...document.querySelectorAll<HTMLElement>(".hero_date, .hero_title, .hero_subtitle, .hero_actions")].map(box);
        const keepsakes = [...document.querySelectorAll<HTMLElement>("[data-hero-keepsake]")].filter((element) => element.getClientRects().length > 0).map(box);
        const rsvp = box(document.querySelector<HTMLElement>(".hero_rsvp")!);
        const weekend = box(document.querySelector<HTMLElement>(".hero_weekend")!);
        const intersects = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const titleSpans = [...document.querySelectorAll<HTMLElement>(".hero_title span")].map(box);
        return {
          hero: { top: hero.top, right: hero.right, bottom: hero.bottom, left: hero.left, height: hero.height },
          text,
          keepsakes,
          intersectsText: keepsakes.some((keepsake) => text.some((textBox) => intersects(keepsake, textBox))),
          actionsCentreDelta: Math.abs(rsvp.top + rsvp.height / 2 - (weekend.top + weekend.height / 2)),
          titleSingleLine: Math.abs(titleSpans[0].top - titleSpans[1].top) < 1,
        };
      });

      for (const keepsake of await page.locator("[data-hero-keepsake]:not(.hero_music)").all()) await expect(keepsake).toBeVisible();
      if (MUSIC) await expect(page.locator(".hero_music")).toBeHidden();
      expect(metrics.keepsakes).toHaveLength(7);
      await expect(page.locator(".hero_date-full")).toBeVisible();
      await expect(page.locator(".hero_date-short")).toBeHidden();
      expect(metrics.actionsCentreDelta).toBeLessThanOrEqual(4);
      expect(metrics.titleSingleLine).toBe(true);
      expect(metrics.intersectsText).toBe(false);
      expect(metrics.keepsakes.every((keepsake) => keepsake.left >= metrics.hero.left && keepsake.right <= metrics.hero.right && keepsake.top >= metrics.hero.top && keepsake.bottom <= metrics.hero.bottom)).toBe(true);
      expect(metrics.hero.height).toBeLessThanOrEqual(0.56944 * viewport.width + 80 + 2);
    });
  }

  test("shows the desktop composition", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Warren & Eunice");
    await expect(page.locator("[data-hero-keepsake]")).toHaveCount(MUSIC ? 8 : 7);
    if (MUSIC) {
      await expect(page.locator(".hero_sunset")).toBeHidden();
      await expect(page.locator(".hero_music")).toBeVisible();
    }
    const shown = page.locator(MUSIC ? "[data-hero-keepsake]:not(.hero_sunset)" : "[data-hero-keepsake]");
    await expect(shown).toHaveCount(7);
    for (const keepsake of await shown.all()) await expect(keepsake).toBeVisible();
  });

  test("uses the compact composition on mobile", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(".hero_title span").first()).toBeVisible();
    await expect(page.locator(".hero_title span").nth(1)).toBeVisible();
    await expect(page.locator(".hero_sunset")).toBeHidden();
    await expect(page.locator(".hero_palm")).toBeHidden();
    const transform = await page.locator(".hero_couple").evaluate((element) => getComputedStyle(element).transform);
    const matrix = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(",").map(Number);
    expect(matrix).toBeTruthy();
    const angle = Math.atan2(matrix![1], matrix![0]) * (180 / Math.PI);
    expect(Math.abs(angle + 6)).toBeLessThan(0.5);
  });

  test("centres the compact photo pair over the title", { tag: ["@single"] }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const width of [390, 480, 600, 767]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");

      const metrics = await page.evaluate(() => {
        const couple = document.querySelector<HTMLElement>(".hero_couple .hero_polaroid")!.getBoundingClientRect();
        const whiteBeach = document.querySelector<HTMLElement>(".hero_white-beach .hero_polaroid")!.getBoundingClientRect();
        const title = document.querySelector<HTMLElement>(".hero_title")!.getBoundingClientRect();
        const photoGroupCentre = (couple.left + whiteBeach.right) / 2;
        const titleCentre = (title.left + title.right) / 2;
        return { delta: Math.abs(photoGroupCentre - titleCentre) };
      });

      expect(metrics.delta, `compact photo pair centre at ${width}px`).toBeLessThanOrEqual(8);
    }
  });

  for (const width of [320, 390, 767]) {
    test(`points the compact hero note arrow toward the couple at ${width}px`, { tag: ["@single"] }, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");

      const metrics = await page.evaluate(() => {
        const arrow = document.querySelector<SVGElement>(".hero_note-arrow")!;
        const text = document.querySelector<HTMLElement>(".hero_note-text")!;
        const couple = document.querySelector<HTMLElement>(".hero_couple .hero_polaroid")!;
        const arrowBox = arrow.getBoundingClientRect();
        const textBox = text.getBoundingClientRect();
        const coupleBox = couple.getBoundingClientRect();
        const transform = getComputedStyle(arrow).transform;
        const matrix = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(",").map(Number);
        return {
          arrowBottom: arrowBox.bottom,
          arrowTop: arrowBox.top,
          textTop: textBox.top,
          coupleBottom: coupleBox.bottom,
          verticalScale: matrix?.[3],
        };
      });

      expect(metrics.arrowBottom).toBeLessThanOrEqual(metrics.textTop + 6);
      expect(metrics.arrowTop).toBeLessThanOrEqual(metrics.coupleBottom + 2);
      expect(metrics.verticalScale).toBeCloseTo(-1, 2);
    });
  }

  test("keepsakes are immediately visible with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("[data-hero-keepsake]").first()).toHaveCSS("opacity", "1");
  });

  test("centres the desktop text and uses the full title line box", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 912 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const metrics = await page.evaluate(() => {
      const hero = document.querySelector<HTMLElement>("#hero")!.getBoundingClientRect();
      const title = document.querySelector<HTMLElement>(".hero_title")!;
      const content = document.querySelector<HTMLElement>(".hero_content")!.getBoundingClientRect();
      return { heroTop: hero.top, heroHeight: hero.height, titleHeight: title.getBoundingClientRect().height, titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize), contentCentre: content.top + content.height / 2 };
    });
    expect(metrics.titleHeight).toBeGreaterThanOrEqual(metrics.titleFontSize * 1.05);
    expect(Math.abs(metrics.contentCentre - (metrics.heroTop + metrics.heroHeight / 2 + 20))).toBeLessThan(24);
  });
});
