import { expect, test } from "@playwright/test";
import { fakeFixtures } from "../src/lib/rsvp/store";

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
  await section.locator("#rsvp-email").fill(email);
  await section.getByRole("button", { name: "Send RSVP" }).click();
}

test.describe("RSVP paths", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await rsvp(page).scrollIntoViewIfNeeded();
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

  test("renames a member via Edit before submitting", async ({ page }) => {
    const section = rsvp(page);
    await findInvite(page, cruz.members[0], cruz);

    const oldName = cruz.members[1];
    const newName = "Marisol Renamed";
    await section
      .getByRole("button", { name: `Edit ${oldName}` })
      .click();
    await section.locator("[aria-label='Name for seat 2']").fill(newName);
    await section
      .getByRole("button", { name: `Done editing ${oldName}` })
      .click();

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
