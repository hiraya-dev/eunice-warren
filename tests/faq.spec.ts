import { expect, test } from "@playwright/test";

const panelHeight = (page: import("@playwright/test").Page, index: number) =>
  page.locator(".faq_panel").nth(index).evaluate((panel) => panel.getBoundingClientRect().height);

test.describe("FAQ section", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("#faq").scrollIntoViewIfNeeded();
  });

  test("renders eight questions with the first open", async ({ page }) => {
    const items = page.locator(".faq_item");
    await expect(page.locator("#faq")).toBeVisible();
    await expect(items).toHaveCount(8);
    await expect(items.nth(0).locator("[data-accordion-toggle]")).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => panelHeight(page, 0)).toBeGreaterThan(0);
    for (let index = 1; index < 8; index += 1) {
      await expect(items.nth(index).locator("[data-accordion-toggle]")).toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => panelHeight(page, index)).toBe(0);
      await expect(items.nth(index).locator(".faq_panel")).toHaveAttribute("inert", "");
    }
  });

  test("opens one item and closes siblings, and can close an open item", async ({ page }) => {
    await page.locator(".faq_toggle").nth(2).click();
    await expect(page.locator(".faq_toggle").nth(2)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".faq_toggle").nth(0)).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => panelHeight(page, 2)).toBeGreaterThan(0);
    await expect.poll(() => panelHeight(page, 0)).toBe(0);

    await page.locator(".faq_toggle").nth(2).click();
    await expect(page.locator(".faq_toggle").nth(2)).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => panelHeight(page, 2)).toBe(0);
  });

  test("opens a focused item with Enter", async ({ page }) => {
    const toggle = page.locator(".faq_toggle").nth(3);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => panelHeight(page, 3)).toBeGreaterThan(0);
  });

  test("places the contact row after the accordion list", async ({ page }) => {
    await expect(page.locator(".faq_list > ul + .faq_contact")).toBeVisible();
    await expect(page.locator(".faq_contact")).toContainText("Still unsure? Ask");
    await expect(page.locator(".faq_contact a")).toContainText("[email / Viber]");
  });
});
