import { expect, type Locator } from "@playwright/test";

/**
 * The shared fade-in (src/scripts/fade-in.ts) keeps an item transparent until its section is
 * reached or focus enters it (L-029). Scroll the element into view, then wait until the fade item that holds
 * it (or the element itself) is fully opaque, so a spec can click or measure it.
 */
export async function reveal(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const item = target.locator("xpath=ancestor-or-self::*[@data-fade-in-item][1]");
  if ((await item.count()) === 0) return;
  // The tween is clock-timed (0.8s), but under 8 workers a page can get a few frames a second,
  // so allow far longer than the tween before calling it stuck.
  await expect(item).toHaveCSS("opacity", "1", { timeout: 20_000 });
}
