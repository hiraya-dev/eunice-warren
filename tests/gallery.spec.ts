import { expect, test, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

declare global {
  interface Window {
    __galleryTextureRequests?: number[];
    __galleryTexturePriorities?: Record<string, number>;
  }
}

const galleryDirectory = resolve(process.cwd(), "src/assets/images/gallery");
const photoCount = readdirSync(galleryDirectory).filter((file) =>
  file.endsWith(".jpg"),
).length;

// The site-wide reduced-motion rule (src/styles/base.css) shortens every transition to
// 0.01ms rather than removing it, so count only animations a person could see (> 1ms).
const perceptibleAnimations = (element: Element) =>
  element
    .getAnimations({ subtree: true })
    .filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return (
        Number(timing?.duration ?? 0) + Number(timing?.delay ?? 0) > 1
      );
    })
    .map((animation) =>
      animation instanceof CSSTransition
        ? `transition:${animation.transitionProperty}`
        : animation instanceof CSSAnimation
          ? `animation:${animation.animationName}`
          : `animation:${animation.id}`,
    );

// The teaser copy fades in as the section arrives (data-fade-in), so reach it before clicking.
const openGallery = async (page: Page) => {
  const open = page.locator("[data-gallery-open]");
  await open.scrollIntoViewIfNeeded();
  // Wait for the fade-in (and its 24px rise) to finish, so the click lands and does not re-scroll (L-029).
  await expect(page.locator(".gallery_actions")).toHaveCSS("opacity", "1");
  await open.click();
};

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
      // Let the copy finish fading in (it also moves 24px), so the click does not re-scroll.
      await expect(page.locator(".gallery_actions")).toHaveCSS("opacity", "1");
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
      const count = page.locator("[data-gallery-lightbox-count]");
      if (isMobile) await expect(count).toHaveText("Swipe for the next one");
      else await expect(count).toBeHidden();
      await expect(page.locator("[data-gallery-lightbox-img]")).toHaveAttribute(
        "aria-label",
        `Photo 1 of ${photoCount}`,
      );

      await page.locator("[data-gallery-next]").click();
      await expect(page.locator("[data-gallery-lightbox-img]")).toHaveAttribute(
        "aria-label",
        `Photo 2 of ${photoCount}`,
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

  test("loads gallery photos concurrently and prioritizes the camera centre", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__galleryTextureRequests = [];
      window.__galleryTexturePriorities = {};
    });
    // Gallery photos are webp variants under /_astro/. Count only requests that start
    // after the overlay opens: the old queue fetched them strictly one at a time.
    let opened = false;
    let active = 0;
    let peak = 0;
    let started = 0;
    await page.route("**/_astro/*.webp", async (route) => {
      if (!opened) return route.continue();
      started += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
      active -= 1;
    });

    await page.goto("/");
    const open = page.locator("[data-gallery-open]");
    await open.scrollIntoViewIfNeeded();
    await expect(page.locator(".gallery_actions")).toHaveCSS("opacity", "1");
    // Let the section's own images and the intent prefetch settle before counting.
    await page.waitForLoadState("networkidle");
    opened = true;
    await open.click();
    await expect.poll(() => started, { timeout: 10_000 }).toBeGreaterThan(3);
    expect(peak).toBeGreaterThan(1);
    await expect
      .poll(() => page.evaluate(() => window.__galleryTextureRequests?.length ?? 0), {
        timeout: 5_000,
      })
      .toBeGreaterThan(1);

    const priority = await page.evaluate(() => {
      const requests = window.__galleryTextureRequests ?? [];
      const priorities = window.__galleryTexturePriorities ?? {};
      return requests
        .map((index: number) => priorities[index])
        .filter(Number.isFinite);
    });
    expect(priority.length).toBeGreaterThan(1);
    expect(priority[0]).toBe(Math.min(...priority));
  });

  test("pans the canvas from the keyboard while a control has focus", async ({
    page,
  }) => {
    await page.goto("/");
    await openGallery(page);
    const overlay = page.locator("#gallery-overlay");
    await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
    // The no-WebGL fallback has no canvas to pan.
    test.skip(
      await page.locator("[data-gallery-grid]").isVisible(),
      "WebGL unavailable: fallback grid has no keyboard panning",
    );
    // The canvas module loads on first open; its key listener binds once it runs.
    await expect(page.locator("[data-gallery-stage] canvas")).toBeAttached();
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.tagName ?? ""),
      )
      .toMatch(/^(BUTTON|A)$/);
    await page.evaluate(() => {
      (window as Window & { galleryPanKeys?: string[] }).galleryPanKeys = [];
      window.addEventListener("keydown", (event) => {
        if (event.defaultPrevented)
          (window as Window & { galleryPanKeys?: string[] }).galleryPanKeys!.push(event.key);
      });
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("d");
    expect(
      await page.evaluate(
        () => (window as Window & { galleryPanKeys?: string[] }).galleryPanKeys,
      ),
    ).toEqual(["ArrowRight", "d"]);
  });

  test(
    "resizes the canvas after a closed-viewport change",
    { tag: ["@sweep"] },
    async ({ page }) => {
      await page.goto("/");
      const open = page.locator("[data-gallery-open]");
      const overlay = page.locator("#gallery-overlay");
      const canvas = page.locator("[data-gallery-stage] canvas");
      const grid = page.locator("[data-gallery-grid]");

      await open.scrollIntoViewIfNeeded();
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

  test(
    "sizes the canvas popup from the photo and closes beside the stamp",
    { tag: ["@smoke"] },
    async ({ page }) => {
      await page.goto("/");
      const manifest = JSON.parse(
        (await page.locator("[data-gallery-manifest]").textContent()) || "[]",
      ) as Array<{ width: number; height: number }>;
      const photo = manifest[0];
      expect(photo).toBeDefined();

      await openGallery(page);
      const overlay = page.locator("#gallery-overlay");
      const firstPhoto = page.locator("[data-gallery-list] button").first();
      await firstPhoto.focus();
      await page.keyboard.press("Enter");
      await expect(overlay).toHaveAttribute("data-gallery-state", "open");

      const popupCanvas = page.locator("[data-gallery-lightbox-canvas]");
      await expect(popupCanvas).toHaveJSProperty("tagName", "CANVAS");
      const popupRatio = await page
        .locator("[data-gallery-lightbox-canvas]")
        .evaluate((canvas) => canvas.clientWidth / canvas.clientHeight);
      const expectedRatio =
        1 / (0.88 * (photo.height / photo.width) + 0.26);
      expect(Math.abs(popupRatio - expectedRatio)).toBeLessThan(0.02);

      const stamp = page.locator("[data-gallery-lightbox-stamp]");
      await stamp.evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      const frameBox = await page
        .locator(".gallery_lightbox-frame")
        .boundingBox();
      const stampBox = await stamp.boundingBox();
      expect(frameBox).not.toBeNull();
      expect(stampBox).not.toBeNull();
      await page.mouse.click(
        frameBox!.x + 4,
        stampBox!.y + stampBox!.height / 2,
      );
      await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
    },
  );

  test(
    "stops held canvas movement when the window loses focus",
    { tag: ["@sweep"] },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        const state = window as Window & { galleryDrawCount?: number };
        state.galleryDrawCount = 0;
        const constructors = [
          window.WebGL2RenderingContext,
          window.WebGLRenderingContext,
        ];
        for (const Constructor of constructors) {
          if (!Constructor) continue;
          const original = Constructor.prototype.clear;
          Object.defineProperty(Constructor.prototype, "clear", {
            configurable: true,
            value: function (
              this: WebGLRenderingContext | WebGL2RenderingContext,
              mask: number,
            ) {
              state.galleryDrawCount = (state.galleryDrawCount ?? 0) + 1;
              return original.call(this, mask);
            },
          });
        }
      });
      await page.route("**/*", async (route) => {
        if (route.request().resourceType() === "image") await route.abort();
        else await route.continue();
      });
      await page.goto("/");
      await openGallery(page);
      const grid = page.locator("[data-gallery-grid]");
      await expect
        .poll(
          async () =>
            (await page.locator("[data-gallery-stage] canvas").count()) > 0 ||
            (await grid.isVisible()),
        )
        .toBe(true);
      if (await grid.isVisible()) {
        test.skip(true, "WebGL is unavailable in this browser");
        return;
      }

      await page.evaluate(() => {
        (window as Window & { galleryDrawCount?: number }).galleryDrawCount = 0;
      });
      await page.keyboard.down("ArrowRight");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { galleryDrawCount?: number })
                .galleryDrawCount ?? 0,
          ),
        )
        .toBeGreaterThan(1);
      const movingCount = await page.evaluate(
        () =>
          (window as Window & { galleryDrawCount?: number }).galleryDrawCount ??
          0,
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as Window & { galleryDrawCount?: number })
                .galleryDrawCount ?? 0,
          ),
        )
        .toBeGreaterThan(movingCount);

      await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
        (window as Window & { galleryDrawCount?: number }).galleryDrawCount = 0;
      });
      await page.waitForTimeout(250);
      expect(
        await page.evaluate(
          () =>
            (window as Window & { galleryDrawCount?: number })
              .galleryDrawCount ?? 0,
        ),
      ).toBeLessThanOrEqual(2);
      await page.keyboard.up("ArrowRight");
    },
  );

  test("keeps focus inside the lightbox controls", async ({ page }) => {
    await page.goto("/");
    await openGallery(page);
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
    await openGallery(page);

    const overlay = page.locator("#gallery-overlay");
    const grid = page.locator("[data-gallery-grid]");
    await expect(grid).toBeVisible();
    await expect(grid.locator("button")).toHaveCount(photoCount);
    await grid.locator("button").first().click();
    await expect(overlay).toHaveAttribute("data-gallery-state", "open");
    await expect(page.locator("[data-gallery-lightbox-img]")).toHaveAttribute(
      "aria-label",
      `Photo 1 of ${photoCount}`,
    );
    await expect(grid.locator("button.gallery_polaroid")).toHaveCount(
      photoCount,
    );
  });

  test("can close while the next photo loads and recovers after failure", async ({
    page,
  }) => {
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
    const manifest = JSON.parse(
      (await page.locator("[data-gallery-manifest]").textContent()) || "[]",
    ) as Array<{ fine: string }>;
    const startIndex = manifest.length - 3;
    const delayedIndex = startIndex + 1;
    const delayedPath = new URL(manifest[delayedIndex].fine, page.url())
      .pathname;
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    let markFirstFailed: (() => void) | undefined;
    let markSecondFailed: (() => void) | undefined;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstFailed = new Promise<void>((resolve) => {
      markFirstFailed = resolve;
    });
    const secondFailed = new Promise<void>((resolve) => {
      markSecondFailed = resolve;
    });
    let requestCount = 0;
    await page.route(
      (url) => url.pathname === delayedPath,
      async (route) => {
        const currentRequest = ++requestCount;
        if (currentRequest === 1) {
          markFirstStarted?.();
          await firstRelease;
        }
        await route.abort();
        if (currentRequest === 1) markFirstFailed?.();
        else if (currentRequest === 2) markSecondFailed?.();
      },
    );

    await openGallery(page);
    const overlay = page.locator("#gallery-overlay");
    const startPhoto = page
      .locator("[data-gallery-list] button")
      .nth(startIndex);
    await startPhoto.focus();
    await page.keyboard.press("Enter");
    await expect(overlay).toHaveAttribute("data-gallery-state", "open");
    const lightboxImage = page.locator("[data-gallery-lightbox-img]");
    await expect(lightboxImage).toHaveAttribute(
      "aria-label",
      `Photo ${startIndex + 1} of ${photoCount}`,
    );

    await page.locator("[data-gallery-next]").click();
    await firstStarted;
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
    releaseFirst?.();
    await firstFailed;

    await startPhoto.focus();
    await page.keyboard.press("Enter");
    await expect(overlay).toHaveAttribute("data-gallery-state", "open");
    await page.locator("[data-gallery-next]").click();
    await secondFailed;
    await expect(lightboxImage).toHaveAttribute(
      "aria-label",
      `Photo ${startIndex + 1} of ${photoCount}`,
    );
    await page.locator("[data-gallery-prev]").click();
    await expect(lightboxImage).toHaveAttribute(
      "aria-label",
      `Photo ${startIndex} of ${photoCount}`,
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
      await overlay.evaluate(perceptibleAnimations),
    ).toEqual([]);

    const firstPhoto = page.locator("[data-gallery-list] button").first();
    await firstPhoto.focus();
    await page.keyboard.press("Enter");
    await expect(overlay).toHaveAttribute("data-gallery-state", "open");
    expect(
      await overlay.evaluate(perceptibleAnimations),
    ).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(overlay).toHaveAttribute("data-gallery-state", "canvas");
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
    await expect(open).toBeFocused();
  });
});
