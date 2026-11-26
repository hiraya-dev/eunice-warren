# 0005: How the music player moves, hides and scrolls its title

- **Status:** accepted
- **Date:** 2026-11-26

## Context

The background music player (`src/components/global/BackgroundMusic.astro`,
`src/scripts/music-teleport.ts`) lives in two places and must never cover a
control. Its rules lived in comments until ADR 0002.

## Decision

### Two homes

- The song has two homes: the polaroid in the hero (desktop) and the luggage tag
  docked bottom-right. `data-music-docked` on the container is the state signal;
  while a flight runs, `data-music-flying` keeps both homes visible. The two cards
  never share an element, and the `<audio>` is never touched.
- From 64rem up, scroll drives it: past the polaroid the tag takes its place with
  a Flip, and scrolling back reverses it. Below 64rem the tag is docked from the
  start.
- The card flies in from the tag, which can sit outside the hero's box and behind
  its text, so the hero's overflow opens for the flight only. Contents arrive once
  the paper has its shape, so they never show squashed.
- Reduced motion swaps the Flip for a 150ms crossfade. The site-wide
  reduced-motion rule makes every CSS transition instant from an earlier cascade
  layer that a component cannot lift, so the crossfade is a Web Animation. The pill
  still crossfades in under reduced motion; nothing wipes, slides, presses or spins.

### Staying off controls

- `watchBand` keeps the docked tag off a control. It watches a target against the
  tag's band at the bottom of the viewport (tag height + bottom offset + 16) and
  sets one hide-reason attribute per watcher, so reasons never fight. One
  `IntersectionObserver` with the band as its root margin, rebuilt on resize;
  nothing reads layout on scroll. `below` also counts a target still below the
  fold. The band follows what the player covers now: the tag, the phone disc, or
  the open pill.
- On a phone the tag steps aside while the hero's CTA group is in its band (or
  still below it), and returns once it has scrolled above.
- The pill never opens where a control sits in its band: it would hide the whole
  player a frame later, so it stays a disc.
- The tag hides as soon as a form field takes focus, but returns only once no
  pointer is down, and in a new task after the release. Pressing a button blurs
  the field before the release; a tag that came back in between would take the
  release and the button would never get its click. Visibility waits for the
  fade; clicks never do.

### The title ticker

- A title that overflows its box scrolls as a ticker: two copies side by side,
  the track slides left by exactly one copy and repeats. The script sets
  `data-ticker` while the title overflows and `--ticker-duration` from its
  measured length, so the speed is the same for any title. It re-measures on
  resize and font load, leaving out the padding the running ticker adds so the
  verdict is the same either way. Reduced motion keeps the ellipsis, and a surface
  that is off screen holds its title still.
- The shadow is a `filter` on a shell around the paper, since `clip-path` would cut
  a `box-shadow` off. Only `transform`, `opacity` and `clip-path` animate.

## Consequences

- A new fixed control near the bottom edge gets a `watchBand` reason.
- `tests/music.spec.ts` covers the hide and return timing.
