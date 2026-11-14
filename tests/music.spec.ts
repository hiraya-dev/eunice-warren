import { expect, test } from "@playwright/test";

const fakeSpotify = `
  window.__playlistController = {
    listeners: [], playCalls: 0, pauseCalls: 0,
    addListener(name, callback) { this.listeners.push([name, callback]); },
    play() { this.playCalls += 1; },
    pause() { this.pauseCalls += 1; }
  };
  window.onSpotifyIframeApiReady({ createController(element, options, callback) {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://open.spotify.com/embed/playlist/test';
    iframe.style.width = '100%';
    iframe.style.height = options.height + 'px';
    element.replaceWith(iframe);
    callback(window.__playlistController);
  } });
`;

const installSpotify = async (page: import("@playwright/test").Page) => {
  await page.route("https://open.spotify.com/embed/iframe-api/v1", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: fakeSpotify }),
  );
};

const controller = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as any).__playlistController);

test.describe("shared music player", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("plays from Just browsing", { tag: ["@single"] }, async ({ page }) => {
    await installSpotify(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect.poll(async () => (await controller(page))?.playCalls).toBe(1);
  });

  test("plays from Open my letter once the guest is found", { tag: ["@single"] }, async ({ page }) => {
    await installSpotify(page);
    await page.goto("/");
    const preloader = page.locator("[data-preloader]");
    await preloader.locator("[data-preloader-name]").fill("Mateo Cruz");
    await preloader.getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader.locator("[data-preloader-admits]")).toBeVisible();
    expect((await controller(page))?.playCalls ?? 0).toBe(0);
    await preloader.getByRole("button", { name: "Open my letter" }).click();
    await expect.poll(async () => (await controller(page))?.playCalls).toBe(1);
  });

  test("does not play when Escape closes the envelope", { tag: ["@single"] }, async ({ page }) => {
    await installSpotify(page);
    await page.goto("/");
    // The player must be ready, so a 0 below is a real read and not a missing controller.
    await expect.poll(async () => Boolean(await controller(page))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    // Hold past the close, then read once: a poll for 0 would pass before Escape ran.
    await page.waitForTimeout(500);
    expect((await controller(page)).playCalls).toBe(0);
  });

  test("shows TAP TO PLAY after a blocked request and retries from the bar widget", { tag: ["@single"] }, async ({ page }) => {
    await installSpotify(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect.poll(async () => (await controller(page)).playCalls).toBe(1);
    await expect(page.locator("[data-music-widget]").first()).toHaveAttribute("data-music-state", "blocked", { timeout: 6000 });
    await expect(page.locator("[data-music-label]").first()).toHaveText("TAP TO PLAY");
    await page.locator(".nav_now-playing").click();
    await expect.poll(async () => (await controller(page)).playCalls).toBe(2);
  });

  test("shares playing state and pauses from the bar widget", { tag: ["@single"] }, async ({ page }) => {
    await installSpotify(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await page.evaluate(() => {
      const spotify = (window as any).__playlistController;
      spotify.listeners.find(([name]: [string]) => name === "playback_update")[1]({ data: { isPaused: false, position: 0, duration: 1000 } });
    });
    await expect(page.locator("[data-music-widget]").first()).toHaveAttribute("data-music-state", "playing");
    await expect(page.locator("[data-music-widget]").first()).toHaveAttribute("aria-label", "Pause music");
    await expect(page.locator("[data-music-label]").first()).toHaveText("NOW PLAYING");
    await page.locator(".nav_now-playing").click();
    await expect.poll(async () => (await controller(page)).pauseCalls).toBe(1);
  });
});
