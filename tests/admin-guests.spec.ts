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
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-admin-drawer]")
              ?.contains(document.activeElement),
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-admin-drawer]")
              ?.contains(document.activeElement),
          ),
        ),
      )
      .toBe(true);
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/filter=waiting.*q=editor/);
    await expect(add).toBeFocused();

    await add.click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-admin-drawer]")
              ?.contains(document.activeElement),
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-admin-drawer]")
              ?.contains(document.activeElement),
          ),
        ),
      )
      .toBe(true);
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

  test("guards dirty guest drawer exits and keeps dismissed edits", async ({
    page,
  }) => {
    const message = "Discard your changes to this household?";
    await page.goto(`/admin/guests?edit=${editor.id}`);
    const edit = page.locator("[data-edit-household]");
    const name = edit.locator("[name='display_name']");
    await name.fill("Changed for the guest guard test");
    const dialogs: string[] = [];
    const dismiss = async (dialog: import("@playwright/test").Dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    };
    page.on("dialog", dismiss);
    await page.keyboard.press("Escape");
    await expect(edit).toBeVisible();
    await expect(name).toHaveValue("Changed for the guest guard test");
    await expect(page).toHaveURL(new RegExp(`edit=${editor.id}`));
    expect(dialogs).toEqual([message]);
    page.off("dialog", dismiss);

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe(message);
      void dialog.dismiss();
    });
    await edit.locator(".admin-drawer_top [data-admin-drawer-close]").click();
    await expect(edit).toBeVisible();
    await expect(name).toHaveValue("Changed for the guest guard test");

    await page.goto("/admin/guests");
    const row = rowById(page, editor.id);
    await row.locator("summary").click();
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    const backEdit = page.locator("[data-edit-household]");
    const backName = backEdit.locator("[name='display_name']");
    await backName.fill("Kept after guest Back");
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe(message);
      void dialog.dismiss();
    });
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`edit=${editor.id}`));
    await expect(backEdit).toBeVisible();
    await expect(backName).toHaveValue("Kept after guest Back");
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe(message);
      void dialog.accept();
    });
    await page.goBack();
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
  });

  test("guards a dirty add scrim and allows clean direct and swapped drawers", async ({
    page,
  }) => {
    await page.goto("/admin/guests?new=1");
    const add = page.locator("[data-new-household]");
    await add.locator("[data-add-name]").fill("Chip Guard");
    await add.locator("[data-add-name]").press("Enter");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Discard your changes to this household?");
      await dialog.dismiss();
    });
    // On the phone layout the sheet covers most of the scrim, so a pointer
    // click can land on the panel; click the scrim from script instead.
    await page
      .locator(".admin-drawer_scrim")
      .evaluate((scrim: HTMLElement) => scrim.click());
    await expect(add).toBeVisible();
    await expect(add.locator("[data-name-chip]")).toContainText("Chip Guard");

    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .locator(".admin-drawer_scrim")
      .evaluate((scrim: HTMLElement) => scrim.click());
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);

    let unexpected = 0;
    const recordUnexpected = async (
      dialog: import("@playwright/test").Dialog,
    ) => {
      unexpected += 1;
      await dialog.dismiss();
    };
    page.on("dialog", recordUnexpected);
    await page.goto("/admin/guests?new=1");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    await page.goto("/admin/guests");
    await page.locator(".admin_guests_add").click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    const row = rowById(page, editor.id);
    await row.locator("summary").click();
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    expect(unexpected).toBe(0);
    page.off("dialog", recordUnexpected);
  });

  test("asks once before a dirty dashboard navigation", async ({ page }) => {
    await page.goto(`/admin/guests?edit=${editor.id}`);
    await page
      .locator("[data-edit-household] [name='notes']")
      .fill("Leave guard");
    const types: string[] = [];
    const accept = async (dialog: import("@playwright/test").Dialog) => {
      types.push(dialog.type());
      await dialog.accept();
    };
    page.on("dialog", accept);
    try {
      await page
        .locator('[data-admin-nav] a[href="/admin"]')
        .evaluate((link: HTMLAnchorElement) => link.click());
      await expect(page).toHaveURL(/\/admin$/);
      expect(types).toEqual(["confirm"]);
    } finally {
      page.off("dialog", accept);
    }
  });

  test("a clean edit of a household sharing a name closes without asking", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const add = page.locator("[data-new-household]");
      await add.locator("[data-add-name]").fill(`Lead ${surname}`);
      await add.locator("[data-add-name]").press("Enter");
      // A made-up name the fake store already has, saved with Add anyway.
      await add.locator("[data-add-name]").fill("Antonio Santos");
      await add.locator("[data-add-name]").press("Enter");
      await add.locator("[data-confirm-duplicate]").click();
      await add.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(row).toHaveCount(1);
      const id = await row.getAttribute("data-household-id");

      let dialogs = 0;
      const unexpected = async (dialog: import("@playwright/test").Dialog) => {
        dialogs += 1;
        await dialog.dismiss();
      };
      page.on("dialog", unexpected);
      try {
        await page.goto(`/admin/guests?edit=${id}`);
        const drawer = page.locator("[data-admin-drawer]");
        await expect(drawer.locator("h2")).toBeFocused();
        // The script shows the shared-name warning; that alone is no change.
        await expect(drawer.locator("[data-duplicate-warning]")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        expect(dialogs).toBe(0);
      } finally {
        page.off("dialog", unexpected);
      }

      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await saved.locator("summary").click();
      await saved.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });

  test("guards Archive household and warns on reload after a drawer swap", async ({
    page,
  }) => {
    await page.goto(`/admin/guests?edit=${editor.id}`);
    const drawer = page.locator("[data-admin-drawer]");
    await expect(drawer.locator("h2")).toBeFocused();
    await drawer.locator("[name='notes']").fill("Swap guard");

    // Archive household is a full navigation: dismissing keeps the draft.
    page.once("dialog", (dialog) => dialog.dismiss());
    await drawer.getByRole("link", { name: "Archive household" }).click();
    await expect(page).toHaveURL(new RegExp(`edit=${editor.id}`));
    await expect(drawer.locator("[name='notes']")).toHaveValue("Swap guard");

    // OK on a row link swaps the drawer in place; the scrim covers the list,
    // so click from script.
    const types: string[] = [];
    page.once("dialog", async (dialog) => {
      types.push(dialog.type());
      await dialog.accept();
    });
    await rowById(page, openSeatFixture.id)
      .locator("[data-admin-edit]")
      .first()
      .evaluate((link: HTMLAnchorElement) => link.click());
    await expect(drawer.locator("input[name='id']")).toHaveValue(
      openSeatFixture.id,
    );
    expect(types).toEqual(["confirm"]);

    // A stepper change fires no input event; reload must still warn.
    await drawer.locator("summary").filter({ hasText: "More seats" }).click();
    await drawer.locator("[data-seat-plus]").click();
    const unload = page.waitForEvent("dialog");
    void page.evaluate(() => location.reload()).catch(() => {});
    const dialog = await unload;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await expect(drawer.locator("input[name='id']")).toHaveValue(
      openSeatFixture.id,
    );
  });

  test("secondary guest actions do not prompt", async ({ page, browser }) => {
    let dialogs = 0;
    const unexpected = async (dialog: import("@playwright/test").Dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    };
    page.on("dialog", unexpected);

    await page.goto("/admin/guests?new=1");
    const add = page.locator("[data-new-household]");
    await add.locator("[data-add-name]").fill("Secondary Guest");
    await add.locator("[data-add-name]").press("Enter");
    await add.locator("[data-plus-one-toggle]").click();
    await add.locator("summary").filter({ hasText: "More seats" }).click();
    await add.locator("[data-seat-plus]").click();
    await add.locator("[data-add-name]").fill("Antonio Santos");
    await add.locator("[data-add-name]").press("Enter");
    await expect(add.locator("[data-duplicate-warning]")).toBeVisible();
    await add.locator("[data-confirm-duplicate]").click();
    await expect(add.locator("[data-duplicate-warning]")).toBeHidden();

    const editPage = await browser.newPage();
    editPage.on("dialog", unexpected);
    await editPage.goto(`/admin/guests?edit=${openSeatFixture.id}`);
    const edit = editPage.locator("[data-edit-household]");
    await edit.getByRole("button", { name: "Remove open seat" }).click();
    // The edit form is dirty now, so leaving this page would rightly warn
    // (beforeunload). Tick Archive on a fresh page instead.
    const archivePage = await browser.newPage();
    archivePage.on("dialog", unexpected);
    await archivePage.goto(`/admin/guests?edit=${editor.id}`);
    await archivePage
      .locator("[data-edit-household] [data-archive-seat]")
      .first()
      .check();
    expect(dialogs).toBe(0);
    editPage.off("dialog", unexpected);
    archivePage.off("dialog", unexpected);
    await archivePage.close();
    await editPage.close({ runBeforeUnload: false });
    page.off("dialog", unexpected);
  });

  test("shows Saving without a guard and restores on bfcache", async ({
    page,
  }) => {
    await page.goto("/admin/guests?new=1");
    const form = page.locator("[data-new-household]");
    await form.locator("[data-add-name]").fill("Pending Save Guest");
    await page.evaluate(() => {
      document
        .querySelector("[data-admin-household-form]")
        ?.addEventListener("submit", (event) => event.preventDefault());
    });
    let dialogs = 0;
    page.on("dialog", async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    const save = form.locator("button.primary");
    const saveAndAdd = form.locator("button[name='save_and_add']");
    await save.click();
    await expect(save).toHaveText("Saving…");
    await expect(save).toBeDisabled();
    await expect(saveAndAdd).toBeDisabled();
    await expect(form.locator("button[name='save']")).toHaveCount(2);
    await expect(form.locator("[data-admin-submit-mirror]")).toHaveCount(1);
    expect(dialogs).toBe(0);

    await page.evaluate(() => {
      const event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    });
    await expect(save).toHaveText("Save");
    await expect(save).toBeEnabled();
    await expect(saveAndAdd).toHaveText("Save and add another");
    await expect(saveAndAdd).toBeEnabled();
    await expect(form.locator("[data-admin-submit-mirror]")).toHaveCount(0);
  });

  test("refused guest saves leave the re-rendered drawer guarded", async ({
    browser,
  }, testInfo) => {
    await withAdminLock(async () => {
      const page = await browser.newPage();
      const other = await browser.newPage();
      const surname = uniqueSurname(testInfo);
      const name = `Guarded ${surname}`;
      await page.goto(`/admin/guests?new=1&q=${surname}`);
      await page.locator("[data-new-household] [data-add-name]").fill(name);
      await page
        .locator("[data-new-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      const created = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(created).toHaveCount(1);
      const id = await created.getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}&q=guarded-stale`);
      await other.goto(`/admin/guests?edit=${id}&q=guarded-stale`);
      await other
        .locator("[data-edit-household] [name='notes']")
        .fill("Fresh lock");
      await other
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(other).toHaveURL(/q=guarded-stale/);
      const form = page.locator("[data-edit-household]");
      await form.locator("[name='display_name']").fill("Refused draft");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(form.locator("[data-admin-write-error]")).toBeVisible();
      let dialogs = 0;
      page.once("dialog", async (dialog) => {
        dialogs += 1;
        expect(dialog.message()).toBe(
          "Discard your changes to this household?",
        );
        await dialog.dismiss();
      });
      await page.keyboard.press("Escape");
      await expect(form).toBeVisible();
      expect(dialogs).toBe(1);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await saved.locator("summary").click();
      await saved.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await other.close();
      await page.close();
    });
  });

  test("updates archived-seat feedback and saves the matching count", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `First ${surname}`;
    const second = `Second ${surname}`;
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const add = page.locator("[data-new-household]");
      await add.locator("[data-add-name]").fill(first);
      await add.locator("[data-add-name]").press("Enter");
      await add.locator("[data-add-name]").fill(second);
      await add.locator("[data-add-name]").press("Enter");
      await add.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(row).toHaveCount(1);
      const id = await row.getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await edit.locator("[data-archive-seat]").last().check();
      // The summary is separate spans, so textContent reads "1seat· 1 name…".
      await expect(edit.locator("[data-seat-summary]")).toHaveText(
        /^\s*1\s*seat\b/,
      );
      await expect(edit.locator("[data-preview-admits]")).toHaveText(
        "Admits 1",
      );
      await expect(edit.locator("[name='display_name']")).toHaveValue(first);
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect(row.locator("[data-col='seats']")).toContainText("1 seat");

      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await saved.locator("summary").click();
      await saved.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });

  test("saves a pending typed guest name with Save", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const name = `Pending ${surname}`;
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      await form.locator("[data-add-name]").fill(name);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(row).toHaveCount(1);
      await expect(row.locator("[data-col='members']")).toContainText(name);
      await row.locator("summary").click();
      await row.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });

  test("supports chips, plus-one parsing, switch, seats, suggestion and save-and-add", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `Rowan ${surname}`;
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?new=1&filter=waiting&q=${surname}`);
      const form = page.locator("[data-new-household]");
      // A new household's one seat is for its first name, not a plus-one.
      await expect(form.locator("[data-plus-one-toggle]")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(form.locator("[data-seat-summary]")).toContainText(
        "0 names + 0 plus-ones",
      );
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
      await expect(
        page
          .locator("[data-admin-household]")
          .filter({ hasText: `Sage ${surname}` }),
      ).toHaveCount(1);

      // Archive what the test added: other specs count the active households.
      await page.goto(`/admin/guests?filter=waiting&q=${surname}`);
      // The suggestion follows the names, so find the row by its surname.
      const added = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await added.locator("summary").click();
      await added.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
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
    await expect(form.locator("[data-name-chip]")).toContainText(
      "Antonio Santos",
    );
  });

  test("checks names outside the active filter", async ({ page }) => {
    await page.goto("/admin/guests?new=1&filter=waiting");
    const form = page.locator("[data-new-household]");
    await form.locator("[data-add-name]").fill("Kat Lim");
    await form.locator("[data-add-name]").press("Enter");
    await expect(form.locator("[data-duplicate-warning]")).toBeVisible();
    await expect(form.locator("[data-duplicate-message]")).toContainText(
      "Kat Lim",
    );
  });

  test("renders a named plus-one as a person and keeps it when turning plus-one off", async ({
    page,
  }) => {
    await page.goto(`/admin/guests?edit=hh-lim`);
    const form = page.locator("[data-edit-household]");
    const named = form.locator("[data-seat-kind='plus_one']").filter({
      hasText: "Jonas Ong",
    });
    await expect(named).toHaveCount(1);
    await expect(named).not.toContainText("Remove open seat");
    await expect(named).toContainText("+1 · named by Kat");
    await expect(form.locator("[data-seat-summary]")).toContainText(
      "2 names + 0",
    );
    // The suggestion is built from the invited members only.
    await expect(form.locator("[data-restore-suggestion]")).not.toContainText(
      "Jonas",
    );
    // Edit hides the switch (Admin 12 has none); its handler still guards
    // named plus-ones, so drive it directly.
    const toggle = form.locator("[data-plus-one-toggle]");
    await toggle.evaluate((button: HTMLButtonElement) => button.click());
    await toggle.evaluate((button: HTMLButtonElement) => button.click());
    await expect(form.locator("[data-seat-kind='plus_one']")).toContainText(
      "Jonas Ong",
    );
    await expect(form.locator("[data-seat-summary]")).toContainText(
      "2 names + 0",
    );
  });

  test("pressing Enter in the invitation name saves add and edit", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?new=1&q=${surname}`);
      const addForm = page.locator("[data-new-household]");
      await addForm.locator("[data-add-name]").fill(`Enter ${surname}`);
      await addForm.locator("[data-add-name]").press("Enter");
      await addForm
        .locator("[name='display_name']")
        .fill(`Enter invite ${surname}`);
      await addForm.locator("[name='display_name']").press("Enter");
      await expect(page).toHaveURL(new RegExp(`q=${surname}`));
      const added = page.locator("[data-admin-household]").filter({
        hasText: `Enter ${surname}`,
      });
      await expect(added.locator("[data-col='seats']")).toContainText("1 seat");
      await expect(added).toContainText(`Enter invite ${surname}`);
      await added.locator("summary").click();
      await added.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();

      await page.goto(`/admin/guests?edit=${editor.id}&q=${surname}`);
      const editForm = page.locator("[data-edit-household]");
      const seatCount = await editForm.locator("[data-seat-row]").count();
      await editForm.locator("[name='display_name']").fill("Enter edit");
      await editForm.locator("[name='display_name']").press("Enter");
      await expect(page).toHaveURL(/q=/);
      const edited = rowById(page, editor.id);
      await expect(edited.locator("[data-col='seats']")).toContainText(
        `${seatCount} seats`,
      );
      await expect(edited).toContainText("Enter edit");
    });
  });

  test("keeps the stepper between one and twelve seats", async ({ page }) => {
    await page.goto("/admin/guests?new=1");
    const form = page.locator("[data-new-household]");
    await form.locator("summary").filter({ hasText: "More seats" }).click();
    await form.locator("[data-seat-minus]").click();
    await expect(form.locator("[data-seat-output]")).toHaveText("1");
    for (let index = 0; index < 15; index += 1)
      await form.locator("[data-seat-plus]").click();
    await expect(form.locator("[data-seat-output]")).toHaveText("12");
  });

  test("keeps rejected stale save and archive drafts in the drawer with Reload", async ({
    browser,
  }) => {
    await withAdminLock(async () => {
      const page = await browser.newPage();
      const other = await browser.newPage();
      await page.goto(`/admin/guests?edit=${editor.id}&filter=waiting&q=stale`);
      await other.goto(
        `/admin/guests?edit=${editor.id}&filter=waiting&q=stale`,
      );
      await other
        .locator("[data-edit-household] [name='notes']")
        .fill("Fresh edit");
      await other
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(other).toHaveURL(/filter=waiting.*q=stale/);
      const staleForm = page.locator("[data-edit-household]");
      await staleForm
        .locator("[name='display_name']")
        .fill("Stale typed value");
      await staleForm
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(staleForm.locator("[data-admin-write-error]")).toContainText(
        "Reload",
      );
      await expect(staleForm.locator("[name='display_name']")).toHaveValue(
        "Stale typed value",
      );
      await expect(
        staleForm.getByRole("link", { name: "Reload" }),
      ).toBeVisible();

      await page.goto(
        `/admin/guests?edit=${editor.id}&filter=waiting&q=stale-archive`,
      );
      await other.goto(
        `/admin/guests?edit=${editor.id}&filter=waiting&q=stale-archive`,
      );
      // Open the confirm first, then change the household elsewhere, so the
      // confirm's token is stale and the archive is refused.
      await page
        .locator("[data-edit-household]")
        .getByRole("link", { name: "Archive household" })
        .click();
      await expect(page.locator("[data-admin-archive-confirm]")).toBeVisible();
      await other
        .locator("[data-edit-household] [name='notes']")
        .fill("Fresh archive edit");
      await other
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(other).toHaveURL(/q=stale-archive/);
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      // Archive household closes the drawer for #99's confirm row (until PR 4),
      // so a stale archive is refused with the page-level notice and Reload.
      await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
      await expect(page.locator("[data-admin-write-error]")).toContainText(
        "Reload",
      );
      await expect(page.locator("[data-admin-write-error] a")).toHaveText(
        "Reload",
      );
      await other.close();
      await page.close();
    });
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

  test("saves typed guest input without pressing Enter when JavaScript is disabled", async ({
    browser,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto(`/admin/guests?new=1&q=${surname}`);
      const form = page.locator("[data-new-household]");
      await form.locator("[data-add-name]").fill(`NoJS ${surname}`);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const added = page.locator("[data-admin-household]").filter({
        hasText: `NoJS ${surname}`,
      });
      await expect(added).toHaveCount(1);
      await expect(added.locator("[data-col='seats']")).toContainText("1 seat");

      await added.locator("summary").click();
      await added.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page
          .locator("[data-admin-household]")
          .filter({ hasText: `NoJS ${surname}` }),
      ).toHaveCount(0);
      await page.close();
    });
  });

  test("keeps no-JS duplicate confirmation in the draft", async ({
    browser,
  }) => {
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      await form.locator("[data-add-name]").fill("Antonio Santos");
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await expect(form.locator("[data-duplicate-warning]")).toBeVisible();
      await form.getByRole("button", { name: "Add anyway" }).click();
      // The round trip keeps the confirmed name in the draft; Save then adds it.
      const draft = page.locator("[data-new-household]");
      await expect(draft.locator("[data-duplicate-warning]")).toBeHidden();
      await expect(draft.locator("input[name='confirmed_name']")).toHaveCount(
        1,
      );
      await draft.getByRole("button", { name: "Save", exact: true }).click();
      const added = page.locator("[data-admin-household]").filter({
        has: page.locator("[data-col='household']", {
          hasText: /^Antonio Santos/,
        }),
      });
      await expect(added).toHaveCount(1);
      await added.locator("summary").click();
      await added.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await page.close();
    });
  });
});

// L-053: every secondary submit without JavaScript ends in a real save, and
// the JS plus-one "off" drops open and draft-only seats. Each test adds its own
// household (unique surname) and archives it, so fixtures stay untouched.
test.describe("guest drawer round trips without JavaScript", () => {
  test.describe.configure({ mode: "serial" });

  const rowFor = (page: Page, text: string) =>
    page.locator("[data-admin-household]").filter({ hasText: text });

  const archiveRow = async (page: Page, text: string) => {
    await page.goto("/admin/guests");
    const row = rowFor(page, text);
    await row.locator("summary").click();
    await row.getByRole("link", { name: "Archive household" }).click();
    await page
      .locator("[data-admin-archive-confirm]")
      .getByRole("button", { name: "Archive" })
      .click();
    await expect(rowFor(page, text)).toHaveCount(0);
  };

  const addName = async (page: Page, name: string) => {
    const form = page.locator("[data-admin-household-form]");
    await form.locator("[name='member_input']").fill(name);
    await form.getByRole("button", { name: "Add", exact: true }).click();
  };

  test("plus-one switch and stepper floor save the seat count", async ({
    browser,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `Ilse ${surname}`;
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      // The stepper never goes below one seat, even with no names yet.
      await form.locator("summary").filter({ hasText: "More seats" }).click();
      await form.locator("[data-seat-minus]").click();
      await expect(
        page.locator("[data-new-household] [data-seat-number]"),
      ).toHaveText("1");
      await addName(page, first);
      const plusOne = () =>
        page.locator("[data-new-household] button[name='plus_one']");
      await plusOne().click();
      await expect(
        page.locator("[data-new-household] [data-seat-number]"),
      ).toHaveText("2");
      await plusOne().click();
      await expect(
        page.locator("[data-new-household] [data-seat-number]"),
      ).toHaveText("1");
      await plusOne().click();
      await page
        .locator("[data-new-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(
        rowFor(page, surname).locator("[data-col='seats']"),
      ).toContainText("2 seats");

      // Edit: the stepper's "−" takes the open seat off and Save stores it.
      const id = await rowFor(page, surname).getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await edit.locator("summary").filter({ hasText: "More seats" }).click();
      await edit.locator("[data-seat-minus]").click();
      await expect(
        page.locator("[data-edit-household] [data-seat-number]"),
      ).toHaveText("1");
      await page
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(
        rowFor(page, surname).locator("[data-col='seats']"),
      ).toContainText("1 seat");
      await archiveRow(page, surname);
      await page.close();
    });
  });

  test("adding names keeps the invitation name on the suggestion", async ({
    browser,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto("/admin/guests?new=1");
      await addName(page, `Ilse ${surname}`);
      await addName(page, `Otto ${surname}`);
      const form = page.locator("[data-new-household]");
      const suggestion = `${surname} Family`;
      await expect(form.locator("[name='display_name']")).toHaveValue(
        suggestion,
      );
      await expect(form.locator("[data-restore-suggestion]")).toBeHidden();
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        rowFor(page, surname).locator("[data-col='household']"),
      ).toContainText(suggestion);
      await archiveRow(page, surname);
      await page.close();
    });
  });

  test("archiving the last member then pressing − still saves the archive", async ({
    browser,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const kept = `Ilse ${surname}`;
    const archived = `Otto ${surname}`;
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto("/admin/guests?new=1");
      await addName(page, kept);
      await addName(page, archived);
      await page
        .locator("[data-new-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      const id = await rowFor(page, surname).getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await edit.locator("[data-archive-seat]").last().check();
      await edit.locator("summary").filter({ hasText: "More seats" }).click();
      await edit.locator("[data-seat-minus]").click();
      // The round trip keeps the archive mark on the last member.
      await expect(
        page.locator("[data-edit-household] [data-archive-seat]").last(),
      ).toBeChecked();
      await page
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(page.locator("[data-admin-write-error]")).toHaveCount(0);
      const row = rowFor(page, surname);
      await expect(row.locator("[data-col='seats']")).toContainText("1 seat");
      await expect(row.locator("[data-col='members']")).not.toContainText(
        "Otto",
      );
      await archiveRow(page, surname);
      await page.close();
    });
  });
});

test.describe("host ID from the invitation name", () => {
  test("follows the invitation name in add and keeps the ID in edit", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const slug = surname.toLowerCase();
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      for (const name of [`Ilse ${surname}`, `Otto ${surname}`]) {
        await form.locator("[data-add-name]").fill(name);
        await form.locator("[data-add-name]").press("Enter");
      }
      // "<S> Family" → "<s>"
      await expect(form.locator("[data-host-id]")).toHaveText(slug);
      await form.locator("[name='display_name']").fill(`Casa ${surname}`);
      await expect(form.locator("[data-host-id]")).toHaveText(`casa-${slug}`);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(row.locator(".admin-guests_id")).toHaveText(`casa-${slug}`);

      // Renaming in edit keeps the ID.
      const id = await row.getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await edit.locator("[name='display_name']").fill(`Villa ${surname}`);
      await expect(edit.locator("[data-host-id]")).toHaveText(`casa-${slug}`);
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page
          .locator("[data-admin-household]")
          .filter({ hasText: surname })
          .locator(".admin-guests_id"),
      ).toHaveText(`casa-${slug}`);

      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await saved.locator("summary").click();
      await saved.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });
});

test.describe("guest drawer plus-one off with JavaScript", () => {
  test("drops a saved open seat and a draft-only seat", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `Ilse ${surname}`;
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      await form.locator("[data-add-name]").fill(first);
      await form.locator("[data-add-name]").press("Enter");
      await form.locator("[data-add-name]").fill("+1");
      await form.locator("[data-add-name]").press("Enter");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: first });
      await expect(row.locator("[data-col='seats']")).toContainText("2 seats");

      const id = await row.getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await expect(
        edit.locator("[data-seat-kind='plus_one'][data-seat-row]"),
      ).toHaveCount(1);
      // A draft-only seat from the stepper, then the switch off: both go.
      await edit.locator("summary").filter({ hasText: "More seats" }).click();
      await edit.locator("[data-seat-plus]").click();
      await expect(edit.locator("[data-seat-number]")).toHaveText("3");
      await edit
        .locator("[data-plus-one-toggle]")
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect(edit.locator("[data-seat-number]")).toHaveText("1");
      await expect(edit.locator("input[name='removed_seat']")).toHaveCount(1);
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page
          .locator("[data-admin-household]")
          .filter({ hasText: first })
          .locator("[data-col='seats']"),
      ).toContainText("1 seat");

      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: first });
      await saved.locator("summary").click();
      await saved.getByRole("link", { name: "Archive household" }).click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: first }),
      ).toHaveCount(0);
    });
  });
});
