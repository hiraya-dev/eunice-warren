import { expect, test } from "@playwright/test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const galleryDirectory = resolve(process.cwd(), "src/assets/images/gallery");
const photoCount = readdirSync(galleryDirectory).filter((file) =>
  file.endsWith(".jpg"),
).length;

test.describe("photo gallery", { tag: ["@single"] }, () => {
  test(
    "opens the canvas and closes back to the page",
    { tag: ["@smoke"] },
    async ({ page, isMobile }) => {
      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.goto("/");

      const manifest = JSON.parse(
        (await page.locator("[data-gallery-manifest]").textContent()) || "[]",
      ) as Array<{ full: string }>;
      const fullSizePaths = manifest.map(
        (photo) => new URL(photo.full, page.url()).pathname,
      );
      expect(
        requests.some((url) => fullSizePaths.includes(new URL(url).pathname)),
      ).toBe(false);
      expect(
        requests.some((url) => /(?:^|[/_-])three(?:[./_-]|$)/i.test(url)),
      ).toBe(false);

      const open = page.locator("[data-gallery-open]");
      await open.scrollIntoViewIfNeeded();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await open.click();

      const overlay = page.locator("#gallery-overlay");
      await expect(overlay).toBeVisible();
      await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(document.activeElement?.closest("#gallery-overlay")),
          ),
        )
        .toBe(true);

      // Mobile WebKit has no mouse wheel; the other projects cover the wheel lock.
      if (!isMobile) {
        await page.mouse.move(300, 300);
        await page.mouse.wheel(0, 600);
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      const firstPhoto = page.locator("[data-gallery-list] button").first();
      await firstPhoto.focus();
      await page.keyboard.press("Enter");
      await expect(overlay).toHaveAttribute("data-gallery-state", "open");
      await expect(page.locator("[data-gallery-lightbox-count]")).toHaveText(
        new RegExp(`^001 \/ ${String(photoCount).padStart(3, "0")}`),
      );
      await expect(page.locator("[data-gallery-lightbox-img]")).toHaveAttribute(
        "alt",
        `Photo 1 of ${photoCount}`,
      );

      await page.locator("[data-gallery-next]").click();
      await expect(page.locator("[data-gallery-lightbox-count]")).toHaveText(
        new RegExp(`^002 \/ ${String(photoCount).padStart(3, "0")}`),
      );
      const save = page.locator("a[data-gallery-save]");
      expect(
        new URL((await save.getAttribute("href")) || "", page.url()).pathname,
      ).toMatch(/\.jpg$/i);
      await expect(save).toHaveAttribute("download", "eunice-warren-002.jpg");

      await page.keyboard.press("Escape");
      await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
      await page.keyboard.press("Escape");
      await expect(overlay).toBeHidden();
      await expect(open).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      await page.evaluate(() => {
        window.name = "gallery-arrow-default-prevented:false";
        window.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown")
            window.name = `gallery-arrow-default-prevented:${event.defaultPrevented}`;
        });
      });
      await page.keyboard.press("ArrowDown");
      expect(await page.evaluate(() => window.name)).toBe(
        "gallery-arrow-default-prevented:false",
      );
    },
  );

  test(
    "resizes the canvas after a closed-viewport change",
    { tag: ["@sweep"] },
    async ({ page }) => {
      await page.goto("/");
      const open = page.locator("[data-gallery-open]");
      const overlay = page.locator("#gallery-overlay");
      const canvas = page.locator("[data-gallery-stage] canvas");
      const grid = page.locator("[data-gallery-grid]");

      await open.click();
      await expect
        .poll(
          async () => (await canvas.count()) > 0 || (await grid.isVisible()),
        )
        .toBe(true);
      if (await grid.isVisible()) {
        test.skip(true, "WebGL is unavailable in this browser");
        return;
      }

      await page.keyboard.press("Escape");
      await expect(overlay).toBeHidden();
      await page.setViewportSize({ width: 980, height: 700 });
      await open.click();
      await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
      await expect(canvas).toHaveCount(1);

      const sizes = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>(
          "[data-gallery-stage]",
        );
        const canvas = document.querySelector<HTMLCanvasElement>(
          "[data-gallery-stage] canvas",
        );
        return {
          canvasWidth: canvas?.clientWidth,
          canvasHeight: canvas?.clientHeight,
          stageWidth: stage?.clientWidth,
          stageHeight: stage?.clientHeight,
        };
      });
      expect(sizes.canvasWidth).toBe(sizes.stageWidth);
      expect(sizes.canvasHeight).toBe(sizes.stageHeight);
    },
  );

  test("keeps focus inside the lightbox controls", async ({ page }) => {
    await page.goto("/");
    await page.locator("[data-gallery-open]").click();
    const overlay = page.locator("#gallery-overlay");
    const firstPhoto = page.locator("[data-gallery-list] button").first();
    await firstPhoto.focus();
    await page.keyboard.press("Enter");
    await expect(overlay).toHaveAttribute("data-gallery-state", "open");

    const lightbox = page.locator("[data-gallery-lightbox]");
    const controls = await lightbox.locator("button, a[href]").count();
    for (let index = 0; index < controls + 2; index += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest("[data-gallery-lightbox]")),
        ),
      ).toBe(true);
    }
  });

  test("shows every photo in the no-WebGL fallback", async ({ page }) => {
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value: function (contextId: string, options?: unknown) {
          if (["webgl", "webgl2", "experimental-webgl"].includes(contextId))
            return null;
          return Reflect.apply(originalGetContext, this, [contextId, options]);
        },
      });
    });
    await page.goto("/");
    await page.locator("[data-gallery-open]").click();

    const overlay = page.locator("#gallery-overlay");
    const grid = page.locator("[data-gallery-grid]");
    await expect(grid).toBeVisible();
    await expect(grid.locator("button")).toHaveCount(photoCount);
    await grid.locator("button").first().click();
    await expect(overlay).toHaveAttribute("data-gallery-state", "open");
    await expect(page.locator("[data-gallery-lightbox-count]")).toHaveText(
      new RegExp(`^001 \/ ${String(photoCount).padStart(3, "0")}`),
    );
  });

  test("keeps open and close immediate with reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const open = page.locator("[data-gallery-open]");
    await open.click();
    const overlay = page.locator("#gallery-overlay");
    await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
    await expect(overlay).toBeVisible();
    expect(
      await overlay.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    ).toBe(0);

    const firstPhoto = page.locator("[data-gallery-list] button").first();
    await firstPhoto.focus();
    await page.keyboard.press("Enter");
    await expect(overlay).toHaveAttribute("data-gallery-state", "open");
    expect(
      await overlay.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    ).toBe(0);

    await page.keyboard.press("Escape");
    await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
    await expect(open).toBeFocused();
  });
});
