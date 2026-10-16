import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const accept = async (
  page: import("@playwright/test").Page,
  companion = true,
) => {
  const rsvp = page.locator("#rsvp");
  await rsvp.locator("[data-rsvp-name]").fill("Liza Santos");
  await rsvp.getByRole("button", { name: /Find my invite/ }).click();
  await rsvp.getByRole("button", { name: /Continue/ }).click();
  if (companion) await rsvp.locator("#rsvp-companion").fill("Marco Santos");
  await rsvp.locator("#rsvp-email").fill("liza@example.com");
  await rsvp.getByRole("button", { name: /Send RSVP/ }).click();
  return page.locator("#rsvp-ticket-modal");
};

test.describe("RSVP ticket popup", () => {
  test("accept prints the matched guest and decline does not open it", async ({
    page,
  }) => {
    await page.goto("/");
    const dialog = await accept(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-ticket-names]")).toHaveText(
      "Liza & Marco Santos",
    );
    await expect(dialog.locator("[data-ticket-names-line]")).toHaveText(
      "Liza & Marco Santos · Joyfully accepts",
    );
    await expect(dialog.locator("[data-ticket-count]")).toHaveText("×2");
    await expect(dialog.locator("[data-ticket-admit]")).toHaveText("Two");
    await expect(dialog.locator("[data-ticket-reference]")).toHaveText(
      "SANTOS",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator("[data-rsvp-panel=sent] h3")).toBeFocused();

    await page.reload();
    const rsvp = page.locator("#rsvp");
    await rsvp.locator("[data-rsvp-name]").fill("Ana Reyes");
    await rsvp.getByRole("button", { name: /Find my invite/ }).click();
    await rsvp.locator("input[value='no']").check();
    await rsvp.getByRole("button", { name: /Continue/ }).click();
    await rsvp.locator("#rsvp-email").fill("ana@example.com");
    await rsvp.getByRole("button", { name: /Send RSVP/ }).click();
    await expect(page.locator("#rsvp-ticket-modal")).toBeHidden();
  });

  test("downloads the PNG ticket and calendar", async ({ page }) => {
    await page.goto("/");
    const dialog = await accept(page);
    const png = page.waitForEvent("download");
    await dialog.locator("[data-ticket-save]").click();
    const download = await png;
    expect(download.suggestedFilename()).toBe(
      "eunice-warren-ticket-santos.png",
    );
    const pngBytes = await readFile((await download.path())!);
    expect([...pngBytes.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    const ics = page.waitForEvent("download");
    await dialog.locator("[data-ticket-calendar]").click();
    const calendar = await ics;
    expect(calendar.suggestedFilename()).toBe("eunice-warren-wedding.ics");
    const icsText = await readFile((await calendar.path())!, "utf8");
    expect(icsText).toContain("BEGIN:VCALENDAR");
    expect(icsText).toContain("DTSTART:20270114T070000Z");
    expect(icsText).toContain("\r\n");
  });

  test("reduced motion opens with the ticket visible", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const dialog = await accept(page);
    await expect(dialog.locator("[data-ticket]")).toHaveClass(/is-printed/);
    await expect(dialog.locator("[data-ticket-confetti]")).toBeEmpty();
  });

  test("fits the viewport at every target size", async ({ page }) => {
    // Four full RSVP flows in one test.
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(size);
      await page.goto("/");
      const dialog = await accept(page, false);
      // Measure once the dialog has opened and its entrance transition settled.
      await expect(dialog.locator("[data-ticket-popup]")).toHaveAttribute(
        "data-stage",
        "released",
        { timeout: 15_000 },
      );
      await page.waitForFunction(() => {
        const modal =
          document.querySelector<HTMLDialogElement>("#rsvp-ticket-modal");
        return (
          modal?.open &&
          modal
            .getAnimations({ subtree: true })
            .every(
              (animation) =>
                animation.playState !== "running" ||
                animation.effect?.getTiming().iterations === Infinity,
            )
        );
      });
      const bounds = await dialog.evaluate((element) => {
        const wrap = element
          .querySelector<HTMLElement>("[data-ticket-popup]")!
          .getBoundingClientRect();
        const ticket = element
          .querySelector("[data-ticket]")!
          .getBoundingClientRect();
        const save = element
          .querySelector("[data-ticket-save]")!
          .getBoundingClientRect();
        const scroll = element.querySelector("[data-modal-scroll]")!;
        return {
          wrap,
          ticket,
          save,
          scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight,
          width: innerWidth,
          height: innerHeight,
        };
      });
      expect(bounds.wrap.left).toBeGreaterThanOrEqual(-1);
      expect(bounds.wrap.top).toBeGreaterThanOrEqual(-1);
      expect(bounds.wrap.right).toBeLessThanOrEqual(bounds.width + 1);
      expect(bounds.wrap.bottom).toBeLessThanOrEqual(bounds.height + 1);
      const minimumTicketHeight =
        size.width === 1440
          ? 480
          : size.width === 1280
            ? 380
            : size.width === 390
              ? 380
              : 330;
      expect(bounds.ticket.height).toBeGreaterThanOrEqual(minimumTicketHeight);
      for (const box of [bounds.ticket, bounds.save]) {
        expect(box.left).toBeGreaterThanOrEqual(-1);
        expect(box.top).toBeGreaterThanOrEqual(-1);
        expect(box.right).toBeLessThanOrEqual(bounds.width + 1);
        expect(box.bottom).toBeLessThanOrEqual(bounds.height + 1);
      }
      expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.clientHeight);
      await page.keyboard.press("Escape");
    }
  });

  test("feeds the ticket with stepped motion", async ({ page }) => {
    await page.goto("/");
    const dialog = await accept(page, false);
    await page.locator("#rsvp-ticket-modal[open]").waitFor();
    const samples = await dialog.locator("[data-ticket]").evaluate(
      (ticket) =>
        new Promise<Array<[number, number]>>((resolve) => {
          // Measure against the printer so the dialog's own entrance motion is excluded.
          const machine = ticket
            .closest("[data-ticket-graphic]")!
            .querySelector(".ticket-popup_machine")!;
          const values: Array<[number, number]> = [];
          const started = performance.now();
          const sample = () => {
            const now = performance.now() - started;
            values.push([
              now,
              ticket.getBoundingClientRect().top -
                machine.getBoundingClientRect().bottom,
            ]);
            // Stop at the release, when the printer itself starts to move.
            const released =
              ticket.closest<HTMLElement>("[data-ticket-popup]")!.dataset
                .stage === "released";
            if (now < 2600 && !released) requestAnimationFrame(sample);
            else resolve(values);
          };
          requestAnimationFrame(sample);
        }),
    );
    const first = samples[0][1];
    const last = samples.at(-1)![1];
    expect(last - first).toBeGreaterThan(20);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index][1]).toBeGreaterThanOrEqual(
        samples[index - 1][1] - 1,
      );
    }
    // Headless frames arrive tens of ms apart, so holds are measured in wall-clock
    // time, and only between the start and end positions (the feed itself).
    let plateaus = 0;
    let runStart = 0;
    for (let index = 1; index <= samples.length; index += 1) {
      const still =
        index < samples.length &&
        Math.abs(samples[index][1] - samples[index - 1][1]) < 1;
      if (still) continue;
      const [startTime, value] = samples[runStart];
      const span = samples[index - 1][0] - startTime;
      if (span >= 40 && value > first + 1 && value < last - 1) plateaus += 1;
      runStart = index;
    }
    expect(plateaus).toBeGreaterThanOrEqual(3);
  });

  test("releases the ticket smoothly into the centred standalone state", async ({
    page,
  }) => {
    await page.goto("/");
    const dialog = await accept(page, false);
    await expect(dialog).toBeVisible();
    const samples = await dialog.locator("[data-ticket]").evaluate(
      (ticket) =>
        new Promise<{
          samples: Array<{ time: number; top: number; left: number }>;
          final: { ticket: DOMRect; wrap: DOMRect; machineOpacity: string };
        }>((resolve) => {
          const wrap = ticket.closest<HTMLElement>(
            ".ticket-popup_graphic-wrap",
          )!;
          const machine = ticket
            .closest("[data-ticket-graphic]")!
            .querySelector<HTMLElement>(".ticket-popup_machine")!;
          const values: Array<{ time: number; top: number; left: number }> = [];
          const started = performance.now();
          const sample = () => {
            const now = performance.now() - started;
            const rect = ticket.getBoundingClientRect();
            if (rect.width > 0)
              values.push({ time: now, top: rect.top, left: rect.left });
            if (now < 3600) {
              requestAnimationFrame(sample);
              return;
            }
            resolve({
              samples: values,
              final: {
                ticket: rect,
                wrap: wrap.getBoundingClientRect(),
                machineOpacity: getComputedStyle(machine).opacity,
              },
            });
          };
          requestAnimationFrame(sample);
        }),
    );
    const last = samples.final;
    expect(
      Math.abs(
        last.ticket.left +
          last.ticket.width / 2 -
          (last.wrap.left + last.wrap.width / 2),
      ),
    ).toBeLessThan(4);
    expect(
      Math.abs(
        last.ticket.top +
          last.ticket.height / 2 -
          (last.wrap.top + last.wrap.height / 2),
      ),
    ).toBeLessThan(4);
    expect(Number(last.machineOpacity)).toBe(0);

    let maxVelocity = 0;
    for (let index = 1; index < samples.samples.length; index += 1) {
      const previous = samples.samples[index - 1];
      const current = samples.samples[index];
      const elapsed = Math.max(1, current.time - previous.time);
      const distance = Math.hypot(
        current.left - previous.left,
        current.top - previous.top,
      );
      maxVelocity = Math.max(maxVelocity, distance / elapsed);
    }
    expect(maxVelocity).toBeLessThan(4.5);
  });
});
