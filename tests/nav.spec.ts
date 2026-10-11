import { expect, test } from "@playwright/test";

const links = [
  ["The wedding", "/#the-wedding"],
  ["Stay", "/#stay"],
  ["Explore", "/#explore"],
  ["Playlist", "/#playlist"],
  ["FAQ", "/#faq"],
] as const;

test.describe("Eunice & Warren navigation", () => {
  test("shows the desktop navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    for (const [name, href] of links) {
      await expect(page.getByRole("link", { name, exact: true }).first()).toHaveAttribute("href", href);
    }
    await expect(page.locator(".hamburger-nav__toggle")).toBeHidden();
    await expect(page.getByRole("link", { name: "RSVP", exact: true })).toHaveAttribute("href", "/#rsvp");
    await expect(page.getByRole("link", { name: "RSVP", exact: true })).toHaveCSS("border-radius", /\d{3,}px/);
    await expect(page.locator(".nav_now-playing")).toHaveAttribute("aria-hidden", "true");
  });

  test("opens and traps the mobile menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.locator(".nav_menu")).toBeHidden();
    const toggle = page.locator('[data-navigation-toggle="toggle"]');
    const rsvp = page.getByRole("link", { name: "RSVP", exact: true });
    const boxes = await Promise.all([toggle.boundingBox(), rsvp.boundingBox()]);
    expect(boxes[0] && boxes[1]).toBeTruthy();
    expect(boxes[0]!.x + boxes[0]!.width <= boxes[1]!.x || boxes[1]!.x + boxes[1]!.width <= boxes[0]!.x).toBe(true);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.locator('[data-navigation-status="active"]')).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".hamburger-nav__a").first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-navigation-status="not-active"]')).toBeVisible();
    await expect(toggle).toBeFocused();

    await toggle.click();
    await page.locator('[data-navigation-toggle="close"]').click({ position: { x: 5, y: 5 } });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(page.locator(".hamburger-nav__a").first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toBeFocused();
    await page.locator(".hamburger-nav__a").first().focus();
    for (let index = 0; index < links.length; index += 1) await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
  });
});
