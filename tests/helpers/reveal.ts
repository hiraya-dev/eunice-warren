import { expect, type Locator } from "@playwright/test";

export async function reveal(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const item = target.locator("xpath=ancestor-or-self::*[@data-fade-in-item][1]");
  if ((await item.count()) === 0) return;
  await expect(item).toHaveCSS("opacity", "1", { timeout: 20_000 });
}
