import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const accept = async (
  page: import("@playwright/test").Page,
  companion = true,
  beforeSubmit?: () => Promise<void>,
) => {
  const rsvp = page.locator("#rsvp");
  await rsvp.locator("[data-rsvp-name]").fill("Liza Santos");
  await rsvp.getByRole("button", { name: /Find my invite/ }).click();
  if (companion) {
    await rsvp.getByRole("button", { name: "Add name for seat 2" }).click();
    await rsvp.locator("[aria-label='Name for seat 2']").fill("Marco Santos");
    await rsvp.getByRole("button", { name: /Done editing seat 2/ }).click();
  }
  await rsvp.getByRole("button", { name: /Continue/ }).click();
  await rsvp.locator("#rsvp-email").fill("liza@example.com");
  await beforeSubmit?.();
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
      "Liza & Marco",
    );
    await expect(dialog.locator("[data-ticket-names-line]")).toHaveText(
      "Liza & Marco · Joyfully accepts",
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
    const notchAlpha = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const tearY = Math.round((24.75 / 32.5) * canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const alphaAt = (x: number, y: number) =>
        pixels[(y * canvas.width + x) * 4 + 3];
      return {
        left: alphaAt(1, tearY),
        right: alphaAt(canvas.width - 2, tearY),
        center: alphaAt(Math.floor(canvas.width / 2), tearY),
      };
    }, pngBytes.toString("base64"));
    expect(notchAlpha.left).toBe(0);
    expect(notchAlpha.right).toBe(0);
    expect(notchAlpha.center).toBe(255);
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

  test("keeps tilt properties local to the ticket", async ({ page }) => {
    await page.goto("/");
    test.skip(
      !(await page.evaluate(() =>
        matchMedia(
          "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
        ).matches,
      )),
      "tilt is disabled for touch or reduced-motion projects",
    );
    const dialog = await accept(page, false);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-ticket-popup]")).toHaveAttribute(
      "data-stage",
      "released",
      { timeout: 15_000 },
    );
    const ticket = dialog.locator("[data-ticket]");
    await expect(ticket).toHaveClass(/is-released/, { timeout: 15_000 });
    const box = await ticket.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
      box!.x + box!.width * 0.2,
      box!.y + box!.height * 0.2,
      { steps: 5 },
    );
    await page.waitForTimeout(50);
    const values = await ticket.evaluate((element) => ({
      ticket: getComputedStyle(element).getPropertyValue("--tilt-x"),
      descendant: getComputedStyle(element.querySelector("strong")!).getPropertyValue("--tilt-x"),
    }));
    expect(values.ticket).not.toBe("0deg");
    expect(values.descendant).toBe("0deg");
  });

  test("uses cut-out perforations and a full-screen confetti layer", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const dialog = await accept(page, false);
    await expect(dialog.locator("[data-ticket-popup]")).toHaveAttribute(
      "data-stage",
      "released",
    );
    await expect(
      dialog.locator("[data-ticket-confetti] .ticket-popup_confetti-piece"),
    ).not.toHaveCount(0);

    const ticket = dialog.locator("[data-ticket]");
    const details = await dialog.evaluate((element) => {
      const ticket = element.querySelector<HTMLElement>("[data-ticket]")!;
      const ticketBox = ticket.getBoundingClientRect();
      const pieceBoxes = [
        ...element.querySelectorAll<HTMLElement>(
          ".ticket-popup_confetti-piece",
        ),
      ].map((piece) => piece.getBoundingClientRect());
      const style = getComputedStyle(ticket);
      return {
        hasNotches: Boolean(element.querySelector(".ticket-popup_notch")),
        maskImage: style.maskImage,
        pointerEvents: getComputedStyle(
          element.querySelector<HTMLElement>("[data-ticket-confetti]")!,
        ).pointerEvents,
        // The burst spans the viewport, not just the ticket.
        spansViewport:
          Math.max(...pieceBoxes.map((piece) => piece.right)) -
            Math.min(...pieceBoxes.map((piece) => piece.left)) >
          Math.max(window.innerWidth * 0.8, ticketBox.width + 40),
      };
    });
    expect(details.hasNotches).toBe(false);
    expect(details.maskImage).not.toBe("none");
    expect(details.pointerEvents).toBe("none");
    expect(details.spansViewport).toBe(true);
    await expect(ticket).toBeVisible();
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
    await accept(page, false, async () => {
      await page.evaluate(() => {
        const state = {
          samples: [] as Array<[number, number]>,
          resolved: false,
          sawPrinting: false,
        };
        Object.assign(window, { __ticketFeed: state });

        const started = performance.now();
        const sample = () => {
          const modal = document.querySelector("#rsvp-ticket-modal");
          const ticket = modal?.querySelector<HTMLElement>("[data-ticket]");
          const popup = ticket?.closest<HTMLElement>("[data-ticket-popup]");
          const stage = popup?.dataset.stage;
          if (ticket && popup && stage === "printing") {
            state.sawPrinting = true;
            const machine = ticket
              .closest("[data-ticket-graphic]")!
              .querySelector(".ticket-popup_machine")!;
            state.samples.push([
              performance.now(),
              ticket.getBoundingClientRect().top -
                machine.getBoundingClientRect().bottom,
            ]);
          } else if (
            ticket &&
            popup &&
            state.sawPrinting &&
            (stage === "printed" || stage === "released")
          ) {
            const machine = ticket
              .closest("[data-ticket-graphic]")!
              .querySelector(".ticket-popup_machine")!;
            state.samples.push([
              performance.now(),
              ticket.getBoundingClientRect().top -
                machine.getBoundingClientRect().bottom,
            ]);
            state.resolved = true;
            return;
          }
          if (performance.now() - started >= 15_000) {
            state.resolved = true;
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    });
    await page.waitForFunction(
      () =>
        (window as Window & { __ticketFeed?: { resolved: boolean } })
          .__ticketFeed?.resolved === true,
      undefined,
      { timeout: 15_000 },
    );
    const samples = await page.evaluate(() => {
      const state = (
        window as Window & {
          __ticketFeed?: { samples: Array<[number, number]> };
        }
      ).__ticketFeed;
      return state?.samples ?? [];
    });
    expect(samples.length).toBeGreaterThanOrEqual(2);
    const liveFirst = samples[0][1];
    const liveLast = samples.at(-1)![1];
    expect(liveLast - liveFirst).toBeGreaterThan(20);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index][1]).toBeGreaterThanOrEqual(
        samples[index - 1][1] - 1,
      );
    }

    const dialog = page.locator("#rsvp-ticket-modal");
    await page.locator("#rsvp-ticket-modal[open]").waitFor();
    const ticket = dialog.locator("[data-ticket]");

    const shape = await ticket.evaluate((ticket) => {
      const probe = ticket.cloneNode(true) as HTMLElement;
      probe.classList.remove("is-printed", "is-releasing", "is-released");
      probe.classList.add("is-printing");
      probe.setAttribute("aria-hidden", "true");
      probe.style.visibility = "hidden";
      ticket.parentElement!.append(probe);

      try {
        const animation = probe
          .getAnimations()
          .find(
            (candidate) =>
              (candidate as CSSAnimation).animationName === "ticket-feed",
          );
        if (!animation) throw new Error("ticket-feed animation not found");

        const duration = Number(animation.effect?.getComputedTiming().duration);
        if (!Number.isFinite(duration))
          throw new Error("ticket-feed animation has no finite duration");

        const values: Array<[number, number]> = [];
        const measure = () => {
          const transform = getComputedStyle(probe).transform;
          return transform === "none" ? 0 : new DOMMatrix(transform).f;
        };

        animation.pause();
        for (let time = 0; time <= duration; time += 10) {
          animation.currentTime = Math.min(time, duration);
          values.push([time, measure()]);
        }
        if (values.at(-1)![0] < duration) {
          animation.currentTime = duration;
          values.push([duration, measure()]);
        }

        const first = values[0][1];
        const last = values.at(-1)![1];
        let plateaus = 0;
        let runStart = 0;
        for (let index = 1; index <= values.length; index += 1) {
          const still =
            index < values.length &&
            Math.abs(values[index][1] - values[index - 1][1]) < 1;
          if (still) continue;
          const [startTime, value] = values[runStart];
          const span = values[index - 1][0] - startTime;
          if (span >= 40 && value > first + 1 && value < last - 1)
            plateaus += 1;
          runStart = index;
        }
        return { values, plateaus };
      } finally {
        probe.remove();
      }
    });

    const shapeFirst = shape.values[0][1];
    const shapeLast = shape.values.at(-1)![1];
    expect(shapeLast - shapeFirst).toBeGreaterThan(20);
    for (let index = 1; index < shape.values.length; index += 1) {
      expect(shape.values[index][1]).toBeGreaterThanOrEqual(
        shape.values[index - 1][1] - 1,
      );
    }
    expect(shape.plateaus).toBeGreaterThanOrEqual(3);
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
