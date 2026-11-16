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
    },
  );

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
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
    await expect(open).toBeFocused();
  });
});
