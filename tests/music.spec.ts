import { expect, test } from "@playwright/test";

const fakeSpotify = `
  window.onSpotifyIframeApiReady({ createController(element, options, callback) {
    const queuedCommands = [];
    let iframeLoaded = false;
    const deliver = (command) => {
      if (!iframeLoaded) {
        queuedCommands.push(command);
        return;
      }
      window.__playlistController[command + 'Calls'] += 1;
    };
    window.__playlistController = {
      listeners: [], playCalls: 0, pauseCalls: 0,
      addListener(name, callback) { this.listeners.push([name, callback]); },
      play() { deliver('play'); },
      pause() { deliver('pause'); }
    };
    const iframe = document.createElement('iframe');
    iframe.loading = 'lazy';
    iframe.src = 'https://open.spotify.com/embed/playlist/test';
    iframe.style.width = '100%';
    iframe.style.height = options.height + 'px';
    iframe.addEventListener('load', () => {
      iframeLoaded = true;
      queuedCommands.splice(0).forEach(deliver);
    });
    element.replaceWith(iframe);
    callback(window.__playlistController);
  } });
`;

const installSpotify = async (page: import("@playwright/test").Page) => {
  await page.route("https://open.spotify.com/embed/**", (route) => {
    if (route.request().url().endsWith("/iframe-api/v1")) {
      return route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: fakeSpotify,
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>embed</title>",
    });
  });
};

const controller = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as any).__playlistController);

const seedRememberedGuest = async (page: import("@playwright/test").Page, paused = false) => {
  await page.addInitScript(({ paused }) => {
    localStorage.setItem("ew-guest-v1", JSON.stringify({ name: "Mateo Cruz", householdName: "The Cruz Family", seats: 4, at: "2026-11-14T00:00:00.000Z" }));
    if (paused) localStorage.setItem("ew-music-v1", JSON.stringify({ paused: true, at: "2026-11-14T00:00:00.000Z" }));
  }, { paused });
};

test.describe("shared music player", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("plays from Just browsing", { tag: ["@single"] }, async ({ page }) => {
    await installSpotify(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    await expect.poll(async () => (await controller(page))?.playCalls).toBe(1);
  });

  test("plays before the off-screen Playlist section loads", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSpotify(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Just browsing" }).click();
    expect(
      await page.locator("#playlist").evaluate((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      }),
    ).toBe(false);
    await expect
      .poll(async () => (await controller(page))?.playCalls, { timeout: 5000 })
      .toBe(1);
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

  test("welcome-back letter plays and keeps the remembered guest", { tag: ["@single"] }, async ({ page }) => {
    await seedRememberedGuest(page);
    await installSpotify(page);
    await page.goto("/");
    const preloader = page.locator("[data-preloader]");
    await expect(preloader.getByRole("heading", { name: "Welcome back, The Cruz Family." })).toBeVisible();
    await preloader.getByRole("button", { name: "Open my letter" }).click();
    await expect(preloader).toHaveCount(0);
    await expect.poll(async () => (await controller(page))?.playCalls).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ew-guest-v1") || "null"))).toEqual({
      name: "Mateo Cruz", householdName: "The Cruz Family", seats: 4, at: "2026-11-14T00:00:00.000Z",
    });
  });

  test("does not show welcome-back letter twice in one session", { tag: ["@single"] }, async ({ page }) => {
    await seedRememberedGuest(page);
    await page.goto("/");
    await expect(page.locator("[data-preloader]").getByRole("heading", { name: "Welcome back, The Cruz Family." })).toBeVisible();
    await page.locator("[data-preloader]").getByRole("button", { name: "Just browsing" }).click();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    await expect(page.locator("main")).toBeVisible();
    await page.reload();
    await expect(page.locator("main")).toBeVisible();
    // The head script decides before first paint, so one read of the class is final.
    expect(await page.locator("html").getAttribute("class") ?? "").not.toContain("ew-preloader-pending");
  });

  test("does not show welcome-back letter when music is paused", { tag: ["@single"] }, async ({ page }) => {
    await seedRememberedGuest(page, true);
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    expect(await page.locator("html").getAttribute("class") ?? "").not.toContain("ew-preloader-pending");
  });

  test("Just browsing keeps a welcome-back guest remembered", { tag: ["@single"] }, async ({ page }) => {
    await seedRememberedGuest(page);
    await page.goto("/");
    await page.locator("[data-preloader]").getByRole("button", { name: "Just browsing" }).click();
    await expect(page.locator("[data-preloader]")).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ew-guest-v1") || "null"))).toEqual({
      name: "Mateo Cruz", householdName: "The Cruz Family", seats: 4, at: "2026-11-14T00:00:00.000Z",
    });
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
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ew-music-v1") || "null"))).toMatchObject({ paused: true });
    await page.evaluate(() => {
      const spotify = (window as any).__playlistController;
      spotify.listeners.find(([name]: [string]) => name === "playback_update")[1]({ data: { isPaused: true, position: 0, duration: 1000 } });
    });
    await page.locator(".nav_now-playing").click();
    expect(await page.evaluate(() => localStorage.getItem("ew-music-v1"))).toBeNull();
  });
});
