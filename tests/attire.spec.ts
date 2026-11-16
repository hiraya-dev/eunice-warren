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

// The viewport width at which the row switches from the swipe slider to seven across.
const sevenAcrossRem = Number(
  attireSource.match(/@media \(min-width: ([\d.]+)rem\) \{\s*\.attire_row \{\s*--slider-status: off/)?.[1],
);
const sevenAcrossPx = sevenAcrossRem * 16;
const pad2 = (value: number) => String(value).padStart(2, "0");

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
      for (const item of await items.all()) {
        // The colour is a dot now; its name stays in the accessible text.
        await expect(item.locator(".attire_caption-name .sr-only")).toHaveText(/\S/);
        await expect(item.locator(".attire_caption-dot")).toHaveAttribute("aria-hidden", "true");
      }
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
    await expect(counter).toHaveText(new RegExp(`01\\s*/\\s*${pad2(lookItemCount)}`));
    const initialX = await track.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).e);
    await next.click();
    await expect.poll(() => track.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).e)).toBeLessThan(initialX);
    await expect(counter).toHaveText(new RegExp(`02\\s*/\\s*${pad2(lookItemCount)}`));
    await expect(prev).toBeEnabled();

    await page.goto("/");
    const lastRow = page.locator("#attire [data-gsap-slider-init]").first();
    const lastNext = lastRow.locator('[data-gsap-slider-control="next"]');
    const lastPrev = lastRow.locator('[data-gsap-slider-control="prev"]');
    const lastTrack = lastRow.locator("[data-gsap-slider-list]");
    const lastCounter = lastRow.locator("[data-gsap-slider-counter]");
    const pad = pad2;
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
    await expect(row.locator("[data-gsap-slider-counter]")).toHaveText(new RegExp(`02\\s*/\\s*${pad2(lookItemCount)}`));

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

  test("clears the slider when resized across the seven-across breakpoint and back", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    expect(sevenAcrossPx).toBeGreaterThan(0);
    await page.setViewportSize({ width: sevenAcrossPx - 1, height: 900 });
    await page.goto("/");
    const row = page.locator("#attire [data-gsap-slider-init]").first();
    const track = row.locator("[data-gsap-slider-list]");
    await expect(row).toHaveAttribute("data-gsap-slider-status", "active");
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator('[data-gsap-slider-control="next"]')).toBeVisible();
    await row.locator('[data-gsap-slider-control="next"]').click();
    await expect.poll(() => track.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).e)).toBeLessThan(-1);

    await page.setViewportSize({ width: sevenAcrossPx, height: 900 });
    await expect.poll(() => row.getAttribute("data-gsap-slider-status")).toBe("not-active");
    await expect
      .poll(() => track.evaluate((element) => {
        const transform = new DOMMatrix(getComputedStyle(element).transform);
        return { x: transform.e, y: transform.f };
      }))
      .toEqual({ x: 0, y: 0 });
    for (const attribute of ["aria-hidden", "aria-selected", "tabindex", "role"]) {
      await expect(row.locator(`[data-gsap-slider-item][${attribute}]`)).toHaveCount(0);
    }
    await expect(row.locator("[data-gsap-slider-controls]")).toBeHidden();

    await page.setViewportSize({ width: sevenAcrossPx - 1, height: 900 });
    await expect.poll(() => row.getAttribute("data-gsap-slider-status")).toBe("active");
    await expect(row.locator("[data-gsap-slider-counter]")).toHaveText(new RegExp(`01\\s*/\\s*\\d+`));
  });

  test("hangs all looks in one row at the seven-across breakpoint", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: sevenAcrossPx, height: 900 });
    await page.goto("/");
    for (const row of await page.locator("#attire [data-gsap-slider-init]").all()) {
      const boxes = await row.locator(".attire_polaroid").evaluateAll((nodes) =>
        nodes.map((node) => {
          const { left, right } = (node.parentElement as HTMLElement).getBoundingClientRect();
          return { left, right, width: (node.parentElement as HTMLElement).offsetWidth };
        }),
      );
      expect(boxes).toHaveLength(lookItemCount);
      for (let index = 0; index < boxes.length; index += 1) {
        expect(boxes[index].width).toBeGreaterThanOrEqual(140);
        if (index > 0) expect(boxes[index].left).toBeGreaterThanOrEqual(boxes[index - 1].right - 0.5);
      }
      expect(boxes[0].left).toBeGreaterThanOrEqual(0);
      expect(boxes[boxes.length - 1].right).toBeLessThanOrEqual(sevenAcrossPx);
    }
  });

  // The global `svg { max-width: 100% }` once capped the string at the content width.
  for (const width of [320, 390, 768, 1199, 1440, 1920, 2560]) {
    test(`runs the clothesline string edge to edge at ${width}px`, { tag: ["@sweep"] }, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const rows = page.locator("#attire [data-gsap-slider-init]");
      await expect(rows).toHaveCount(lookGroupCount);
      for (const row of await rows.all()) {
        const string = row.locator(".attire_string:visible");
        await expect(string).toHaveCount(1);
        const box = await string.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeCloseTo(0, 0);
        expect(box!.x + box!.width).toBeCloseTo(width, 0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});
