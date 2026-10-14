import { expect, test } from "@playwright/test";

const fakeSpotify = `
  window.__playlistController = { calls: [], listeners: [], togglePlay() { this.calls.push(['togglePlay']); }, seek(seconds) { this.calls.push(['seek', seconds]); }, addListener(name, callback) { this.listeners.push([name, callback]); } };
  window.onSpotifyIframeApiReady({ createController(element, options, callback) { window.__playlistController.options = options; callback(window.__playlistController); } });
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

  test("keeps controls disabled until Spotify is ready and disables them on abort", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("[data-playlist-toggle]")).toBeDisabled();
    await page.route("https://open.spotify.com/embed/iframe-api/v1", (route) =>
      route.abort(),
    );
    await page.locator("#playlist").scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await expect(page.locator("[data-playlist-toggle]")).toBeDisabled();
    await expect(page.locator("[data-playlist-restart]")).toBeDisabled();
    await expect(page.locator("[data-playlist-seek]")).toBeDisabled();
  });

  test("syncs cassette controls and continuously rotates reels while playing", async ({
    page,
  }) => {
    await installSpotify(page);
    await page.goto("/");
    await loadSpotify(page);
    const toggle = page.locator("[data-playlist-toggle]");
    await toggle.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.stringify((window as any).__playlistController.calls),
        ),
      )
      .toContain("togglePlay");
    await page.evaluate(() =>
      (window as any).__playlistController.listeners[0][1]({
        data: { isPaused: false, position: 72000, duration: 231000 },
      }),
    );
    await expect(toggle).toHaveAttribute("aria-label", "Pause");
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
    await expect(toggle).toHaveAttribute("aria-label", "Play");
    const stopped = await page
      .locator(".playlist_reel-inner")
      .first()
      .evaluate((element) => getComputedStyle(element).transform);
    await page.waitForTimeout(100);
    await expect(page.locator(".playlist_reel-inner").first()).toHaveCSS(
      "transform",
      stopped,
    );
    await page.locator("[data-playlist-seek]").evaluate((input) => {
      (input as HTMLInputElement).value = "90000";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect
      .poll(async () =>
        JSON.stringify(
          await page.evaluate(() => (window as any).__playlistController.calls),
        ),
      )
      .toContain("seek");
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
