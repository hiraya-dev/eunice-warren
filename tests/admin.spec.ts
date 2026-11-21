import { test, expect } from "@playwright/test";
import { fakeAdminFixtures } from "../src/lib/admin/fake";

test.describe("admin dashboard", () => {
  test("renders the fixture overview and protected headers @smoke", async ({
    page,
  }) => {
    const response = await page.goto("/admin");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator("[data-admin-sample]")).toBeVisible();
    await expect(page.locator("[data-admin-greeting]")).toContainText("Eunice");
    await expect(page.locator("[data-admin-coming]")).toBeVisible();
    await expect(page.locator("[data-admin-reply]")).toHaveCount(4);
    await expect(page.locator("[data-admin-waiting-row]")).toHaveCount(
      Math.min(
        3,
        fakeAdminFixtures.filter((row) => row.rsvp.state === "waiting").length,
      ),
    );
  });

  test("lists and searches fixture households @smoke", async ({ page }) => {
    await page.goto("/admin/guests");
    await expect(page.locator("[data-admin-household]")).toHaveCount(
      fakeAdminFixtures.length,
    );
    await page.locator("[data-admin-search]").fill("mendoza");
    await expect(
      page.locator("[data-admin-household]:not([hidden])"),
    ).toHaveCount(1);
    await page.locator("[data-admin-search]").fill("no such household");
    await expect(page.locator("[data-admin-no-match]")).toBeVisible();
  });

  // Overflow is judged against the page itself: the stamp is rotated and the
  // guest table swaps layout at 84rem (1344px), so odd widths are in the list (L-018).
  for (const path of [
    "/admin",
    "/admin/guests",
    "/admin/rsvps",
    "/admin/rsvps?household=hh-lim",
  ]) {
    test(`has no horizontal overflow at 320 to 1920 on ${path} @sweep @single`, async ({
      page,
    }) => {
      for (const width of [
        320, 375, 390, 481, 768, 1023, 1024, 1150, 1279, 1280, 1343, 1344, 1440,
        1920,
      ]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(
          overflow,
          `scrollWidth - innerWidth at ${width}`,
        ).toBeLessThanOrEqual(0);
      }
    });
  }

  // User feedback on #96: the phone greeting wrapped to 3 lines beside the
  // stamp (old CSS: 3 lines at 390). Use the longest greeting the helper makes.
  test("keeps the greeting to two lines on phones @sweep @single", async ({
    page,
  }) => {
    for (const width of [320, 360, 390, 480, 768, 1023]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/admin");
      const lines = await page
        .locator("[data-admin-greeting]")
        .evaluate((el) => {
          const name = el.querySelector("em")?.textContent ?? "Eunice";
          el.innerHTML = `Good afternoon, <em>${name}</em>`;
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
          return Math.round(el.getBoundingClientRect().height / lineHeight);
        });
      expect(lines, `greeting lines at ${width}`).toBeLessThanOrEqual(2);
    }
  });

  test("swaps the sidebar for the tab bar below 1024 @sweep @single", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.locator("[data-admin-tabbar]")).toBeVisible();
    await expect(page.locator("[data-admin-sidebar]")).toBeHidden();
    const tabbar = await page.locator("[data-admin-tabbar]").boundingBox();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = await page
      .locator("main section")
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    // Padding clears the fixed bar: the old failure hides the last row under it.
    expect(last).toBeLessThanOrEqual(tabbar!.y + 6);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("[data-admin-sidebar]")).toBeVisible();
    await expect(page.locator("[data-admin-tabbar]")).toBeHidden();
    const sidebar = await page.locator("[data-admin-sidebar]").boundingBox();
    expect(Math.abs(sidebar!.width - 264)).toBeLessThanOrEqual(6);
  });
});
