import { test, expect } from "@playwright/test";
import { fakeAdminFixtures } from "../src/lib/admin/fake";

const replied = fakeAdminFixtures.filter((row) => row.rsvp.state !== "waiting");

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
      for (const [filter, count] of [
        ["all", replied.length],
        ["attending", replied.filter((r) => r.rsvp.state === "coming").length],
        ["declined", replied.filter((r) => r.rsvp.state === "declined").length],
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
        [
          "waiting",
          fakeAdminFixtures.filter((r) => r.rsvp.state === "waiting").length,
        ],
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
