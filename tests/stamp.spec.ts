import { expect, test } from "@playwright/test";

test.describe("stamp component", () => {
  for (const width of [1440, 390]) {
    test(`keeps every stamp framed and undistorted at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");

      const stamps = page.locator(".stamp_wrap");
      await expect(stamps).not.toHaveCount(0);

      const metrics = [];
      for (const stamp of await stamps.all()) {
        const box = await stamp.boundingBox();
        if (!box || box.width === 0 || box.height === 0) continue;

        await stamp.scrollIntoViewIfNeeded();
        const image = stamp.locator("img");
        await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);

        metrics.push(await stamp.evaluate((element) => {
          const root = element as HTMLElement;
          const paper = root.querySelector(".stamp_paper")!;
          const styles = getComputedStyle(paper);
          const image = root.querySelector("img") as HTMLImageElement | null;
          const art = root.querySelector<HTMLElement>(".stamp_art");
          return {
            mask: styles.maskImage !== "none" || styles.getPropertyValue("-webkit-mask-image") !== "none",
            aspect: root.offsetWidth / root.offsetHeight,
            imageLoaded: image?.complete && image.naturalWidth > 0,
            imageAspect: image ? image.offsetWidth / image.offsetHeight : 0,
            naturalAspect: image && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 0,
            artWidthRatio: art ? art.offsetWidth / root.offsetWidth : 0,
          };
        }));
      }

      for (const metric of metrics) {
        expect(metric.mask).toBe(true);
        expect(metric.aspect).toBeCloseTo(0.8, 2);
        expect(metric.imageLoaded).toBe(true);
        expect(metric.artWidthRatio).toBeGreaterThanOrEqual(0.8);
        expect(metric.imageAspect / metric.naturalAspect).toBeGreaterThan(0.98);
        expect(metric.imageAspect / metric.naturalAspect).toBeLessThan(1.02);
      }

      const sources = await page.locator(".stamp_wrap img").evaluateAll((images) =>
        images.map((image) => {
          const img = image as HTMLImageElement;
          return img.currentSrc || img.getAttribute("src") || "";
        }),
      );
      for (const source of sources) {
        expect(source).not.toMatch(/stamp-(paraw|palm|pilipinas|pawikan|willys-rock|shell|ew)/);
      }
    });
  }
});
