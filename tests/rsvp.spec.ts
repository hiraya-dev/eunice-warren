import { expect, test } from "@playwright/test";

const rsvp = (page: import("@playwright/test").Page) => page.locator("#rsvp");
const visiblePanels = (page: import("@playwright/test").Page) =>
  rsvp(page).locator("[data-rsvp-panel]:not([hidden])");

test.describe("RSVP section", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await rsvp(page).scrollIntoViewIfNeeded();
  });

  test("shows the RSVP deadline label", async ({ page }) => {
    await expect(rsvp(page).locator("[data-rsvp-intro]")).toContainText(
      "December 31",
    );
  });

  test("shows a stable busy spinner without changing the button name", async ({ page }) => {
    const button = rsvp(page).getByRole("button", { name: "Find my invite" });
    await button.evaluate((element) => {
      element.setAttribute("aria-busy", "true");
      (element as HTMLButtonElement).disabled = true;
    });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button.locator(".rsvp_primary-spinner")).toBeVisible();
    await expect(button.locator(".rsvp_primary-arrow")).toBeHidden();
    await expect(button.locator(".rsvp_primary-label-busy")).toBeHidden();
    await expect(button).toHaveAccessibleName("Find my invite");
  });

  test("uses a visible busy label when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const button = rsvp(page).getByRole("button", { name: "Find my invite" });
    await button.evaluate((element) => element.setAttribute("aria-busy", "true"));
    await expect(button.locator(".rsvp_primary-label-busy")).toBeVisible();
    await expect(button.locator(".rsvp_primary-spinner")).toBeHidden();
    await expect(button).toHaveAccessibleName("Find my invite");
  });

  test("fills current and complete steps with a transformed pseudo-element", async ({ page }) => {
    const transforms = await rsvp(page).locator(".rsvp_steps li > span").evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element, "::after").transform),
    );
    expect(transforms[0]).toContain("matrix(1");
    expect(transforms[1]).toContain("matrix(0");
    await rsvp(page).locator("[data-step='2']").evaluate((element) => element.classList.add("is-complete"));
    await expect.poll(() => rsvp(page).locator("[data-step='2'] > span").evaluate((element) => getComputedStyle(element, "::after").transform)).toContain("matrix(1");
  });

  test("reveals the RSVP header through the shared fade-in attributes", async ({ page }) => {
    const header = rsvp(page).locator(".rsvp_header");
    await expect(header).toHaveAttribute("data-fade-in", "");
    await expect(header.locator("[data-fade-in-item]")).toHaveCount(2);
  });

  test("keeps RSVP field layout stable when focused", async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const nameInput = rsvp(page).locator("[data-rsvp-name]");
      const nextBlock = nameInput.locator("xpath=following-sibling::*[1]");
      await nameInput.evaluate((input) => input.blur());
      await nameInput.scrollIntoViewIfNeeded();

      const before = await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>(
          "[data-rsvp-name]",
        )!;
        const nextBlock = input.nextElementSibling!;
        const inputRect = input.getBoundingClientRect();
        return {
          input: {
            height: inputRect.height,
            width: inputRect.width,
          },
          nextTop: nextBlock.getBoundingClientRect().top,
        };
      });

      await nameInput.focus();

      const after = await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>(
          "[data-rsvp-name]",
        )!;
        const nextBlock = input.nextElementSibling!;
        const inputRect = input.getBoundingClientRect();
        const styles = getComputedStyle(input);
        return {
          input: {
            height: inputRect.height,
            width: inputRect.width,
          },
          nextTop: nextBlock.getBoundingClientRect().top,
          borderTopWidth: styles.borderTopWidth,
          boxShadow: styles.boxShadow,
        };
      });

      expect(after.input).toEqual(before.input);
      expect(after.nextTop).toBe(before.nextTop);
      expect(after.borderTopWidth).toBe("1px");
      expect(after.boxShadow).not.toBe("none");
      await expect(nextBlock).toBeVisible();
    }
  });

  test("finds invites case-insensitively and ignores accents and spacing", async ({
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

  test("shows an error for an unknown name", async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Unknown Guest");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-name-error]")).toContainText(
      "We couldn't find that name",
    );
    await expect(rsvp(page).locator("[data-rsvp-panel='1']")).toBeVisible();
  });

  test("recovers from a fictional store rejection", async ({ page }) => {
    const button = rsvp(page).getByRole("button", { name: /Find my invite/ });
    await rsvp(page).locator("[data-rsvp-name]").fill("Error Test");
    await button.click();
    await expect(rsvp(page).locator("[data-rsvp-name-error]")).toHaveText(
      "Something went wrong — please try again.",
    );
    await expect(button).toBeEnabled();
    await expect(rsvp(page).locator("[data-rsvp-panel='1']")).toBeVisible();
  });

  test("bounds the guest count by the invitation seats", async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Liza Santos");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await expect(rsvp(page).locator("[data-rsvp-count]")).toHaveText("2");
    await expect(rsvp(page).locator("[data-rsvp-more]")).toBeDisabled();
    await rsvp(page).locator("[data-rsvp-fewer]").click();
    await expect(rsvp(page).locator("[data-rsvp-count]")).toHaveText("1");
    await expect(rsvp(page).locator("[data-rsvp-fewer]")).toBeDisabled();
  });

  test("requires a valid email and reveals companion details", async ({
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
    await expect(
      rsvp(page).locator("[data-rsvp-companion-field]"),
    ).toBeVisible();
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

  test("accepts and can edit a received RSVP", async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Liza Santos");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await rsvp(page)
      .getByRole("button", { name: /Continue/ })
      .click();
    await rsvp(page).locator("#rsvp-email").fill("liza@example.com");
    await rsvp(page)
      .getByRole("button", { name: /Send RSVP/ })
      .click();
    await expect(page.locator("#rsvp-ticket-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rsvp(page).locator("[data-rsvp-panel='sent']")).toBeVisible();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
    await expect(
      rsvp(page).locator("[data-rsvp-attending-summary]"),
    ).toHaveText("Joyfully accepts");
    await expect(
      rsvp(page).locator("[data-rsvp-guests-summary-value]"),
    ).toHaveText("2 guests");
    await expect(rsvp(page).locator("[data-rsvp-sent-steps]")).toContainText(
      "RSVP received",
    );
    await rsvp(page).getByRole("button", { name: "Edit my RSVP" }).click();
    await expect(rsvp(page).locator("[data-rsvp-panel='2']")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-count]")).toHaveText("2");
    await expect(rsvp(page).locator(".rsvp_title")).toHaveText(
      "Will yoube there?",
    );
    await expect(rsvp(page).locator(".rsvp_intro")).toContainText(
      "Please reply by",
    );
  });

  test("declines without a guest summary row", async ({ page }) => {
    await rsvp(page).locator("[data-rsvp-name]").fill("Ana Reyes");
    await rsvp(page)
      .getByRole("button", { name: /Find my invite/ })
      .click();
    await rsvp(page).locator("input[value='no']").check();
    await expect(rsvp(page).locator("[data-rsvp-guests]")).toBeHidden();
    await rsvp(page)
      .getByRole("button", { name: /Continue/ })
      .click();
    await rsvp(page).locator("#rsvp-email").fill("ana@example.com");
    await rsvp(page)
      .getByRole("button", { name: /Send RSVP/ })
      .click();
    await expect(rsvp(page).locator(".rsvp_title")).toHaveText(
      "We'll miss you.",
    );
    await expect(rsvp(page).locator("[data-rsvp-invitation]")).toBeVisible();
    await expect(rsvp(page).locator("[data-rsvp-guests-summary]")).toBeHidden();
  });

  test("hides the invitation at step one, shows it at step two, and moves focus", async ({
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

  test("switches between desktop columns and mobile stacking", async ({
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

  test("fits within the viewport at mobile widths", async ({ page }) => {
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
});
