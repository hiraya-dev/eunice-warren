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

  for (const { width, height, wide } of [
    { width: 1440, height: 900, wide: true },
    { width: 390, height: 844, wide: false },
  ]) {
    test(`pins the approved countdown styles at ${width}px`, async ({
      page,
    }) => {
      await installClock(page, "2027-01-10T12:34:56Z");
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(page.locator(".hero_countdown-cell")).toHaveCount(4);
      const measured = await page.evaluate(() => {
        const token = (name: string) => {
          const probe = document.createElement("span");
          probe.style.color = `var(${name})`;
          document.body.append(probe);
          const colour = getComputedStyle(probe).color;
          probe.remove();
          return colour;
        };
        const cells = [
          ...document.querySelectorAll(".hero_countdown-cell"),
        ].map((cell) => {
          const style = getComputedStyle(cell);
          const number = getComputedStyle(
            cell.querySelector(".hero_countdown-number")!,
          );
          const label = getComputedStyle(
            cell.querySelector(".hero_countdown-label")!,
          );
          return {
            width: cell.getBoundingClientRect().width,
            borderWidth: Number.parseFloat(style.borderLeftWidth),
            borderStyle: style.borderLeftStyle,
            borderColor: style.borderLeftColor,
            numberColor: number.color,
            numberWeight: number.fontWeight,
            numberSize: Number.parseFloat(number.fontSize),
            labelColor: label.color,
          };
        });
        const whenLine = document
          .querySelector(".hero_when-line")!
          .getBoundingClientRect();
        const venue = document
          .querySelector(".hero_venue")!
          .getBoundingClientRect();
        return {
          cells,
          light300: token("--light-300"),
          dark900: token("--dark-900"),
          dark700: token("--dark-700"),
          accent500: token("--accent-500"),
          whenTop: whenLine.top,
          whenBottom: whenLine.bottom,
          whenRight: whenLine.right,
          venueLeft: venue.left,
          venueTop: venue.top,
        };
      });
      const [days, ...rest] = measured.cells;

      if (wide) {
        for (const cell of measured.cells) {
          expect(Math.abs(cell.width - 176)).toBeLessThanOrEqual(1);
          expect(cell.numberSize).toBeCloseTo(120, 0);
        }
      }

      expect(days.borderWidth).toBe(0);
      for (const cell of rest) {
        expect(cell.borderWidth).toBeCloseTo(1, 1);
        expect(cell.borderStyle).toBe("solid");
        expect(cell.borderColor).toBe(measured.light300);
      }

      expect(days.numberColor).toBe(measured.dark900);
      expect(days.numberWeight).toBe("400");
      expect(days.labelColor).toBe(measured.accent500);
      for (const cell of rest) {
        expect(cell.numberColor).toBe("rgb(174, 180, 198)");
        expect(cell.numberWeight).toBe("200");
        expect(cell.labelColor).toBe(measured.dark700);
      }

      if (wide) {
        expect(
          Math.abs(measured.venueTop - measured.whenTop),
        ).toBeLessThanOrEqual(2);
        expect(measured.venueLeft).toBeGreaterThanOrEqual(
          measured.whenRight - 1,
        );
      } else {
        expect(measured.venueTop).toBeGreaterThanOrEqual(measured.whenBottom);
      }
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
