import { expect, test } from "@playwright/test";

// How far (px) a pill's background layer sits from the pill's own edges. Runs in the page.
const bgOffset = (element: Element) => {
  const pill = element.getBoundingClientRect();
  const bg = element.querySelector(".button-016__bg")!.getBoundingClientRect();
  return Math.max(Math.abs(pill.top - bg.top), Math.abs(pill.right - bg.right), Math.abs(pill.bottom - bg.bottom), Math.abs(pill.left - bg.left));
};

test.describe("Button 016 hover controls", () => {
  test("keeps the control names unique", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const controls = [page.locator(".nav_rsvp"), page.locator(".hero_rsvp"), page.locator(".hero_weekend")];
    for (const control of controls) await expect(control).toHaveCount(1);
    const names = await Promise.all(controls.map((control) => control.evaluate((element) => (element.getAttribute("aria-label") ?? element.textContent ?? "").trim())));
    for (const name of names) expect(name).not.toBe("");
    expect(new Set(names).size).toBe(controls.length);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-navigation-toggle="toggle"]').click();
    await expect(page.locator(".navigation_rsvp")).toHaveCount(1);
    await expect(page.locator(".navigation_rsvp")).toBeVisible();
    await expect(page.locator(".hero_rsvp")).toHaveCount(1);
  });

  test("keeps each background flush with its pill", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    // Pills only: the weekend link uses the roll without a background layer.
    for (const pill of await page.locator("[data-button-016].pill").all()) {
      await expect.poll(() => pill.evaluate(bgOffset)).toBeLessThanOrEqual(1);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-navigation-toggle="toggle"]').click();
    const panelPill = page.locator(".navigation_rsvp");
    await expect.poll(() => panelPill.evaluate(bgOffset)).toBeLessThanOrEqual(1);
  });

  test("rolls the text and changes the background on fine-pointer hover", { tag: ["@sweep"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const supportsHover = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
    const pill = page.locator(".nav_rsvp");
    const text = pill.locator(".button-016__text");
    const background = pill.locator(".button-016__bg");
    const restColor = await background.evaluate((element) => getComputedStyle(element).backgroundColor);
    await pill.hover();

    if (supportsHover) {
      await expect.poll(() => background.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(restColor);
      await expect.poll(() => text.evaluate((element) => {
        const style = getComputedStyle(element);
        const value = style.translate.split(" ")[1] || "0px";
        return Number.parseFloat(value) / Number.parseFloat(style.fontSize);
      })).toBeCloseTo(-2, 1);
    } else {
      await expect.poll(() => background.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(restColor);
      await expect.poll(() => text.evaluate((element) => getComputedStyle(element).translate)).not.toContain("-");
    }
  });

  test("preserves the three pill heights", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect.poll(() => page.locator(".nav_rsvp").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(40);
    await expect.poll(() => page.locator(".nav_rsvp").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(42);
    await expect.poll(() => page.locator(".hero_rsvp").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(51);
    await expect.poll(() => page.locator(".hero_rsvp").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(53);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-navigation-toggle="toggle"]').click();
    await expect.poll(() => page.locator(".navigation_rsvp").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(53);
    await expect.poll(() => page.locator(".navigation_rsvp").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(55);
  });

  test("does not roll or recolor under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const pill = page.locator(".nav_rsvp");
    const text = pill.locator(".button-016__text");
    const background = pill.locator(".button-016__bg");
    const restColor = await background.evaluate((element) => getComputedStyle(element).backgroundColor);
    await pill.hover();
    await expect.poll(() => background.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(restColor);
    await expect.poll(() => text.evaluate((element) => getComputedStyle(element).translate)).not.toContain("-");
  });
});

test("rolls the weekend link's text on fine-pointer hover without a background", { tag: ["@sweep"] }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const supportsHover = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches);
  const link = page.locator(".hero_weekend");
  const text = link.locator(".button-016__text");
  await link.hover();
  const lineHeight = await text.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight));
  // The roll moves the label up by two line heights, onto its text-shadow copy.
  const expected = supportsHover ? -2 * lineHeight : 0;
  await expect.poll(() => text.evaluate((element) => {
    const translate = getComputedStyle(element).translate;
    return translate === "none" ? 0 : Number.parseFloat(translate.split(" ")[1] ?? "0");
  })).toBeCloseTo(expected, 0);
  expect(await link.locator(".button-016__bg").count()).toBe(0);
});
