import { expect, test, type Locator, type Page } from "@playwright/test";
import { fakeFixtures } from "../src/lib/rsvp/store";
import { reveal } from "./helpers/reveal";

// Tall enough that the polaroid's buttons sit above the fold: Playwright centres a button it has to
// scroll to, and that scroll alone would carry the page past the polaroid and dock it.
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const audioOf = (page: Page) => page.locator("audio[data-music-audio]");
const tagOf = (page: Page) => page.locator("[data-music-tag]");
const discOf = (page: Page) => page.locator("[data-music-disc]");
const pillOf = (page: Page) => page.locator("[data-music-pill]");
const cardOf = (page: Page) => page.locator("[data-music-polaroid] .music-polaroid_wrap");
const containerOf = (page: Page) => page.locator("[data-music-container]");
const PILL_OPEN = "data-music-open";
/** Taps through the preloader and waits out the 3s intro the first tap opens, so a test starts from the closed disc. */
const tapIntoSite = async (page: Page) => {
  await page.getByRole("button", { name: "Just browsing" }).click();
  await expect(page.locator("[data-preloader]")).toHaveCount(0);
  // The intro opens as the preloader starts to close, so it is decided by the time the node is gone.
  await expect(containerOf(page)).not.toHaveAttribute(PILL_OPEN, "", { timeout: 10_000 });
  await expect(discOf(page)).toBeVisible();
  // The intro's own close (a wipe, or a 150ms fade) has to finish, or the next tap reverses it midway.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => !(animation instanceof CSSAnimation) && (animation.effect as KeyframeEffect).target?.closest("[data-music-container]") && Number(animation.effect!.getComputedTiming().endTime) > 1).length,
      ),
    )
    .toBe(0);
};
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

  test("pauses background music when the page is hidden and stays paused", async ({ page }) => {
    await page.goto("/");
    const audio = audioOf(page);
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect.poll(() => isPaused(audio)).toBe(false);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => isPaused(audio)).toBe(true);
    await expect(page.locator("[data-music-surface]").first()).toHaveAttribute("data-state", "paused");

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
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

test.describe("background music hit targets", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [label, width, height] of [["mobile", 390, 844], ["desktop", 1440, 900]] as const) {
    test(`hides for the Spotify embed at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => localStorage.setItem("ew-test-skip-preloader", "1"));
      await page.goto("/");
      const embed = page.locator("[data-playlist-embed]");
      await embed.evaluate((element) => element.scrollIntoView({ block: "end" }));
      await expect(page.locator("[data-music-container] [data-music-hidden-for-embed]")).toHaveCount(1, { timeout: 5000 });
      const hit = await embed.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return document.elementFromPoint(box.left + Math.min(323, box.width / 2), box.top + Math.min(60, box.height / 2))?.closest("[data-playlist-embed]") === element;
      });
      expect(hit).toBe(true);
    });

    test(`hides for the footer back-to-top link at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => localStorage.setItem("ew-test-skip-preloader", "1"));
      await page.goto("/");
      const link = page.locator(".footer_top-link");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.locator("[data-music-container] [data-music-hidden-for-footer]")).toHaveCount(1, { timeout: 5000 });
      const hit = await link.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest(".footer_top-link") === element;
      });
      expect(hit).toBe(true);
    });
  }
});

test.describe("background music returning guest", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("waits for a found guest to open the letter before starting", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/audio/")) requests.push(request.url()); });
    await page.goto("/");
    const audio = audioOf(page);
    const overlay = page.locator("[data-preloader]");
    await overlay.locator("[data-preloader-name]").fill("Mateo Cruz");
    await overlay.getByRole("button", { name: "Open my letter" }).click();
    await expect(overlay.getByRole("heading", { name: "Welcome, Cruz Family." })).toBeVisible();
    await expect.poll(() => isPaused(audio)).toBe(true);
    expect(requests).toHaveLength(0);

    await overlay.getByRole("button", { name: "Open my letter" }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect.poll(() => isPaused(audio)).toBe(false);
  });

  test("does not start for a not-found lookup", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/audio/")) requests.push(request.url()); });
    await page.goto("/");
    const audio = audioOf(page);
    const overlay = page.locator("[data-preloader]");
    await overlay.locator("[data-preloader-name]").fill("Nobody Example");
    await overlay.getByRole("button", { name: "Open my letter" }).click();
    await expect(overlay.getByText("Hmm, we can't find that name.")).toBeVisible();
    await expect.poll(() => isPaused(audio)).toBe(true);
    expect(requests).toHaveLength(0);
  });

  test("does not request audio until the visible player is pressed", async ({ page }) => {
    const requests: string[] = [];
    const size = page.viewportSize();
    if (size && size.width >= 1024) await page.setViewportSize({ width: size.width, height: DESKTOP.height });
    page.on("request", (request) => { if (request.url().includes("/audio/")) requests.push(request.url()); });
    await page.addInitScript(() => localStorage.setItem("ew-test-skip-preloader", "1"));
    await page.goto("/");
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await heroSettled(page);
    await expect.poll(() => isPaused(audioOf(page))).toBe(true);
    await page.waitForTimeout(500);
    expect(requests).toHaveLength(0);

    // Desktop shows the polaroid in the hero (the tag is hidden there); a phone shows the tag.
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    const toggle = page.locator(wide ? "[data-music-polaroid] [data-music-toggle]" : "[data-music-disc]");
    await expect(toggle).toBeVisible();
    await toggle.click();
    if (!wide) await pillOf(page).locator("[data-music-toggle]").click();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect.poll(() => isPaused(audioOf(page))).toBe(false);
  });
});

test.describe("background music teleport, desktop", { tag: ["@single"] }, () => {
  test.use({ viewport: DESKTOP });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ew-test-skip-preloader", "1"));
  });

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
    await expect(tagOf(page)).toBeVisible(SLOW);
    await expect(cardOf(page)).toBeHidden(SLOW);
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
      await expect(cardOf(page)).toBeVisible(SLOW);
      // The ticker is switched on by a measure after layout and fonts; give it a frame to settle.
      await expect.poll(() => page.locator("[data-music-polaroid] [data-music-ticker]").evaluate((title) => title.scrollWidth <= title.clientWidth || title.hasAttribute("data-ticker"))).toBe(true);
      // Layout sizes, not bounding boxes: the card is rotated, and a rotated box measures taller.
      const fit = await page.locator("[data-music-polaroid]").evaluate((surface) => {
        const part = (selector: string) => surface.querySelector<HTMLElement>(selector)!;
        const strip = part(".music-polaroid_strip");
        const title = part(".music-polaroid_title");
        const columns = [part(".music-polaroid_info"), part(".music-polaroid_controls")];
        return {
          stripOverflows: strip.scrollWidth > strip.clientWidth,
          // A title wider than its box is allowed only while it scrolls as a ticker.
          titleClipped: title.scrollWidth > title.clientWidth && !title.hasAttribute("data-ticker"),
          // One line: the strip is as tall as its tallest column.
          tallest: Math.max(...columns.map((column) => column.offsetHeight)),
          stripHeight: strip.offsetHeight,
          // A scrolling title reaches 0.625rem left of its text for the edge fade; the text itself starts inside.
          inside: [part(".music-polaroid_label"), title, ...columns].every((el) => el.offsetLeft + parseFloat(getComputedStyle(el).paddingLeft) >= strip.offsetLeft && el.offsetLeft + el.offsetWidth <= strip.offsetLeft + strip.offsetWidth),
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

/** The title ticker's track and its loop animation on one surface, read live. */
const TICKER = "[data-music-ticker]";
const trackOf = (surface: Locator) => surface.locator(`${TICKER} .music-ticker_track`);
const tickerState = (track: Locator) =>
  track.evaluate((element) => {
    const animation = element.getAnimations().find((candidate) => candidate instanceof CSSAnimation && candidate.animationName === "music-ticker");
    const timing = animation?.effect?.getComputedTiming();
    const frames = animation ? (animation.effect as KeyframeEffect).getKeyframes() : [];
    return {
      exists: Boolean(animation),
      playState: animation?.playState ?? "none",
      // A pause or a play is applied on the next frame; until then the clock still reads as it did.
      pending: animation?.pending ?? false,
      css: getComputedStyle(element).animationPlayState,
      time: animation ? Number(animation.currentTime) : -1,
      duration: Number(timing?.duration ?? 0),
      iterations: timing?.iterations ?? 0,
      easing: (animation?.effect as KeyframeEffect | undefined)?.getComputedTiming().easing ?? "",
      properties: [...new Set(frames.flatMap((frame) => Object.keys(frame)).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)))],
      loopPx: (element as HTMLElement).offsetWidth / 2,
    };
  });
/** Waits until the loop is paused for good (the pause has been applied on a frame), then returns its state. */
const tickerHeld = async (track: Locator) => {
  await expect.poll(async () => { const state = await tickerState(track); return state.playState === "paused" && !state.pending; }).toBe(true);
  return tickerState(track);
};
/** Wall-clock sample of the loop's own time: how far it moved while `wait` ms of the clock went by. */
const tickerAdvance = async (page: Page, track: Locator, wait = 600) => {
  const before = await tickerState(track);
  const start = Date.now();
  await page.waitForTimeout(wait);
  const after = await tickerState(track);
  return { moved: after.time - before.time, elapsed: Date.now() - start };
};

test.describe("background music title ticker, desktop", { tag: ["@single"] }, () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("scrolls an overflowing title at a steady 30px/s, only while the song plays and is not muted", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await heroSettled(page);
    const polaroid = page.locator("[data-music-polaroid]");
    await expect(cardOf(page)).toBeVisible();
    const title = polaroid.locator(TICKER);
    // The new title does not fit the polaroid at 1440 (166px of text in a 124px box), so it ticks.
    await expect(title).toHaveAttribute("data-ticker", "");
    const track = trackOf(polaroid);

    // Before the first play it rests at the start, so the title reads from its first letter.
    const idle = await tickerState(track);
    expect(idle.exists).toBe(true);
    expect(idle.playState).toBe("paused");
    expect(idle.time).toBe(0);
    // Linear, endless, transform only; the loop is one copy plus the gap, at about 30px/s.
    expect(idle.easing).toBe("linear");
    expect(idle.iterations).toBe(Infinity);
    expect(idle.properties).toEqual(["transform"]);
    expect(Math.abs(idle.loopPx / (idle.duration / 1000) - 30)).toBeLessThanOrEqual(1);

    await polaroid.locator("[data-music-toggle]").click();
    await expect(polaroid).toHaveAttribute("data-state", "playing");
    await expect.poll(async () => (await tickerState(track)).playState).toBe("running");
    // Clock time, not frames (L-009): the loop's clock moves with the wall clock, within one capped frame.
    const running = await tickerAdvance(page, track);
    expect(running.moved).toBeGreaterThan(running.elapsed * 0.5);
    expect(running.moved).toBeLessThan(running.elapsed + 250);

    // Muting holds it where it is.
    await polaroid.locator("[data-music-mute]").click();
    await expect(polaroid.locator("[data-music-mute]")).toHaveAttribute("aria-pressed", "true");
    const mutedAt = (await tickerHeld(track)).time;
    expect(mutedAt).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    expect((await tickerState(track)).time).toBe(mutedAt);
    await polaroid.locator("[data-music-mute]").click();
    await expect.poll(async () => (await tickerState(track)).playState).toBe("running");
    expect((await tickerState(track)).time).toBeGreaterThanOrEqual(mutedAt);

    // Pausing the song holds it in place too, and playing again carries on from there.
    await polaroid.locator("[data-music-toggle]").click();
    await expect(polaroid).toHaveAttribute("data-state", "paused");
    const pausedAt = (await tickerHeld(track)).time;
    await page.waitForTimeout(400);
    expect((await tickerState(track)).time).toBe(pausedAt);
    await polaroid.locator("[data-music-toggle]").click();
    await expect.poll(async () => (await tickerState(track)).time).toBeGreaterThan(pausedAt);
  });

  test("fades both edges while it scrolls, stays still when the title fits, and reads once to a screen reader", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await heroSettled(page);
    const polaroid = page.locator("[data-music-polaroid]");
    const title = polaroid.locator(TICKER);
    await expect(title).toHaveAttribute("data-ticker", "");
    const mask = await title.evaluate((element) => getComputedStyle(element).maskImage);
    expect(mask).toContain("linear-gradient");
    expect(mask).toContain("rgba(0, 0, 0, 0)");

    // Two copies are in the markup, and only the first is announced.
    for (const surface of [polaroid, tagOf(page)]) {
      const copies = surface.locator(`${TICKER} .music-ticker_text`);
      await expect(copies).toHaveCount(2);
      await expect(copies.nth(0)).not.toHaveAttribute("aria-hidden", "true");
      await expect(copies.nth(1)).toHaveAttribute("aria-hidden", "true");
      await expect(copies.nth(0)).toHaveText(await copies.nth(1).evaluate((element) => element.textContent ?? ""));
    }

    // A title that fits stays still: widen its box and the script drops the ticker, mask and duplicate.
    await title.evaluate((element) => { element.style.width = "600px"; });
    await expect(title).not.toHaveAttribute("data-ticker", "");
    const still = await title.evaluate((element) => ({
      mask: getComputedStyle(element).maskImage,
      copy: getComputedStyle(element.querySelectorAll(".music-ticker_text")[1]).display,
      animations: element.getAnimations({ subtree: true }).filter((animation) => animation instanceof CSSAnimation).length,
    }));
    expect(still).toEqual({ mask: "none", copy: "none", animations: 0 });
    // And it ticks again when the box is too small, with no reload (it re-measures on resize).
    await title.evaluate((element) => { element.style.width = ""; });
    await expect(title).toHaveAttribute("data-ticker", "");
  });

  test("the docked tag ticks while the song plays, and the hidden surfaces hold still", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await heroSettled(page);
    const polaroid = page.locator("[data-music-polaroid]");
    const polaroidTrack = trackOf(polaroid);
    const tagTrack = trackOf(tagOf(page));
    await polaroid.locator("[data-music-toggle]").click();
    await expect(polaroid).toHaveAttribute("data-state", "playing");
    await expect.poll(async () => (await tickerState(polaroidTrack)).playState).toBe("running");
    // The tag is out of sight until the page scrolls past the polaroid, so it does not run yet.
    await expect(trackOf(tagOf(page))).toHaveCount(1);
    expect((await tickerState(tagTrack)).css).toBe("paused");

    const heroHeight = await page.locator("#hero").evaluate((hero) => hero.getBoundingClientRect().height);
    await page.evaluate((y) => window.scrollTo(0, y), heroHeight + 120);
    await expect(tagOf(page)).toBeVisible(SLOW);
    await expect(containerOf(page)).not.toHaveAttribute("data-music-flying", "");
    await expect(tagOf(page).locator(TICKER)).toHaveAttribute("data-ticker", "");
    await expect.poll(async () => (await tickerState(tagTrack)).playState).toBe("running");
    const running = await tickerAdvance(page, tagTrack);
    expect(running.moved).toBeGreaterThan(running.elapsed * 0.5);
    expect(running.moved).toBeLessThan(running.elapsed + 250);
    expect((await tickerState(polaroidTrack)).css).toBe("paused");
    const tagState = await tickerState(tagTrack);
    expect(tagState.properties).toEqual(["transform"]);
    expect(Math.abs(tagState.loopPx / (tagState.duration / 1000) - 30)).toBeLessThanOrEqual(1);

    await tagOf(page).locator("[data-music-toggle]").click();
    await expect(tagOf(page)).toHaveAttribute("data-state", "paused");
    await tickerHeld(tagTrack);
  });
});

test.describe("background music title ticker, phone", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE, hasTouch: true, isMobile: true });

  test("leaves the pill's title as it was", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    const title = pillOf(page).locator(".music-player_title");
    await expect(title).toHaveCount(1);
    expect(await title.evaluate((element) => ({ ticker: element.hasAttribute("data-music-ticker"), tracks: element.querySelectorAll(".music-ticker_track").length, fits: element.scrollWidth <= element.clientWidth }))).toEqual({ ticker: false, tracks: 0, fits: true });
    expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation instanceof CSSAnimation && animation.animationName === "music-ticker").length)).toBe(0);
  });
});

test.describe("background music teleport, reduced motion", { tag: ["@single"] }, () => {
  test.use({ viewport: DESKTOP, reducedMotion: "reduce" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ew-test-skip-preloader", "1"));
  });

  test("keeps the ellipsis and scrolls nothing, even while the song plays", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await heroSettled(page);
    const polaroid = page.locator("[data-music-polaroid]");
    await polaroid.locator("[data-music-toggle]").click();
    await expect(polaroid).toHaveAttribute("data-state", "playing");
    // The site-wide rule shortens transitions to 0.01ms instead of removing them (L-026): only a
    // perceptible animation counts.
    const settled = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>("[data-music-polaroid] [data-music-ticker]")!;
      const perceptible = document
        .getAnimations()
        .filter((animation) => animation.effect instanceof KeyframeEffect && animation.effect.target && (animation.effect.target === title || title.contains(animation.effect.target)))
        .filter((animation) => Number(animation.effect!.getComputedTiming().duration) + Number(animation.effect!.getComputedTiming().delay) > 1);
      const style = getComputedStyle(title);
      return {
        perceptible: perceptible.length,
        overflow: style.overflow,
        ellipsis: style.textOverflow,
        mask: style.maskImage,
        copy: getComputedStyle(title.querySelectorAll(".music-ticker_text")[1]).display,
        clipped: title.scrollWidth > title.clientWidth,
      };
    });
    expect(settled).toEqual({ perceptible: 0, overflow: "hidden", ellipsis: "ellipsis", mask: "none", copy: "none", clipped: true });
  });

  test("swaps the polaroid and the tag without a flight", async ({ page }) => {
    await page.goto("/");
    await expect(cardOf(page)).toBeVisible();
    await expect(tagOf(page)).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect(tagOf(page)).toBeVisible(SLOW);
    await expect(cardOf(page)).toBeHidden(SLOW);
    await expect(containerOf(page)).not.toHaveAttribute("data-music-flying", "");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(cardOf(page)).toBeVisible({ timeout: 5000 });
    await expect(tagOf(page)).toBeHidden();
  });
});

test.describe("background music disc, phone", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE, hasTouch: true, isMobile: true });

  test("shows one disc bottom-right after the tap, clear of the hero and nav actions", async ({ page }) => {
    await page.goto("/");
    await expect(tagOf(page)).toBeHidden();
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(discOf(page)).toBeVisible();
    await expect(tagOf(page)).toBeHidden();
    await expect(cardOf(page)).toBeHidden();
    await expect(page.locator("[data-music-polaroid]")).toBeHidden();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);

    const box = (await discOf(page).boundingBox())!;
    expect(Math.abs(PHONE.width - (box.x + box.width) - 16)).toBeLessThanOrEqual(6);
    expect(Math.abs(PHONE.height - (box.y + box.height) - 16)).toBeLessThanOrEqual(6);
    for (const selector of [".hero_rsvp", ".hero_weekend", ".nav_rsvp"]) {
      const other = await page.locator(selector).first().boundingBox();
      if (!other) continue;
      const overlaps = box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y;
      expect(overlaps, `disc overlaps ${selector}`).toBe(false);
    }
    // Playing from the tap: the gesture that closed the preloader also started the song.
    await expect.poll(() => isPaused(audioOf(page))).toBe(false);
  });

  test("steps aside while a form field has focus", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(discOf(page)).toBeVisible();
    const name = page.locator("[data-rsvp-name]");
    await reveal(name);
    await name.focus();
    await expect(name).toBeFocused();
    await expect(discOf(page)).toBeHidden();
    await name.blur();
    await expect(discOf(page)).toBeVisible();
  });

  test("opens and closes the pill from the disc", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    await expect(discOf(page)).toBeVisible();
    await expect(pillOf(page).locator("[data-music-controls]")).toBeHidden();
    await discOf(page).click();
    await expect(containerOf(page)).toHaveAttribute(PILL_OPEN, "");
    await expect(discOf(page)).toHaveAttribute("aria-expanded", "true");
    await expect(pillOf(page).locator("[data-music-controls]")).toBeVisible();
    await discOf(page).click();
    await expect(containerOf(page)).not.toHaveAttribute(PILL_OPEN, "");
    await expect(discOf(page)).toHaveAttribute("aria-expanded", "false");
    await expect(pillOf(page).locator("[data-music-controls]")).toBeHidden();
  });

  test("keeps the closed pill's controls out of the tab order and out of reach", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    const inReach = () =>
      page.evaluate(() => {
        const controls = document.querySelector<HTMLElement>("[data-music-controls]")!;
        const reachable = [...controls.querySelectorAll<HTMLElement>("button")].filter((button) => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return getComputedStyle(button).visibility !== "hidden" && (hit === button || button.contains(hit));
        });
        return { inert: controls.inert, reachable: reachable.length };
      });
    expect(await inReach()).toEqual({ inert: true, reachable: 0 });
    // Tab from the disc: focus leaves the player instead of stopping on a hidden control.
    await discOf(page).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-music-controls]")))).toBe(false);
    // Shift+Tab can land on the footer's Back to top, which scrolls there and hides the disc for it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect(containerOf(page).locator("[data-music-hidden-for-footer]")).toHaveCount(0);
    await discOf(page).click();
    await expect(containerOf(page)).toHaveAttribute(PILL_OPEN, "");
    expect((await inReach()).inert).toBe(false);
    await expect.poll(async () => (await inReach()).reachable).toBe(2);
  });

  test("supports keyboard focus, Escape, outside tap, and scroll closing", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    await discOf(page).press("Enter");
    await expect(pillOf(page).locator("[data-music-toggle]")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(discOf(page)).toBeFocused();
    await expect(containerOf(page)).not.toHaveAttribute(PILL_OPEN, "");
    await discOf(page).click();
    await expect(containerOf(page)).toHaveAttribute(PILL_OPEN, "");
    await page.mouse.click(20, 20);
    await expect(containerOf(page)).not.toHaveAttribute(PILL_OPEN, "");
    await discOf(page).click();
    await expect(containerOf(page)).toHaveAttribute(PILL_OPEN, "");
    await page.evaluate(() => window.scrollBy(0, 60));
    await expect(containerOf(page)).not.toHaveAttribute(PILL_OPEN, "");
  });

  test("opens for the preloader intro, then stays closed for returning guests", async ({ page }) => {
    test.setTimeout(60_000);
    // Opening and closing again takes 3s; a slow page can miss the open in between, so record it.
    const watchOpen = () =>
      page.addInitScript(() => {
        const seen = window as unknown as { musicOpened?: boolean };
        new MutationObserver((records) => {
          if (records.some((record) => (record.target as Element).hasAttribute("data-music-open"))) seen.musicOpened = true;
        }).observe(document, { attributes: true, attributeFilter: ["data-music-open"], subtree: true });
      });
    await watchOpen();
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { musicOpened?: boolean }).musicOpened)), { timeout: 15_000 }).toBe(true);
    await expect(containerOf(page)).not.toHaveAttribute(PILL_OPEN, "", { timeout: 15_000 });

    await page.addInitScript(() => localStorage.setItem("ew-test-skip-preloader", "1"));
    await page.reload();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await expect(discOf(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => Boolean((window as unknown as { musicOpened?: boolean }).musicOpened))).toBe(false);
    await expect(containerOf(page)).not.toHaveAttribute(PILL_OPEN, "");
  });

  test("plays and pauses from the pill without replacing the audio", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    await discOf(page).click();
    const audio = audioOf(page);
    await expect.poll(() => isPaused(audio)).toBe(false);
    await pillOf(page).locator("[data-music-toggle]").click();
    await expect.poll(() => isPaused(audio)).toBe(true);
    await expect(pillOf(page)).toHaveAttribute("data-state", "paused");
    await pillOf(page).locator("[data-music-toggle]").click();
    await expect.poll(() => isPaused(audio)).toBe(false);
    await expect(audio).toHaveCount(1);
  });

  test("the record turns only while the song plays, and the ring follows it", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    const record = discOf(page).locator("img");
    const state = () => record.evaluate((img) => { const style = getComputedStyle(img); return { name: style.animationName, playState: style.animationPlayState, duration: style.animationDuration }; });
    await expect.poll(async () => (await state()).playState).toBe("running");
    expect(await state()).toMatchObject({ name: "music-spin", duration: "6s" });
    await audioOf(page).evaluate((element) => (element as HTMLAudioElement).pause());
    await expect.poll(async () => (await state()).playState).toBe("paused");
    await expect.poll(() => discOf(page).locator("[data-music-ring]").evaluate((ring) => ring.style.getPropertyValue("--music-progress")), { timeout: 15_000 }).not.toBe("");
  });
});

test.describe("background music disc motion, phone", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE, hasTouch: true, isMobile: true });

  // Seeks the transition on the clock (L-009): a paused animation, read at set times, not frames.
  test("wipes open and closed on the pill's own clip, with its shadow following", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    const wipe = page.locator(".music-player_wipe");
    const timing = () =>
      wipe.evaluate((element) => {
        const style = getComputedStyle(element);
        return { property: style.transitionProperty, duration: style.transitionDuration, delay: style.transitionDelay, width: element.getBoundingClientRect().width };
      });
    const closed = await timing();
    expect(closed.property).toBe("clip-path");
    expect(closed.duration).toBe("0.14s");
    expect(closed.delay).toBe("0.06s");
    // Read in the task that taps, before a slow page lets the 280ms run out.
    const runs = await wipe.evaluate((element) => {
      document.querySelector<HTMLElement>("[data-music-disc]")!.click();
      return element.getAnimations().map((animation) => ({ property: (animation as CSSTransition).transitionProperty, keyframes: (animation.effect as KeyframeEffect).getKeyframes().map((frame) => frame.clipPath) }));
    });
    await expect(containerOf(page)).toHaveAttribute(PILL_OPEN, "");
    const open = await timing();
    expect(open.duration).toBe("0.28s");
    expect(open.delay).toBe("0s");
    // The width never animates: the box is the same wide pill throughout; only the clip moves.
    expect(open.width).toBe(closed.width);
    // The tap started a clip-path transition from the disc's footprint to the whole pill, and nothing else moved.
    expect(runs).toHaveLength(1);
    expect(runs[0].property).toBe("clip-path");
    expect(runs[0].keyframes[0]).toContain("calc(100% - 56px)");
    expect(runs[0].keyframes[1]).toBe("inset(0px round 28px)");
    const shell = await page.locator(".music-player_shell").evaluate((element) => getComputedStyle(element).filter);
    expect(shell).toContain("drop-shadow");
  });

  test("the open pill stays inside the viewport and shares the disc's corner", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    const before = (await discOf(page).boundingBox())!;
    await discOf(page).click();
    await expect(containerOf(page)).toHaveAttribute(PILL_OPEN, "");
    await expect(pillOf(page).locator("[data-music-controls]")).toBeVisible();
    await expect.poll(async () => (await page.locator(".music-player_wipe").evaluate((element) => element.getAnimations().length))).toBe(0);
    const after = (await discOf(page).boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    const pill = (await pillOf(page).boundingBox())!;
    expect(pill.x).toBeGreaterThanOrEqual(0);
    expect(pill.x + pill.width).toBeLessThanOrEqual(PHONE.width);
    expect(Math.abs(pill.width - 358)).toBeLessThanOrEqual(1);
    expect(Math.abs(pill.height - 56)).toBeLessThanOrEqual(1);
  });
});

test.describe("background music disc motion, reduced", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE, hasTouch: true, isMobile: true, reducedMotion: "reduce" });

  test("crossfades in 150ms with no wipe, slide or spin", async ({ page }) => {
    await page.goto("/");
    await tapIntoSite(page);
    // The page's own rule makes CSS transitions instant under reduced motion (L-026), so the
    // crossfade is a Web Animation: read it in the same task as the tap that starts it.
    const fades = await page.evaluate(() => {
      const timings = () =>
        [".music-player_wipe", "[data-music-controls]"].flatMap((selector) =>
          document.querySelector(selector)!.getAnimations().map((animation) => ({
            selector,
            property: Object.keys((animation.effect as KeyframeEffect).getKeyframes()[0]).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)).join(),
            duration: animation.effect!.getComputedTiming().duration,
          })),
        );
      document.querySelector<HTMLElement>("[data-music-disc]")!.click();
      const opening = timings();
      document.querySelector<HTMLElement>("[data-music-disc]")!.click();
      return { opening, closing: timings() };
    });
    // Opening starts two (the paper and the controls); closing starts two more beside them.
    for (const [list, count] of [[fades.opening, 2], [fades.closing, 4]] as const) {
      const perceptible = list.filter((fade) => Number(fade.duration) > 1);
      expect(perceptible.map((fade) => [fade.property, fade.duration])).toEqual(Array.from({ length: count }, () => ["opacity", 150]));
    }
    const resting = await page.evaluate(() => {
      const wipe = getComputedStyle(document.querySelector(".music-player_wipe")!);
      const controls = getComputedStyle(document.querySelector("[data-music-controls]")!);
      const record = getComputedStyle(document.querySelector("[data-music-disc] img")!);
      return { wipe: wipe.transitionProperty, controlsTransform: controls.transform, spin: record.animationName };
    });
    expect(resting).toEqual({ wipe: "opacity", controlsTransform: "none", spin: "none" });
  });
});

/** The hero or nav action the phone disc overlaps while it is shown, with both boxes; empty when it covers none. */
const actionUnderDisc = (page: Page) =>
  page.evaluate(() => {
    const disc = document.querySelector<HTMLElement>("[data-music-disc]")!;
    if (getComputedStyle(disc).visibility === "hidden") return "";
    const box = disc.getBoundingClientRect();
    const round = (rect: DOMRect) => [rect.left, rect.top, rect.right, rect.bottom].map(Math.round).join(",");
    for (const selector of [".hero_rsvp", ".hero_weekend", ".nav_rsvp"]) {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || element.getClientRects().length === 0 || getComputedStyle(element).visibility === "hidden") continue;
      const other = element.getBoundingClientRect();
      if (box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top) return `${selector} [${round(other)}] under the disc [${round(box)}] at scroll ${Math.round(scrollY)}`;
    }
    return "";
  });
const tagCoversAction = async (page: Page) => (await actionUnderDisc(page)) !== "";

/** True when the pill, at its open size, overlaps a hero or nav action that is on screen. */
const openPillCoversAction = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-music-pill]")!.getBoundingClientRect();
    return [".hero_rsvp", ".hero_weekend", ".nav_rsvp"].some((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || element.getClientRects().length === 0 || getComputedStyle(element).visibility === "hidden") return false;
      const other = element.getBoundingClientRect();
      return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
    });
  });

test.describe("background music disc, short phone", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test("sits in its corner clear of the hero buttons, and opens only once they have scrolled clear", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    // The hero buttons are centred and the disc is in the corner: it is there at rest.
    await expect(discOf(page)).toBeVisible();
    const box = (await discOf(page).boundingBox())!;
    expect(Math.abs(375 - (box.x + box.width) - 16)).toBeLessThanOrEqual(6);
    expect(Math.abs(667 - (box.y + box.height) - 16)).toBeLessThanOrEqual(6);
    expect(await tagCoversAction(page)).toBe(false);
    await expect.poll(() => isPaused(audioOf(page))).toBe(false);

    // The wide pill would cover them, so a tap leaves it a disc.
    await discOf(page).click();
    await page.waitForTimeout(300);
    await expect(containerOf(page)).not.toHaveAttribute(PILL_OPEN, "");
    await expect(discOf(page)).toBeVisible();
    expect(await tagCoversAction(page)).toBe(false);

    // Scroll the CTA group to just above the pill's band, and it opens clear of them.
    await page.evaluate(() => {
      const bottom = document.querySelector(".hero_actions")!.getBoundingClientRect().bottom;
      window.scrollBy(0, bottom - (window.innerHeight - 102) + 40);
    });
    await expect(discOf(page)).toBeVisible();
    await discOf(page).click();
    await expect(containerOf(page)).toHaveAttribute(PILL_OPEN, "");
    await expect(pillOf(page).locator("[data-music-controls]")).toBeVisible();
    expect(await openPillCoversAction(page)).toBe(false);
    expect(await isPaused(audioOf(page))).toBe(false);
  });
});

test.describe("background music disc, phone sizes", { tag: ["@single"] }, () => {
  test.use({ reducedMotion: "reduce", hasTouch: true, isMobile: true });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ew-test-skip-preloader", "1"));
  });

  test("never covers the hero or nav actions while it is shown", async ({ page }) => {
    test.setTimeout(120_000);
    const sizes = [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932], [767, 1024]];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(page.locator("[data-preloader]")).toHaveCount(0);
      for (const y of [0, 150, 300, 450]) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        // A busy runner can leave the page unanswering for seconds at a time (L-023): wait long, assert what is found.
        await expect.poll(async () => `${width}x${height} y${y}: ${await actionUnderDisc(page)}`, SLOW).toBe(`${width}x${height} y${y}: `);
      }
    }
    // A comfortable phone shows it straight away.
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await expect(discOf(page)).toBeVisible();
  });
});

/**
 * Puts a control's bottom edge on the viewport's bottom edge. That is where a scroll-into-view lands
 * a control reached from above, and it is the tag's band: CI's WebKit lands "Find my invite" there,
 * the Mac does not. A step that is still laying out moves the control after the scroll, so this
 * scrolls again until a later look finds it resting there.
 */
const toViewportBottom = (control: Locator) =>
  expect
    .poll(
      () =>
        control.evaluate((element) => {
          const off = Math.abs(window.innerHeight - element.getBoundingClientRect().bottom);
          if (off > 2) element.scrollIntoView({ block: "end", behavior: "instant" });
          return off;
        }),
      { timeout: 15_000 },
    )
    .toBeLessThanOrEqual(2);
/** What a press at the control's centre would land on. */
const hitAtCentre = (control: Locator) =>
  control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (hit === element || element.contains(hit)) return "control";
    return hit?.closest("[data-music-container]") ? "tag" : "other";
  });
/** True when the control's box and the tag's resting box share any area, so the tag would cover it if shown. */
const underTheTag = (control: Locator) =>
  control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const tag = document.querySelector<HTMLElement>("[data-music-container]")!.getBoundingClientRect();
    return box.left < tag.right && box.right > tag.left && box.top < tag.bottom && box.bottom > tag.top;
  });
const pointerEventsOf = (tag: Locator) => tag.evaluate((element) => getComputedStyle(element).pointerEvents);
/** Presses at the control's centre and holds; the caller releases with `page.mouse.up()`. */
const pressAndHold = async (page: Page, control: Locator) => {
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
};
// WebKit on the CI runner paints seconds apart (L-023), and the guards answer on a frame.
const SLOW = { timeout: 15_000 };
/** A new RSVP step focuses its heading a frame after it shows, and that focus scrolls the page: wait for it before scrolling. */
const stepFocused = (page: Page, step: string) => expect(page.locator(`#rsvp [data-rsvp-panel='${step}'] :focus`)).toHaveCount(1, SLOW);

test.describe("background music tag and the RSVP card", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Runs at each project's own size: webkit and mobile are the phones, chromium the docked desktop tag.
  test("stays off Find my invite at the bottom of the screen, through the whole press", { tag: ["@smoke"] }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    const name = page.locator("#rsvp [data-rsvp-name]");
    const find = page.locator("#rsvp [data-rsvp-find] button[type='submit']");
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    const surface = phone ? pillOf(page) : tagOf(page);
    await reveal(find);

    // No field has focus yet, so only the card in the tag's band can be hiding it.
    await toViewportBottom(find);
    await expect(surface).toHaveAttribute("data-music-hidden-for-form", "", SLOW);
    await expect(surface).not.toHaveAttribute("data-music-hidden-for-input", "");
    await expect(surface).toBeHidden(SLOW);
    expect(await pointerEventsOf(phone ? discOf(page) : tagOf(page))).toBe("none");
    expect(await underTheTag(find), "the button sits where the tag rests").toBe(true);
    expect(await hitAtCentre(find)).toBe("control");

    // The run that failed in CI: typing the name, then pressing the button. The press blurs the
    // field before the release; a tag that came back in between took the release and the click.
    await name.fill(fakeFixtures[0].members[0]);
    await toViewportBottom(find);
    await pressAndHold(page, find);
    await expect(name).not.toBeFocused();
    expect(await hitAtCentre(find)).toBe("control");
    expect(await pointerEventsOf(phone ? discOf(page) : tagOf(page))).toBe("none");
    await page.mouse.up();
    await expect(page.locator("#rsvp [data-rsvp-panel='2']")).toBeVisible(SLOW);
  });
});

test.describe("background music tag and the RSVP card, desktop", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: DESKTOP });

  test("the docked tag hides while Continue is in its corner, and the song plays on", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    const audio = audioOf(page);
    await expect.poll(() => isPaused(audio)).toBe(false);

    // Past the hero the tag is docked and shown.
    const heroHeight = await page.locator("#hero").evaluate((hero) => hero.getBoundingClientRect().height);
    await page.evaluate((y) => window.scrollTo(0, y), heroHeight + 120);
    await expect(containerOf(page)).toHaveAttribute("data-music-docked", "");
    await expect(tagOf(page)).toBeVisible({ timeout: 5000 });

    const name = page.locator("#rsvp [data-rsvp-name]");
    await reveal(name);
    await name.fill(fakeFixtures[0].members[0]);
    await page.locator("#rsvp [data-rsvp-find] button[type='submit']").click();
    const proceed = page.locator("#rsvp [data-rsvp-attending] button[type='submit']");
    await expect(proceed).toBeVisible(SLOW);
    await stepFocused(page, "2");

    await toViewportBottom(proceed);
    await expect(containerOf(page)).toHaveAttribute("data-music-docked", "");
    await expect(tagOf(page)).toHaveAttribute("data-music-hidden-for-form", "");
    await expect(tagOf(page)).not.toHaveAttribute("data-music-hidden-for-input", "");
    await expect(tagOf(page)).toBeHidden();
    expect(await pointerEventsOf(tagOf(page))).toBe("none");
    expect(await underTheTag(proceed), "Continue sits where the tag rests").toBe(true);
    expect(await hitAtCentre(proceed)).toBe("control");
    await pressAndHold(page, proceed);
    await page.mouse.up();
    await expect(page.locator("#rsvp [data-rsvp-panel='3']")).toBeVisible(SLOW);
    await stepFocused(page, "3");

    // Hiding the tag is not pausing the song, and the tag is back once the card has left its band.
    expect(await isPaused(audio)).toBe(false);
    await page.evaluate((y) => window.scrollTo(0, y), heroHeight + 120);
    await expect(tagOf(page)).toBeVisible({ timeout: 5000 });
    await expect(tagOf(page)).not.toHaveAttribute("data-music-hidden-for-form", "");
    expect(await pointerEventsOf(tagOf(page))).toBe("auto");
    expect(await isPaused(audio)).toBe(false);
  });
});

test.describe("background music tag and a press that blurs a field", { tag: ["@single"] }, () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE, hasTouch: true, isMobile: true });

  // Outside the RSVP card nothing keeps the tag out of its band, so only the held pointer does.
  test("comes back after the release, never under the pointer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    const field = page.locator("#playlist form input[name='song']");
    const submit = page.locator("#playlist form button[type='submit']");
    await reveal(submit);
    // Count the click and stop it there: this is about where it lands, not about sending a song.
    await submit.evaluate((button) => {
      button.dataset.musicSpecClicks = "0";
      button.addEventListener("click", (event) => { event.preventDefault(); button.dataset.musicSpecClicks = String(Number(button.dataset.musicSpecClicks) + 1); });
    });
    await field.focus();
    await expect(discOf(page)).toBeHidden();
    await toViewportBottom(submit);
    await expect(discOf(page)).not.toHaveAttribute("data-music-hidden-for-form", "");
    expect(await underTheTag(submit), "the button sits where the tag rests").toBe(true);

    await pressAndHold(page, submit);
    await expect(field).not.toBeFocused();
    expect(await hitAtCentre(submit)).toBe("control");
    expect(await pointerEventsOf(discOf(page))).toBe("none");
    await page.mouse.up();
    await expect(submit).toHaveAttribute("data-music-spec-clicks", "1");
    await expect(discOf(page)).toBeVisible();
    expect(await pointerEventsOf(discOf(page))).toBe("auto");
  });
});
