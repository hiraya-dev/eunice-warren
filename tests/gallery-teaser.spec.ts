import { expect, test, type Page } from "@playwright/test";

const polaroids = "#gallery .gallery_slot .gallery_polaroid";

const scrollSectionIn = async (page: Page, top = 60) => {
  await page.evaluate((offset) => {
    const section = document.querySelector<HTMLElement>("#gallery")!;
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - offset);
  }, top);
  await expect
    .poll(() => page.evaluate(() => Math.round(document.querySelector("#gallery")!.getBoundingClientRect().top)))
    .toBe(top);
};

const slotShift = (page: Page, tier: "near" | "mid" | "far") =>
  page.evaluate((name) => {
    const slot = Array.from(document.querySelectorAll<HTMLElement>(`#gallery .gallery_slot.${name}`)).find(
      (item) => item.getClientRects().length,
    )!;
    const value = getComputedStyle(slot).translate;
    const [x, y] = value === "none" ? [0, 0] : value.split(" ").map(parseFloat);
    return { x, y: y ?? 0 };
  }, tier);

const perceptibleAnimations = (element: Element) =>
  element
    .getAnimations({ subtree: true })
    .filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return Number(timing?.duration ?? 0) + Number(timing?.delay ?? 0) > 1;
    })
    .map((animation) => animation.id || animation.constructor.name);

const copyBox = (page: Page) =>
  page.evaluate(() => {
    const rect = document.querySelector(".gallery_content")!.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });

const expectSettled = async (page: Page) => {
  await expect(page.locator("#gallery")).toHaveAttribute("data-teaser-reveal", "done", { timeout: 5000 });
  const state = await page.locator(polaroids).evaluateAll((items) =>
    items.map((item) => {
      const styles = getComputedStyle(item);
      return { opacity: styles.opacity, transform: styles.transform };
    }),
  );
  expect(state.length).toBeGreaterThan(5);
  for (const item of state) expect(item).toEqual({ opacity: "1", transform: "none" });
  const slots = await page.locator("#gallery .gallery_slot").evaluateAll((items) =>
    items.filter((item) => item.getClientRects().length).map((item) => ({
      tier: ["near", "mid", "far"].find((name) => item.classList.contains(name)),
      opacity: Number(getComputedStyle(item).opacity),
      rotate: getComputedStyle(item).rotate,
    })),
  );
  for (const slot of slots) {
    expect(slot.rotate).not.toBe("none");
    if (slot.tier === "near") expect(slot.opacity).toBe(1);
    if (slot.tier === "mid") expect(slot.opacity).toBeCloseTo(0.92, 2);
    if (slot.tier === "far") expect(slot.opacity).toBeGreaterThan(0.4);
  }
};

test.describe("gallery teaser, fine pointer", { tag: ["@single", "@sweep"] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("polaroids settle in once the section scrolls into view", async ({ page }) => {
    await page.goto("/");
    await expect
      .poll(() => page.locator(polaroids).first().evaluate((item) => getComputedStyle(item).opacity))
      .toBe("0");
    await scrollSectionIn(page);
    await expectSettled(page);
    await expect(page.locator(".gallery_title")).toHaveCSS("opacity", "1");
  });

  test("polaroids drift with the pointer by tier and return on leave", async ({ page }) => {
    await page.goto("/");
    test.skip(
      !(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)),
      "needs a fine pointer",
    );
    await scrollSectionIn(page);
    await expectSettled(page);

    const copyBefore = await copyBox(page);
    await page.mouse.move(720, 450);
    await page.mouse.move(1438, 450, { steps: 8 });

    await expect
      .poll(async () => (await slotShift(page, "near")).x, { timeout: 5000 })
      .toBeGreaterThan(10);
    const near = await slotShift(page, "near");
    const mid = await slotShift(page, "mid");
    const far = await slotShift(page, "far");
    expect(near.x).toBeLessThanOrEqual(15);
    expect(near.x).toBeGreaterThan(mid.x);
    expect(mid.x).toBeGreaterThan(far.x);
    expect(far.x).toBeGreaterThan(0.5);
    expect(far.x).toBeLessThanOrEqual(5);

    expect(await copyBox(page)).toEqual(copyBefore);
    expect(
      await page.locator(polaroids).evaluateAll((items) => items.map((item) => getComputedStyle(item).transform)),
    ).toEqual(Array(await page.locator(polaroids).count()).fill("none"));

    await page.mouse.move(720, 20, { steps: 4 });
    await expect
      .poll(async () => Math.max(...(await Promise.all((["near", "mid", "far"] as const).map(async (tier) => Math.abs((await slotShift(page, tier)).x)))))
      , { timeout: 5000 })
      .toBeLessThan(0.5);
  });

  test("Step inside still opens the canvas right after the section arrives", async ({ page }) => {
    await page.goto("/");
    await scrollSectionIn(page);
    await page.locator("[data-gallery-open]").click();
    await expect(page.locator("#gallery-overlay")).toHaveAttribute("data-gallery-state", "canvas");
  });
});

test.describe("gallery teaser, reduced motion", { tag: ["@single", "@sweep"] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("nothing animates in and nothing follows the pointer", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await scrollSectionIn(page);

    const state = await page.locator(polaroids).evaluateAll((items) =>
      items.map((item) => ({ opacity: getComputedStyle(item).opacity, transform: getComputedStyle(item).transform })),
    );
    for (const item of state) expect(item).toEqual({ opacity: "1", transform: "none" });
    await expect(page.locator(".gallery_title")).toHaveCSS("opacity", "1");
    expect(await page.locator("#gallery").evaluate(perceptibleAnimations)).toEqual([]);

    await page.mouse.move(720, 450);
    await page.mouse.move(1438, 450, { steps: 8 });
    await page.waitForTimeout(600);
    for (const tier of ["near", "mid", "far"] as const) expect(await slotShift(page, tier)).toEqual({ x: 0, y: 0 });
    expect(await page.locator("#gallery").evaluate(perceptibleAnimations)).toEqual([]);
  });
});

test.describe("gallery teaser, touch", { tag: ["@single", "@sweep"] }, () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("reveals, and does not follow a pointer", async ({ page }) => {
    await page.goto("/");
    await scrollSectionIn(page, 40);
    await expectSettled(page);
    await page.mouse.move(380, 400);
    await page.waitForTimeout(500);
    for (const tier of ["near", "far"] as const) expect(await slotShift(page, tier)).toEqual({ x: 0, y: 0 });
  });
});
