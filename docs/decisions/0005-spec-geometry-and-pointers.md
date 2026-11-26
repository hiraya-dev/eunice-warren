# 0005: Specs measure in the element's own frame and press like a guest

- **Status:** accepted
- **Date:** 2026-11-26

## Context

Much of the site is rotated paper: tickets, postcards, polaroids, notebook and
attire cards. Layouts swap at `rem` breakpoints, and fixed bars, scrims and
sheets cover each other. Viewport boxes from `getBoundingClientRect` therefore
lie about layout, and a pointer click can land on the wrong layer. Before ADR 0002
the rules lived as comments in the specs.

## Decision

1. **Measure in the element's own frame (L-035).** A rotated element is measured
   with layout values (`offsetTop`, `offsetLeft`, `offsetWidth`) or in the card's
   own frame, never by viewport boxes (`attire.spec.ts` notebook rules,
   `explore.spec.ts` sticker, `invitation.spec.ts` ticket, `music.spec.ts` ticker
   card, `playlist.spec.ts` postcard inputs, `rsvp.spec.ts` field positions).
   Layout shift is read from a fixed, stable frame: `preloader.spec.ts` measures
   from the overlay, not the centred form. Layout offsets round to whole pixels
   while transforms do not.
2. **Sweep the breakpoints (L-018).** Overflow is judged against the page itself.
   The widths include the odd ones around each swap: the guest and song tables at
   84rem (1344px), the sidebar at 64rem (`admin.spec.ts`), the menu that sits
   absolutely at the cell edge from 1344px (`admin-guests.spec.ts`), and a window
   just above the envelope's phone breakpoint (`preloader.spec.ts`).
3. **Escapes keep their test.** A spec that guards a bug the user found keeps the
   worst case that failed: the longest greeting that wrapped to 3 lines on the
   phone (#96, `admin.spec.ts`), the label flush against the button (#82,
   `rsvp-paths.spec.ts`), and the global `svg { max-width: 100% }` that capped the
   clothesline (`attire.spec.ts`).
4. **Reserved space is measured on production.** The Turnstile widget box is 72px
   (a 65px iframe plus its wrapper, measured at 390×844). `preloader.spec.ts` and
   `rsvp.spec.ts` assert that nothing moves when it appears, in a window tall
   enough that the column is centred.
5. **Tolerances are design facts.** The hand font's line box differs by a few px
   across platforms (6px still fails the old arrow), Paper centres the hero text
   about 20px under the section centre (`hero.spec.ts`), and the faint postmark
   sits in the gap between entourage rows by design (`entourage.spec.ts`).
6. **Press what a guest could press.** A spec clicks from script only when a
   covering layer makes a real pointer land elsewhere: the scrim under a phone
   sheet, a row link under the scrim, the sidebar under a drawer
   (`admin-guests.spec.ts`, `admin-rsvps.spec.ts`). A hidden control's handler is
   driven directly only to prove its guard. Playwright scrolls a button to the
   centre before clicking, so `music.spec.ts` uses a viewport tall enough that
   this scroll does not dock the polaroid. Headless Chromium hides scrollbars, so
   `nav-scrollbar.spec.ts` shows them to test the scroll lock's padding.
   Focus-wrap loops stop after the candidate count plus one (L-050).

## Consequences

- A new layout spec on rotated or covered UI follows these rules. A tolerance it
  adds says where the number comes from, here or in the test name, never in a
  comment.
