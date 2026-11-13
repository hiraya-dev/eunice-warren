import { expect, test } from "@playwright/test";

test.describe("smoke", { tag: ["@smoke"] }, () => {
  test("home page renders", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page).toHaveTitle(/Eunice & Warren/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });

  test("renders every section in order with an id", async ({ page }) => {
    await page.goto("/");
    // PreWedding is commented out in src/pages/index.astro.
    const ids = await page.locator("main > section").evaluateAll((sections) => sections.map((section) => section.id));
    expect(ids).toEqual([
      "hero",
      "invitation",
      "wedding",
      "attire",
      "entourage",
      "stay",
      "explore",
      "ribbons",
      "with-love",
      "playlist",
      "faq",
      "rsvp",
    ]);
    for (const id of ids) expect(id).not.toBe("");
  });

  test("marks section headings for the shared fade-in", async ({ page }) => {
    await page.goto("/");
    for (const [selector, items] of [
      [".wedding_header", 1],
      [".playlist_header", 2],
      [".faq_header", 2],
      ["#rsvp .rsvp_header", 2],
    ] as const) {
      const header = page.locator(selector);
      await expect(header, selector).toHaveAttribute("data-fade-in", "");
      await expect(header.locator("[data-fade-in-item]"), selector).toHaveCount(items);
    }
  });

  test("unknown route serves the 404 page", { tag: ["@single"] }, async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.locator("h1")).toHaveText("This page doesn't exist");
  });

  test("robots.txt allows crawling without advertising a sitemap before launch", { tag: ["@single"] }, async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).not.toContain("Sitemap: ");
  });

  test("moves the style guide to its own noindex route", { tag: ["@single"] }, async ({ page }) => {
    const response = await page.goto("/style-guide");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText("Style Guide");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });
});
