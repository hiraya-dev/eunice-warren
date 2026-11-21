import { test, expect } from "@playwright/test";
import { createFakeAdminStore, fakeAdminFixtures } from "../src/lib/admin/fake";
import { djText, duplicateLabel } from "../src/lib/admin/presentation";

test.describe("admin dashboard", () => {
  test("renders the fixture overview and protected headers @smoke", async ({
    page,
  }) => {
    const response = await page.goto("/admin");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator("[data-admin-sample]")).toBeVisible();
    await expect(page.locator("[data-admin-greeting]")).toContainText("Eunice");
    await expect(page.locator("[data-admin-coming]")).toBeVisible();
    await expect(page.locator("[data-admin-reply]")).toHaveCount(4);
    await expect(page.locator("[data-admin-waiting-row]")).toHaveCount(
      Math.min(
        3,
        fakeAdminFixtures.filter((row) => row.rsvp.state === "waiting").length,
      ),
    );
  });

  test("lists and searches fixture households @smoke", async ({ page }) => {
    await page.goto("/admin/guests");
    await expect(page.locator("[data-admin-household]")).toHaveCount(
      fakeAdminFixtures.length,
    );
    await page.locator("[data-admin-search]").fill("mendoza");
    await expect(
      page.locator("[data-admin-household]:not([hidden])"),
    ).toHaveCount(1);
    await page.locator("[data-admin-search]").fill("no such household");
    await expect(page.locator("[data-admin-no-match]")).toBeVisible();
  });

  // Overflow is judged against the page itself: the stamp is rotated and the
  // guest table swaps layout at 84rem (1344px), so odd widths are in the list (L-018).
  for (const path of ["/admin", "/admin/guests"]) {
    test(`has no horizontal overflow at 320 to 1920 on ${path} @sweep @single`, async ({
      page,
    }) => {
      for (const width of [
        320, 390, 768, 1023, 1024, 1150, 1279, 1280, 1343, 1344, 1440, 1920,
      ]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(
          overflow,
          `scrollWidth - innerWidth at ${width}`,
        ).toBeLessThanOrEqual(0);
      }
    });
  }

  // User feedback on #96: the phone greeting wrapped to 3 lines beside the
  // stamp (old CSS: 3 lines at 390). Use the longest greeting the helper makes.
  test("keeps the greeting to two lines on phones @sweep @single", async ({
    page,
  }) => {
    for (const width of [320, 360, 390, 480, 768, 1023]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/admin");
      const lines = await page
        .locator("[data-admin-greeting]")
        .evaluate((el) => {
          const name = el.querySelector("em")?.textContent ?? "Eunice";
          el.innerHTML = `Good afternoon, <em>${name}</em>`;
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
          return Math.round(el.getBoundingClientRect().height / lineHeight);
        });
      expect(lines, `greeting lines at ${width}`).toBeLessThanOrEqual(2);
    }
  });

  test("swaps the sidebar for the tab bar below 1024 @sweep @single", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.locator("[data-admin-tabbar]")).toBeVisible();
    await expect(page.locator("[data-admin-sidebar]")).toBeHidden();
    const tabbar = await page.locator("[data-admin-tabbar]").boundingBox();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = await page
      .locator("main section")
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    // Padding clears the fixed bar: the old failure hides the last row under it.
    expect(last).toBeLessThanOrEqual(tabbar!.y + 6);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("[data-admin-sidebar]")).toBeVisible();
    await expect(page.locator("[data-admin-tabbar]")).toBeHidden();
    const sidebar = await page.locator("[data-admin-sidebar]").boundingBox();
    expect(Math.abs(sidebar!.width - 264)).toBeLessThanOrEqual(6);
  });
});

// Slipper order and song requests. Counts come from the fake store the build
// uses, never from rendered text.
const fakeStore = createFakeAdminStore();

test.describe("admin slippers and songs", () => {
  test("links both pages from the sidebar and the tab bar @smoke", async ({
    page,
  }) => {
    for (const [path, active] of [
      ["/admin/slippers", "Slippers"],
      ["/admin/songs", "Songs"],
    ] as const) {
      await page.goto(path);
      for (const nav of ["[data-admin-sidebar]", "[data-admin-tabbar]"]) {
        const root = page.locator(nav);
        await expect(root.locator('a[href="/admin/slippers"]')).toHaveCount(1);
        await expect(root.locator('a[href="/admin/songs"]')).toHaveCount(1);
        const current = root.locator('a[aria-current="page"]');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAttribute("href", path);
        await expect(current).toContainText(active);
      }
    }
  });

  test("charts every slipper size with the fake store's counts @smoke", async ({
    page,
  }) => {
    const order = await fakeStore.getSlipperOrder();
    await page.goto("/admin/slippers");
    await expect(page.locator("[data-admin-slippers-page]")).toBeVisible();
    const women = page.locator('[data-slipper-chart="women"] li[data-size]');
    const men = page.locator('[data-slipper-chart="men"] li[data-size]');
    await expect(women).toHaveCount(order.women.length);
    await expect(men).toHaveCount(order.men.length);
    await expect(page.locator("li[data-size]")).toHaveCount(28);
    expect(order.women).toHaveLength(13);
    expect(order.men).toHaveLength(15);
    const counts = async (items: typeof women) =>
      items.evaluateAll((nodes) =>
        nodes.map((node) => Number((node as HTMLElement).dataset.count)),
      );
    expect((await counts(women)).reduce((a, b) => a + b, 0)).toBe(
      order.womenTotal,
    );
    expect((await counts(men)).reduce((a, b) => a + b, 0)).toBe(order.menTotal);
    expect(await counts(women)).toEqual(order.women.map((row) => row.count));
    expect(await counts(men)).toEqual(order.men.map((row) => row.count));
    await expect(page.locator("[data-slipper-stat]")).toHaveCount(3);
  });

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    test(`draws a zero count as a hairline at ${width} @sweep @single`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/admin/slippers");
      const zero = page.locator('li[data-size][data-count="0"]');
      expect(await zero.count()).toBeGreaterThan(0);
      for (const bar of await zero.locator("i").all()) {
        const box = await bar.boundingBox();
        expect(box!.height, `zero bar height at ${width}`).toBeLessThanOrEqual(
          3,
        );
        expect(box!.width).toBeGreaterThan(8);
      }
      // A counted size still draws a real bar.
      const counted = await page
        .locator('li[data-size]:not([data-count="0"]) i')
        .first()
        .boundingBox();
      expect(Math.max(counted!.width, counted!.height)).toBeGreaterThan(8);
    });
  }

  test("lists every song request and flags repeats @smoke", async ({
    page,
  }) => {
    const songs = await fakeStore.getSongRequests();
    await page.goto("/admin/songs");
    await expect(page.locator("[data-song-row]")).toHaveCount(songs.requests);
    const flagged = songs.rows.filter((row) => row.requestCount > 1);
    expect(flagged.length).toBeGreaterThan(0);
    await expect(page.locator("[data-song-dupe]")).toHaveCount(flagged.length);
    for (const [index, row] of songs.rows.entries()) {
      const dupe = page
        .locator("[data-song-row]")
        .nth(index)
        .locator("[data-song-dupe]");
      await expect(dupe).toHaveCount(row.requestCount > 1 ? 1 : 0);
      if (row.requestCount > 1)
        await expect(dupe).toHaveText(duplicateLabel(row.requestCount));
    }
    await expect(page.locator('[data-song-no-dedication="true"]')).toHaveCount(
      songs.rows.filter((row) => !row.dedication).length,
    );
  });

  test("copies the DJ list to the clipboard and clears the status", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "clipboard-read and clipboard-write permissions are Chromium only",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const songs = await fakeStore.getSongRequests();
    await page.goto("/admin/songs");
    const status = page.locator("[data-dj-copy-status]");
    await expect(status).toBeHidden();
    const before = await page.locator("[data-admin-songs-page]").boundingBox();
    await page.locator("[data-dj-copy]").click();
    await expect(status).toBeVisible();
    const after = await page.locator("[data-admin-songs-page]").boundingBox();
    expect(after!.height).toBe(before!.height);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      djText(songs.rows),
    );
    await page.waitForTimeout(1200);
    await page.locator("[data-dj-copy]").click();
    await page.waitForTimeout(1200);
    await expect(status).toBeVisible();
    await expect(status).toBeHidden({ timeout: 5000 });
  });

  test("serves both CSV downloads as no-store attachments @smoke", async ({
    page,
  }) => {
    for (const path of ["/admin/songs.csv", "/admin/slippers.csv"]) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(200);
      const headers = response.headers();
      expect(headers["content-type"]).toContain("text/csv");
      expect(headers["content-disposition"]).toContain("attachment");
      expect(headers["cache-control"]).toContain("no-store");
    }
  });

  // The song table swaps layout at 84rem (1344px) and the sidebar at 64rem.
  test("has no horizontal overflow on slippers and songs @sweep @single", async ({
    page,
  }) => {
    for (const path of ["/admin/slippers", "/admin/songs"]) {
      for (const width of [320, 390, 768, 1023, 1024, 1343, 1344, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(
          overflow,
          `${path} scrollWidth - innerWidth at ${width}`,
        ).toBeLessThanOrEqual(0);
      }
    }
  });

  test("lines song cells up under their headers from 1344 @sweep @single", async ({
    page,
  }) => {
    for (const width of [1344, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/songs");
      const lefts = (selector: string) =>
        page
          .locator(selector)
          .evaluateAll((nodes) =>
            nodes.map((node) => Math.round(node.getBoundingClientRect().left)),
          );
      const headers = await lefts('[role="columnheader"]');
      expect(headers).toHaveLength(5);
      const row = page.locator("[data-song-row]").first();
      const cells = [
        "[data-song-no]",
        ':scope > [role="cell"]:nth-child(2)',
        "[data-song-from]",
        "[data-song-dedication]",
        "[data-song-sent]",
      ];
      for (const [index, selector] of cells.entries()) {
        const left = await row
          .locator(selector)
          .evaluate((node) => Math.round(node.getBoundingClientRect().left));
        expect(
          Math.abs(left - headers[index]),
          `column ${index} at ${width}`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  test("shares one baseline across each slipper chart from 1024 @sweep @single", async ({
    page,
  }) => {
    for (const width of [1024, 1343, 1344, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/slippers");
      for (const chart of ["women", "men"]) {
        const bottoms = await page
          .locator(`[data-slipper-chart="${chart}"] li i`)
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getBoundingClientRect().bottom),
          );
        expect(bottoms.length).toBeGreaterThan(0);
        expect(
          Math.max(...bottoms) - Math.min(...bottoms),
          `${chart} bar bottoms at ${width}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});
