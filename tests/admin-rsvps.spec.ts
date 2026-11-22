import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { fakeAdminFixtures, fakeAdminResponses } from "../src/lib/admin/fake";
import { withAdminLock } from "./helpers/admin-lock";

const latest = new Map<string, (typeof fakeAdminResponses)[number]>();
for (const response of fakeAdminResponses) {
  const saved = latest.get(response.householdId);
  if (
    !saved ||
    response.submittedAt > saved.submittedAt ||
    (response.submittedAt === saved.submittedAt && response.id > saved.id)
  )
    latest.set(response.householdId, response);
}
const counted = fakeAdminFixtures;
const replied = counted.filter((row) => latest.has(row.id));

const uniqueRsvpPrefix = (
  testInfo: Pick<TestInfo, "project" | "workerIndex" | "repeatEachIndex" | "title">,
) =>
  `HostEdit${testInfo.project.name}${testInfo.workerIndex}${testInfo.repeatEachIndex}${testInfo.title}`
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 36);

const archiveByPrefix = async (page: Page, prefix: string) => {
  await page.goto(`/admin/guests?q=${encodeURIComponent(prefix)}`);
  for (;;) {
    const row = page
      .locator("[data-admin-household]")
      .filter({ hasText: prefix })
      .first();
    if (!(await row.count())) return;
    await row.locator("summary").click();
    await row.getByRole("link", { name: "Archive household" }).click();
    await page
      .locator("[data-admin-archive-confirm]")
      .getByRole("button", { name: "Archive" })
      .click();
    await expect(
      page.locator("[data-admin-household]").filter({ hasText: prefix }),
    ).toHaveCount(0);
  }
};

const withTemporaryRsvpHousehold = async (
  page: Page,
  testInfo: Pick<TestInfo, "project" | "workerIndex" | "repeatEachIndex" | "title">,
  run: (household: { id: string; prefix: string }) => Promise<void>,
) => {
  await withAdminLock(async () => {
    const prefix = uniqueRsvpPrefix(testInfo);
    await archiveByPrefix(page, prefix);
    try {
      await page.goto(`/admin/guests?new=1&q=${encodeURIComponent(prefix)}`);
      const form = page.locator("[data-new-household]");
      // Save takes a name still in the input, with or without JS (the no-JS
      // "Add" button doesn't exist once the chips script runs).
      await form.locator("[name='member_input']").fill(`Ari ${prefix}`);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: prefix });
      await expect(row).toHaveCount(1);
      await run({ id: (await row.getAttribute("data-household-id"))!, prefix });
    } finally {
      await archiveByPrefix(page, prefix);
    }
  });
};

test.describe("admin RSVPs", () => {
  test(
    "guest home does not contain admin fixture data",
    { tag: ["@single"] },
    async ({ request }) => {
      const html = await (await request.get("/")).text();
      for (const row of fakeAdminFixtures) {
        expect(html).not.toContain(row.label);
        expect(html).not.toContain(`${row.id}@example.com`);
      }
      expect(html).not.toContain("maria@example.com");
    },
  );

  test(
    "filter pills use fixture counts",
    { tag: "@smoke" },
    async ({ page }) => {
      await withAdminLock(async () => {
        await page.goto("/admin/rsvps");
        await expect(
          page.locator(
            '[data-admin-nav] a[href="/admin/guests"] [data-admin-count]',
          ),
        ).toHaveText(String(fakeAdminFixtures.length));
        for (const [filter, count] of [
        ["all", replied.length],
        [
          "attending",
          replied.filter((r) => latest.get(r.id)?.attending).length,
        ],
        [
          "declined",
          replied.filter((r) => !latest.get(r.id)?.attending).length,
        ],
        [
          "seat-changes",
          replied.filter((r) =>
            r.seats.some(
              (seat) =>
                (seat.kind === "member" && seat.name !== seat.invitedName) ||
                (seat.kind === "plus_one" && Boolean(seat.name)),
            ),
          ).length,
        ],
        ["waiting", counted.filter((r) => !latest.has(r.id)).length],
        ] as const) {
          await page.locator(`[data-admin-filter="${filter}"]`).click();
          await expect(
            page.locator(
            `[data-admin-rsvp-row]`,
            ),
          ).toHaveCount(
            count,
          );
        }
      });
    },
  );

  test("searches by email", { tag: "@smoke" }, async ({ page }) => {
    await page.goto("/admin/rsvps");
    await page.locator("[data-admin-search]").fill("maria@example.com");
    await expect(
      page.locator("[data-admin-rsvp-row]:not([hidden])"),
    ).toHaveCount(1);
  });

  test("drops the divider under the last visible row", async ({ page }) => {
    const borders = () =>
      page
        .locator("[data-admin-rsvp-row]:not([hidden])")
        .evaluateAll((rows) =>
          rows.map((row) => getComputedStyle(row).borderBottomWidth),
        );
    await page.goto("/admin/rsvps");
    let widths = await borders();
    expect(widths.at(-1)).toBe("0px");
    expect(widths.slice(0, -1).every((width) => width !== "0px")).toBe(true);
    // Search hides the rows after a match; the match becomes the last one.
    await page.locator("[data-admin-search]").fill("liza@example.com");
    widths = await borders();
    expect(widths).toEqual(["0px"]);
  });

  test("keeps typed search in filter, row, and close URLs", async ({
    page,
  }) => {
    await page.goto("/admin/rsvps");
    await page.locator("[data-admin-search]").fill("maria");
    await page.locator('[data-admin-filter="attending"]').click();
    await expect(page).toHaveURL(
      /filter=attending&?q=maria|q=maria&?filter=attending/,
    );
    await expect(page.locator("[data-admin-search]")).toHaveValue("maria");
    await expect(
      page.locator("[data-admin-rsvp-row]:not([hidden])"),
    ).toHaveCount(1);

    await page.locator("[data-admin-rsvp-link]").first().click();
    await expect(page).toHaveURL(/q=maria.*household=/);
    await page.locator("[data-admin-drawer-close]").click();
    await expect(page).toHaveURL(/q=maria/);
  });

  test("keeps focus inside the drawer while tabbing both directions", async ({
    page,
  }) => {
    await page.goto("/admin/rsvps");
    await page.locator("[data-admin-rsvp-link]").first().click();
    await page.locator("[data-admin-drawer-nav]").click();
    const drawer = page.locator("[data-admin-drawer]");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("h2")).toBeFocused();
    for (const modifiers of [[], ["Shift"]]) {
      if (modifiers.length) await page.keyboard.down("Shift");
      for (let index = 0; index < 10; index++) {
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(
            () =>
              document.activeElement?.closest("[data-admin-drawer]") !== null,
          ),
        ).toBe(true);
      }
      if (modifiers.length) await page.keyboard.up("Shift");
    }
  });

  test("leaves modified row clicks to the browser", async ({ page }) => {
    await page.goto("/admin/rsvps");
    const url = page.url();
    await page
      .locator("[data-admin-rsvp-link]")
      .first()
      .click({
        modifiers: ["Control"],
      });
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    expect(page.url()).toBe(url);
  });

  test(
    "opens and closes a waiting drawer and returns focus",
    { tag: "@smoke" },
    async ({ page }) => {
      await page.goto("/admin/rsvps?filter=waiting");
      const link = page.locator("[data-admin-rsvp-link]").first();
      await link.click();
      await expect(page.locator("[data-admin-drawer]")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
      await expect(link).toBeFocused();
      await page.goBack();
      await expect(page.locator("[data-admin-drawer]")).toBeVisible();
    },
  );

  test("unknown household is a 404", { tag: "@single" }, async ({ page }) => {
    const response = await page.goto("/admin/rsvps?household=unknown");
    expect(response?.status()).toBe(404);
    await expect(page.locator("[data-admin-not-found]")).toBeVisible();
  });

  test(
    "empty household query renders the list",
    { tag: "@single" },
    async ({ page }) => {
      const response = await page.goto("/admin/rsvps?household=");
      expect(response?.status()).toBe(200);
      await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
      await expect(page.locator("[data-admin-rsvps]")).toBeVisible();
    },
  );

  test(
    "CSV has the host-only export headers",
    { tag: ["@smoke", "@single"] },
    async ({ request }) => {
      const response = await request.get("/admin/rsvps.csv");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/csv");
      expect(response.headers()["content-disposition"]).toContain("attachment");
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect((await response.text()).split("\r\n")[0]).toBe(
        "household_label,household,reply,email,sent_at_manila,versions,edited_by,slot,kind,invited_as,name,coming,slipper_size,note",
      );
    },
  );

  test("does not overflow on mobile", { tag: "@single" }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/rsvps");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator("[data-admin-rsvp-link]").first().click();
    await page.locator("[data-admin-drawer-nav]").click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole("button", { name: "Save reply" })).toBeVisible();
  });

  test("pins the edit footer to the sheet and keeps Save reply under no other layer", { tag: "@single" }, async ({ page }) => {
    // Read-only: opens the form and measures, never saves.
    const measure = () =>
      page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const save = rect(".admin-drawer_edit-footer button");
        const hit = document.elementFromPoint(save.x + save.width / 2, save.y + save.height / 2);
        return {
          panelWidth: rect(".admin-drawer_panel").width,
          footerBottom: rect(".admin-drawer_edit-footer").bottom,
          saveTop: save.top,
          saveHit: hit?.closest("button")?.textContent?.trim() ?? null,
          selectWidth: rect(".admin-drawer_edit-seat select").width,
          height: innerHeight,
        };
      });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/rsvps?household=hh-ramos&edit=1");
    await expect(page.locator(".admin-drawer_edit-form")).toBeVisible();
    await page.waitForTimeout(400);
    const phone = await measure();
    expect(Math.abs(phone.footerBottom - phone.height)).toBeLessThanOrEqual(2);
    expect(phone.saveTop).toBeGreaterThan(0);
    expect(phone.saveHit).toBe("Save reply");
    expect(Math.abs(phone.selectWidth - 120)).toBeLessThanOrEqual(2);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(400);
    const desktop = await measure();
    expect(Math.abs(desktop.panelWidth - 600)).toBeLessThanOrEqual(2);
    expect(Math.abs(desktop.footerBottom - desktop.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(desktop.selectWidth - 128)).toBeLessThanOrEqual(2);
  });

  test("opens edit mode, shows live renames, and clears a fixed size error", async ({ page }, testInfo) => {
    await withTemporaryRsvpHousehold(page, testInfo, async ({ id, prefix }) => {
      await page.goto(`/admin/rsvps?household=${id}&edit=1`);
      await expect(page.locator(".admin-drawer_edit-form")).toBeVisible();
      await page.locator('input[name="attending"][value="yes"]').check();
      const firstName = page.locator('input[name="seat_name_1"]');
      await firstName.fill(`Renamed ${prefix}`);
      await expect(page.locator("[data-admin-was]")).toBeVisible();
      await page.locator('input[name="seat_attending_1"]').check();
      await page.locator('select[name="slipper_size_1"]').selectOption("");
      await page.getByRole("button", { name: "Save reply" }).click();
      await expect(page.locator(".admin-drawer_error").filter({ hasText: "Pick a slipper size" })).toBeVisible();
      await expect(firstName).toHaveValue(`Renamed ${prefix}`);
      await page.locator('select[name="slipper_size_1"]').selectOption("W 7");
      await expect(page.locator(".admin-drawer_size-error")).toBeHidden();
    });
  });

  test("saves a host edit from Enter and shows the new history version", async ({ page }, testInfo) => {
    await withTemporaryRsvpHousehold(page, testInfo, async ({ id, prefix }) => {
      await page.goto(`/admin/rsvps?household=${id}&edit=1`);
      await page.locator('input[name="attending"][value="yes"]').check();
      await page.locator('input[name="seat_attending_1"]').check();
      await page.locator('select[name="slipper_size_1"]').selectOption("W 7");
      await page.locator('input[name="seat_name_1"]').fill(`Fictional Host ${prefix}`);
      await page.locator('input[name="seat_name_1"]').press("Enter");
      await expect(page.locator("[data-admin-saved]")).toBeVisible();
      await expect(page.locator("[data-admin-host-edit]").first()).toContainText("by host");
    });
  });

  test("switching to No collapses the seats and saves a decline", async ({ page }, testInfo) => {
    await withTemporaryRsvpHousehold(page, testInfo, async ({ id }) => {
      await page.goto(`/admin/rsvps?household=${id}&edit=1`);
      await page.locator('input[name="attending"][value="no"]').check();
      await expect(page.locator("[data-admin-nobody]")).toBeVisible();
      await expect(page.locator("[data-admin-edit-seats]")).toBeHidden();
      await page.getByRole("button", { name: "Save reply" }).click();
      await expect(page.locator(`[data-admin-rsvp-row][data-household="${id}"]`)).toHaveAttribute("data-state", "declined");
      await expect(page.locator("[data-admin-host-edit]").first()).toContainText("by host");
    });
  });

  test("answers for a waiting household and keeps its empty email", async ({ page }, testInfo) => {
    await withTemporaryRsvpHousehold(page, testInfo, async ({ id }) => {
      await page.goto(`/admin/rsvps?household=${id}&edit=1`);
      await page.locator('input[name="attending"][value="yes"]').check();
      await page.locator('input[name="seat_attending_1"]').check();
      await page.locator('select[name="slipper_size_1"]').selectOption("W 7");
      await page.getByRole("button", { name: "Save reply" }).click();
      await expect(page.locator(`[data-admin-rsvp-row][data-household="${id}"]`)).toHaveAttribute("data-state", "attending");
      await expect(page.locator(`[data-admin-rsvp-row][data-household="${id}"] small`)).toHaveText("—");
      await expect(page.locator("[data-admin-host-edit]").first()).toContainText("by host");
    });
  });

  test("Cancel, Escape, and Back return to the read view with filter and search", async ({ page }) => {
    await page.goto("/admin/rsvps?filter=attending&q=maria");
    // Each step waits for the drawer swap to land before the next key or click
    // (L-055: a key pressed before the swap acts on the previous drawer).
    const editForm = page.locator(".admin-drawer_edit-form");
    await page.locator("[data-admin-rsvp-link]").first().click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.locator("[data-admin-drawer-nav]").click();
    await expect(editForm).toBeVisible();
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/filter=attending.*q=maria/);
    await expect(editForm).toHaveCount(0);
    await page.locator("[data-admin-drawer-nav]").click();
    await expect(editForm).toBeVisible();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/filter=attending.*q=maria/);
    await expect(editForm).toHaveCount(0);
    await expect(page.locator("[data-admin-drawer]")).toBeVisible();
    await page.locator("[data-admin-drawer-nav]").click();
    await expect(editForm).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/filter=attending.*q=maria/);
    await expect(page.locator(".admin-drawer_edit-form")).toHaveCount(0);
  });

  test("refuses a stale host edit and keeps the draft", async ({ page, browser }, testInfo) => {
    await withTemporaryRsvpHousehold(page, testInfo, async ({ id, prefix }) => {
      const other = await browser.newPage();
      try {
        await page.goto(`/admin/rsvps?household=${id}&edit=1`);
        await other.goto(`/admin/rsvps?household=${id}&edit=1`);
        await other.locator('input[name="attending"][value="no"]').check();
        await other.getByRole("button", { name: "Save reply" }).click();
        await expect(other.locator("[data-admin-host-edit]").first()).toContainText("by host");
        await page.locator('input[name="attending"][value="yes"]').check();
        await page.locator('input[name="seat_name_1"]').fill(`Stale draft ${prefix}`);
        await page.locator('input[name="seat_attending_1"]').check();
        await page.locator('select[name="slipper_size_1"]').selectOption("W 7");
        await page.getByRole("button", { name: "Save reply" }).click();
        await expect(page.locator(".admin-drawer_stale")).toBeVisible();
        await expect(page.locator(".admin-drawer_stale")).toContainText("This reply changed while you were editing");
        await expect(page.locator(".admin-drawer_stale a", { hasText: "Reload" })).toHaveAttribute("href", /household=.*edit=1/);
        await expect(page.locator('input[name="seat_name_1"]')).toHaveValue(`Stale draft ${prefix}`);
        // Nothing was written: the read view still holds only the other host's version.
        await page.goto(`/admin/rsvps?household=${id}`);
        await expect(page.locator("[data-admin-host-edit]")).toHaveCount(1);
      } finally {
        await other.close();
      }
    });
  });
});

test.describe("admin RSVPs without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test(
    "deep link renders and close returns to list",
    { tag: "@smoke" },
    async ({ page }) => {
      await page.goto("/admin/rsvps?household=hh-dela-cruz");
      await expect(page.locator("[data-admin-drawer]")).toBeVisible();
      await page.locator("[data-admin-drawer-close]").click();
      await expect(page).toHaveURL(/\/admin\/rsvps\/?(?:\?filter=all)?$/);
    },
  );
  test(
    "edit deep link saves a host reply without JavaScript",
    { tag: "@smoke" },
    async ({ page }, testInfo) => {
      await withTemporaryRsvpHousehold(page, testInfo, async ({ id }) => {
        await page.goto(`/admin/rsvps?household=${id}&edit=1`);
        await expect(page.locator("[data-admin-drawer]")).toBeVisible();
        await expect(page.locator("form.admin-drawer_edit-form")).toBeVisible();
        await expect(page.locator('button[type="submit"]')).toHaveText("Save reply");
        await page.locator('input[name="attending"][value="yes"]').check();
        await page.locator('input[name="seat_attending_1"]').check();
        await page.locator('select[name="slipper_size_1"]').selectOption("W 7");
        await page.getByRole("button", { name: "Save reply" }).click();
        await expect(page).toHaveURL(/household=.*saved=1/);
        await expect(page.locator("[data-admin-saved]")).toBeVisible();
        await expect(page.locator("[data-admin-host-edit]").first()).toContainText("by host");
      });
    },
  );
});
