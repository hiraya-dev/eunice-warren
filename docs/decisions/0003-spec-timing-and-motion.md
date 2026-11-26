# 0003: Specs time motion by the clock and wait for things to settle

- **Status:** accepted
- **Date:** 2026-11-26

## Context

The Playwright suite runs on loaded CI runners, eight workers at a time. Headless
Chromium there delivers frames 40 to 67 ms apart, CI's Linux WebKit renders in
software and can stop answering for seconds, and a background tab freezes
`requestAnimationFrame`. The site animates a lot: a shared fade-in on every
section, drawers, a nav wipe, a music pill, ticket and record motion. Before ADR
0002 these rules were scattered through `tests/**` as comments citing lessons.
This ADR collects them.

## Decision

1. **The clock, not frames (L-009).** Motion is checked either by pausing a Web
   Animation and seeking `currentTime` at set times (`music.spec.ts` pill clip,
   ticker loop), or by sampling live playback over wall-clock time with
   `performance.now()` and bounding the change by elapsed time plus one capped
   frame (`music.spec.ts` ticker and playback rate, `wedding.spec.ts` autoplay
   progress over 500 ms, `playlist.spec.ts` record spin, where an 11.5° floor
   follows from 200°/s). Waits use `expect.poll` with a timeout
   (`gallery-teaser.spec.ts`), never a frame count. Playback is timed only once
   it has started advancing. A per-frame velocity (distance over one frame) is a
   frame assertion too (#152).
2. **Recording a whole transition.** When an assertion must hold at every moment
   of a short transition, the spec records every frame and asserts over all of
   them, because polling can step over a ~150 ms window. The click starts from
   inside the page, so the recording starts with the transition
   (`nav-scrollbar.spec.ts`).
3. **Read in the same turn as the action (L-060, L-055).** A style or animation
   that a click starts is read in the same `evaluate` as the click: popover
   origins and drawer transitions (`admin-guests.spec.ts`), the pill crossfade,
   and the 280 ms open read before a slow page lets it run out (`music.spec.ts`).
   Each drawer step waits for the drawer swap to land before the next key or
   click (`admin-rsvps.spec.ts`). Waits past a timer, such as the closing drawer's
   300 ms fallback, use wall-clock time (L-009). A flow a slow page can miss, such
   as the 3 s pill open and close, is recorded instead of polled.
4. **Reduced motion means nothing perceptible (L-026).** The site-wide rule in
   `src/styles/base.css` shortens transitions to 0.01 ms instead of removing them.
   Specs therefore count only animations whose duration plus delay is over 1 ms
   (`perceptible` in `admin-rsvps.spec.ts`, `gallery.spec.ts`, `music.spec.ts`,
   `stay.spec.ts`, `admin-guests.spec.ts`). Under reduced motion the pill's
   crossfade is a Web Animation, so it is read in the task that taps.
5. **Wait for the shared fade-in (L-029).** `src/scripts/fade-in.ts` keeps an
   item transparent, and 24px low, until its section is reached or focus enters
   it. Specs scroll there with `reveal()` (`tests/helpers/reveal.ts`) and wait
   for the rise to finish before measuring or clicking, or the click re-scrolls
   (`gallery.spec.ts`, `invitation.spec.ts`, `playlist.spec.ts`,
   `wedding.spec.ts`). Faded items stay in the tab order and the accessibility
   tree. `gallery-teaser.spec.ts` clicks mid-fade on purpose, to prove the button
   works during the reveal.
6. **Budgets for a busy runner (L-023).** The 0.8 s tween in `reveal()` gets a
   far longer timeout, because a page under eight workers can get a few frames a
   second. Specs that loop over many wheel or sample round trips raise their
   timeout (`ribbons.spec.ts`), WebKit guards that answer on a frame wait long and
   assert what they find (`music.spec.ts`), and `rsvp.spec.ts` marks the Garcia
   test `test.slow()`. An in-page cap may get a test-side backstop whose clock
   starts later (`ribbons.spec.ts`).
7. **Counting network work.** `route.continue()` resolves when the request is
   sent, not when it finishes. So `gallery.spec.ts` keeps each pre-open photo
   request in its set until the response body arrives, and counts only requests
   that start after the overlay opens.

## Consequences

- A new motion spec follows these rules, and its author proves it with
  `--repeat-each 20 --workers 8` or `flake-check.yml` (L-009 **Check**).
- Tests that cannot meet them yet are skipped with an issue, never with a comment:
  #153 (nav on Linux WebKit), #152 (ticket release velocity).
