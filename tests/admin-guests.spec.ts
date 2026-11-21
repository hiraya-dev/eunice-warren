import { createHash } from "node:crypto";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { fakeAdminFixtures } from "../src/lib/admin/fake";

// The fake store keeps the editor fixture in server memory, shared by every
// worker and both projects, and every save bumps its stale-save token. A
// directory lock, keyed by checkout, keeps one writer between opening the form
// and reading the saved row back (L-022). A lock older than a minute is stale.
const editorLock = join(
  tmpdir(),
  `eunice-warren-admin-editor-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 12)}`,
);
const withEditorLock = async (run: () => Promise<void>) => {
  for (;;) {
    try {
      mkdirSync(editorLock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(editorLock).mtimeMs > 60_000)
          rmSync(editorLock, { recursive: true, force: true });
      } catch {
        // Released between the two calls; retry.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    await run();
  } finally {
    rmSync(editorLock, { recursive: true, force: true });
  }
};

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
    await withEditorLock(async () => {
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
    await withEditorLock(async () => {
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

  test("adds a household and archives it through the in-page confirmation", async ({
    page,
  }) => {
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
