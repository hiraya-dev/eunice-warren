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

  test("renders a passive turntable and a dark Spotify controller", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSpotify(page);
    await page.goto("/");
    await loadSpotify(page);
    const turntable = page.locator("[data-playlist-turntable]");
    const embed = page.locator("[data-playlist-embed]");
    await expect(turntable).toHaveAttribute("aria-hidden", "true");
    await expect(turntable.locator("button, input, [tabindex]")).toHaveCount(0);
    await expect(turntable.locator("[data-playlist-record]")).toHaveCount(1);
    await expect(turntable.locator("[data-playlist-tonearm]")).toHaveCount(1);
    await expect(embed).toHaveCSS("width", "380px");
    const iframe = embed.locator("iframe");
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toHaveCSS("opacity", "1");
    await expect(iframe).toHaveAttribute("src", /theme=0/);
    const layout = await turntable.evaluate((node) => {
      const element = node as HTMLElement;
      const embedElement = element.parentElement?.querySelector(
        "[data-playlist-embed]",
      ) as HTMLElement;
      const iframeElement = embedElement.querySelector("iframe") as HTMLElement;
      return {
        turntableLeft: element.offsetLeft,
        turntableWidth: element.offsetWidth,
        embedLeft: embedElement.offsetLeft,
        iframeLeft: iframeElement.offsetLeft,
        iframeWidth: iframeElement.offsetWidth,
      };
    });
    expect(layout.embedLeft).toBe(layout.turntableLeft);
    expect(layout.iframeLeft).toBe(0);
    expect(layout.iframeWidth).toBe(layout.turntableWidth);
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.stringify((window as any).__playlistController.options),
        ),
      )
      .toContain('"theme":"dark"');
  });

  test("marks the heading copy for the shared fade-in", async ({ page }) => {
    await page.goto("/");
    const header = page.locator(".playlist_header");
    await expect(header).toHaveAttribute("data-fade-in", "");
    await expect(header.locator("[data-fade-in-item]")).toHaveCount(2);
  });

  test("drops the needle and continuously spins the record while Spotify is playing", async ({
    page,
  }) => {
    await installSpotify(page);
    await page.goto("/");
    await loadSpotify(page);
    const arm = page.locator("[data-playlist-tonearm]");
    const record = page.locator("[data-playlist-record]");
    await expect(arm).toHaveCSS("transform", /matrix\(0\.866/);
    await page.evaluate(() =>
      (window as any).__playlistController.listeners[0][1]({
        data: { isPaused: false, position: 72000, duration: 231000 },
      }),
    );
    await expect(arm).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await page.waitForTimeout(700);
    const firstCenter = await record.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
    await page.waitForTimeout(350);
    const secondCenter = await record.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
    expect(Math.abs(secondCenter.x - firstCenter.x)).toBeLessThan(1);
    expect(Math.abs(secondCenter.y - firstCenter.y)).toBeLessThan(1);
    const samples: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      samples.push(
        await record.evaluate((element) => {
          const values = new DOMMatrix(getComputedStyle(element).transform);
          return Math.atan2(values.b, values.a);
        }),
      );
      await page.waitForTimeout(200);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.2);
    const beforePause = samples.at(-1)!;
    await page.evaluate(() =>
      (window as any).__playlistController.listeners[0][1]({
        data: { isPaused: true, position: 73000, duration: 231000 },
      }),
    );
    await page.waitForTimeout(1500);
    const afterPause = await record.evaluate((element) => {
      const values = new DOMMatrix(getComputedStyle(element).transform);
      return Math.atan2(values.b, values.a);
    });
    await expect(arm).toHaveCSS("transform", /matrix\(0\.866/);
    expect(Math.abs(afterPause - beforePause)).toBeGreaterThan(0.2);
    const stopped = await record.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await page.waitForTimeout(200);
    await expect(record).toHaveCSS("transform", stopped);
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

  test("does not reset the record angle on a repeated play event", async ({
    page,
  }) => {
    await installSpotify(page);
    await page.goto("/");
    await loadSpotify(page);
    const record = page.locator("[data-playlist-record]");
    const send = async () =>
      page.evaluate(() =>
        (window as any).__playlistController.listeners[0][1]({
          data: { isPaused: false, position: 72000, duration: 231000 },
        }),
      );
    await send();
    await page.waitForTimeout(850);
    const before = await record.evaluate((element) => {
      const angle = Number.parseFloat(
        element.style.transform.match(/rotate\(([-\d.e]+)deg\)/)?.[1] ?? "0",
      );
      return { angle, time: performance.now() };
    });
    await send();
    const after = await record.evaluate((element) => {
      const angle = Number.parseFloat(
        element.style.transform.match(/rotate\(([-\d.e]+)deg\)/)?.[1] ?? "0",
      );
      return { angle, time: performance.now() };
    });
    const elapsed = after.time - before.time;
    const maxAdvance = (elapsed + 100) * 0.2;
    expect(after.angle).toBeGreaterThanOrEqual(before.angle - 0.5);
    expect(after.angle - before.angle).toBeLessThanOrEqual(maxAdvance + 0.5);
    await page.waitForTimeout(200);
    const later = await record.evaluate((element) => {
      return Number.parseFloat(
        element.style.transform.match(/rotate\(([-\d.e]+)deg\)/)?.[1] ?? "0",
      );
    });
    expect(later - after.angle).toBeGreaterThan(1);
  });

  test("does not rotate the record when reduced motion is requested", async ({
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
    const record = page.locator("[data-playlist-record]");
    const arm = page.locator("[data-playlist-tonearm]");
    const first = await record.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await page.waitForTimeout(300);
    await expect(record).toHaveCSS("transform", first);
    await expect(arm).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  });

  test("validates the request form and shows its honest status", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".playlist_submit").click();
    await expect(page.locator('.playlist_form-wrap input[name="name"]')).toBeFocused();
    await page.locator('.playlist_form-wrap input[name="name"]').fill("Eunice");
    await expect(page.locator(".field-search-icon")).toHaveCount(0);
    await expect(page.locator('input[name="artist"]')).not.toHaveAttribute(
      "required",
    );
    await page.locator('input[name="song"]').fill("Dancing Queen");
    await page.locator('input[name="artist"]').fill("ABBA");
    await page.locator(".playlist_submit").click();
    await expect(
      page.locator('.playlist_form-wrap .form_note-sent[role="status"]'),
    ).toHaveText("Song requests open soon — hold that thought.");
  });

  test("keeps postcard fields empty, lined, and stable on focus", async ({
    page,
  }) => {
    await page.goto("/");
    const dedication = page.locator('textarea[name="dedication"]');

    await expect(dedication).toHaveValue("");
    await dedication.click({ position: { x: 80, y: 24 } });
    expect(
      await dedication.evaluate(
        (element) => (element as HTMLTextAreaElement).selectionStart,
      ),
    ).toBe(0);

    const sizing = await dedication.evaluate((element) => {
      const control = element as HTMLTextAreaElement;
      const styles = getComputedStyle(control);
      return {
        height: control.offsetHeight,
        lineHeight: parseFloat(styles.lineHeight),
        maxHeight: Math.round(parseFloat(styles.maxHeight)),
        resize: styles.resize,
        borderTop: styles.borderTopStyle,
        borderLeft: styles.borderLeftStyle,
        borderRight: styles.borderRightStyle,
      };
    });
    expect(sizing.height).toBeGreaterThanOrEqual(sizing.lineHeight * 4);
    expect(sizing.height).toBeLessThanOrEqual(sizing.maxHeight);
    expect(sizing.resize).toBe("none");
    expect(sizing.borderTop).toBe("none");
    expect(sizing.borderLeft).toBe("none");
    expect(sizing.borderRight).toBe("none");

    await dedication.fill("line\n".repeat(7) + "line");
    const expandedHeight = await dedication.evaluate(
      (element) => (element as HTMLElement).offsetHeight,
    );
    expect(expandedHeight).toBeGreaterThan(sizing.height);
    expect(expandedHeight).toBe(sizing.maxHeight);

    for (const field of await page
      .locator(".playlist_postcard .field-control")
      .all()) {
      const blurred = await field.evaluate((element) => ({
        height: (element as HTMLElement).offsetHeight,
        boxShadow: getComputedStyle(element).boxShadow,
      }));
      await field.focus();
      const focused = await field.evaluate((element) => {
        const control = element as HTMLInputElement | HTMLTextAreaElement;
        const styles = getComputedStyle(control);
        return {
          height: control.offsetHeight,
          outlineStyle: styles.outlineStyle,
          outlineWidth: styles.outlineWidth,
          borderTop: styles.borderTopStyle,
          borderLeft: styles.borderLeftStyle,
          borderRight: styles.borderRightStyle,
          borderBottom: styles.borderBottomStyle,
          boxShadow: styles.boxShadow,
        };
      });
      expect(focused.height).toBe(blurred.height);
      expect(
        focused.outlineStyle === "none" || focused.outlineWidth === "0px",
      ).toBe(true);
      expect(focused.borderTop).toBe("none");
      expect(focused.borderLeft).toBe("none");
      expect(focused.borderRight).toBe("none");
      expect(focused.borderBottom).toBe("none");
      // The line is an inset shadow so thickening it never shifts layout.
      expect(blurred.boxShadow).toMatch(/0px -1\.5px 0px 0px inset/);
      expect(focused.boxShadow).toMatch(/0px -3px 0px 0px inset/);
    }
  });
});
