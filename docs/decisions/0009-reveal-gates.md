# 0009: Reveals hide with opacity and open their pre-paint gate once tweens own the start

- **Status:** accepted
- **Date:** 2026-11-26

## Context

Scroll reveals (`src/scripts/fade-in.ts`), the hero entrance
(`src/components/sections/Hero.astro`), the preloader flat lay
(`src/components/global/Preloader.astro`), the gallery teaser
(`src/scripts/gallery/teaser.ts`) and the nav menu (`src/components/global/Nav.astro`)
hide content before it animates. Their rules lived in comments until ADR 0002.

## Decision

- **Opacity, not visibility.** `fade-in.ts` fades with `opacity` only. `autoAlpha`
  would add `visibility: hidden`, taking every link and button out of the tab
  order and the accessibility tree until the section is reached.
- **Focus finishes a reveal.** Focus landing on an item that has not revealed yet
  finishes the reveal at once, so a focus ring never sits on invisible content.
- **One piece.** An element with both `data-fade-in` and `data-fade-in-item` is its
  own trigger and item. Widgets that drive their own children (sliders, accordion,
  card) reveal that way.
- **The pre-paint gate opens after the tweens render.** `data-hero-motion` and
  `data-preloader-motion` hide content before the first paint. They are removed
  only after the `from()` tweens have rendered their hidden start state inline;
  earlier, the tweens would animate towards `visibility: hidden`.
- **Fail-safe.** If the preloader's motion module is slow or never runs, an inline
  script removes `data-preloader-motion` after 2 seconds. The entrance then skips,
  so nothing hides and replays. The hero entrance never runs under reduced motion,
  where the hero is already visible.
- **Preloader order.** Props enter by `data-depth`, lowest first; equal depths keep
  their paint order. Pointer drift stops as soon as the close starts; the exit is
  CSS (`.is-closing`).
- **Teaser order.** Near tier first, far last; inside a tier, nearest the section's
  centre first. Each polaroid starts a few degrees past its slot's resting tilt.
  The slot owns position, resting `rotate`, opacity and the parallax `translate`;
  the polaroid owns the reveal and clears it when it finishes. Parallax stops
  while the fullscreen overlay is open.
- **Test bypass.** `localStorage["ew-test-skip-preloader"] = "1"` skips the
  preloader for Playwright (`src/components/utility/BaseHead.astro`). Real guest
  storage never sets it.

## Consequences

- A new reveal keeps its content focusable while hidden.
- A new pre-paint gate is removed only after its tweens render.
