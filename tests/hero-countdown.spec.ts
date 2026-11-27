import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { countdownState } from "../src/scripts/hero-countdown";

const heroCopy = JSON.parse(
  readFileSync("src/content/hero/hero.json", "utf8"),
) as { countdownToday: string };
const installClock = async (page: Page, time: string) => {
  await page.clock.install({ time: new Date(time) });
  await page.clock.pauseAt(new Date(time));
  await page.addInitScript(() =>
    localStorage.setItem("ew-test-skip-preloader", "1"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
};

test.describe("hero countdown", () => {
  test("renders source-derived values and ticks", async ({ page }) => {
    const instant = "2027-01-10T12:34:56Z";
    await installClock(page, instant);
    await page.goto("/");
    const expected = countdownState(Date.parse(instant));
    if (expected.state !== "counting")
      throw new Error("expected a counting state");
    for (const [unit, value] of Object.entries({
      days: expected.days,
      hours: expected.hours,
      minutes: expected.minutes,
      seconds: expected.seconds,
    })) {
      await expect(
        page.locator(`[data-countdown-unit="${unit}"] [data-countdown-value]`),
      ).toHaveText(
        unit === "days" ? String(value) : String(value).padStart(2, "0"),
      );
    }
    await expect(page.locator('[data-countdown-unit="seconds"]')).toBeVisible();
    await page.clock.runFor(1000);
    const next = countdownState(Date.parse(instant) + 1000);
    if (next.state !== "counting") throw new Error("expected a counting state");
    await expect(
      page.locator('[data-countdown-unit="seconds"] [data-countdown-value]'),
    ).toHaveText(String(next.seconds).padStart(2, "0"));
  });

  for (const timezoneId of ["America/Los_Angeles", "Asia/Manila"]) {
    test.describe(`timezone ${timezoneId}`, () => {
      test.use({ timezoneId });
      test("uses the same values", async ({ page }) => {
        const instant = "2027-01-10T12:34:56Z";
        await installClock(page, instant);
        await page.goto("/");
        const expected = countdownState(Date.parse(instant));
        if (expected.state !== "counting")
          throw new Error("expected a counting state");
        for (const [unit, value] of Object.entries({
          days: expected.days,
          hours: expected.hours,
          minutes: expected.minutes,
          seconds: expected.seconds,
        })) {
          await expect(
            page.locator(
              `[data-countdown-unit="${unit}"] [data-countdown-value]`,
            ),
          ).toHaveText(
            unit === "days" ? String(value) : String(value).padStart(2, "0"),
          );
        }
      });
    });
  }

  for (const { width, number } of [
    { width: 390, number: 44 },
    { width: 1440, number: 120 },
  ]) {
    test(`lays out four equal cells at ${width}px`, async ({ page }) => {
      await installClock(page, "2027-01-10T12:34:56Z");
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const cells = page.locator(".hero_countdown-cell");
      await expect(cells).toHaveCount(4);
      const boxes = await cells.evaluateAll((elements) =>
        elements.map((element) => {
          const { left, right, width } = element.getBoundingClientRect();
          return { left, right, width };
        }),
      );
      for (const box of boxes)
        expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(1.5);
      for (let index = 1; index < boxes.length; index += 1)
        expect(boxes[index].left).toBeGreaterThanOrEqual(
          boxes[index - 1].right - 1,
        );
      expect(boxes[3].right).toBeLessThanOrEqual(width);
      const size = await page
        .locator(".hero_countdown-number")
        .first()
        .evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        );
      expect(size).toBeCloseTo(number, 0);
    });
  }

  test("shows the today state at Manila morning", async ({ page }) => {
    await installClock(page, "2027-01-14T01:00:00Z");
    await page.goto("/");
    await expect(page.locator(".hero_countdown-today")).toBeVisible();
    await expect(page.locator(".hero_countdown-counting")).toBeHidden();
    await expect(page.locator(".hero_countdown-today")).toHaveText(
      heroCopy.countdownToday,
    );
  });

  test("switches to today at the live boundary", async ({ page }) => {
    await installClock(page, "2027-01-13T15:59:58Z");
    await page.goto("/");
    await page.clock.runFor(3000);
    await expect(page.locator(".hero_countdown-today")).toBeVisible();
    await expect(page.locator(".hero_countdown-counting")).toBeHidden();
  });

  test("hides after the wedding day", async ({ page }) => {
    await installClock(page, "2027-01-14T16:00:00Z");
    await page.goto("/");
    await expect(page.locator("[data-hero-countdown]")).toBeHidden();
  });
});
