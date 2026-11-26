import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { fakeAdminFixtures } from "../src/lib/admin/fake";
import { withAdminLock } from "./helpers/admin-lock";

const activeFixtures = fakeAdminFixtures.filter((row) => !row.archivedAt);
const expectedIds = (filter: string) =>
  activeFixtures
    .filter((row) => {
      if (filter === "waiting") return row.rsvp.state === "waiting";
      if (filter === "coming") return row.rsvp.state === "coming";
      if (filter === "declined") return row.rsvp.state === "declined";
      if (filter === "no-name")
        return row.seats.some(
          (seat) => !seat.name?.trim() && (seat.state ?? "open") === "open",
        );
      return true;
    })
    .map((row) => row.id);

const rowById = (page: Page, id: string) =>
  page.locator(`[data-household-id="${id}"]`);
const expectRsvpSeatCount = async (
  row: ReturnType<typeof rowById>,
  seatCount: number,
) =>
  expect(row.locator("[data-admin-rsvp]")).toContainText(
    new RegExp(`(?:of\\s+${seatCount}\\s+coming|·\\s+${seatCount}\\s+seats?)`),
  );
const editor = fakeAdminFixtures.find((row) => row.id === "hh-admin-editor")!;
const openSeatFixture = fakeAdminFixtures.find(
  (row) => row.id === "hh-mendoza",
)!;
const twoMemberFixture = fakeAdminFixtures.find(
  (row) => row.id === "hh-merly-ben",
)!;

// The fake store outlives a project run and refuses a repeat name as already
// invited, so each test saves a surname of its own (letters only).
const uniqueSurname = (
  testInfo: Pick<TestInfo, "project" | "workerIndex" | "retry">,
) =>
  `Vega${[
    ...`${testInfo.project.name}${testInfo.workerIndex}${testInfo.retry}${Date.now().toString(36)}`,
  ]
    .map((char) => (/\d/.test(char) ? "abcdefghij"[Number(char)] : char))
    .join("")}`;

test.describe("guest list filters", () => {
  test.describe.configure({ mode: "serial" });

  test("renders fixture counts and keeps filter and q on links", async ({
    page,
  }) => {
    await page.goto("/admin/guests?filter=waiting&q=editor");
    await expect(page.locator("[data-admin-household]")).toHaveCount(
      expectedIds("waiting").length,
    );
    await expect(page.locator("[data-admin-filter='waiting']")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator("[data-admin-edit]").first()).toHaveAttribute(
      "href",
      /filter=waiting.*q=editor/,
    );
    await page.locator("[data-admin-filter='all']").click();
    await expect(page).toHaveURL(/q=editor/);
    await expect(page.locator("[data-admin-search]")).toHaveValue("editor");
  });

  test("keeps filters without JavaScript and uses the fixture as the count source", async ({
    browser,
  }) => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto("/admin/guests?q=editor");
    await page.locator("[data-admin-filter='declined']").click();
    await expect(page).toHaveURL(/filter=declined.*q=editor/);
    await expect(page.locator("[data-admin-household]")).toHaveCount(
      expectedIds("declined").length,
    );
    await page.close();
  });
});

test.describe("guest list rows", () => {
  test("keeps row menus exclusive and closes them for drawer actions", async ({
    page,
  }, testInfo) => {
    await withAdminLock(async () => {
      await page.setViewportSize(
        testInfo.project.name === "mobile"
          ? { width: 390, height: 844 }
          : { width: 1440, height: 900 },
      );
      await page.goto("/admin/guests");
      const rows = page.locator("[data-admin-household]");
      const firstMenu = rows.nth(0).locator("details.admin_guests_menu");
      const secondMenu = rows.nth(testInfo.project.name === "mobile" ? 2 : 1).locator("details.admin_guests_menu");

      await firstMenu.locator("summary").click();
      await expect(firstMenu).toHaveAttribute("open", "");
      await secondMenu.locator("summary").click();
      await expect(firstMenu).not.toHaveAttribute("open", "");
      await expect(secondMenu).toHaveAttribute("open", "");

      const outsidePoint = await page.evaluate(() => {
        const section = document.querySelector("[data-admin-guests-page]");
        if (!section) return null;
        for (let y = 8; y < window.innerHeight; y += 8)
          for (let x = 8; x < window.innerWidth; x += 8) {
            const element = document.elementFromPoint(x, y);
            if (
              element &&
              !section.contains(element) &&
              !element.closest("a, button, input, select, textarea, summary")
            )
              return { x, y };
          }
        return null;
      });
      expect(outsidePoint).not.toBeNull();
      await page.mouse.click(outsidePoint!.x, outsidePoint!.y);
      await expect(secondMenu).not.toHaveAttribute("open", "");

      await secondMenu.locator("summary").click();
      await page
        .locator("[data-admin-guests-page]")
        .click({ position: { x: 8, y: 8 } });
      await expect(secondMenu).not.toHaveAttribute("open", "");

      await firstMenu.locator("summary").click();
      await page.keyboard.press("Escape");
      await expect(firstMenu).not.toHaveAttribute("open", "");
      await expect(firstMenu.locator("summary")).toBeFocused();

      await firstMenu.locator("summary").click();
      await page.getByRole("link", { name: "+ Add household" }).click();
      await expect(page.locator("[data-admin-drawer]")).toBeVisible();
      await expect(
        page.locator("details.admin_guests_menu[open]"),
      ).toHaveCount(0);
    });
  });

  test("keeps desktop popovers inside the card and clear of every other menu @single", async ({ page }) => {
    await page.goto("/admin/guests");
    for (const width of [1344, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const collisions = await page.locator(".admin-guests_card").evaluate((card) => {
        const bounds = card.getBoundingClientRect();
        const menus = [...card.querySelectorAll<HTMLDetailsElement>(".admin_guests_menu")];
        return menus.flatMap((menu) => {
          menu.open = true;
          const box = menu.querySelector(".admin_guests_popover")!.getBoundingClientRect();
          const overlaps = menus.some((other) => {
            if (other === menu) return false;
            const button = other.querySelector("summary")!.getBoundingClientRect();
            return box.left < button.right && box.right > button.left &&
              box.top < button.bottom && box.bottom > button.top;
          });
          menu.open = false;
          return overlaps || box.left < bounds.left || box.right > bounds.right
            ? [menu.closest("tr")!.dataset.householdId]
            : [];
        });
      });
      expect(collisions, `width ${width}`).toEqual([]);
    }
  });

  test("keeps the last visible menu above the phone tab bar after search", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/guests");
    const tabbar = page.locator("[data-admin-tabbar]");
    const menu = page.locator("[data-admin-household]:visible").last().locator("details");
    // The numbered fixture labels end before the three editor/activity fixtures.
    for (const query of ["", "-0"]) {
      await page.locator("[data-admin-search]").fill(query);
      if (query) {
        await expect(page.locator("tr:nth-last-child(-n + 2)[data-admin-household]:visible")).toHaveCount(0);
      }
      const bottom = (await tabbar.boundingBox())!.y;
      const summary = menu.locator("summary");
      await summary.evaluate((button, limit) => {
        window.scrollBy(0, button.getBoundingClientRect().bottom - (limit - 8));
      }, bottom);
      await summary.click();
      await expect.poll(async () => {
        const box = await menu.locator(".admin_guests_popover").boundingBox();
        return box ? box.y + box.height : Infinity;
      }).toBeLessThanOrEqual(bottom);
      await page.keyboard.press("Escape");
    }
  });

  test("keeps renamed members quiet in rows and detailed in the drawer", async ({
    page,
  }) => {
    const renamed = fakeAdminFixtures.find((row) => row.id === "hh-dela-cruz")!;
    await page.goto("/admin/guests");
    const row = rowById(page, renamed.id);
    await expect(row.locator(".rename")).toHaveCount(0);
    await expect(row.locator(".admin_guests_renamed")).toHaveText("renamed");
    await row.locator("details.admin_guests_menu summary").click();
    await row.locator("[data-admin-edit]").click();
    await expect(page.locator("[data-admin-drawer]")).toContainText(
      "renamed by",
    );
  });

  test("keeps every row menu button clear of its RSVP pill", async ({
    page,
  }) => {
    // The pill carries the seat count now, so it is wider; at 1344 and up the
    // menu sits absolutely at the cell's right edge and must not sit under it.
    for (const width of [390, 1344, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/guests");
      const overlaps = await page
        .locator("[data-admin-household]")
        .evaluateAll((rows) =>
          rows.flatMap((row) => {
            const pill = row
              .querySelector("[data-admin-rsvp]")!
              .getBoundingClientRect();
            const menu = row
              .querySelector(".admin_guests_menu summary")!
              .getBoundingClientRect();
            return pill.right > menu.left + 1
              ? [row.getAttribute("data-household-id")]
              : [];
          }),
        );
      expect(overlaps, `width ${width}`).toEqual([]);
    }
  });

  test("opens a row menu with a 140ms opacity and scale entrance from the button", { tag: ["@single"] }, async ({ page }) => {
    const ease = "cubic-bezier(0.23, 1, 0.32, 1)";
    // Open in the same turn that reads the transitions (L-060), then read where
    // the popover scales from once the page script has decided up or down.
    const open = (last: boolean) =>
      page.evaluate((useLast) => {
        const rows = [...document.querySelectorAll<HTMLElement>("[data-admin-household]")].filter(
          (row) => !row.hidden,
        );
        const menu = rows[useLast ? rows.length - 1 : 0].querySelector<HTMLDetailsElement>("details.admin_guests_menu")!;
        const summary = menu.querySelector("summary")!;
        if (useLast) {
          const bar = document.querySelector("[data-admin-tabbar]")!.getBoundingClientRect().y;
          window.scrollBy(0, summary.getBoundingClientRect().bottom - (bar - 8));
        }
        summary.click();
        const popover = menu.querySelector<HTMLElement>(".admin_guests_popover")!;
        return popover.getAnimations().map((animation) => {
          const effect = animation.effect as KeyframeEffect;
          const frames = effect.getKeyframes();
          return {
            property: (animation as CSSTransition).transitionProperty,
            duration: effect.getComputedTiming().duration,
            easing: effect.getTiming().easing,
            from: frames[0][(animation as CSSTransition).transitionProperty as "opacity"],
            to: frames[frames.length - 1][(animation as CSSTransition).transitionProperty as "opacity"],
          };
        });
      }, last);
    const origin = (last: boolean) =>
      page.evaluate((useLast) => {
        const rows = [...document.querySelectorAll<HTMLElement>("[data-admin-household]")].filter(
          (row) => !row.hidden,
        );
        const menu = rows[useLast ? rows.length - 1 : 0].querySelector("details.admin_guests_menu")!;
        const popover = menu.querySelector<HTMLElement>(".admin_guests_popover")!;
        const [x, y] = getComputedStyle(popover).transformOrigin.split(" ").map(parseFloat);
        return {
          up: menu.hasAttribute("data-up"),
          x: x / popover.offsetWidth,
          y: y / popover.offsetHeight,
        };
      }, last);
    const cases = [
      { width: 390, last: false, y: 0 },
      { width: 390, last: true, y: 1 },
      { width: 1440, last: false, y: 0.5 },
    ];
    for (const { width, last, y } of cases) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/admin/guests");
      const started = await open(last);
      const label = `${width}${last ? " up" : ""}`;
      expect(started.map((entry) => entry.property).sort(), label).toEqual(["opacity", "scale"]);
      for (const entry of started) {
        expect(entry.duration, label).toBe(140);
        expect(entry.easing, label).toBe(ease);
      }
      expect(started.find((entry) => entry.property === "opacity")).toMatchObject({ from: "0", to: "1" });
      expect(started.find((entry) => entry.property === "scale")).toMatchObject({ from: "0.96", to: "1" });
      await expect.poll(() => origin(last), label).toMatchObject({ up: last });
      const where = await origin(last);
      expect(where.x, label).toBeCloseTo(1, 1);
      expect(where.y, label).toBeCloseTo(y, 1);
      // Settled: the entrance leaves nothing behind.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const popover = document.querySelector<HTMLElement>("details.admin_guests_menu[open] .admin_guests_popover")!;
              const style = getComputedStyle(popover);
              return {
                running: popover.getAnimations().length,
                opacity: style.opacity,
                scale: style.scale === "none" ? "1" : style.scale,
              };
            }),
          label,
        )
        .toEqual({ running: 0, opacity: "1", scale: "1" });
    }
  });

  test("keeps the desktop popover centred on its button once open", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/guests");
    const menu = page.locator("[data-admin-household]").first().locator("details.admin_guests_menu");
    await menu.locator("summary").click();
    await expect
      .poll(async () => {
        const [button, popover] = await Promise.all([
          menu.locator("summary").boundingBox(),
          menu.locator(".admin_guests_popover").boundingBox(),
        ]);
        return Math.abs(button!.y + button!.height / 2 - (popover!.y + popover!.height / 2));
      })
      .toBeLessThanOrEqual(1);
  });

  test("shows no perceptible row menu entrance under reduced motion", { tag: ["@single"] }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/admin/guests");
      const perceptible = await page.evaluate(() => {
        const menu = document.querySelector<HTMLDetailsElement>("[data-admin-household] details.admin_guests_menu")!;
        menu.querySelector("summary")!.click();
        return menu
          .querySelector(".admin_guests_popover")!
          .getAnimations()
          .filter((animation) => {
            const timing = animation.effect!.getComputedTiming();
            return Number(timing.duration) + Number(timing.delay) > 1;
          }).length;
      });
      expect(perceptible, `width ${width}`).toBe(0);
    }
  });

  test("shows no row menu exit animation when it closes", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/guests");
    const perceptible = await page.evaluate(async () => {
      const menu = document.querySelector<HTMLDetailsElement>("[data-admin-household] details.admin_guests_menu")!;
      menu.open = true;
      await new Promise((resolve) => setTimeout(resolve, 300));
      menu.open = false;
      return menu
        .querySelector(".admin_guests_popover")!
        .getAnimations()
        .filter((animation) => {
          const timing = animation.effect!.getComputedTiming();
          return Number(timing.duration) + Number(timing.delay) > 1;
        }).length;
    });
    expect(perceptible).toBe(0);
  });

  test("presses Add household in to 0.97 and back on release", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/guests");
    const add = page.locator(".admin_guests_add");
    const scale = () => add.evaluate((el) => (getComputedStyle(el).scale === "none" ? "1" : getComputedStyle(el).scale));
    await add.hover();
    await page.mouse.down();
    await expect.poll(scale).toBe("0.97");
    // Leave the button before release so the press does not open the drawer.
    const parent = (await add.locator("..").boundingBox())!;
    await page.mouse.move(parent.x + 2, parent.y + 2);
    await page.mouse.up();
    await expect.poll(scale).toBe("1");
  });

  test("presses the guest drawer Save in to 0.97 and not when disabled", { tag: ["@single"] }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/admin/guests?edit=${editor.id}`);
    const save = page.locator(".admin_guests_drawer_footer > button.primary");
    const scale = () => save.evaluate((el) => (getComputedStyle(el).scale === "none" ? "1" : getComputedStyle(el).scale));
    const letGo = async () => {
      const footer = (await save.locator("..").boundingBox())!;
      await page.mouse.move(footer.x + 2, footer.y + 2);
      await page.mouse.up();
    };
    await save.hover();
    await page.mouse.down();
    await expect.poll(scale).toBe("0.97");
    await letGo();
    await expect.poll(scale).toBe("1");

    await save.evaluate((el: HTMLButtonElement) => (el.disabled = true));
    await save.hover({ force: true });
    await page.mouse.down();
    await page.waitForTimeout(300);
    expect(await scale()).toBe("1");
    await letGo();
  });

  test("shows coming and seat counts in the combined RSVP pill", async ({
    page,
  }) => {
    const coming = fakeAdminFixtures.find(
      (row) => row.id === "hh-dela-cruz" && row.rsvp.state === "coming",
    )!;
    await page.goto("/admin/guests");
    const pill = rowById(page, coming.id).locator("[data-admin-rsvp]");
    await expect(pill).toHaveAttribute("data-state", coming.rsvp.state);
    const comingCount =
      coming.rsvp.state === "coming" ? coming.rsvp.coming : 0;
    await expect(pill).toContainText(String(comingCount));
    await expect(pill).toContainText(String(coming.seatCount));
  });
});

test.describe("guest list drawer", () => {
  test.describe.configure({ mode: "serial" });

  test("titles edit drawers from invited members, not named plus-ones", async ({
    page,
  }) => {
    await page.goto("/admin/guests?edit=hh-lim");
    const limTitle = page.locator("[data-admin-drawer] h2");
    await expect(limTitle).toHaveText("Kat");
    await expect(limTitle).not.toContainText("Jonas");

    await page.goto(`/admin/guests?edit=${twoMemberFixture.id}`);
    const memberNames = twoMemberFixture.seats
      .filter((seat) => seat.kind === "member" && seat.name)
      .map((seat) => seat.name!.split(/\s+/)[0]);
    const twoMemberTitle = page.locator("[data-admin-drawer] h2");
    await expect(twoMemberTitle).toContainText(
      `${memberNames[0]} & ${memberNames[1]}`,
    );
    await expect(twoMemberTitle.locator("em")).toHaveText(
      `& ${memberNames[1]}`,
    );

    await page.goto("/admin/guests?new=1");
    await expect(page.locator("[data-admin-drawer] h2")).toHaveText(
      "Who are you inviting?",
    );
  });

  test(
    "tracks the mobile sheet keyboard and cleans up on close",
    { tag: ["@single"] },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/admin/guests?edit=${editor.id}`);
      const panel = page.locator(".admin_guests_panel");
      const field = page.locator("[data-edit-household] [name='notes']");
      await page.evaluate(() => {
        const field = document.querySelector<HTMLElement>(
          "[data-edit-household] [name='notes']",
        );
        if (!field) throw new Error("notes field missing");
        field.scrollIntoView = () => {
          field.dataset.scrollCalls = String(
            Number(field.dataset.scrollCalls ?? "0") + 1,
          );
        };
        field.focus();
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          get: () => 500,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect(panel).toHaveAttribute("data-keyboard-open", "");
      await expect
        .poll(() =>
          panel.evaluate((element) =>
            element.style.getPropertyValue("--guest-sheet-keyboard"),
          ),
        )
        .toBe("344px");
      await expect
        .poll(() => field.getAttribute("data-scroll-calls"))
        .toBe("1");

      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          get: () => 844,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect(panel).not.toHaveAttribute("data-keyboard-open");
      await expect
        .poll(() =>
          panel.evaluate((element) =>
            element.style.getPropertyValue("--guest-sheet-keyboard"),
          ),
        )
        .toBe("0px");

      await page
        .locator(
          `[data-household-id="${openSeatFixture.id}"] [data-admin-edit]`,
        )
        .first()
        .evaluate((link: HTMLAnchorElement) => link.click());
      await expect(
        page.locator("[data-edit-household] input[name='id']"),
      ).toHaveValue(openSeatFixture.id);
      const swappedPanel = page.locator(".admin_guests_panel");
      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          get: () => 500,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect(swappedPanel).toHaveAttribute("data-keyboard-open", "");

      const errors: Error[] = [];
      page.on("pageerror", (error) => errors.push(error));
      await page
        .locator(".admin-drawer_scrim")
        .evaluate((scrim: HTMLElement) => scrim.click());
      await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(errors).toEqual([]);

      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          get: () => 844,
        });
      });
      await page.locator(".admin_guests_add").click();
      const laterPanel = page.locator(".admin_guests_panel");
      await expect(laterPanel).not.toHaveAttribute("data-keyboard-open");
      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          get: () => 500,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect(laterPanel).toHaveAttribute("data-keyboard-open", "");
    },
  );

  test(
    "does not track the keyboard at desktop widths",
    { tag: ["@single"] },
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/admin/guests?edit=${editor.id}`);
      const panel = page.locator(".admin_guests_panel");
      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          get: () => 500,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect(panel).not.toHaveAttribute("data-keyboard-open");
    },
  );

  test(
    "docks the drawer from 64rem and is a full-width sheet below it",
    { tag: ["@single"] },
    async ({ page }) => {
      for (const [width, height, docked] of [
        [639, 800, false],
        [640, 800, false],
        [768, 1024, false],
        [1023, 800, false],
        [1024, 800, true],
        [1440, 900, true],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto("/admin/guests?new=1");
        const panel = page.locator(".admin_guests_panel");
        await expect(panel).toBeVisible();
        // The slide-in settles before the box is read.
        await expect
          .poll(async () => (await panel.boundingBox())?.x, {
            message: `${width}px panel position`,
          })
          .toBe(docked ? width - 600 : 0);
        const box = (await panel.boundingBox())!;
        expect(box.width).toBe(docked ? 600 : width);
        expect(box.x + box.width).toBe(width);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(overflow).toBe(false);
      }
    },
  );

  test(
    "animates the drawer out and replaces it cleanly while closing",
    { tag: ["@single"] },
    async ({ page }) => {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/admin/guests");
        await page.locator(".admin_guests_add").click();
        await expect(page.locator(".admin_guests_panel")).toBeVisible();
        const state = await page.evaluate(() => {
          const opener = document.querySelector<HTMLElement>(".admin_guests_add");
          const drawer = document.querySelector<HTMLElement>("[data-admin-drawer]");
          if (!opener || !drawer) throw new Error("drawer not ready");
          drawer
            .querySelector<HTMLElement>("[data-admin-drawer-close], .admin-drawer_scrim")
            ?.click();
          return {
            closing: drawer.hasAttribute("data-closing"),
            inert: drawer.inert,
            focused: document.activeElement === opener,
          };
        });
        expect(state).toEqual({ closing: true, inert: true, focused: true });
        await expect
          .poll(() => page.locator("[data-admin-drawer]").count(), { timeout: 1_000 })
          .toBe(0);

        await page.goto("/admin/guests");
        await page.locator(".admin_guests_add").click();
        await expect(page.locator("[data-admin-drawer]")).toBeVisible();
        await page.evaluate(() => {
          document.querySelector<HTMLElement>("[data-admin-drawer-close]")?.click();
          document.querySelector<HTMLElement>(".admin_guests_add")?.click();
        });
        await expect(page.locator("[data-admin-drawer]")).toHaveCount(1);
        await expect(
          page.locator("[data-admin-drawer]:not([data-closing])"),
        ).toHaveCount(1);
        // Past the closing drawer's 300ms fallback: its timer must not unlock
        // the page under the new drawer (wall clock, L-009).
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
        await expect(page.locator("[data-admin-drawer]:not([data-closing])")).toHaveCount(1);
        await expect(page.locator("html")).toHaveAttribute("data-admin-drawer-open", "");
      }
    },
  );

  // The panel's perceptible animations by the clock (L-009, L-026): the
  // entrance of a drawer the page just rendered, or the exit once it closes.
  const drawerMotion = (page: Page) =>
    page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".admin_guests_panel");
      const scrim = document.querySelector<HTMLElement>(".admin-drawer_scrim");
      if (!panel || !scrim) throw new Error("drawer missing");
      const perceptible = (el: HTMLElement) =>
        el
          .getAnimations()
          .map((animation) => {
            const timing = (animation.effect as KeyframeEffect).getComputedTiming();
            return {
              name: (animation as CSSAnimation).animationName,
              ms: Number(timing.duration) + Number(timing.delay),
            };
          })
          .filter((animation) => animation.ms > 1);
      const box = panel.getBoundingClientRect();
      return {
        panel: perceptible(panel),
        scrim: perceptible(scrim),
        panelName: getComputedStyle(panel).animationName,
        right: box.right,
        top: box.top,
        width: innerWidth,
      };
    });

  const closeDrawer = (page: Page) =>
    page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>("[data-admin-drawer]");
      const panel = document.querySelector<HTMLElement>(".admin_guests_panel");
      if (!drawer || !panel) throw new Error("drawer missing");
      drawer.querySelector<HTMLElement>(".admin-drawer_scrim")?.click();
      return panel
        .getAnimations()
        .map((animation) => ({
          name: (animation as CSSAnimation).animationName,
          ms: Number(
            (animation.effect as KeyframeEffect).getComputedTiming().duration,
          ),
        }));
    });

  test(
    "shows a re-rendered drawer in place and still slides out when it closes",
    { tag: ["@single"] },
    async ({ page }) => {
      page.on("dialog", (dialog) => void dialog.accept());
      for (const width of [390, 1440]) {
        const docked = width >= 1024;
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/admin/guests");

        // Opened by a click, the drawer still slides in (280ms phone, 240ms docked).
        const entrance = await page.evaluate(
          () =>
            new Promise<{ name: string; ms: number }[]>((resolve) => {
              document.querySelector<HTMLElement>(".admin_guests_add")?.click();
              const read = () => {
                const panel = document.querySelector<HTMLElement>(".admin_guests_panel");
                if (!panel) return requestAnimationFrame(read);
                resolve(
                  panel.getAnimations().map((animation) => ({
                    name: (animation as CSSAnimation).animationName,
                    ms: Number(
                      (animation.effect as KeyframeEffect).getComputedTiming().duration,
                    ),
                  })),
                );
              };
              read();
            }),
        );
        expect(entrance).toEqual([
          { name: docked ? "admin-drawer-in" : "admin-drawer-up", ms: docked ? 240 : 280 },
        ]);
        await expect(page.locator("[data-admin-drawer-settled]")).toHaveCount(0);

        // An empty invitation name is refused: the server renders the same drawer again.
        for (const save of ["save_and_add", "save"]) {
          await page.goto("/admin/guests?new=1");
          const form = page.locator("[data-new-household]");
          await (save === "save_and_add"
            ? form.locator("button[name='save_and_add']:visible")
            : form.getByRole("button", { name: "Save", exact: true })
          ).click();
          await expect(page.locator("[data-admin-write-error]")).toBeVisible();
          await expect(page.locator("[data-admin-drawer-settled]")).toHaveCount(1);
          const settled = await drawerMotion(page);
          expect(settled.panel).toEqual([]);
          expect(settled.scrim).toEqual([]);
          expect(settled.panelName).toBe("none");
          if (docked) expect(Math.round(settled.right)).toBe(settled.width);
          else expect(Math.round(settled.top)).toBe(0);
        }

        // The same for an edit form refused with an empty invitation name.
        await page.goto(`/admin/guests?edit=${editor.id}`);
        await page.locator("[name='display_name']").fill("");
        await page
          .locator("[data-edit-household]")
          .getByRole("button", { name: "Save", exact: true })
          .click();
        await expect(page.locator("[data-admin-write-error]")).toBeVisible();
        const edit = await drawerMotion(page);
        expect(edit.panel).toEqual([]);
        expect(edit.scrim).toEqual([]);

        // The redirect after Save and add another continues the open drawer.
        await page.goto("/admin/guests?new=1&added=Someone");
        await expect(page.locator("[data-admin-added]")).toBeVisible();
        const added = await drawerMotion(page);
        expect(added.panel).toEqual([]);
        expect(added.scrim).toEqual([]);

        // A settled drawer still plays its 180ms exit.
        const exit = await closeDrawer(page);
        expect(exit).toEqual([
          { name: docked ? "admin-drawer-out" : "admin-drawer-down", ms: 180 },
        ]);
      }
    },
  );

  test(
    "the phone sheet pins the header and footer and scrolls only the body",
    { tag: ["@single"] },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/admin/guests?new=1");
      const panel = page.locator(".admin_guests_panel");
      const scroll = page.locator(".admin_guests_drawer_scroll");
      const footer = page.locator(".admin_guests_drawer_footer");
      const names = page.locator("[data-add-name]");
      for (const name of [
        "Sheet Guest One",
        "Sheet Guest Two",
        "Sheet Guest Three",
        "Sheet Guest Four",
        "Sheet Guest Five",
        "Sheet Guest Six",
        "Sheet Guest Seven",
        "Sheet Guest Eight",
      ]) {
        await names.fill(name);
        await names.press("Enter");
      }
      await expect(page.locator("[data-name-chip]")).toHaveCount(8);
      // The chips can be ready while the sheet is still sliding up.
      await expect
        .poll(async () => (await panel.boundingBox())?.y, {
          message: "phone sheet reaches the top of the viewport",
        })
        .toBe(0);
      expect(
        await scroll.evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);

      const inside = async (selector: string) => {
        const box = (await page.locator(selector).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        expect(box.height).toBeGreaterThanOrEqual(48);
      };
      await inside(".admin_guests_drawer_footer > a[data-admin-drawer-close]");
      await inside(".admin_guests_drawer_footer > button.primary");
      const footerBox = (await footer.boundingBox())!;
      expect(Math.abs(footerBox.y + footerBox.height - 844)).toBeLessThanOrEqual(
        6,
      );
      // The page behind the sheet does not scroll.
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).overflow,
        ),
      ).toBe("hidden");

      await expect(
        page.locator(".admin-drawer_top a[data-admin-drawer-close]"),
      ).toBeHidden();
      await expect(
        panel.locator(".admin-drawer_top .admin_label"),
      ).toBeVisible();
      const title = page.locator("#admin-drawer-title");
      expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
        "36px",
      );
      const smallInputs = await panel.evaluate((element) =>
        [...element.querySelectorAll<HTMLElement>("input, textarea")]
          .filter((el) => (el as HTMLInputElement).type !== "hidden")
          .map((el) => parseFloat(getComputedStyle(el).fontSize))
          .filter((size) => size < 16),
      );
      expect(smallInputs).toEqual([]);

      // Save and add another ends the body; the footer drops it.
      await expect(
        footer.locator("button[name='save_and_add']:visible"),
      ).toBeHidden();
      await expect(footer.locator("a.accent")).toHaveCount(0);
      await expect(
        page.locator(".admin_guests_footer_hint"),
      ).toBeHidden();
      const bodyCopy = scroll.locator("button[name='save_and_add']:visible");
      await bodyCopy.scrollIntoViewIfNeeded();
      await expect(bodyCopy).toBeVisible();
      const copyBox = (await bodyCopy.boundingBox())!;
      expect(copyBox.height).toBeGreaterThanOrEqual(48);
      expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(
        (await footer.boundingBox())!.y + 1,
      );
      // The header stays put while the body scrolls under it.
      const titleBefore = (await title.boundingBox())!.y;
      await scroll.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      expect(Math.abs((await title.boundingBox())!.y - titleBefore)).toBe(0);

      await page.goto(`/admin/guests?edit=${editor.id}`);
      const editScroll = page.locator(".admin_guests_drawer_scroll");
      const archive = editScroll.locator("a[href*='archive=']:visible");
      await archive.scrollIntoViewIfNeeded();
      await expect(archive).toBeVisible();
      await expect(
        page.locator(".admin_guests_drawer_footer a.accent"),
      ).toBeHidden();
      await expect(
        page.locator(".admin_guests_drawer_footer > button.primary"),
      ).toBeVisible();
      await expect(
        page.locator(".admin_guests_drawer_footer > a[data-admin-drawer-close]"),
      ).toBeVisible();
    },
  );

  test(
    "the phone sheet footer sits on the keyboard and the header stays",
    { tag: ["@single"] },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/admin/guests?new=1");
      const panel = page.locator(".admin_guests_panel");
      const footer = page.locator(".admin_guests_drawer_footer");
      const names = page.locator("[data-add-name]");
      await names.focus();
      await expect(page.locator(".admin_guests_name_tip")).toBeVisible();
      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          get: () => 844 - 291,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect(panel).toHaveAttribute("data-keyboard-open", "");
      await expect
        .poll(async () => {
          const box = (await footer.boundingBox())!;
          return Math.abs(box.y + box.height - (844 - 291));
        })
        .toBeLessThanOrEqual(6);
      await expect(page.locator("#admin-drawer-title")).toBeVisible();
      await expect(
        panel.locator(".admin-drawer_top .admin_label"),
      ).toBeVisible();
      await expect(names).toBeInViewport();
      const padding = await footer.evaluate(
        (el) => getComputedStyle(el).paddingBottom,
      );
      expect(padding).toBe("12px");

      await page.evaluate(() => {
        const viewport = window.visualViewport;
        if (!viewport) throw new Error("visualViewport missing");
        Object.defineProperty(viewport, "height", {
          configurable: true,
          get: () => 844,
        });
        viewport.dispatchEvent(new Event("resize"));
      });
      await expect(panel).not.toHaveAttribute("data-keyboard-open");
      await expect
        .poll(async () => {
          const box = (await footer.boundingBox())!;
          return Math.round(box.y + box.height);
        })
        .toBe(844);
    },
  );

  test("opens add and edit drawers without reloading and traps focus", async ({
    page,
  }) => {
    await page.goto("/admin/guests?filter=waiting&q=editor");
    const add = page.locator(".admin_guests_add");
    await add.click();
    await expect(page.locator("[data-new-household]")).toBeVisible();
    await expect(page).toHaveURL(
      /(?=.*new=1)(?=.*filter=waiting)(?=.*q=editor)/,
    );
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-admin-drawer]")
              ?.contains(document.activeElement),
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-admin-drawer]")
              ?.contains(document.activeElement),
          ),
        ),
      )
      .toBe(true);
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/filter=waiting.*q=editor/);
    await expect(add).toBeFocused();

    await add.click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-admin-drawer]")
              ?.contains(document.activeElement),
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            document
              .querySelector("[data-admin-drawer]")
              ?.contains(document.activeElement),
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    await expect(add).toBeFocused();

    const row = rowById(page, editor.id);
    await row.locator("summary").click();
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("[data-edit-household]")).toBeVisible();
    await page.goBack();
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
  });

  test("guards dirty guest drawer exits and keeps dismissed edits", async ({
    page,
  }) => {
    const message = "Discard your changes to this household?";
    await page.goto(`/admin/guests?edit=${editor.id}`);
    const edit = page.locator("[data-edit-household]");
    const name = edit.locator("[name='display_name']");
    await name.fill("Changed for the guest guard test");
    const dialogs: string[] = [];
    const dismiss = async (dialog: import("@playwright/test").Dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    };
    page.on("dialog", dismiss);
    await page.keyboard.press("Escape");
    await expect(edit).toBeVisible();
    await expect(name).toHaveValue("Changed for the guest guard test");
    await expect(page).toHaveURL(new RegExp(`edit=${editor.id}`));
    expect(dialogs).toEqual([message]);
    page.off("dialog", dismiss);

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe(message);
      void dialog.dismiss();
    });
    // The header × on the docked drawer; the phone sheet has Cancel instead.
    await edit.locator("[data-admin-drawer-close]:visible").first().click();
    await expect(edit).toBeVisible();
    await expect(name).toHaveValue("Changed for the guest guard test");

    await page.goto("/admin/guests");
    const row = rowById(page, editor.id);
    await row.locator("summary").click();
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    const backEdit = page.locator("[data-edit-household]");
    const backName = backEdit.locator("[name='display_name']");
    await backName.fill("Kept after guest Back");
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe(message);
      void dialog.dismiss();
    });
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`edit=${editor.id}`));
    await expect(backEdit).toBeVisible();
    await expect(backName).toHaveValue("Kept after guest Back");
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe(message);
      void dialog.accept();
    });
    await page.goBack();
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
  });

  test("guards a dirty add scrim and allows clean direct and swapped drawers", async ({
    page,
  }) => {
    await page.goto("/admin/guests?new=1");
    const add = page.locator("[data-new-household]");
    await add.locator("[data-add-name]").fill("Chip Guard");
    await add.locator("[data-add-name]").press("Enter");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Discard your changes to this household?");
      await dialog.dismiss();
    });
    // On the phone layout the sheet covers most of the scrim, so a pointer
    // click can land on the panel; click the scrim from script instead.
    await page
      .locator(".admin-drawer_scrim")
      .evaluate((scrim: HTMLElement) => scrim.click());
    await expect(add).toBeVisible();
    await expect(add.locator("[data-name-chip]")).toContainText("Chip Guard");

    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .locator(".admin-drawer_scrim")
      .evaluate((scrim: HTMLElement) => scrim.click());
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);

    let unexpected = 0;
    const recordUnexpected = async (
      dialog: import("@playwright/test").Dialog,
    ) => {
      unexpected += 1;
      await dialog.dismiss();
    };
    page.on("dialog", recordUnexpected);
    await page.goto("/admin/guests?new=1");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    await page.goto("/admin/guests");
    await page.locator(".admin_guests_add").click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    const row = rowById(page, editor.id);
    await row.locator("summary").click();
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("[data-admin-drawer] h2")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
    expect(unexpected).toBe(0);
    page.off("dialog", recordUnexpected);
  });

  test("asks once before a dirty dashboard navigation", async ({ page }) => {
    await page.goto(`/admin/guests?edit=${editor.id}`);
    await page
      .locator("[data-edit-household] [name='notes']")
      .fill("Leave guard");
    const types: string[] = [];
    const accept = async (dialog: import("@playwright/test").Dialog) => {
      types.push(dialog.type());
      await dialog.accept();
    };
    page.on("dialog", accept);
    try {
      await page
        .locator('[data-admin-nav] a[href="/admin"]')
        .evaluate((link: HTMLAnchorElement) => link.click());
      await expect(page).toHaveURL(/\/admin$/);
      expect(types).toEqual(["confirm"]);
    } finally {
      page.off("dialog", accept);
    }
  });

  test("a clean edit of a household sharing a name closes without asking", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const add = page.locator("[data-new-household]");
      await add.locator("[data-add-name]").fill(`Lead ${surname}`);
      await add.locator("[data-add-name]").press("Enter");
      // A made-up name the fake store already has, saved with Add anyway.
      await add.locator("[data-add-name]").fill("Antonio Santos");
      await add.locator("[data-add-name]").press("Enter");
      await add.locator("[data-confirm-duplicate]").click();
      await add.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(row).toHaveCount(1);
      const id = await row.getAttribute("data-household-id");

      let dialogs = 0;
      const unexpected = async (dialog: import("@playwright/test").Dialog) => {
        dialogs += 1;
        await dialog.dismiss();
      };
      page.on("dialog", unexpected);
      try {
        await page.goto(`/admin/guests?edit=${id}`);
        const drawer = page.locator("[data-admin-drawer]");
        await expect(drawer.locator("h2")).toBeFocused();
        // The script shows the shared-name warning; that alone is no change.
        await expect(drawer.locator("[data-duplicate-warning]")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        expect(dialogs).toBe(0);
      } finally {
        page.off("dialog", unexpected);
      }

      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await saved.locator("summary").click();
      await saved.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });

  test("guards Archive household and warns on reload after a drawer swap", async ({
    page,
  }) => {
    await page.goto(`/admin/guests?edit=${editor.id}`);
    const drawer = page.locator("[data-admin-drawer]");
    await expect(drawer.locator("h2")).toBeFocused();
    await drawer.locator("[name='notes']").fill("Swap guard");

    // Archive household is a full navigation: dismissing keeps the draft.
    page.once("dialog", (dialog) => dialog.dismiss());
    await drawer.locator("a[href*='archive=']:visible").click();
    await expect(page).toHaveURL(new RegExp(`edit=${editor.id}`));
    await expect(drawer.locator("[name='notes']")).toHaveValue("Swap guard");

    // OK on a row link swaps the drawer in place; the scrim covers the list,
    // so click from script.
    const types: string[] = [];
    page.once("dialog", async (dialog) => {
      types.push(dialog.type());
      await dialog.accept();
    });
    await rowById(page, openSeatFixture.id)
      .locator("[data-admin-edit]")
      .first()
      .evaluate((link: HTMLAnchorElement) => link.click());
    await expect(drawer.locator("input[name='id']")).toHaveValue(
      openSeatFixture.id,
    );
    expect(types).toEqual(["confirm"]);

    // A stepper change fires no input event; reload must still warn.
    await drawer.locator("summary").filter({ hasText: "More seats" }).click();
    await drawer.locator("[data-seat-plus]").click();
    const unload = page.waitForEvent("dialog");
    void page.evaluate(() => location.reload()).catch(() => {});
    const dialog = await unload;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await expect(drawer.locator("input[name='id']")).toHaveValue(
      openSeatFixture.id,
    );
  });

  test("secondary guest actions do not prompt", async ({ page, browser }) => {
    let dialogs = 0;
    const unexpected = async (dialog: import("@playwright/test").Dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    };
    page.on("dialog", unexpected);

    await page.goto("/admin/guests?new=1");
    const add = page.locator("[data-new-household]");
    await add.locator("[data-add-name]").fill("Secondary Guest");
    await add.locator("[data-add-name]").press("Enter");
    await add.locator("[data-plus-one-toggle]").click();
    await add.locator("summary").filter({ hasText: "More seats" }).click();
    await add.locator("[data-seat-plus]").click();
    await add.locator("[data-add-name]").fill("Antonio Santos");
    await add.locator("[data-add-name]").press("Enter");
    await expect(add.locator("[data-duplicate-warning]")).toBeVisible();
    await add.locator("[data-confirm-duplicate]").click();
    await expect(add.locator("[data-duplicate-warning]")).toBeHidden();

    const editPage = await browser.newPage();
    editPage.on("dialog", unexpected);
    await editPage.goto(`/admin/guests?edit=${openSeatFixture.id}`);
    const edit = editPage.locator("[data-edit-household]");
    await edit.locator("[data-remove-open-seat]").click();
    // The edit form is dirty now, so leaving this page would rightly warn
    // (beforeunload). Tick Archive on a fresh page instead.
    const archivePage = await browser.newPage();
    archivePage.on("dialog", unexpected);
    await archivePage.goto(`/admin/guests?edit=${editor.id}`);
    await archivePage
      .locator("[data-edit-household] [data-archive-seat]")
      .first()
      .check();
    expect(dialogs).toBe(0);
    editPage.off("dialog", unexpected);
    archivePage.off("dialog", unexpected);
    await archivePage.close();
    await editPage.close({ runBeforeUnload: false });
    page.off("dialog", unexpected);
  });

  test("shows Saving without a guard and restores on bfcache", async ({
    page,
  }) => {
    await page.goto("/admin/guests?new=1");
    const form = page.locator("[data-new-household]");
    await form.locator("[data-add-name]").fill("Pending Save Guest");
    await page.evaluate(() => {
      document
        .querySelector("[data-admin-household-form]")
        ?.addEventListener("submit", (event) => event.preventDefault());
    });
    let dialogs = 0;
    page.on("dialog", async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    const save = form.locator("button.primary");
    // The footer's copy, and the one the phone sheet shows at the end of the
    // body: Saving… disables both.
    const saveAndAdd = form.locator(
      ".admin_guests_drawer_footer button[name='save_and_add']",
    );
    const bodySaveAndAdd = form.locator(
      ".admin_guests_sheet_actions button[name='save_and_add']",
    );
    const saveLabel = await save.textContent();
    const saveAndAddLabel = await saveAndAdd.textContent();
    const bodySaveAndAddLabel = await bodySaveAndAdd.textContent();
    await save.click();
    await expect(save).toBeDisabled();
    await expect(saveAndAdd).toBeDisabled();
    await expect(bodySaveAndAdd).toBeDisabled();
    await expect(save).toHaveText(/Saving/);
    await expect(saveAndAdd).toHaveText(saveAndAddLabel!);
    await expect(bodySaveAndAdd).toHaveText(bodySaveAndAddLabel!);
    await expect(form.locator("button[name='save']")).toHaveCount(2);
    await expect(form.locator("[data-admin-submit-mirror]")).toHaveCount(1);
    expect(dialogs).toBe(0);

    await page.evaluate(() => {
      const event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    });
    await expect(save).toBeEnabled();
    await expect(saveAndAdd).toBeEnabled();
    await expect(bodySaveAndAdd).toBeEnabled();
    await expect(save).toHaveText(saveLabel!);
    await expect(saveAndAdd).toHaveText(saveAndAddLabel!);
    await expect(bodySaveAndAdd).toHaveText(bodySaveAndAddLabel!);
    await expect(form.locator("[data-admin-submit-mirror]")).toHaveCount(0);
  });

  test("refused guest saves leave the re-rendered drawer guarded", async ({
    browser,
  }, testInfo) => {
    await withAdminLock(async () => {
      const page = await browser.newPage();
      const other = await browser.newPage();
      const surname = uniqueSurname(testInfo);
      const name = `Guarded ${surname}`;
      await page.goto(`/admin/guests?new=1&q=${surname}`);
      await page.locator("[data-new-household] [data-add-name]").fill(name);
      await page
        .locator("[data-new-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      const created = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(created).toHaveCount(1);
      const id = await created.getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}&q=guarded-stale`);
      await other.goto(`/admin/guests?edit=${id}&q=guarded-stale`);
      await other
        .locator("[data-edit-household] [name='notes']")
        .fill("Fresh lock");
      await other
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(other).toHaveURL(/q=guarded-stale/);
      const form = page.locator("[data-edit-household]");
      await form.locator("[name='display_name']").fill("Refused draft");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(form.locator("[data-admin-write-error]")).toBeVisible();
      let dialogs = 0;
      page.once("dialog", async (dialog) => {
        dialogs += 1;
        expect(dialog.message()).toBe(
          "Discard your changes to this household?",
        );
        await dialog.dismiss();
      });
      await page.keyboard.press("Escape");
      await expect(form).toBeVisible();
      expect(dialogs).toBe(1);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await saved.locator("summary").click();
      await saved.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await other.close();
      await page.close();
    });
  });

  test("updates archived-seat feedback and saves the matching count", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `First ${surname}`;
    const second = `Second ${surname}`;
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const add = page.locator("[data-new-household]");
      await add.locator("[data-add-name]").fill(first);
      await add.locator("[data-add-name]").press("Enter");
      await add.locator("[data-add-name]").fill(second);
      await add.locator("[data-add-name]").press("Enter");
      await add.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(row).toHaveCount(1);
      const id = await row.getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await edit.locator("[data-archive-seat]").last().check();
      // The summary is separate spans, so textContent reads "1seat· 1 name…".
      await expect(edit.locator("[data-seat-summary]")).toHaveText(
        /^\s*1\s*seat\b/,
      );
      await expect(edit.locator("[data-preview-admits]")).toHaveText(
        "Admits 1",
      );
      await expect(edit.locator("[name='display_name']")).toHaveValue(first);
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expectRsvpSeatCount(row, 1);

      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await saved.locator("summary").click();
      await saved.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });

  test("saves a pending typed guest name with Save", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const name = `Pending ${surname}`;
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      await form.locator("[data-add-name]").fill(name);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(row).toHaveCount(1);
      await expect(row.locator("[data-col='members']")).toContainText(name);
      await row.locator("summary").click();
      await row.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });

  test("supports chips, plus-one parsing, switch, seats, suggestion and save-and-add", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `Rowan ${surname}`;
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?new=1&filter=waiting&q=${surname}`);
      const form = page.locator("[data-new-household]");
      // A new household's one seat is for its first name, not a plus-one.
      await expect(form.locator("[data-plus-one-toggle]")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(form.locator("[data-seat-summary]")).toContainText(
        "0 names + 0 plus-ones",
      );
      const name = form.locator("[data-add-name]");
      await name.fill(`  Rowan   ${surname} `);
      await name.press("Enter");
      await expect(form.locator("[data-name-chip]")).toHaveCount(1);
      await name.fill("+1");
      await name.press("Enter");
      await expect(form.locator("[data-seat-summary]")).toContainText(
        "1 plus-one",
      );
      await form.locator("[data-plus-one-toggle]").click();
      await expect(form.locator("[data-seat-summary]")).toContainText(
        "0 plus-one",
      );
      await form.locator("[data-plus-one-toggle]").click();
      await form.locator("summary").filter({ hasText: "More seats" }).click();
      await form.locator("[data-seat-plus]").click();
      await expect(form.locator("[data-seat-output]")).toHaveText("3");
      const invitation = form.locator("[name='display_name']");
      await expect(invitation).toHaveValue(first);
      await invitation.fill("A different invitation");
      await expect(form.locator("[data-invitation-hint]")).toContainText(
        "Your own",
      );
      await form.locator("[data-restore-suggestion]").click();
      await expect(invitation).toHaveValue(first);
      await form.locator("[name='member_input']").fill(`Sage ${surname}`);
      await form.locator("button[name='save_and_add']:visible").click();
      await expect(page).toHaveURL(
        new RegExp(`(?=.*new=1)(?=.*filter=waiting)(?=.*q=${surname})`),
      );
      await expect(page.locator("[data-admin-added]")).toContainText("Added");
      await expect(
        page
          .locator("[data-admin-household]")
          .filter({ hasText: `Sage ${surname}` }),
      ).toHaveCount(1);

      // Archive what the test added: other specs count the active households.
      await page.goto(`/admin/guests?filter=waiting&q=${surname}`);
      // The suggestion follows the names, so find the row by its surname.
      const added = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await added.locator("summary").click();
      await added.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });

  test("shows duplicate warning with open and confirm actions", async ({
    page,
  }) => {
    await page.goto("/admin/guests?new=1");
    const form = page.locator("[data-new-household]");
    await form.locator("[data-add-name]").fill("Antonio Santos");
    await form.locator("[data-add-name]").press("Enter");
    await expect(form.locator("[data-duplicate-warning]")).toBeVisible();
    await expect(form.locator("[data-duplicate-open]")).toHaveAttribute(
      "href",
      /edit=/,
    );
    await form.locator("[data-confirm-duplicate]").click();
    await expect(form.locator("[data-duplicate-warning]")).toBeHidden();
    await expect(form.locator("[data-name-chip]")).toContainText(
      "Antonio Santos",
    );
  });

  test("checks names outside the active filter", async ({ page }) => {
    await page.goto("/admin/guests?new=1&filter=waiting");
    const form = page.locator("[data-new-household]");
    await form.locator("[data-add-name]").fill("Kat Lim");
    await form.locator("[data-add-name]").press("Enter");
    await expect(form.locator("[data-duplicate-warning]")).toBeVisible();
    await expect(form.locator("[data-duplicate-message]")).toContainText(
      "Kat Lim",
    );
  });

  test("renders a named plus-one as a person and keeps it when turning plus-one off", async ({
    page,
  }) => {
    await page.goto(`/admin/guests?edit=hh-lim`);
    const form = page.locator("[data-edit-household]");
    const named = form.locator("[data-seat-kind='plus_one']").filter({
      hasText: "Jonas Ong",
    });
    await expect(named).toHaveCount(1);
    await expect(named.locator("[data-remove-open-seat]")).toHaveCount(0);
    await expect(named).toContainText("+1 · named by Kat");
    await expect(form.locator("[data-seat-summary]")).toContainText(
      "2 names + 0",
    );
    // The suggestion is built from the invited members only.
    await expect(form.locator("[data-restore-suggestion]")).not.toContainText(
      "Jonas",
    );
    // Edit hides the switch (Admin 12 has none); its handler still guards
    // named plus-ones, so drive it directly.
    const toggle = form.locator("[data-plus-one-toggle]");
    await toggle.evaluate((button: HTMLButtonElement) => button.click());
    await toggle.evaluate((button: HTMLButtonElement) => button.click());
    await expect(form.locator("[data-seat-kind='plus_one']")).toContainText(
      "Jonas Ong",
    );
    await expect(form.locator("[data-seat-summary]")).toContainText(
      "2 names + 0",
    );
  });

  test("pressing Enter in the invitation name saves add and edit", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?new=1&q=${surname}`);
      const addForm = page.locator("[data-new-household]");
      await addForm.locator("[data-add-name]").fill(`Enter ${surname}`);
      await addForm.locator("[data-add-name]").press("Enter");
      await addForm
        .locator("[name='display_name']")
        .fill(`Enter invite ${surname}`);
      await addForm.locator("[name='display_name']").press("Enter");
      await expect(page).toHaveURL(new RegExp(`q=${surname}`));
      const added = page.locator("[data-admin-household]").filter({
        hasText: `Enter ${surname}`,
      });
      await expectRsvpSeatCount(added, 1);
      await expect(added).toContainText(`Enter invite ${surname}`);
      await added.locator("summary").click();
      await added.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();

      await page.goto(`/admin/guests?edit=${editor.id}&q=${surname}`);
      const editForm = page.locator("[data-edit-household]");
      const seatCount = await editForm.locator("[data-seat-row]").count();
      await editForm.locator("[name='display_name']").fill("Enter edit");
      await editForm.locator("[name='display_name']").press("Enter");
      await expect(page).toHaveURL(/q=/);
      const edited = rowById(page, editor.id);
      await expectRsvpSeatCount(edited, seatCount);
      await expect(edited).toContainText("Enter edit");
    });
  });

  test("keeps the stepper between one and twelve seats", async ({ page }) => {
    await page.goto("/admin/guests?new=1");
    const form = page.locator("[data-new-household]");
    await form.locator("summary").filter({ hasText: "More seats" }).click();
    await form.locator("[data-seat-minus]").click();
    await expect(form.locator("[data-seat-output]")).toHaveText("1");
    for (let index = 0; index < 15; index += 1)
      await form.locator("[data-seat-plus]").click();
    await expect(form.locator("[data-seat-output]")).toHaveText("12");
  });

  test("keeps rejected stale save and archive drafts in the drawer with Reload", async ({
    browser,
  }) => {
    await withAdminLock(async () => {
      const page = await browser.newPage();
      const other = await browser.newPage();
      await page.goto(`/admin/guests?edit=${editor.id}&filter=waiting&q=stale`);
      await other.goto(
        `/admin/guests?edit=${editor.id}&filter=waiting&q=stale`,
      );
      await other
        .locator("[data-edit-household] [name='notes']")
        .fill("Fresh edit");
      await other
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(other).toHaveURL(/filter=waiting.*q=stale/);
      const staleForm = page.locator("[data-edit-household]");
      await staleForm
        .locator("[name='display_name']")
        .fill("Stale typed value");
      await staleForm
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(staleForm.locator("[data-admin-write-error]")).toContainText(
        "Reload",
      );
      await expect(staleForm.locator("[name='display_name']")).toHaveValue(
        "Stale typed value",
      );
      await expect(
        staleForm.getByRole("link", { name: "Reload" }),
      ).toBeVisible();

      await page.goto(
        `/admin/guests?edit=${editor.id}&filter=waiting&q=stale-archive`,
      );
      await other.goto(
        `/admin/guests?edit=${editor.id}&filter=waiting&q=stale-archive`,
      );
      // Open the confirm first, then change the household elsewhere, so the
      // confirm's token is stale and the archive is refused.
      await page
        .locator("[data-edit-household]")
        .locator("a[href*='archive=']:visible")
        .click();
      await expect(page.locator("[data-admin-archive-confirm]")).toBeVisible();
      await other
        .locator("[data-edit-household] [name='notes']")
        .fill("Fresh archive edit");
      await other
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(other).toHaveURL(/q=stale-archive/);
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      // Archive household closes the drawer for #99's confirm row (until PR 4),
      // so a stale archive is refused with the page-level notice and Reload.
      await expect(page.locator("[data-admin-drawer]")).toHaveCount(0);
      await expect(page.locator("[data-admin-write-error]")).toContainText(
        "Reload",
      );
      await expect(page.locator("[data-admin-write-error] a")).toHaveText(
        "Reload",
      );
      await other.close();
      await page.close();
    });
  });

  test("supports edit archive undo, invited-name fix, add guest and open-seat removal", async ({
    page,
  }, testInfo) => {
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?edit=${editor.id}&filter=waiting&q=edit`);
      const form = page.locator("[data-edit-household]");
      const archive = form.locator("[data-archive-seat]").first();
      await archive.check();
      await expect(
        archive.locator("..").locator("[data-archive-label]"),
      ).toHaveText("Undo");
      await archive.uncheck();
      await form
        .locator("details.admin_guests_fix")
        .first()
        .locator("summary")
        .click();
      await expect(
        form.locator("input[name^='invited_name_']").first(),
      ).toBeVisible();
      const members = await form.locator("[data-seat-kind='member']").count();
      await form
        .locator("[name='member_input']")
        .fill(`Mina ${uniqueSurname(testInfo)}`);
      await form.locator("[name='member_input']").press("Enter");
      await expect(form.locator("[data-seat-kind='member']")).toHaveCount(
        members + 1,
      );
      await form.getByRole("button", { name: "Save" }).click();
      await expect(page).toHaveURL(/filter=waiting.*q=edit/);
    });
  });

  test("removes an unnamed open seat through the drawer", async ({ page }) => {
    await withAdminLock(async () => {
      await page.goto(`/admin/guests?edit=${openSeatFixture.id}`);
      const form = page.locator("[data-edit-household]");
      await form.locator("[data-remove-open-seat]").click();
      await form.getByRole("button", { name: "Save" }).click();
      const seats = rowById(page, openSeatFixture.id);
      await expectRsvpSeatCount(seats, 1);

      // Put the open seat back so the next project finds the fixture as it was.
      await page.goto(`/admin/guests?edit=${openSeatFixture.id}`);
      const again = page.locator("[data-edit-household]");
      await again.locator("[name='member_input']").fill("+1");
      await again.locator("[name='member_input']").press("Enter");
      await again.getByRole("button", { name: "Save" }).click();
      await expectRsvpSeatCount(seats, 2);
    });
  });

  test("removes an open seat without JavaScript, counting it once", async ({
    browser,
    page,
  }) => {
    await withAdminLock(async () => {
      const noJs = await browser.newPage({ javaScriptEnabled: false });
      await noJs.goto(`/admin/guests?edit=${openSeatFixture.id}`);
      const form = noJs.locator("[data-edit-household]");
      const openSeats = openSeatFixture.seats.filter(
        (seat) => seat.kind === "plus_one" && !seat.name,
      ).length;
      await expect(form.locator("button[name='remove_seat']")).toHaveCount(
        openSeats,
      );
      await form.locator("button[name='remove_seat']").first().click();
      // The round trip drops the row and carries the removal to Save.
      await expect(
        noJs.locator("[data-edit-household] button[name='remove_seat']"),
      ).toHaveCount(openSeats - 1);
      await expect(
        noJs.locator("[data-edit-household] input[name='removed_seat']"),
      ).toHaveCount(1);
      await noJs
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save" })
        .click();
      await expectRsvpSeatCount(
        rowById(noJs, openSeatFixture.id),
        openSeatFixture.seatCount - 1,
      );
      await noJs.close();

      // Put the open seat back so the next project finds the fixture as it was.
      await page.goto(`/admin/guests?edit=${openSeatFixture.id}`);
      const again = page.locator("[data-edit-household]");
      await again.locator("[name='member_input']").fill("+1");
      await again.locator("[name='member_input']").press("Enter");
      await again.getByRole("button", { name: "Save" }).click();
      await expectRsvpSeatCount(
        rowById(page, openSeatFixture.id),
        openSeatFixture.seatCount,
      );
    });
  });

  test("deep links render with JavaScript disabled and secondary actions are submits", async ({
    browser,
  }) => {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.goto(`/admin/guests?edit=${editor.id}&filter=waiting&q=nojs`);
    const form = page.locator("[data-edit-household]");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form.locator("button[name='seat_action']")).toHaveCount(2);
    await expect(form.locator("button[name='plus_one']")).toHaveCount(1);
    await expect(form.locator("button[name='remove_seat']")).toHaveCount(
      editor.seats.filter((seat) => seat.kind === "plus_one" && !seat.name)
        .length,
    );
    await expect(
      form.locator("details").filter({ hasText: "More seats" }),
    ).toHaveCount(1);
    await expect(
      form.locator("details").filter({ hasText: "Edit ID" }),
    ).toHaveCount(1);
    await page.close();
  });

  test("saves typed guest input without pressing Enter when JavaScript is disabled", async ({
    browser,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto(`/admin/guests?new=1&q=${surname}`);
      const form = page.locator("[data-new-household]");
      await form.locator("[data-add-name]").fill(`NoJS ${surname}`);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const added = page.locator("[data-admin-household]").filter({
        hasText: `NoJS ${surname}`,
      });
      await expect(added).toHaveCount(1);
      await expectRsvpSeatCount(added, 1);

      await added.locator("summary").click();
      await added.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page
          .locator("[data-admin-household]")
          .filter({ hasText: `NoJS ${surname}` }),
      ).toHaveCount(0);
      await page.close();
    });
  });

  test("keeps no-JS duplicate confirmation in the draft", async ({
    browser,
  }) => {
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      await form.locator("[data-add-name]").fill("Antonio Santos");
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await expect(form.locator("[data-duplicate-warning]")).toBeVisible();
      await form.getByRole("button", { name: "Add anyway" }).click();
      // The round trip keeps the confirmed name in the draft; Save then adds it.
      const draft = page.locator("[data-new-household]");
      await expect(draft.locator("[data-duplicate-warning]")).toBeHidden();
      await expect(draft.locator("input[name='confirmed_name']")).toHaveCount(
        1,
      );
      await draft.getByRole("button", { name: "Save", exact: true }).click();
      const added = page.locator("[data-admin-household]").filter({
        has: page.locator("[data-col='household']", {
          hasText: /^Antonio Santos/,
        }),
      });
      await expect(added).toHaveCount(1);
      await added.locator("summary").click();
      await added.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await page.close();
    });
  });
});

// L-053: every secondary submit without JavaScript ends in a real save, and
// the JS plus-one "off" drops open and draft-only seats. Each test adds its own
// household (unique surname) and archives it, so fixtures stay untouched.
test.describe("guest drawer round trips without JavaScript", () => {
  test.describe.configure({ mode: "serial" });

  const rowFor = (page: Page, text: string) =>
    page.locator("[data-admin-household]").filter({ hasText: text });

  const archiveRow = async (page: Page, text: string) => {
    await page.goto("/admin/guests");
    const row = rowFor(page, text);
    await row.locator("summary").click();
    await row.locator("a[href*='archive=']:visible").click();
    await page
      .locator("[data-admin-archive-confirm]")
      .getByRole("button", { name: "Archive" })
      .click();
    await expect(rowFor(page, text)).toHaveCount(0);
  };

  const addName = async (page: Page, name: string) => {
    const form = page.locator("[data-admin-household-form]");
    await form.locator("[name='member_input']").fill(name);
    await form.getByRole("button", { name: "Add", exact: true }).click();
  };

  test("plus-one switch and stepper floor save the seat count", async ({
    browser,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `Ilse ${surname}`;
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      // The stepper never goes below one seat, even with no names yet.
      await form.locator("summary").filter({ hasText: "More seats" }).click();
      await form.locator("[data-seat-minus]").click();
      await expect(
        page.locator("[data-new-household] [data-seat-number]"),
      ).toHaveText("1");
      await addName(page, first);
      const plusOne = () =>
        page.locator("[data-new-household] button[name='plus_one']");
      await plusOne().click();
      await expect(
        page.locator("[data-new-household] [data-seat-number]"),
      ).toHaveText("2");
      await plusOne().click();
      await expect(
        page.locator("[data-new-household] [data-seat-number]"),
      ).toHaveText("1");
      await plusOne().click();
      await page
        .locator("[data-new-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expectRsvpSeatCount(rowFor(page, surname), 2);

      // Edit: the stepper's "−" takes the open seat off and Save stores it.
      const id = await rowFor(page, surname).getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await edit.locator("summary").filter({ hasText: "More seats" }).click();
      await edit.locator("[data-seat-minus]").click();
      await expect(
        page.locator("[data-edit-household] [data-seat-number]"),
      ).toHaveText("1");
      await page
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expectRsvpSeatCount(rowFor(page, surname), 1);
      await archiveRow(page, surname);
      await page.close();
    });
  });

  test("adding names keeps the invitation name on the suggestion", async ({
    browser,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto("/admin/guests?new=1");
      await addName(page, `Ilse ${surname}`);
      await addName(page, `Otto ${surname}`);
      const form = page.locator("[data-new-household]");
      const suggestion = `${surname} Family`;
      await expect(form.locator("[name='display_name']")).toHaveValue(
        suggestion,
      );
      await expect(form.locator("[data-restore-suggestion]")).toBeHidden();
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        rowFor(page, surname).locator("[data-col='household']"),
      ).toContainText(suggestion);
      await archiveRow(page, surname);
      await page.close();
    });
  });

  test("archiving the last member then pressing − still saves the archive", async ({
    browser,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const kept = `Ilse ${surname}`;
    const archived = `Otto ${surname}`;
    await withAdminLock(async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      await page.goto("/admin/guests?new=1");
      await addName(page, kept);
      await addName(page, archived);
      await page
        .locator("[data-new-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      const id = await rowFor(page, surname).getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await edit.locator("[data-archive-seat]").last().check();
      await edit.locator("summary").filter({ hasText: "More seats" }).click();
      await edit.locator("[data-seat-minus]").click();
      // The round trip keeps the archive mark on the last member.
      await expect(
        page.locator("[data-edit-household] [data-archive-seat]").last(),
      ).toBeChecked();
      await page
        .locator("[data-edit-household]")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(page.locator("[data-admin-write-error]")).toHaveCount(0);
      const row = rowFor(page, surname);
      await expectRsvpSeatCount(row, 1);
      await expect(row.locator("[data-col='members']")).not.toContainText(
        "Otto",
      );
      await archiveRow(page, surname);
      await page.close();
    });
  });
});

test.describe("host ID from the invitation name", () => {
  test("follows the invitation name in add and keeps the ID in edit", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const slug = surname.toLowerCase();
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      for (const name of [`Ilse ${surname}`, `Otto ${surname}`]) {
        await form.locator("[data-add-name]").fill(name);
        await form.locator("[data-add-name]").press("Enter");
      }
      // "<S> Family" → "<s>"
      await expect(form.locator("[data-host-id]")).toHaveText(slug);
      await form.locator("[name='display_name']").fill(`Casa ${surname}`);
      await expect(form.locator("[data-host-id]")).toHaveText(`casa-${slug}`);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await expect(row.locator(".admin-guests_id")).toHaveText(`casa-${slug}`);

      // Renaming in edit keeps the ID.
      const id = await row.getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await edit.locator("[name='display_name']").fill(`Villa ${surname}`);
      await expect(edit.locator("[data-host-id]")).toHaveText(`casa-${slug}`);
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page
          .locator("[data-admin-household]")
          .filter({ hasText: surname })
          .locator(".admin-guests_id"),
      ).toHaveText(`casa-${slug}`);

      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: surname });
      await saved.locator("summary").click();
      await saved.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: surname }),
      ).toHaveCount(0);
    });
  });
});

test.describe("guest drawer plus-one off with JavaScript", () => {
  test("drops a saved open seat and a draft-only seat", async ({
    page,
  }, testInfo) => {
    const surname = uniqueSurname(testInfo);
    const first = `Ilse ${surname}`;
    await withAdminLock(async () => {
      await page.goto("/admin/guests?new=1");
      const form = page.locator("[data-new-household]");
      await form.locator("[data-add-name]").fill(first);
      await form.locator("[data-add-name]").press("Enter");
      await form.locator("[data-add-name]").fill("+1");
      await form.locator("[data-add-name]").press("Enter");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const row = page
        .locator("[data-admin-household]")
        .filter({ hasText: first });
      await expectRsvpSeatCount(row, 2);

      const id = await row.getAttribute("data-household-id");
      await page.goto(`/admin/guests?edit=${id}`);
      const edit = page.locator("[data-edit-household]");
      await expect(
        edit.locator("[data-seat-kind='plus_one'][data-seat-row]"),
      ).toHaveCount(1);
      // A draft-only seat from the stepper, then the switch off: both go.
      await edit.locator("summary").filter({ hasText: "More seats" }).click();
      await edit.locator("[data-seat-plus]").click();
      await expect(edit.locator("[data-seat-number]")).toHaveText("3");
      await edit
        .locator("[data-plus-one-toggle]")
        .evaluate((button: HTMLButtonElement) => button.click());
      await expect(edit.locator("[data-seat-number]")).toHaveText("1");
      await expect(edit.locator("input[name='removed_seat']")).toHaveCount(1);
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expectRsvpSeatCount(
        page.locator("[data-admin-household]").filter({ hasText: first }),
        1,
      );

      await page.goto("/admin/guests");
      const saved = page
        .locator("[data-admin-household]")
        .filter({ hasText: first });
      await saved.locator("summary").click();
      await saved.locator("a[href*='archive=']:visible").click();
      await page
        .locator("[data-admin-archive-confirm]")
        .getByRole("button", { name: "Archive" })
        .click();
      await expect(
        page.locator("[data-admin-household]").filter({ hasText: first }),
      ).toHaveCount(0);
    });
  });
});
