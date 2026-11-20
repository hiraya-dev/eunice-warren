import { expect, test, type Locator, type Page } from "@playwright/test";
import { reveal } from "./helpers/reveal";

// Tall enough that the polaroid's buttons sit above the fold: Playwright centres a button it has to
// scroll to, and that scroll alone would carry the page past the polaroid and dock it.
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const audioOf = (page: Page) => page.locator("audio[data-music-audio]");
const tagOf = (page: Page) => page.locator("[data-music-tag]");
const cardOf = (page: Page) => page.locator("[data-music-polaroid] .music-polaroid_wrap");
const containerOf = (page: Page) => page.locator("[data-music-container]");
/** The hero keepsakes tween in on load; a click on a moving polaroid is retried with a scroll that docks it. */
const heroSettled = (page: Page) => expect(page.locator("#hero")).not.toHaveAttribute("data-hero-entering", "", { timeout: 20_000 });

type MarkedAudio = HTMLAudioElement & { musicSpec?: boolean };
const isPaused = (audio: Locator) => audio.evaluate((element) => (element as HTMLAudioElement).paused);
const currentTime = (audio: Locator) => audio.evaluate((element) => (element as HTMLAudioElement).currentTime);
const markAudio = (audio: Locator) => audio.evaluate((element) => { (element as MarkedAudio).musicSpec = true; });
const isMarked = (audio: Locator) => audio.evaluate((element) => Boolean((element as MarkedAudio).musicSpec));

/** Console errors a missing file cannot help logging; everything else must stay silent. */
const isNetworkNoise = (text: string) => /Failed to load resource/i.test(text);

test.describe("background music", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("starts from the preloader gesture, keeps one audio node and plays in real time", async ({ page }) => {
    await page.goto("/");
    const audio = audioOf(page);
    await expect(page.locator("[data-preloader]")).toBeVisible();
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(audio).toHaveCount(1);
    await expect.poll(() => isPaused(audio)).toBe(false);
    // Playback has to have started advancing before it is timed, or the sample catches the load.
    await expect.poll(() => currentTime(audio), { timeout: 15_000 }).toBeGreaterThan(0);
    const sample = await audio.evaluate(async (element) => {
      const media = element as HTMLAudioElement;
      const start = performance.now();
      const initial = media.currentTime;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return { elapsed: (performance.now() - start) / 1000, delta: media.currentTime - initial };
    });
    // Real time, not frames: it cannot run faster than the clock and must not crawl.
    expect(sample.delta).toBeGreaterThan(sample.elapsed * 0.3);
    expect(sample.delta).toBeLessThan(sample.elapsed + 0.25);

    await markAudio(audio);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(audio).toHaveCount(1);
    await expect.poll(() => isMarked(audio)).toBe(true);
  });

  test("pauses when Spotify starts and does not resume by itself", async ({ page }) => {
    await page.goto("/");
    const audio = audioOf(page);
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect.poll(() => isPaused(audio)).toBe(false);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("ew:playlist-play")));
    await expect.poll(() => isPaused(audio)).toBe(true);
    await expect(page.locator("[data-music-surface]").first()).toHaveAttribute("data-state", "paused");
    await page.waitForTimeout(1000);
    expect(await isPaused(audio)).toBe(true);
  });

  test("disables every control when the audio fails, without throwing", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !isNetworkNoise(message.text())) problems.push(`console: ${message.text()}`);
    });
    await page.route("**/audio/our-song.mp3", (route) => route.fulfill({ status: 404, body: "missing" }));
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(page.locator("[data-music][data-state=error]")).toHaveCount(1);
    const controls = page.locator("[data-music-toggle], [data-music-mute]");
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) await expect(control).toBeDisabled();
    // Every surface agrees, so the polaroid is not left offering a dead play button.
    for (const surface of await page.locator("[data-music-surface]").all()) await expect(surface).toHaveAttribute("data-state", "error");
    expect(problems).toEqual([]);
  });
});

test.describe("background music returning guest", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("does not request audio until the visible player is pressed", async ({ page }) => {
    const requests: string[] = [];
    const size = page.viewportSize();
    if (size && size.width >= 1024) await page.setViewportSize({ width: size.width, height: DESKTOP.height });
    page.on("request", (request) => { if (request.url().includes("/audio/")) requests.push(request.url()); });
    await page.addInitScript(() => localStorage.setItem("ew-guest-v1", JSON.stringify({ skipped: true, at: "2026-01-01T00:00:00.000Z" })));
    await page.goto("/");
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await heroSettled(page);
    await expect.poll(() => isPaused(audioOf(page))).toBe(true);
    await page.waitForTimeout(500);
    expect(requests).toHaveLength(0);

    // Desktop shows the polaroid in the hero (the tag is hidden there); a phone shows the tag.
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    const toggle = page.locator(wide ? "[data-music-polaroid] [data-music-toggle]" : "[data-music-tag] [data-music-toggle]");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect.poll(() => isPaused(audioOf(page))).toBe(false);
  });
});

test.describe("background music teleport, desktop", { tag: ["@single"] }, () => {
  test.use({ viewport: DESKTOP });

  test("flies from the hero polaroid to the tag and back on the same audio node", async ({ page }) => {
    await page.goto("/");
    const audio = audioOf(page);
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await heroSettled(page);
    await expect(cardOf(page)).toBeVisible();
    await expect(tagOf(page)).toBeHidden();
    await expect(containerOf(page)).not.toHaveAttribute("data-music-docked", "");

    await page.locator("[data-music-polaroid] [data-music-toggle]").click();
    await expect.poll(() => isPaused(audio)).toBe(false);
    await expect.poll(() => currentTime(audio), { timeout: 15_000 }).toBeGreaterThan(0);
    await markAudio(audio);
    const before = await currentTime(audio);

    const heroHeight = await page.locator("#hero").evaluate((hero) => hero.getBoundingClientRect().height);
    await page.evaluate((y) => window.scrollTo(0, y), heroHeight + 120);
    await expect(tagOf(page)).toBeVisible({ timeout: 5000 });
    await expect(cardOf(page)).toBeHidden();
    await expect(containerOf(page)).toHaveAttribute("data-music-docked", "");
    await expect(containerOf(page)).not.toHaveAttribute("data-music-flying", "");
    // The tag rests clear of the flight's transforms, in the bottom-right corner.
    const box = (await tagOf(page).boundingBox())!;
    expect(Math.abs(DESKTOP.width - (box.x + box.width) - 16)).toBeLessThanOrEqual(6);
    expect(Math.abs(DESKTOP.height - (box.y + box.height) - 16)).toBeLessThanOrEqual(6);

    expect(await isMarked(audio)).toBe(true);
    await expect(audio).toHaveCount(1);
    expect(await isPaused(audio)).toBe(false);
    await expect.poll(() => currentTime(audio), { timeout: 15_000 }).toBeGreaterThan(before);
    await expect(page.locator("[data-music-polaroid]")).toHaveAttribute("data-state", "playing");

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(cardOf(page)).toBeVisible({ timeout: 5000 });
    await expect(tagOf(page)).toBeHidden();
    await expect(containerOf(page)).not.toHaveAttribute("data-music-docked", "");
    await expect(page.locator("[data-music-polaroid] [data-music-toggle]")).toBeEnabled();
    expect(await isMarked(audio)).toBe(true);
    expect(await isPaused(audio)).toBe(false);
  });

  test("the tag controls the same song while the polaroid is away", async ({ page }) => {
    await page.goto("/");
    const audio = audioOf(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect(tagOf(page)).toBeVisible({ timeout: 5000 });
    await tagOf(page).locator("[data-music-toggle]").click();
    await expect.poll(() => isPaused(audio)).toBe(false);
    await expect(page.locator("[data-music-surface]").first()).toHaveAttribute("data-state", "playing");
    await expect(page.locator("[data-music-polaroid]")).toHaveAttribute("data-state", "playing");
    await tagOf(page).locator("[data-music-toggle]").click();
    await expect.poll(() => isPaused(audio)).toBe(true);
    await expect(page.locator("[data-music-polaroid]")).toHaveAttribute("data-state", "paused");
  });

  test("keeps the polaroid strip on one line from 1024 and drops it for the tag below", async ({ page }) => {
    for (const width of [1024, 1100, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await expect(cardOf(page)).toBeVisible();
      // Layout sizes, not bounding boxes: the card is rotated, and a rotated box measures taller.
      const fit = await page.locator("[data-music-polaroid]").evaluate((surface) => {
        const part = (selector: string) => surface.querySelector<HTMLElement>(selector)!;
        const strip = part(".music-polaroid_strip");
        const title = part(".music-polaroid_title");
        const columns = [part(".music-polaroid_info"), part(".music-polaroid_controls")];
        return {
          stripOverflows: strip.scrollWidth > strip.clientWidth,
          titleClipped: title.scrollWidth > title.clientWidth,
          // One line: the strip is as tall as its tallest column.
          tallest: Math.max(...columns.map((column) => column.offsetHeight)),
          stripHeight: strip.offsetHeight,
          inside: [part(".music-polaroid_label"), title, ...columns].every((el) => el.offsetLeft >= strip.offsetLeft && el.offsetLeft + el.offsetWidth <= strip.offsetLeft + strip.offsetWidth),
          smallestButton: Math.min(...[...surface.querySelectorAll<HTMLElement>("button")].map((button) => Math.min(button.offsetWidth, button.offsetHeight))),
        };
      });
      expect(fit.stripOverflows, `strip overflows at ${width}`).toBe(false);
      expect(fit.titleClipped, `title clipped at ${width}`).toBe(false);
      expect(fit.inside, `strip parts outside at ${width}`).toBe(true);
      expect(fit.stripHeight, `strip wraps at ${width}`).toBeLessThanOrEqual(fit.tallest + 1);
      expect(fit.smallestButton, `buttons shrank at ${width}`).toBeGreaterThanOrEqual(32);
    }
    // 48rem to 63.99rem keeps the sunset polaroid and shows the tag at rest.
    await page.setViewportSize({ width: 1023, height: 800 });
    await page.goto("/");
    await expect(cardOf(page)).toBeHidden();
    await expect(tagOf(page)).toBeVisible();
  });
});

test.describe("background music teleport, reduced motion", { tag: ["@single"] }, () => {
  test.use({ viewport: DESKTOP, reducedMotion: "reduce" });

  test("swaps the polaroid and the tag without a flight", async ({ page }) => {
    await page.goto("/");
    await expect(cardOf(page)).toBeVisible();
    await expect(tagOf(page)).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect(tagOf(page)).toBeVisible({ timeout: 5000 });
    await expect(cardOf(page)).toBeHidden();
    await expect(containerOf(page)).not.toHaveAttribute("data-music-flying", "");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(cardOf(page)).toBeVisible({ timeout: 5000 });
    await expect(tagOf(page)).toBeHidden();
  });
});

test.describe("background music tag, phone", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE, hasTouch: true, isMobile: true });

  test("docks bottom-right after the tap, clear of the hero and nav actions", async ({ page }) => {
    await page.goto("/");
    await expect(tagOf(page)).toBeHidden();
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(tagOf(page)).toBeVisible();
    await expect(cardOf(page)).toBeHidden();
    await expect(page.locator("[data-music-polaroid]")).toBeHidden();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);

    const box = (await tagOf(page).boundingBox())!;
    expect(Math.abs(PHONE.width - (box.x + box.width) - 16)).toBeLessThanOrEqual(6);
    expect(Math.abs(PHONE.height - (box.y + box.height) - 16)).toBeLessThanOrEqual(6);
    for (const selector of [".hero_rsvp", ".hero_weekend", ".nav_rsvp"]) {
      const other = await page.locator(selector).first().boundingBox();
      if (!other) continue;
      const overlaps = box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y;
      expect(overlaps, `tag overlaps ${selector}`).toBe(false);
    }
    // Playing from the tap: the gesture that closed the preloader also started the song.
    await expect.poll(() => isPaused(audioOf(page))).toBe(false);
  });

  test("steps aside while a form field has focus", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(tagOf(page)).toBeVisible();
    const name = page.locator("[data-rsvp-name]");
    await reveal(name);
    await name.focus();
    await expect(name).toBeFocused();
    await expect(tagOf(page)).toBeHidden();
    await name.blur();
    await expect(tagOf(page)).toBeVisible();
  });
});

/** True while the tag is shown and overlaps a hero or nav action. */
const tagCoversAction = (page: Page) =>
  page.evaluate(() => {
    const tag = document.querySelector<HTMLElement>("[data-music-tag]")!;
    if (getComputedStyle(tag).visibility === "hidden") return false;
    const box = tag.getBoundingClientRect();
    return [".hero_rsvp", ".hero_weekend", ".nav_rsvp"].some((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || element.getClientRects().length === 0 || getComputedStyle(element).visibility === "hidden") return false;
      const other = element.getBoundingClientRect();
      return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
    });
  });

test.describe("background music tag, short phone", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test("waits for the hero buttons to clear its corner, and keeps playing meanwhile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await expect(tagOf(page)).toBeHidden();
    await expect.poll(() => isPaused(audioOf(page))).toBe(false);

    // Scroll the CTA group to just above the tag's band.
    await page.evaluate(() => {
      const bottom = document.querySelector(".hero_actions")!.getBoundingClientRect().bottom;
      window.scrollBy(0, bottom - (window.innerHeight - 102) + 40);
    });
    await expect(tagOf(page)).toBeVisible();
    expect(await tagCoversAction(page)).toBe(false);
    expect(await isPaused(audioOf(page))).toBe(false);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(tagOf(page)).toBeHidden();
  });
});

test.describe("background music tag, phone sizes", { tag: ["@single"] }, () => {
  test.use({ reducedMotion: "reduce", hasTouch: true, isMobile: true });

  test("never covers the hero or nav actions while it is shown", async ({ page }) => {
    test.setTimeout(120_000);
    const sizes = [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932], [767, 1024]];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(page.locator("[data-preloader]")).toHaveCount(0);
      for (const y of [0, 150, 300, 450]) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await expect.poll(() => tagCoversAction(page), { message: `tag over an action at ${width}x${height}, scroll ${y}` }).toBe(false);
      }
    }
    // A comfortable phone shows it straight away.
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await expect(tagOf(page)).toBeVisible();
  });
});
