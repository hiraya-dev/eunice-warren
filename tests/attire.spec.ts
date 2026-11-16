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

// The viewport width at which the row switches from the swipe slider to two clotheslines.
const twoLineRem = Number(
  attireSource.match(/@media \(min-width: ([\d.]+)rem\) \{(?:(?!@media)[\s\S])*?--slider-status: off/)?.[1],
);
const twoLinePx = twoLineRem * 16;
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

  test("clears the slider when resized across the two-line breakpoint and back", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    expect(twoLinePx).toBeGreaterThan(0);
    await page.setViewportSize({ width: twoLinePx - 1, height: 900 });
    await page.goto("/");
    const row = page.locator("#attire [data-gsap-slider-init]").first();
    const track = row.locator("[data-gsap-slider-list]");
    await expect(row).toHaveAttribute("data-gsap-slider-status", "active");
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator('[data-gsap-slider-control="next"]')).toBeVisible();
    await row.locator('[data-gsap-slider-control="next"]').click();
    await expect.poll(() => track.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).e)).toBeLessThan(-1);

    await page.setViewportSize({ width: twoLinePx, height: 900 });
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

    await page.setViewportSize({ width: twoLinePx - 1, height: 900 });
    await expect.poll(() => row.getAttribute("data-gsap-slider-status")).toBe("active");
    await expect(row.locator("[data-gsap-slider-counter]")).toHaveText(new RegExp(`01\\s*/\\s*\\d+`));
  });

  for (const width of [twoLinePx, 1440, 1920]) {
    test(`hangs the looks on two clotheslines at ${width}px`, { tag: ["@sweep", "@single"] }, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      for (const group of await page.locator("#attire .attire_looks").all()) {
        await group.scrollIntoViewIfNeeded();
        const row = group.locator("[data-gsap-slider-init]");
        const items = row.locator("[data-gsap-slider-item]");
        await expect(items).toHaveCount(lookItemCount);
        for (const item of await items.all()) {
          await item.scrollIntoViewIfNeeded();
          await expect(item.locator(".attire_polaroid")).toHaveCSS("opacity", "1");
        }
        const boxes = await items.evaluateAll((nodes) =>
          nodes.map((node) => {
            const { left, right, top, bottom } = node.getBoundingClientRect();
            return { left, right, top, bottom, width: (node as HTMLElement).offsetWidth };
          }),
        );
        const firstLine = boxes.slice(0, 4);
        const secondLine = boxes.slice(4);
        // Cards stay at least ~220px wide and never exceed the 276px design size.
        for (const box of boxes) {
          expect(box.width).toBeGreaterThanOrEqual(220);
          expect(box.width).toBeLessThanOrEqual(276.5);
        }
        expect(secondLine).toHaveLength(lookItemCount - 4);
        // Line 1 sits above line 2, each in reading order with no overlap.
        const firstBottom = Math.max(...firstLine.map((box) => box.bottom));
        for (const box of secondLine) expect(box.top).toBeGreaterThan(firstBottom - 1);
        for (const line of [firstLine, secondLine]) {
          for (let index = 1; index < line.length; index += 1) {
            expect(line[index].left).toBeGreaterThanOrEqual(line[index - 1].right - 0.5);
          }
        }
        // Line 2 is centred on the viewport.
        const lineLeft = secondLine[0].left;
        const lineRight = secondLine[secondLine.length - 1].right;
        expect((lineLeft + lineRight) / 2).toBeCloseTo(width / 2, 0);
        expect(firstLine[0].left).toBeGreaterThanOrEqual(0);
        expect(firstLine[3].right).toBeLessThanOrEqual(width);
        // Each line has its own string, and every card peg sits on its string.
        const strings = row.locator(".attire_string:visible");
        await expect(strings).toHaveCount(2);
        const stringBoxes = [await strings.nth(0).boundingBox(), await strings.nth(1).boundingBox()];
        expect(stringBoxes[0]!.y).toBeLessThan(firstLine[0].top);
        expect(stringBoxes[1]!.y).toBeGreaterThan(firstBottom - 1);
        expect(stringBoxes[1]!.y).toBeLessThan(secondLine[0].top);
        for (const [index, box] of [...firstLine, ...secondLine].entries()) {
          const peg = await items.nth(index).locator(".attire_peg").boundingBox();
          const string = stringBoxes[index < 4 ? 0 : 1]!;
          expect(peg!.y).toBeGreaterThanOrEqual(string.y);
          expect(peg!.y).toBeLessThan(string.y + string.height);
          expect(box.top).toBeGreaterThan(string.y);
        }
        // The group heading is stacked and centred on the page.
        const title = await group.locator(".attire_looks-title").boundingBox();
        const copy = await group.locator(".attire_looks-copy").boundingBox();
        expect(title!.x + title!.width / 2).toBeCloseTo(width / 2, -1);
        expect(copy!.x + copy!.width / 2).toBeCloseTo(width / 2, -1);
        expect(copy!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
        expect(copy!.width).toBeLessThanOrEqual(480);
        // Both strings run edge to edge.
        for (const box of stringBoxes) {
          expect(box!.x).toBeCloseTo(0, 0);
          expect(box!.x + box!.width).toBeCloseTo(width, 0);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  // The global `svg { max-width: 100% }` once capped the string at the content width.
  for (const width of [320, 390, 768, 1151, 1152, 1440, 1920, 2560]) {
    test(`runs the clothesline string edge to edge at ${width}px`, { tag: ["@sweep"] }, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const rows = page.locator("#attire [data-gsap-slider-init]");
      await expect(rows).toHaveCount(lookGroupCount);
      for (const row of await rows.all()) {
        const strings = row.locator(".attire_string:visible");
        // One string in the slider, one per clothesline on desktop.
        await expect(strings).toHaveCount(width >= twoLinePx ? 2 : 1);
        for (const string of await strings.all()) {
          const box = await string.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeCloseTo(0, 0);
          expect(box!.x + box!.width).toBeCloseTo(width, 0);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});
