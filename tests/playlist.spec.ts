import { expect, test } from "@playwright/test";

const fakeSpotify = `
  window.__playlistController = { listeners: [], addListener(name, callback) { this.listeners.push([name, callback]); } };
  window.onSpotifyIframeApiReady({ createController(element, options, callback) {
    window.__playlistController.options = options;
    const iframe = document.createElement('iframe');
    iframe.src = 'https://open.spotify.com/embed/playlist/test' + (options.theme === 'dark' ? '?theme=0' : '');
    iframe.style.width = '100%';
    iframe.style.height = options.height + 'px';
    element.replaceWith(iframe);
    callback(window.__playlistController);
  } });
`;

const installSpotify = async (page: import("@playwright/test").Page) => {
  await page.route("https://open.spotify.com/embed/iframe-api/v1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: fakeSpotify,
    }),
  );
};

const loadSpotify = async (page: import("@playwright/test").Page) => {
  await page.locator("#playlist").scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as Window & { __playlistController?: unknown })
            .__playlistController,
        ),
      ),
    )
    .toBe(true);
};

test.describe("Playlist section", () => {
  test("is present and reachable from the nav", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-navigation-toggle="toggle"]').click();
    await expect(
      page.locator(".navigation_link", { hasText: "Playlist" }),
    ).toHaveAttribute("href", "/#playlist");
    await page.locator(".navigation_link", { hasText: "Playlist" }).click();
    await expect(page.locator("#playlist")).toBeInViewport();
  });

  test("renders a passive cassette and a dark Spotify controller", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSpotify(page);
    await page.goto("/");
    await loadSpotify(page);
    const cassette = page.locator("[data-playlist-cassette]");
    const embed = page.locator("[data-playlist-embed]");
    await expect(cassette.locator("button, input")).toHaveCount(0);
    await expect(cassette.locator("[tabindex]")).toHaveCount(0);
    await expect(embed).toHaveCSS("width", "380px");
    const iframe = embed.locator("iframe");
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toHaveAttribute("src", /theme=0/);
    const layout = await cassette.evaluate((node) => {
      const element = node as HTMLElement;
      const embedElement = element.parentElement?.querySelector(
        "[data-playlist-embed]",
      ) as HTMLElement;
      const iframeElement = embedElement.querySelector("iframe") as HTMLElement;
      return {
        cassetteLeft: element.offsetLeft,
        cassetteWidth: element.offsetWidth,
        embedLeft: embedElement.offsetLeft,
        iframeLeft: iframeElement.offsetLeft,
        iframeWidth: iframeElement.offsetWidth,
      };
    });
    expect(layout.embedLeft).toBe(layout.cassetteLeft);
    expect(layout.iframeLeft).toBe(0);
    expect(layout.iframeWidth).toBe(layout.cassetteWidth);
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.stringify((window as any).__playlistController.options),
        ),
      )
      .toContain('"theme":"dark"');
  });

  test("continuously rotates reels while Spotify is playing", async ({
    page,
  }) => {
    await installSpotify(page);
    await page.goto("/");
    await loadSpotify(page);
    await page.evaluate(() =>
      (window as any).__playlistController.listeners[0][1]({
        data: { isPaused: false, position: 72000, duration: 231000 },
      }),
    );
    const first = await page
      .locator(".playlist_reel-inner")
      .first()
      .evaluate((element) => getComputedStyle(element).transform);
    await page.waitForTimeout(300);
    const second = await page
      .locator(".playlist_reel-inner")
      .first()
      .evaluate((element) => getComputedStyle(element).transform);
    expect(second).not.toBe(first);
    await page.evaluate(() =>
      (window as any).__playlistController.listeners[0][1]({
        data: { isPaused: true, position: 73000, duration: 231000 },
      }),
    );
    const stopped = await page
      .locator(".playlist_reel-inner")
      .first()
      .evaluate((element) => getComputedStyle(element).transform);
    await page.waitForTimeout(100);
    await expect(page.locator(".playlist_reel-inner").first()).toHaveCSS(
      "transform",
      stopped,
    );
    await expect(page.locator("[data-playlist-progress]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("keeps the embed at least 300px wide without document overflow on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await installSpotify(page);
    await page.goto("/");
    await loadSpotify(page);
    await expect(page.locator("[data-playlist-embed] iframe")).toHaveCount(1);
    expect(
      await page
        .locator("[data-playlist-embed] iframe")
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(300);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  });

  test("does not rotate reels when reduced motion is requested", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installSpotify(page);
    await page.goto("/");
    await loadSpotify(page);
    await page.evaluate(() =>
      (window as any).__playlistController.listeners[0][1]({
        data: { isPaused: false, position: 72000, duration: 231000 },
      }),
    );
    const first = await page
      .locator(".playlist_reel-inner")
      .first()
      .evaluate((element) => getComputedStyle(element).transform);
    await page.waitForTimeout(300);
    await expect(page.locator(".playlist_reel-inner").first()).toHaveCSS(
      "transform",
      first,
    );
  });

  test("validates the request form and shows its honest status", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".playlist_submit").click();
    await expect(page.locator('input[name="name"]')).toBeFocused();
    await page.locator('input[name="name"]').fill("Eunice");
    await page.locator('input[name="song"]').fill("Dancing Queen — ABBA");
    await page.locator(".playlist_submit").click();
    await expect(
      page.locator('.playlist_form-wrap .form_note-sent[role="status"]'),
    ).toHaveText("Song requests open soon — hold that thought.");
  });
});
