import { expect, test } from "@playwright/test";

const calendarPath = "/eunice-warren-wedding.ics";
const churchMap = "https://maps.app.goo.gl/hdagou9oAemHt2Mu5";
const belmontMap = "https://maps.app.goo.gl/zRcdZnfr5m5LzGYE9";
const savoyMap = "https://maps.app.goo.gl/fsWi3VsXBAkcK5DBA";
const messageHref = "sms:+639362300525";

test.describe("home page links", { tag: ["@smoke"] }, () => {
  test("wires in-page and calendar links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero_rsvp")).toHaveAttribute("href", "#rsvp");
    await expect(page.locator(".hero_weekend")).toHaveAttribute(
      "href",
      "#wedding",
    );
    await expect(
      page.locator(".invitation_fact-link").filter({ hasText: "RSVP NOW" }),
    ).toHaveAttribute("href", "#rsvp");
    await expect(page.locator(`a[href="${calendarPath}"]`)).toHaveCount(3);
    await expect(page.locator(".footer_top-link")).toHaveAttribute(
      "href",
      "#hero",
    );
  });

  test("wires venue maps and message links", async ({ page }) => {
    await page.goto("/");
    const maps = page.locator(".wedding_location a");
    await expect(maps).toHaveCount(4);
    for (const [index, href] of [
      churchMap,
      belmontMap,
      belmontMap,
      savoyMap,
    ].entries()) {
      await expect(maps.nth(index)).toHaveAttribute("href", href);
      await expect(maps.nth(index)).toHaveAttribute("target", "_blank");
      await expect(maps.nth(index)).toHaveAttribute("rel", "noopener");
    }
    for (const link of [
      page.locator(".invitation_fact-link").filter({ hasText: "OPEN IN MAPS" }),
      page
        .locator(".rsvp_invitation-links a")
        .filter({ hasText: "Open in maps" }),
    ]) {
      await expect(link).toHaveAttribute("href", churchMap);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener");
    }
    await expect(page.locator(".rsvp_actions a.rsvp_text-link")).toHaveAttribute(
      "href",
      messageHref,
    );
  });

  test.describe("preloader", () => {
    // The default storage state skips the preloader; start without it.
    test.use({ storageState: { cookies: [], origins: [] } });

    test("wires the preloader message link", async ({ page }) => {
      await page.goto("/");
      await expect(
        page.locator("[data-preloader] [data-preloader-message] a"),
      ).toHaveAttribute("href", messageHref);
    });
  });

  test("serves the wedding calendar", async ({ request }) => {
    const response = await request.get(calendarPath);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/calendar");
    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("DTSTART:20270114T070000Z");
  });
});
