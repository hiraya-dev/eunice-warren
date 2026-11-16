import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const attireSource = readFileSync("src/components/sections/Attire.astro", "utf8");
const looksSource = attireSource.slice(
  attireSource.indexOf("const looks ="),
  attireSource.indexOf("const notes ="),
);
const lookGroupCount = (looksSource.match(/id: /g) ?? []).length;
const lookItemCount =
  (looksSource.match(/caption: /g) ?? []).length / lookGroupCount;

function sourceListCount(label: string) {
  const block = attireSource.match(
    new RegExp(`label: "${label}"[\\s\\S]*?items: \\[([^\\]]+)\\]`),
  )?.[1];
  return block?.match(/"[^"]+"/g)?.length ?? 0;
}

test.describe("attire section", () => {
  test("renders the guide structure and accessible colour swatches", { tag: ["@single", "@smoke"] }, async ({ page }) => {
    await page.goto("/");
    const attire = page.locator("#attire");
    await expect(attire).toHaveCount(1);
    await expect(attire.locator("h2")).toBeVisible();

    const swatches = attire.locator(".attire_colours .attire_swatch");
    await expect(swatches).toHaveCount(4);
    for (const swatch of await swatches.all()) {
      // The label is the list item's visible text.
      await expect(swatch.locator("..")).toHaveText(/\S/);
      const fill = await swatch.evaluate((element) => {
        const { backgroundColor, backgroundImage } = getComputedStyle(element);
        return { backgroundColor, backgroundImage };
      });
      const hasColour =
        fill.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        fill.backgroundColor !== "transparent";
      expect(hasColour || fill.backgroundImage !== "none").toBe(true);
    }
  });

  test("renders both looks rows and loads each look image", { tag: ["@single"] }, async ({ page }) => {
    await page.goto("/");
    const rows = page.locator("#attire [data-gsap-slider-init]");
    await expect(rows).toHaveCount(lookGroupCount);
    for (const row of await rows.all()) {
      const items = row.locator("[data-gsap-slider-item]");
      await expect(items).toHaveCount(lookItemCount);
      for (const image of await items.locator("img").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
        await expect(image).toHaveAttribute("alt", /.+/);
      }
    }
  });

  test("renders the notebook restrictions and postmark", { tag: ["@single"] }, async ({ page }) => {
    await page.goto("/");
    const note = page.locator("#attire .attire_note");
    for (const [label, count] of [["Tops", sourceListCount("Tops")], ["Bottoms", sourceListCount("Bottoms")]] as const) {
      const group = note.locator(".attire_note-group", { hasText: label });
      const items = group.locator(".attire_note-list li");
      await expect(items).toHaveCount(count);
      await expect(items.locator("svg[aria-hidden=true]")).toHaveCount(count);
    }
    await expect(note.locator(".attire_postmark")).toHaveAttribute("alt", "Strictly no white");
  });

  test("advances the mobile slider and updates its counter", { tag: ["@sweep"] }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const row = page.locator("#attire [data-gsap-slider-init]").first();
    const track = row.locator("[data-gsap-slider-list]");
    const next = row.locator('[data-gsap-slider-control="next"]');
    const prev = row.locator('[data-gsap-slider-control="prev"]');
    const counter = row.locator("[data-gsap-slider-counter]");
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    const initialX = await track.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).e);
    await next.click();
    await expect.poll(() => track.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).e)).toBeLessThan(initialX);
    await expect(counter).toHaveText(new RegExp(`02\\s*/\\s*${String(lookItemCount).padStart(2, "0")}`));
    await expect(prev).toBeEnabled();

    await page.goto("/");
    const lastRow = page.locator("#attire [data-gsap-slider-init]").first();
    const lastNext = lastRow.locator('[data-gsap-slider-control="next"]');
    const lastPrev = lastRow.locator('[data-gsap-slider-control="prev"]');
    const lastTrack = lastRow.locator("[data-gsap-slider-list]");
    const lastCounter = lastRow.locator("[data-gsap-slider-counter]");
    const pad = (value: number) => String(value).padStart(2, "0");
    // Click and wait for each move to land; the buttons settle after the tween.
    for (let index = 2; index <= lookItemCount; index += 1) {
      await expect(lastNext).toBeEnabled();
      await lastNext.click();
      await expect(lastCounter).toHaveText(new RegExp(`${pad(index)}\\s*/\\s*${pad(lookItemCount)}`));
    }
    await expect(lastNext).toBeDisabled();
    await expect(lastPrev).toBeEnabled();
    await expect.poll(() => lastTrack.locator("[data-gsap-slider-item]").last().evaluate((element) => {
      const item = element.getBoundingClientRect();
      const collection = element.closest("[data-gsap-slider-collection]")!.getBoundingClientRect();
      return collection.right - item.right;
    })).toBeGreaterThanOrEqual(-1);
  });

  // Mouse drag, like the Explore drag test: desktop Chromium only.
  test("snaps to the next look after a settled drag", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const row = page.locator("#attire [data-gsap-slider-init]").first();
    const track = row.locator("[data-gsap-slider-list]");
    await track.scrollIntoViewIfNeeded();
    const card = row.locator("[data-gsap-slider-item]").first();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const y = box!.y + Math.min(80, box!.height / 2);
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - box!.width * 0.7, y, { steps: 6 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await expect.poll(() => track.evaluate((element) => Math.round(new DOMMatrix(getComputedStyle(element).transform).e))).toBeLessThan(-1);
    await expect(row.locator("[data-gsap-slider-counter]")).toHaveText(new RegExp(`02\\s*/\\s*${String(lookItemCount).padStart(2, "0")}`));
  });

  test("does not activate looks sliders on desktop", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const rows = page.locator("#attire [data-gsap-slider-init]");
    await expect(rows).toHaveCount(lookGroupCount);
    for (const row of await rows.all()) {
      await expect(row).toHaveAttribute("data-gsap-slider-status", "not-active");
      await expect(row.locator("[data-gsap-slider-controls]")).toBeHidden();
      const items = row.locator("[data-gsap-slider-item]");
      await expect(items).toHaveCount(lookItemCount);
      // The looks themselves stay readable; their decorations (pegs) are aria-hidden.
      await expect(row.locator('[data-gsap-slider-item][aria-hidden="true"]')).toHaveCount(0);
      for (const item of await items.all()) {
        await expect(item.locator("img")).toBeVisible();
      }
    }
  });

  test("clears the mobile slider position when resized to desktop", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const row = page.locator("#attire [data-gsap-slider-init]").first();
    const track = row.locator("[data-gsap-slider-list]");
    await row.locator('[data-gsap-slider-control="next"]').click();
    await expect(row.locator("[data-gsap-slider-counter]")).toHaveText(/02\s*\/\s*04/);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(() => row.getAttribute("data-gsap-slider-status"))
      .toBe("not-active");
    await expect
      .poll(() => track.evaluate((element) => {
        const transform = new DOMMatrix(getComputedStyle(element).transform);
        return { x: transform.e, y: transform.f };
      }))
      .toEqual({ x: 0, y: 0 });
    await expect(row.locator('[data-gsap-slider-item][aria-hidden="true"]')).toHaveCount(0);
  });
});
