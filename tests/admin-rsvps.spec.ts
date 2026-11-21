import { test, expect } from "@playwright/test";
import { fakeAdminFixtures, fakeAdminResponses } from "../src/lib/admin/fake";

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
const replied = fakeAdminFixtures.filter((row) => latest.has(row.id));

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
        ["waiting", fakeAdminFixtures.filter((r) => !latest.has(r.id)).length],
      ] as const) {
        await page.locator(`[data-admin-filter="${filter}"]`).click();
        await expect(page.locator("[data-admin-rsvp-row]")).toHaveCount(count);
      }
    },
  );

  test("searches by email", { tag: "@smoke" }, async ({ page }) => {
    await page.goto("/admin/rsvps");
    await page.locator("[data-admin-search]").fill("maria@example.com");
    await expect(
      page.locator("[data-admin-rsvp-row]:not([hidden])"),
    ).toHaveCount(1);
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
    const drawer = page.locator("[data-admin-drawer]");
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
    await expect(drawer).toBeVisible();
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
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
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
});
