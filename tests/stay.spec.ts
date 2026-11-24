import { expect, test, type Page } from "@playwright/test";
import { reveal } from "./helpers/reveal";

// The mobile timeline: one solid segment per gap between steps, each scrubbed with scaleY, and a
// filled circle (.is-reached) for every step the line has reached.
const readTimeline = (page: Page) => page.evaluate(() => {
  const lines = Array.from(document.querySelectorAll<HTMLElement>("#stay .stay_step-line")).map((line) => new DOMMatrix(getComputedStyle(line).transform).d);
  const reached = Array.from(document.querySelectorAll<HTMLElement>("#stay .stay_step")).map((step) => step.classList.contains("is-reached"));
  return { lines, progress: lines.reduce((sum, value) => sum + value, 0) / lines.length, reached };
});

const scrollSettled = async (page: Page, y: number) => {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForFunction((top) => Math.abs(window.scrollY - top) < 2, y);
  await page.waitForTimeout(250);
};

test.describe("stay section", () => {
  test("uses the desktop directions layout", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const steps = await page.locator("#stay .stay_step").evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return { top: box.top, left: box.left }; }));
    expect(steps[0].top).toBe(steps[1].top);
    expect(steps[1].top).toBe(steps[2].top);
    expect(steps[1].left).toBeGreaterThan(steps[0].left);
    expect(steps[2].left).toBeGreaterThan(steps[1].left);
    await expect(page.locator("#stay .stay_title")).toHaveCSS("font-size", "120px");
    await expect(page.locator("#stay .stay_compass")).toBeVisible();
    await expect(page.locator("#stay .stay_map")).toHaveCount(0);
    expect(await page.locator("#stay .stay_compass").evaluate((compass) => compass.getBoundingClientRect().width)).toBeCloseTo(460, 0);
  });

  test("stacks the directions on mobile", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const result = await page.evaluate(() => {
      const steps = Array.from(document.querySelectorAll<HTMLElement>("#stay .stay_step")).map((item) => item.getBoundingClientRect().top);
      return { steps };
    });
    expect(result.steps[1]).toBeGreaterThan(result.steps[0]);
    expect(result.steps[2]).toBeGreaterThan(result.steps[1]);
    await expect(page.locator("#stay .stay_compass")).toBeVisible();
    await expect(page.locator("#stay .stay_compass")).toHaveCount(1);
    await expect(page.locator("#stay .stay_compass_wrap")).toHaveAttribute("aria-hidden", "true");
    expect(await page.locator("#stay .stay_compass").evaluate((compass) => compass.getBoundingClientRect().width)).toBeLessThanOrEqual(350);
    await expect(page.locator("#stay .stay_map")).toHaveCount(0);
  });

  test("follows the pointer and returns to the destination bearing", { tag: ["@sweep"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "pointer follow only runs on hover-capable fine pointers");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const stay = page.locator("#stay");
    await stay.scrollIntoViewIfNeeded();
    const box = await stay.boundingBox();
    expect(box).not.toBeNull();
    const samples: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      await page.mouse.move(box!.x + 150 + index * 45, box!.y + 120 + index * 15);
      await page.waitForTimeout(60);
      samples.push(Number(await page.locator("#stay .stay_compass-needle").getAttribute("data-angle")));
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(5);
    await page.mouse.move(0, 0);
    await expect.poll(async () => Number(await page.locator("#stay .stay_compass-needle").getAttribute("data-angle")), { timeout: 2000 }).toBeCloseTo(22, 0);
  });

  test("swings in once and settles on the destination bearing on touch", { tag: ["@sweep"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "touch entrance only runs without a fine pointer");
    await page.goto("/");
    const needle = page.locator("#stay .stay_compass-needle");
    await expect(needle).toHaveAttribute("data-angle", "22");
    await page.locator("#stay .stay_compass").scrollIntoViewIfNeeded();
    const samples: number[] = [];
    const start = Date.now();
    while (Date.now() - start < 600) {
      samples.push(Number(await needle.getAttribute("data-angle")));
      await page.waitForTimeout(30);
    }
    expect(samples.some((angle) => angle > 180)).toBeTruthy();
    expect(samples.every((angle) => angle < 90 || angle > 270)).toBeTruthy();
    await expect.poll(async () => Number(await needle.getAttribute("data-angle")), { timeout: 2500 }).toBeCloseTo(22, 0);
  });

  test("holds the destination bearing with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const stay = page.locator("#stay");
    await stay.scrollIntoViewIfNeeded();
    const box = await stay.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 100, box!.y + 100);
    await page.waitForTimeout(250);
    await expect(page.locator("#stay .stay_compass-needle")).toHaveAttribute("data-angle", "22");
  });

  test("draws a solid progress line down the mobile timeline as the steps scroll by", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await reveal(page.locator("#stay .stay_step").first());
    const steps = page.locator("#stay .stay_step");
    await expect(steps.first().locator(".stay_step-number")).toHaveCSS("transition-duration", /^0\.2[0-9]*s/);
    await expect(page.locator("#stay .stay_step-line")).toHaveCount(2);
    for (const line of await page.locator("#stay .stay_step-line").all()) {
      await expect(line).toHaveCSS("transform-origin", /^[\d.]+px 0px$/);
      await expect(line).toHaveCSS("width", "1.5px");
    }

    const { top, bottom } = await page.evaluate(() => {
      const list = document.querySelector("#stay .stay_steps")!.getBoundingClientRect();
      return { top: list.top + window.scrollY, bottom: list.bottom + window.scrollY };
    });
    await scrollSettled(page, Math.max(0, top - 844));
    const before = await readTimeline(page);
    expect(before.progress).toBeLessThan(0.05);
    expect(before.reached).toEqual([false, false, false]);

    const samples: Awaited<ReturnType<typeof readTimeline>>[] = [];
    for (let y = top - 700; y <= bottom; y += 120) {
      await scrollSettled(page, y);
      samples.push(await readTimeline(page));
    }
    await scrollSettled(page, bottom + 200);
    samples.push(await readTimeline(page));

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].progress).toBeGreaterThanOrEqual(samples[index - 1].progress - 0.001);
    }
    for (const sample of samples) {
      // Circles fill in order: never a later circle without the earlier ones.
      expect(sample.reached.every((filled, index) => !filled || sample.reached.slice(0, index).every(Boolean))).toBe(true);
      // A circle fills only once the line above it has been drawn.
      sample.reached.forEach((filled, index) => { if (index > 0 && filled) expect(sample.lines[index - 1]).toBeGreaterThan(0.95); });
    }
    expect(samples.some((sample) => sample.progress > 0.1 && sample.progress < 0.9)).toBe(true);
    expect(samples.some((sample) => sample.reached[0] && !sample.reached[1])).toBe(true);
    const last = samples[samples.length - 1];
    expect(last.progress).toBeCloseTo(1, 1);
    expect(last.reached).toEqual([true, true, true]);
    for (const circle of await steps.locator(".stay_step-number").all()) {
      await expect(circle).toHaveCSS("background-color", "rgb(245, 239, 227)");
    }

    await scrollSettled(page, Math.max(0, top - 844));
    const back = await readTimeline(page);
    expect(back.progress).toBeLessThan(0.05);
    expect(back.reached).toEqual([false, false, false]);
    await expect(steps.first().locator(".stay_step-number")).not.toHaveCSS("background-color", "rgb(245, 239, 227)");
  });

  test("shows the mobile timeline fully drawn and static with reduced motion", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator("#stay .stay_steps").scrollIntoViewIfNeeded();
    await scrollSettled(page, await page.evaluate(() => document.querySelector("#stay .stay_steps")!.getBoundingClientRect().top + window.scrollY - 200));
    const state = await readTimeline(page);
    expect(state.lines).toEqual([1, 1]);
    expect(state.reached).toEqual([false, false, false]);
    for (const circle of await page.locator("#stay .stay_step-number").all()) {
      await expect(circle).toHaveCSS("background-color", "rgb(245, 239, 227)");
      await expect(circle).toHaveCSS("color", "rgb(31, 47, 92)");
    }
    // Reduced motion shortens transitions to 0.01 ms; nothing perceptible may run (L-026).
    const running = await page.evaluate(() => Array.from(document.querySelectorAll("#stay .stay_steps, #stay .stay_steps *"))
      .flatMap((element) => element.getAnimations())
      .filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return timing ? Number(timing.duration) + Number(timing.delay) > 1 : false;
      }).length);
    expect(running).toBe(0);
    await scrollSettled(page, await page.evaluate(() => document.querySelector("#stay .stay_steps")!.getBoundingClientRect().top + window.scrollY - 500));
    expect((await readTimeline(page)).lines).toEqual([1, 1]);
  });

  test("keeps the directions reveal and tears the timeline down on desktop", { tag: ["@sweep", "@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await reveal(page.locator("#stay .stay_step").last());
    await expect(page.locator("#stay .stay_directions-title")).toHaveCSS("opacity", "1");
    await scrollSettled(page, await page.evaluate(() => document.querySelector("#stay .stay_steps")!.getBoundingClientRect().bottom + window.scrollY + 200));
    expect((await readTimeline(page)).reached).toEqual([true, true, true]);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(async () => (await readTimeline(page)).reached, { timeout: 3000 }).toEqual([false, false, false]);
    await expect(page.locator("#stay .stay_step-line").first()).toBeHidden();
    await expect(page.locator("#stay .stay_step-line").first()).toHaveCSS("transform", "none");
    const tops = await page.locator("#stay .stay_step").evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(tops[0]).toBe(tops[1]);
    expect(tops[1]).toBe(tops[2]);
    for (const circle of await page.locator("#stay .stay_step-number").all()) {
      await expect(circle).toHaveCSS("background-color", "rgb(31, 47, 92)");
    }
  });
});
