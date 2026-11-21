import { expect, test } from "@playwright/test";
import { fakeFixtures } from "../src/lib/rsvp/store";
import { reveal } from "./helpers/reveal";

const rsvp = (page: import("@playwright/test").Page) =>
  page.locator("#rsvp");
const visiblePanels = (page: import("@playwright/test").Page) =>
  rsvp(page).locator("[data-rsvp-panel]:not([hidden])");
const santos = fakeFixtures.find((invite) => invite.id === "santos")!;
const cruz = fakeFixtures.find((invite) => invite.id === "cruz")!;
// The ticket prints first names only (RsvpTicketPrinter.astro).
const firstName = (name: string) => name.split(" ")[0];

async function findInvite(
  page: import("@playwright/test").Page,
  name: string,
  invite: (typeof fakeFixtures)[number],
) {
  const section = rsvp(page);
  await section.locator("[data-rsvp-name]").fill(name);
  await section.getByRole("button", { name: "Find my invite" }).click();

  const panel = section.locator("[data-rsvp-panel='2']");
  const seatRows = section.locator("[data-rsvp-seat-list] .rsvp_seat-row");
  await expect(panel).toBeVisible();
  await expect(seatRows).toHaveCount(invite.seats);
  return { panel, seatRows };
}

async function submitRsvp(
  page: import("@playwright/test").Page,
  email: string,
) {
  const section = rsvp(page);
  await section.getByRole("button", { name: "Continue" }).click();
  await expect(section.locator("[data-rsvp-panel='3']")).toBeVisible();
  for (const select of await section.locator("[data-rsvp-slipper-list] select").all()) await select.selectOption("W 7");
  await section.locator("#rsvp-email").fill(email);
  await section.getByRole("button", { name: "Send RSVP" }).click();
}

test.describe("RSVP paths", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await rsvp(page).scrollIntoViewIfNeeded();
    await reveal(rsvp(page).locator("[data-rsvp-name]"));
  });

  test("unticks a seat before submitting", async ({ page }) => {
    const section = rsvp(page);
    await findInvite(page, cruz.members[0], cruz);

    const count = section.locator("[data-rsvp-count]");
    // Every named member starts ticked; open seats do not (L-021: the expected
    // count comes from the fixture, never from the async label).
    const initialCount = cruz.members.length;
    await expect(count).toHaveText(`${initialCount} of ${cruz.seats} seats`);

    const untickedGuest = cruz.members[0];
    await section.locator("#rsvp-seat-0").uncheck();
    await expect(count).toHaveText(`${initialCount - 1} of ${cruz.seats} seats`);

    await submitRsvp(page, "mateo@example.com");
    const ticket = page.locator("#rsvp-ticket-modal");
    await expect(ticket).toBeVisible();
    await expect(ticket.locator("[data-ticket-names]")).not.toContainText(
      firstName(untickedGuest),
    );
    await page.keyboard.press("Escape");
    await expect(ticket).toBeHidden();

    await expect(section.locator("[data-rsvp-panel='sent']")).toBeVisible();
    const summary = section.locator("[data-rsvp-guests-summary-value]");
    for (const guest of cruz.members.slice(1)) {
      await expect(summary).toContainText(guest);
    }
    await expect(summary).not.toContainText(untickedGuest);
  });

  test("rebuilds after-party rows from the checked seats", async ({ page }) => {
    const section = rsvp(page);
    await findInvite(page, cruz.members[0], cruz);
    await section.locator("#rsvp-seat-1").uncheck();
    await section.getByRole("button", { name: "Continue" }).click();
    await expect(section.locator("[data-rsvp-slipper-list] .rsvp_after-party-row")).toHaveCount(cruz.members.length - 1);
    await expect(section.locator("[data-rsvp-slipper-list]")).not.toContainText(cruz.members[1]);
    await expect(section.locator("[data-rsvp-not-coming]")).toBeVisible();
    await expect(section.locator("[data-rsvp-not-coming]")).toContainText(cruz.members[1]);
  });

  test("requires a slipper size before submitting", async ({ page }) => {
    const section = rsvp(page);
    await findInvite(page, santos.members[0], santos);
    await section.getByRole("button", { name: "Continue" }).click();
    await expect(section.locator("[data-rsvp-not-coming]")).toBeHidden();
    await section.locator("#rsvp-email").fill("liza-size@example.com");
    await section.getByRole("button", { name: "Send RSVP" }).click();
    const select = section.locator("[data-rsvp-slipper-list] select").first();
    await expect(select).toBeFocused();
    const rowError = select.locator("xpath=ancestor::*[contains(@class,'rsvp_after-party-row')]").locator(".rsvp_slipper-error");
    await expect(rowError).toHaveRole("alert");
    await expect(rowError).toBeVisible();
    await expect(select).toHaveAttribute("aria-invalid", "true");
    await select.selectOption("W 7");
    await expect(rowError).toBeHidden();
    await expect(select).not.toHaveAttribute("aria-invalid");
  });

  test("renames a member via Edit before submitting", async ({ page }) => {
    const section = rsvp(page);
    await findInvite(page, cruz.members[0], cruz);

    const oldName = cruz.members[1];
    const newName = "Marisol Renamed";
    await section
      .getByRole("button", { name: `Edit ${oldName}` })
      .click();
    await section.locator("[aria-label='Name for seat 2']").fill(newName);
    const done = section.getByRole("button", { name: `Done editing ${oldName}` });
    // Escape #82: the label sat flush against the button's left edge.
    const inset = await done.evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      return { left: text.left - box.left, right: box.right - text.right };
    });
    expect(inset.left).toBeGreaterThanOrEqual(8);
    expect(Math.abs(inset.left - inset.right)).toBeLessThanOrEqual(2);
    await done.click();

    await submitRsvp(page, "mateo-renamed@example.com");
    const ticket = page.locator("#rsvp-ticket-modal");
    await expect(ticket).toBeVisible();
    await expect(ticket.locator("[data-ticket-names]")).toContainText(firstName(newName));
    await expect(ticket.locator("[data-ticket-names]")).not.toContainText(firstName(oldName));
    await page.keyboard.press("Escape");
    await expect(ticket).toBeHidden();

    const summary = section.locator("[data-rsvp-guests-summary-value]");
    await expect(summary).toContainText(newName);
    await expect(summary).not.toContainText(oldName);
  });

  test("opens a blank plus-one name and blocks Next until it is named", async ({ page }) => {
    const section = rsvp(page);
    await findInvite(page, santos.members[0], santos);
    await section.locator("#rsvp-seat-1").check();
    const name = section.locator("[aria-label='Name for seat 2']");
    await expect(name).toBeVisible();
    await section.getByRole("button", { name: "Continue" }).click();
    const error = section.locator("[data-rsvp-guest-error]");
    await expect(error).toBeVisible();
    await expect(error).toHaveText("Add a name or untick this seat.");
    await name.fill("Fictional Companion");
    await section.getByRole("button", { name: "Done editing seat 2" }).click();
    await expect(error).toBeHidden();
  });

  test("reloads a changed seat set and keeps typed values for surviving seat ids", { tag: ["@single"] }, async ({ page }) => {
    const fixture = fakeFixtures.find((invite) => invite.id === "seat-change-test")!;
    const section = rsvp(page);
    await findInvite(page, fixture.members[0], fixture);
    await section.getByRole("button", { name: `Edit ${fixture.members[0]}` }).click();
    await section.locator("[aria-label='Name for seat 1']").fill("Kept Typed Value");
    await section.getByRole("button", { name: `Done editing ${fixture.members[0]}` }).click();
    await submitRsvp(page, "fixture-conflict@example.com");
    await expect(section.locator("[data-rsvp-submit-error]")).toHaveText("Your invite changed. Check the seats before sending.");
    await expect(section.locator("[data-rsvp-seat-list] .rsvp_seat-row")).toHaveCount(2);
    await expect(section.locator("[data-rsvp-seat-list]")).toContainText("Kept Typed Value");
    await expect(section.locator("[data-rsvp-seat-list]")).not.toContainText("Pia Fixture");
  });

  test("edits an accepted RSVP and resubmits a decline", async ({ page }) => {
    const section = rsvp(page);
    await findInvite(page, santos.members[0], santos);
    await submitRsvp(page, "liza-edit@example.com");

    const ticket = page.locator("#rsvp-ticket-modal");
    await expect(ticket).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ticket).toBeHidden();
    await expect(section.locator("[data-rsvp-panel='sent']")).toBeVisible();

    await section.getByRole("button", { name: "Edit my RSVP" }).click();
    await expect(section.locator("[data-rsvp-panel='2']")).toBeVisible();
    await section.locator("input[name='attending'][value='no']").check();
    await submitRsvp(page, "liza-edit@example.com");

    await expect(section.locator("[data-rsvp-panel='sent']")).toBeVisible();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(section.locator("[data-rsvp-attending-summary]")).toHaveText(
      "Regretfully declines",
    );
    await expect(section.locator("[data-rsvp-guests-summary]")).toBeHidden();
  });
});
