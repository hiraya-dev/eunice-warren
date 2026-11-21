import { test, expect, type Page } from "@playwright/test";
import { fakeAdminFixtures } from "../src/lib/admin/fake";
import { withAdminLock } from "./helpers/admin-lock";

test.describe("guest list editor", () => {
  test.describe.configure({ mode: "serial" });
  const fixture = fakeAdminFixtures.find(
    (row) => row.id === "hh-admin-editor",
  )!;
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const rowById = (page: Page, id: string) =>
    page.locator(`[data-household-id="${id}"]`);

  test("opens the menu, edits a member, and preserves the stepper workflow", async ({
    page,
  }) => {
    await withAdminLock(async () => {
      await page.goto("/admin/guests");
      const row = rowById(page, fixture.id);
      await row.locator("summary").click();
      await row.getByRole("link", { name: "Edit" }).click();
      const form = page.locator("[data-edit-household]");
      await expect(form).toBeVisible();
      const count = form.locator("[data-seat-output]");
      const storedCount = Number(await count.textContent());
      await form.locator('button[name="seat_action"][value="add"]').click();
      await expect(count).toHaveText(String(storedCount + 1));
      await expect(
        form.locator('input[placeholder="Open seat · add a name"]'),
      ).toHaveCount(1);
      await form.locator('button[name="seat_action"][value="remove"]').click();
      await expect(count).toHaveText(String(storedCount));
      await form
        .locator('input[name="seat_name"]')
        .first()
        .fill(`Editor Parent ${run}`);
      await form.getByRole("button", { name: "Save" }).click();
      await expect(rowById(page, fixture.id)).toContainText(
        `Editor Parent ${run}`,
      );
    });
  });

  test("pressing Enter in the household name saves without changing seats", async ({
    page,
  }) => {
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?edit=${fixture.id}`);
      const form = page.locator("[data-edit-household]");
      const count = await form.locator("[data-seat-output]").textContent();
      const name = `Enter save ${run}`;
      const field = form.locator('input[name="display_name"]');
      await field.fill(name);
      await field.press("Enter");
      const saved = rowById(page, fixture.id);
      await expect(saved).toContainText(name);
      await expect(saved.locator('[data-col="seats"]')).toContainText(
        `${count} seats`,
      );
    });
  });

  test("enforces the stepper limits with JavaScript", async ({ page }) => {
    await page.goto("/admin/guests?new=1");
    const newForm = page.locator("[data-new-household]");
    const add = newForm.locator('button[name="seat_action"][value="add"]');
    for (let count = 1; count < 12; count += 1) await add.click();
    await expect(newForm.locator("[data-new-seat-output]")).toHaveText("12");
    await expect(add).toBeDisabled();

    for (const id of [fixture.id, "hh-lim", "hh-admin-activity"]) {
      await page.goto(`/admin/guests?edit=${id}`);
      await expect(
        page.locator(
          '[data-edit-household] button[name="seat_action"][value="remove"]',
        ),
      ).toBeDisabled();
    }
  });

  test("refuses no-JS stepper overflow and a responded trailing seat", async ({
    browser,
  }) => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto("/admin/guests?new=1");
    const newForm = page.locator("[data-new-household]");
    await newForm.locator('input[name="display_name"]').fill("Limit household");
    await newForm.locator('input[name="label"]').fill("LIMIT_01");
    await newForm.locator('input[name="member_name"]').fill("Limit member");
    for (let count = 1; count < 12; count += 1)
      await newForm.locator('button[name="seat_action"][value="add"]').click();
    await expect(newForm.locator("[data-new-seat-output]")).toHaveText("12");
    await expect(
      newForm.locator('button[name="seat_action"][value="add"]'),
    ).toBeDisabled();

    await page.goto("/admin/guests?edit=hh-admin-activity");
    const editForm = page.locator("[data-edit-household]");
    await editForm
      .locator('button[name="seat_action"][value="remove"]')
      .click();
    await expect(editForm.locator("[data-admin-write-error]")).toContainText(
      "Seat 2 has activity. Review or retire this seat first.",
    );
    await expect(editForm.locator("[data-seat-output]")).toHaveText("2");
    await page.close();
  });

  test("keeps a rejected new household draft", async ({ page }) => {
    await page.goto("/admin/guests?new=1");
    const form = page.locator("[data-new-household]");
    await form.locator('input[name="display_name"]').fill("Typed household");
    await form.locator('input[name="label"]').fill("TYPED_ID");
    await form.locator('input[name="notes"]').fill("Typed notes");
    await form.getByRole("button", { name: "+ Add member" }).click();
    await form.locator('button[name="seat_action"][value="add"]').click();
    await form
      .locator('input[name="member_name"]')
      .first()
      .fill("Typed member");
    await form.getByRole("button", { name: "Save household" }).click();
    await expect(form.locator("[data-admin-write-error]")).toContainText(
      "At least one member name is required.",
    );
    await expect(form.locator('input[name="display_name"]')).toHaveValue(
      "Typed household",
    );
    await expect(form.locator('input[name="label"]')).toHaveValue("TYPED_ID");
    await expect(form.locator('input[name="notes"]')).toHaveValue(
      "Typed notes",
    );
    expect(
      await form
        .locator('input[name="member_name"]')
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value),
        ),
    ).toEqual(["Typed member", ""]);
    await expect(form.locator("[data-new-seat-output]")).toHaveText("3");
  });

  test("keeps an existing plus-one a plus-one after the no-JS stepper submits", async ({
    browser,
  }) => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto("/admin/guests?edit=hh-lim");
    const form = page.locator("[data-edit-household]");
    const count = form.locator("[data-seat-output]");
    const storedCount = Number(await count.textContent());
    await form.locator('button[name="seat_action"][value="add"]').click();
    await expect(count).toHaveText(String(storedCount + 1));
    const existingPlusOne = form.locator(
      '.admin_guests_chip:has(input[name="seat_id"][value="2"])',
    );
    await expect(existingPlusOne).toHaveAttribute("data-seat-kind", "plus_one");
    await expect(
      existingPlusOne.locator('input[placeholder="Open seat · add a name"]'),
    ).toBeVisible();
    await expect(existingPlusOne.locator('input[type="checkbox"]')).toHaveCount(
      0,
    );
    await page.close();
  });

  test("refuses the second stale save", async ({ browser }) => {
    await withAdminLock(async () => {
      const first = await browser.newPage();
      const second = await browser.newPage();
      await Promise.all([
        first.goto("/admin/guests?edit=hh-admin-editor"),
        second.goto("/admin/guests?edit=hh-admin-editor"),
      ]);
      await first
        .locator('[data-edit-household] input[name="display_name"]')
        .fill(`First ${run}`);
      await first
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save" })
        .click();
      await expect(rowById(first, fixture.id)).toContainText(`First ${run}`);
      await second
        .locator('[data-edit-household] input[name="display_name"]')
        .fill(`Stale ${run}`);
      await second
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save" })
        .click();
      await expect(second.locator("[data-admin-write-error]")).toContainText(
        "This household changed since you opened it",
      );
      await expect(
        second.getByRole("link", { name: "Reload" }),
      ).toHaveAttribute("href", "/admin/guests?edit=hh-admin-editor");
      await first.close();
      await second.close();
    });
  });

  test("links a stale archive refusal back to its household", async ({
    browser,
  }) => {
    await withAdminLock(async () => {
      const archive = await browser.newPage();
      const editor = await browser.newPage();
      await Promise.all([
        archive.goto(`/admin/guests?archive=${fixture.id}`),
        editor.goto(`/admin/guests?edit=${fixture.id}`),
      ]);
      await editor
        .locator('[data-edit-household] input[name="display_name"]')
        .fill(`Archive stale ${run}`);
      await editor
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save" })
        .click();
      await archive
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(archive.locator("[data-admin-write-error]")).toContainText(
        "This household changed since you opened it",
      );
      await expect(
        archive.getByRole("link", { name: "Reload" }),
      ).toHaveAttribute("href", `/admin/guests?edit=${fixture.id}`);
      await archive.close();
      await editor.close();
    });
  });

  test("adds a household and archives it through the in-page confirmation", async ({
    page,
  }) => {
    await withAdminLock(async () => {
      const label = `Ed ${run}`;
      const householdId = label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      await form
        .locator('input[name="display_name"]')
        .fill(`The ${label} Family`);
      await form.locator('input[name="label"]').fill(label);
      await form
        .locator('input[name="member_name"]')
        .first()
        .fill(`New Member ${run}`);
      await form.getByRole("button", { name: "Save household" }).click();
      const added = rowById(page, householdId);
      await expect(added).toBeVisible();
      await added.locator("summary").click();
      await added.getByRole("link", { name: "Archive household" }).click();
      await expect(page.locator("[data-admin-archive-confirm]")).toContainText(
        `Archive The ${label} Family?`,
      );
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(rowById(page, householdId)).toHaveCount(0);
    });
  });
});
