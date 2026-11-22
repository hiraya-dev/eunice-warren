import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { fakeAdminFixtures } from "../src/lib/admin/fake";
import { withAdminLock } from "./helpers/admin-lock";

const activeFixtures = fakeAdminFixtures.filter((row) => !row.archivedAt);
const expectedIds = (filter: string) =>
  activeFixtures
    .filter((row) => {
      if (filter === "waiting") return row.rsvp.state === "waiting";
      if (filter === "coming") return row.rsvp.state === "coming";
      if (filter === "declined") return row.rsvp.state === "declined";
      if (filter === "no-name")
        return row.seats.some(
          (seat) => !seat.name?.trim() && (seat.state ?? "open") === "open",
        );
      return true;
    })
    .map((row) => row.id);

const rowById = (page: Page, id: string) =>
  page.locator(`[data-household-id="${id}"]`);
const editor = fakeAdminFixtures.find((row) => row.id === "hh-admin-editor")!;
const openSeatFixture = fakeAdminFixtures.find(
  (row) => row.id === "hh-mendoza",
)!;

// The fake store outlives a project run and refuses a repeat name as already
// invited, so each test saves a surname of its own (letters only).
const uniqueSurname = (
  testInfo: Pick<TestInfo, "project" | "workerIndex" | "retry">,
) =>
  `Vega${[
    ...`${testInfo.project.name}${testInfo.workerIndex}${testInfo.retry}${Date.now().toString(36)}`,
  ]
    .map((char) => (/\d/.test(char) ? "abcdefghij"[Number(char)] : char))
    .join("")}`;

test.describe("guest list filters", () => {
  test.describe.configure({ mode: "serial" });

  test("renders fixture counts and keeps filter and q on links", async ({
    page,
  }) => {
    await page.goto("/admin/guests?filter=waiting&q=editor");
    await expect(page.locator("[data-admin-household]")).toHaveCount(
      expectedIds("waiting").length,
    );
    await expect(page.locator("[data-admin-filter='waiting']")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator("[data-admin-edit]").first()).toHaveAttribute(
      "href",
      /filter=waiting.*q=editor/,
    );
    await page.locator("[data-admin-filter='all']").click();
    await expect(page).toHaveURL(/q=editor/);
    await expect(page.locator("[data-admin-search]")).toHaveValue("editor");
  });

  test("keeps filters without JavaScript and uses the fixture as the count source", async ({
    browser,
  }) => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto("/admin/guests?q=editor");
    await page.locator("[data-admin-filter='declined']").click();
    await expect(page).toHaveURL(/filter=declined.*q=editor/);
    await expect(page.locator("[data-admin-household]")).toHaveCount(
      expectedIds("declined").length,
    );
    await page.close();
  });
});

test.describe("guest list drawer", () => {
  test.describe.configure({ mode: "serial" });

  test("opens add and edit drawers without reloading and traps focus", async ({
    page,
  }) => {
    await page.goto("/admin/guests?filter=waiting&q=editor");
    const add = page.locator(".admin_guests_add");
    await add.click();
    await expect(page.locator("[data-new-household]")).toBeVisible();
    await expect(page).toHaveURL(
      /(?=.*new=1)(?=.*filter=waiting)(?=.*q=editor)/,
    );
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("[data-admin-drawer]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    await expect(add).toBeFocused();

    const row = rowById(page, editor.id);
    await row.locator("summary").click();
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("[data-edit-household]")).toBeVisible();
    await page.goBack();
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
  });

  test("supports chips, plus-one parsing, switch, seats, suggestion and save-and-add", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `Rowan ${surname}`;
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?new=1&filter=waiting&q=${surname}`);
      const form = page.locator("[data-new-household]");
      const name = form.locator("[data-add-name]");
      await name.fill(`  Rowan   ${surname} `);
      await name.press("Enter");
      await expect(form.locator("[data-name-chip]")).toHaveCount(1);
      await name.fill("+1");
      await name.press("Enter");
      await expect(form.locator("[data-seat-summary]")).toContainText(
        "1 plus-one",
      );
      await form.locator("[data-plus-one-toggle]").click();
      await expect(form.locator("[data-seat-summary]")).toContainText(
        "0 plus-one",
      );
      await form.locator("[data-plus-one-toggle]").click();
      await form.locator("summary").filter({ hasText: "More seats" }).click();
      await form.locator("[data-seat-plus]").click();
      await expect(form.locator("[data-seat-output]")).toHaveText("3");
      const invitation = form.locator("[name='display_name']");
      await expect(invitation).toHaveValue(first);
      await invitation.fill("A different invitation");
      await expect(form.locator("[data-invitation-hint]")).toContainText(
        "Your own",
      );
      await form.locator("[data-restore-suggestion]").click();
      await expect(invitation).toHaveValue(first);
      await form.locator("[name='member_input']").fill(`Sage ${surname}`);
      await form.getByRole("button", { name: "Save and add another" }).click();
      await expect(page).toHaveURL(
        new RegExp(`(?=.*new=1)(?=.*filter=waiting)(?=.*q=${surname})`),
      );
      await expect(page.locator("[data-admin-added]")).toContainText("Added");

      // Archive what the test added: other specs count the active households.
      await page.goto(`/admin/guests?filter=waiting&q=${surname}`);
      const added = page
        .locator("[data-admin-household]")
        .filter({ hasText: first });
      await added.locator("summary").click();
      await added.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: first }),
      ).toHaveCount(0);
    });
  });

  test("shows duplicate warning with open and confirm actions", async ({
    page,
  }) => {
    await page.goto("/admin/guests?new=1");
    const form = page.locator("[data-new-household]");
    await form.locator("[data-add-name]").fill("Antonio Santos");
    await form.locator("[data-add-name]").press("Enter");
    await expect(form.locator("[data-duplicate-warning]")).toBeVisible();
    await expect(form.locator("[data-duplicate-open]")).toHaveAttribute(
      "href",
      /edit=/,
    );
    await form.locator("[data-confirm-duplicate]").click();
    await expect(form.locator("[data-duplicate-warning]")).toBeHidden();
  });

  test("supports edit archive undo, invited-name fix, add guest and open-seat removal", async ({
    page,
  }, testInfo) => {
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?edit=${editor.id}&filter=waiting&q=edit`);
      const form = page.locator("[data-edit-household]");
      const archive = form.locator("[data-archive-seat]").first();
      await archive.check();
      await expect(
        archive.locator("..").locator("[data-archive-label]"),
      ).toHaveText("Undo");
      await archive.uncheck();
      await form
        .locator("details")
        .filter({ hasText: "Fix invited name" })
        .first()
        .locator("summary")
        .click();
      await expect(
        form.locator("input[name^='invited_name_']").first(),
      ).toBeVisible();
      const members = await form.locator("[data-seat-kind='member']").count();
      await form
        .locator("[name='member_input']")
        .fill(`Mina ${uniqueSurname(testInfo)}`);
      await form.locator("[name='member_input']").press("Enter");
      await expect(form.locator("[data-seat-kind='member']")).toHaveCount(
        members + 1,
      );
      await form.getByRole("button", { name: "Save" }).click();
      await expect(page).toHaveURL(/filter=waiting.*q=edit/);
    });
  });

  test("removes an unnamed open seat through the drawer", async ({ page }) => {
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?edit=${openSeatFixture.id}`);
      const form = page.locator("[data-edit-household]");
      await form.getByRole("button", { name: "Remove open seat" }).click();
      await form.getByRole("button", { name: "Save" }).click();
      const seats = rowById(page, openSeatFixture.id).locator(
        "[data-col='seats']",
      );
      await expect(seats).toContainText("1 seat");

      // Put the open seat back so the next project finds the fixture as it was.
      await page.goto(`/admin/guests?edit=${openSeatFixture.id}`);
      const again = page.locator("[data-edit-household]");
      await again.locator("[name='member_input']").fill("+1");
      await again.locator("[name='member_input']").press("Enter");
      await again.getByRole("button", { name: "Save" }).click();
      await expect(seats).toContainText("2 seats");
    });
  });

  test("removes an open seat without JavaScript, counting it once", async ({
    browser,
    page,
  }) => {
    await withAdminLock(async () => {
      const noJs = await browser.newPage({ javaScriptEnabled: false });
      await noJs.goto(`/admin/guests?edit=${openSeatFixture.id}`);
      const form = noJs.locator("[data-edit-household]");
      const openSeats = openSeatFixture.seats.filter(
        (seat) => seat.kind === "plus_one" && !seat.name,
      ).length;
      await expect(form.locator("button[name='remove_seat']")).toHaveCount(
        openSeats,
      );
      await form.locator("button[name='remove_seat']").first().click();
      // The round trip drops the row and carries the removal to Save.
      await expect(
        noJs.locator("[data-edit-household] button[name='remove_seat']"),
      ).toHaveCount(openSeats - 1);
      await expect(
        noJs.locator("[data-edit-household] input[name='removed_seat']"),
      ).toHaveCount(1);
      await noJs
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save" })
        .click();
      await expect(
        rowById(noJs, openSeatFixture.id).locator("[data-col='seats']"),
      ).toContainText(`${openSeatFixture.seatCount - 1} seat`);
      await noJs.close();

      // Put the open seat back so the next project finds the fixture as it was.
      await page.goto(`/admin/guests?edit=${openSeatFixture.id}`);
      const again = page.locator("[data-edit-household]");
      await again.locator("[name='member_input']").fill("+1");
      await again.locator("[name='member_input']").press("Enter");
      await again.getByRole("button", { name: "Save" }).click();
      await expect(
        rowById(page, openSeatFixture.id).locator("[data-col='seats']"),
      ).toContainText(`${openSeatFixture.seatCount} seats`);
    });
  });

  test("deep links render with JavaScript disabled and secondary actions are submits", async ({
    browser,
  }) => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto(`/admin/guests?edit=${editor.id}&filter=waiting&q=nojs`);
    const form = page.locator("[data-edit-household]");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form.locator("button[name='seat_action']")).toHaveCount(2);
    await expect(form.locator("button[name='plus_one']")).toHaveCount(1);
    await expect(form.locator("button[name='remove_seat']")).toHaveCount(
      editor.seats.filter((seat) => seat.kind === "plus_one" && !seat.name)
        .length,
    );
    await expect(
      form.locator("details").filter({ hasText: "More seats" }),
    ).toHaveCount(1);
    await expect(
      form.locator("details").filter({ hasText: "Edit ID" }),
    ).toHaveCount(1);
    await page.close();
  });
});
