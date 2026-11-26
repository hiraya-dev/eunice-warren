import { createHash } from "node:crypto";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeFixtures } from "../src/lib/rsvp/store.ts";
import { reveal } from "./helpers/reveal.ts";

const garciaLock = join(
  tmpdir(),
  `eunice-warren-garcia-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 12)}`,
);
const withGarciaLock = async (run: () => Promise<void>) => {
  for (;;) {
    try {
      mkdirSync(garciaLock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(garciaLock).mtimeMs > 60_000) rmSync(garciaLock, { recursive: true, force: true });
      } catch {
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    await run();
  } finally {
    rmSync(garciaLock, { recursive: true, force: true });
  }
};

const rsvp = (page: import("@playwright/test").Page) => page.locator("#rsvp");
const visiblePanels = (page: import("@playwright/test").Page) =>
  rsvp(page).locator("[data-rsvp-panel]:not([hidden])");
const mateoInvite = fakeFixtures.find((invite) => invite.id === "cruz")!;
const santosInvite = fakeFixtures.find((invite) => invite.id === "santos")!;
const chooseSlippers = async (page: import("@playwright/test").Page) => {
  for (const select of await rsvp(page).locator("[data-rsvp-slipper-list] select").all()) await select.selectOption("W 7");
};

test.describe("RSVP section", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await rsvp(page).scrollIntoViewIfNeeded();
    await reveal(rsvp(page).locator("[data-rsvp-name]"));
  });

  test("shows the RSVP deadline label", { tag: ["@single"] }, async ({ page }) => {
    await expect(rsvp(page).locator("[data-rsvp-intro]")).toContainText(
      "December 12",
    );
  });

  test("shows a stable busy spinner without changing the button name", { tag: ["@single"] }, async ({ page }) => {
    const button = rsvp(page).locator("[data-rsvp-find] button.rsvp_primary");
    await button.evaluate((element) => {
      element.setAttribute("aria-busy", "true");
      (element as HTMLButtonElement).disabled = true;
    });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button.locator(".rsvp_primary-spinner")).toBeVisible();
    await expect(button.locator(".rsvp_primary-arrow")).toBeHidden();
    await expect(button.locator(".rsvp_primary-label-busy")).toBeHidden();
    await expect(button).toHaveAccessibleName(/\S+/);
  });

  test("uses a visible busy label when reduced motion is requested", { tag: ["@single"] }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const button = rsvp(page).locator("[data-rsvp-find] button.rsvp_primary");
    await button.evaluate((element) => element.setAttribute("aria-busy", "true"));
    await expect(button.locator(".rsvp_primary-label-busy")).toBeVisible();
    await expect(button.locator(".rsvp_primary-spinner")).toBeHidden();
    await expect(button).toHaveAccessibleName(/\S+/);
  });

  test("keeps RSVP field layout stable when focused", { tag: ["@single"] }, async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const nameInput = rsvp(page).locator("[data-rsvp-name]");
      const nextBlock = nameInput.locator("xpath=following-sibling::*[1]");
      await nameInput.evaluate((input) => input.blur());
      await reveal(nameInput);

      const measure = () =>
        page.evaluate(() => {
          const input = document.querySelector<HTMLInputElement>("[data-rsvp-name]")!;
          const card = input.closest<HTMLElement>(".rsvp_card-wrap")!;
          const next = input.nextElementSibling!;
          const inputRect = input.getBoundingClientRect();
          const cardTop = card.getBoundingClientRect().top;
          const styles = getComputedStyle(input);
          return {
            input: { height: inputRect.height, width: inputRect.width },
            inputOffset: inputRect.top - cardTop,
            nextOffset: next.getBoundingClientRect().top - cardTop,
            borderTopWidth: styles.borderTopWidth,
            boxShadow: styles.boxShadow,
          };
        });

      const before = await measure();
      await nameInput.focus();
      const after = await measure();

      expect(after.input).toEqual(before.input);
      expect(after.inputOffset).toBe(before.inputOffset);
      expect(after.nextOffset).toBe(before.nextOffset);
      expect(after.borderTopWidth).toBe("1px");
      expect(after.boxShadow).not.toBe("none");
      await expect(nextBlock).toBeVisible();
    }
  });

  test("keeps the Find my invite button still when the Turnstile widget appears", { tag: ["@single"] }, async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const measure = () =>
        page.evaluate(() => {
          const button = document.querySelector<HTMLElement>("#rsvp [data-rsvp-panel]:not([hidden]) .rsvp_primary")!;
          const cardTop = button.closest<HTMLElement>(".rsvp_card-wrap")!.getBoundingClientRect().top;
          return button.getBoundingClientRect().top - cardTop;
        });
      const before = await measure();
      await page.evaluate(() => {
        const box = document.querySelector("#rsvp [data-rsvp-panel]:not([hidden]) [data-rsvp-turnstile]")!;
        box.replaceChildren();
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "display:block;width:300px;height:72px;border:0";
        box.append(iframe);
      });
      expect(Math.abs((await measure()) - before)).toBeLessThanOrEqual(1);
      await page.evaluate(() => document.querySelector("#rsvp [data-rsvp-panel]:not([hidden]) [data-rsvp-turnstile]")!.replaceChildren());
    }
  });

  test("finds invites case-insensitively and ignores accents and spacing", { tag: ["@single"] }, async ({
    page,
  }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("liza  SANTOS");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-panel='2']")).toBeVisible();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(rsvp(page).locator("[data-step='2']")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(rsvp(page).locator("[data-rsvp-first-name]")).toHaveText(
      "Liza",
    );
  });

  test("shows an error for an unknown name", { tag: ["@single"] }, async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Unknown Guest");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-name-error]")).toContainText(
      "We couldn't find that name",
    );
    await expect(rsvp(page).locator("[data-rsvp-panel='1']")).toBeVisible();
  });

  test("suggests a near match and confirms it", { tag: ["@single"] }, async ({ page }) => {
    const name = rsvp(page).locator("[data-rsvp-name]");
    await name.fill("Matoe Cruz");
    await rsvp(page).locator("[data-rsvp-find] button.rsvp_primary").click();
    await expect(rsvp(page).locator("[data-rsvp-name-error]")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-name-error]")).toContainText("Mateo Cruz");
    const confirm = rsvp(page).getByRole("button", { name: "Yes, that's me" });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(rsvp(page).locator("[data-rsvp-panel='2']")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-first-name]")).toHaveText("Mateo");
  });

  test("clears a near-match suggestion when the name changes", { tag: ["@single"] }, async ({ page }) => {
    const name = rsvp(page).locator("[data-rsvp-name]");
    await name.fill("Matoe Cruz");
    await rsvp(page).locator("[data-rsvp-find] button.rsvp_primary").click();
    const error = rsvp(page).locator("[data-rsvp-name-error]");
    await expect(error).toBeVisible();
    await name.fill("Nobody Example");
    await expect(error).toBeHidden();
    await expect(rsvp(page).locator("[data-rsvp-find] button.rsvp_primary")).toBeVisible();
  });

  test("recovers from a fictional store rejection", { tag: ["@single"] }, async ({ page }) => {
    const button = rsvp(page).getByRole("button", { name: /Find my invite/ });
    await rsvp(page).locator("[data-rsvp-name]").fill("Error Test");
    await button.click();
    await expect(rsvp(page).locator("[data-rsvp-name-error]")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-name]")).toHaveAttribute("aria-invalid", "true");
    await expect(button).toBeEnabled();
    await expect(rsvp(page).locator("[data-rsvp-panel='1']")).toBeVisible();
  });

  test("renders one checklist row per seat", { tag: ["@single"] }, async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Mateo Cruz");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-count]")).toHaveText(
      new RegExp(`of ${mateoInvite.seats} seats`),
    );
    await expect(rsvp(page).locator("[data-rsvp-seat-list] .rsvp_seat-row")).toHaveCount(
      mateoInvite.seats,
    );
    await expect(rsvp(page).locator("[data-rsvp-seat-list]")).toContainText(
      mateoInvite.members.at(-1)!,
    );
    await expect(rsvp(page).locator("[data-rsvp-count]")).toHaveText(
      `${mateoInvite.members.length} of ${mateoInvite.seats} seats`,
    );
    await expect(
      rsvp(page).getByRole("button", {
        name: `Add name for seat ${mateoInvite.seats}`,
      }),
    ).toBeVisible();
    const firstSeat = rsvp(page).locator("#rsvp-seat-0");
    await firstSeat.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => rsvp(page).locator("#rsvp-seat-0").evaluate((element) => document.activeElement === element)).toBe(true);
  });

  test("restores a dedicated returning guest without exposing private details", async ({ page }, testInfo) => {
    test.slow();
    const uniqueName = `Nico Garcia ${testInfo.project.name}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${testInfo.retry}-${Date.now()}`;
    await withGarciaLock(async () => {
      await rsvp(page).locator("[data-rsvp-name]").fill("Paolo Garcia");
      await rsvp(page).getByRole("button", { name: /Find my invite/ }).click();
      const seatThree = rsvp(page).locator("[data-seat-index='2']");
      await seatThree.locator("[data-rsvp-seat-action]").click();
      await rsvp(page).locator("[aria-label='Name for seat 3']").fill(uniqueName);
      await seatThree.getByRole("button", { name: /^Done editing / }).click();
      const seatThreeCheckbox = rsvp(page).locator("#rsvp-seat-2");
      if (!(await seatThreeCheckbox.isChecked())) await seatThreeCheckbox.check();
      await rsvp(page).getByRole("button", { name: /Continue/ }).click();
      await chooseSlippers(page);
      await rsvp(page).locator("#rsvp-email").fill("paolo@example.com");
      await rsvp(page).locator("#rsvp-note").fill("private note");
      await rsvp(page).getByRole("button", { name: /Send RSVP/ }).click();
      await expect(page.locator("#rsvp-ticket-modal")).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press("Escape");
      await page.reload();
      await rsvp(page).locator("[data-rsvp-name]").fill("Paolo Garcia");
      await rsvp(page).getByRole("button", { name: /Find my invite/ }).click();
      await expect(rsvp(page).locator("#rsvp-seat-2")).toBeChecked({ timeout: 15_000 });
      await expect(rsvp(page).locator("[data-rsvp-guests]")).toContainText(uniqueName);
      await rsvp(page).getByRole("button", { name: /Continue/ }).click();
      await expect(rsvp(page).locator("[data-rsvp-slipper-list] select").nth(2)).toHaveValue("W 7");
    });
    await expect(rsvp(page).locator("#rsvp-email")).toHaveValue("");
    await expect(rsvp(page).locator("#rsvp-note")).toHaveValue("");
  });

  test("requires a valid email and keeps the guest checklist", { tag: ["@single"] }, async ({
    page,
  }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Liza Santos");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await rsvp(page)
      .getByRole("button", { name: /Continue/ })
      .click();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
    await expect(rsvp(page).locator("[data-step='3']")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(rsvp(page).locator("[data-rsvp-companion-field]")).toHaveCount(0);
    await rsvp(page)
      .getByRole("button", { name: /Send RSVP/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-email-error]")).toBeVisible();
    await rsvp(page).locator("#rsvp-email").fill("not-an-email");
    await rsvp(page)
      .getByRole("button", { name: /Send RSVP/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-email-error]")).toBeVisible();
  });

  test("accepts and can edit a received RSVP", { tag: ["@smoke"] }, async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Liza Santos");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await rsvp(page)
      .getByRole("button", { name: /Continue/ })
      .click();
    await rsvp(page).locator("#rsvp-email").fill("liza@example.com");
    await chooseSlippers(page);
    await rsvp(page)
      .getByRole("button", { name: /Send RSVP/ })
      .click();
    await expect(page.locator("#rsvp-ticket-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rsvp(page).locator("[data-rsvp-panel='sent']")).toBeVisible();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-attending-summary]")).toHaveText(/accepts/);
    await expect(
      rsvp(page).locator("[data-rsvp-guests-summary-value]"),
    ).toHaveText(
      new RegExp(`${santosInvite.members.length} guest: ${santosInvite.members[0]}`),
    );
    await expect(rsvp(page).locator("[data-rsvp-sent-steps]")).toBeVisible();
    await rsvp(page).locator("[data-rsvp-edit]").click();
    await expect(rsvp(page).locator("[data-rsvp-panel='2']")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-count]")).toHaveText(`${santosInvite.members.length} of ${santosInvite.seats} seats`);
    await expect(rsvp(page).locator(".rsvp_title")).toBeVisible();
    await expect(rsvp(page).locator(".rsvp_intro")).toBeVisible();
  });

  test("refreshes an expired edit token before sending", { tag: ["@single"] }, async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Luna Toledo");
    await rsvp(page).getByRole("button", { name: /Find my invite/ }).click();
    await rsvp(page).getByRole("button", { name: /Continue/ }).click();
    await rsvp(page).locator("#rsvp-email").fill("luna@example.com");
    await rsvp(page).locator("#rsvp-note").fill("Vegetarian meal, please");
    await chooseSlippers(page);
    const submits: number[] = [];
    page.on("response", (response) => { if (response.url().includes("/_actions/rsvp.submit")) submits.push(response.status()); });
    await rsvp(page).locator("[data-rsvp-init]").evaluate((element: HTMLElement) => { element.dataset.rsvpToken = "expired.token"; });
    await rsvp(page).getByRole("button", { name: /Send RSVP/ }).click();
    await expect(page.locator("#rsvp-ticket-modal")).toBeVisible();
    expect(submits).toEqual([401, 200]);
    await expect(rsvp(page).locator("[data-rsvp-panel='sent']")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-email-summary]")).toHaveText("luna@example.com");
    await expect(rsvp(page).locator("#rsvp-note")).toHaveValue("Vegetarian meal, please");
  });

  test("declines without a guest summary row", { tag: ["@smoke"] }, async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Ana Reyes");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await rsvp(page).locator("input[value='no']").check();
    await expect(rsvp(page).locator("[data-rsvp-guests]")).toBeHidden();
    await rsvp(page)
      .getByRole("button", { name: /Continue/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-panel='3']")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-after-party]")).toBeHidden();
    await rsvp(page).locator("#rsvp-email").fill("ana@example.com");
    const initialTitle = await rsvp(page).locator(".rsvp_title").textContent();
    await rsvp(page)
      .getByRole("button", { name: /Send RSVP/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-attending-summary]")).toHaveText(/declines/);
    await expect(rsvp(page).locator(".rsvp_title")).toBeVisible();
    await expect(rsvp(page).locator(".rsvp_title")).not.toHaveText(initialTitle!);
    await expect(page.locator("#rsvp-ticket-modal")).toBeHidden();
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-guests-summary]")).toBeHidden();
  });

  test("hides the invitation at step one, shows it at step two, and moves focus", { tag: ["@single"] }, async ({
    page,
  }) => {
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeHidden();
    await rsvp(page).locator("[data-rsvp-name]").fill("Mateo Cruz");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(
      rsvp(page).locator("[data-rsvp-panel='2'] [data-rsvp-heading]"),
    ).toBeFocused();
  });

  test("switches between desktop columns and mobile stacking", { tag: ["@single"] }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(() =>
        rsvp(page)
          .locator(".rsvp_layout")
          .evaluate((element) => getComputedStyle(element).gridTemplateColumns),
      )
      .toMatch(/ 560px$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        rsvp(page)
          .locator(".rsvp_layout")
          .evaluate(
            (element) =>
              getComputedStyle(element).gridTemplateColumns.split(" ").length,
          ),
      )
      .toBe(1);
    await rsvp(page).locator("[data-rsvp-name]").fill("Liza Santos");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
    const card = await rsvp(page).locator(".rsvp_card-wrap").boundingBox();
    const invitation = await rsvp(page)
      .locator("[data-rsvp-invitation]")
      .boundingBox();
    expect(invitation?.y).toBeGreaterThan((card?.y ?? 0) + (card?.height ?? 0));
  });

  test("fits within the viewport at mobile widths", { tag: ["@single"] }, async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Liza Santos");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const cardRight = await rsvp(page)
        .locator(".rsvp_card")
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const margin = parseFloat(
            getComputedStyle(document.querySelector(".rsvp_wrap")!)
              .paddingRight,
          );
          return { right: rect.right, limit: innerWidth - margin };
        });
      expect(cardRight.right).toBeLessThanOrEqual(cardRight.limit);
    }
  });

  test("keeps real long-name and twelve-seat fixtures inside the card without leaking labels", { tag: ["@single"] }, async ({ page }) => {
    const fixtures = fakeFixtures.filter((fixture) => fixture.id === "teachaburanatapaporn" || fixture.id === "long-display");
    expect(fixtures.find(({ id }) => id === "long-display")?.householdName.length).toBe(40);
    for (const fixture of fixtures) for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await rsvp(page).scrollIntoViewIfNeeded();
      await reveal(rsvp(page).locator("[data-rsvp-name]"));
      await rsvp(page).locator("[data-rsvp-name]").fill(fixture.members[0]);
      await rsvp(page).getByRole("button", { name: /Find my invite/ }).click();
      await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
      await expect(rsvp(page).locator("[data-rsvp-household]")).toHaveText(fixture.householdName);
      await expect(rsvp(page).locator("[data-rsvp-seats]")).toHaveText(String(fixture.seats));
      await expect(rsvp(page)).not.toContainText(fixture.label);
      await expect(rsvp(page)).not.toContainText(fixture.id);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const bounds = await rsvp(page).evaluate((section) => {
        const card = section.querySelector<HTMLElement>("[data-rsvp-invitation]")!.getBoundingClientRect();
        const name = section.querySelector<HTMLElement>("[data-rsvp-household]")!.getBoundingClientRect();
        const admits = section.querySelector<HTMLElement>(".rsvp_admits")!.getBoundingClientRect();
        return { cardLeft: card.left, cardRight: card.right, nameLeft: name.left, nameRight: name.right, admitsLeft: admits.left, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(bounds.overflow).toBe(false);
      expect(bounds.nameLeft).toBeGreaterThanOrEqual(bounds.cardLeft - 1);
      expect(bounds.nameRight).toBeLessThanOrEqual(bounds.cardRight + 1);
      expect(bounds.nameRight).toBeLessThanOrEqual(bounds.admitsLeft + 1);
    }
  });
});
