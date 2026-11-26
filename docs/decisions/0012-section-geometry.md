# 0012: Geometry the gallery, attire, preloader and marquee depend on

- **Status:** accepted
- **Date:** 2026-11-26

## Context

Several sections hold measurements that only work together. Changing one value
alone breaks the layout or a loop. These rules lived in comments until ADR 0002.

## Decision

### Polaroids (`src/components/sections/Gallery.astro`, `src/scripts/gallery/*`)

- Borders are shares of the polaroid's own width: 6% left, right and top, and a
  deep bottom strip (20% in the popup). The photo window is 0.88W wide and 0.92W
  (portrait, 4:5) or 0.57W (landscape, 5:4) tall. CSS, the WebGL textures
  (`stamp-texture.ts`) and the popup (`overlay.ts`) use the same shares. The top
  border is a percentage margin, which resolves against width, so it matches the
  sides. `stamp-texture.ts` pads each texture with a transparent margin for the
  baked shadow; plane geometry includes it and projected source rects exclude it.
- Image widths per tier are about twice the largest rendered window.
- The popup's polaroid gets the height the count and controls leave, capped at 74%
  of the screen; `overlay.ts` reads the frame's resolved `max-height` as the space
  left.
- Open and close swap the WebGL mesh and the popup in the same task, drawing first,
  so no frame shows both or neither. A new navigation or close supersedes a running
  animation. If the sharp image fails, the decoded texture-sized image stays.
- Chunks next to each other move by at least eleven album positions, so their
  five-photo runs do not repeat; the coprime x stride visits every photo.
- `canvas.ts` keeps its MIT licence header: it ports Edoardo Lunardi's Infinite
  Canvas, and the licence requires the notice. Its comment baseline stays at 1.

### Attire notebook and clotheslines (`src/components/sections/Attire.astro`)

- The ruled lines and the writing share one pitch (`--_rule`). Every padding,
  margin, gap and line height inside the card is a whole number of rows, so each
  line box ends on a rule; the writing has no leading trim. A hand font's baseline
  sits above the bottom of its line box, so the text moves down by half a row,
  less the `--_*-k` em term, less the 1px rule.
- From 72rem there are two clotheslines (looks 1-4, then 5-7 centred). Narrower,
  cards would drop under about 220px, so they swipe instead. One list stays in the
  DOM; a 4-track grid holds line 1 and line 2 offsets each card by percentage
  margins. Sizes scale with `--_u` (1px at 1440, capped there). The motif colours
  are not site tokens on purpose.

### Preloader units (`src/components/global/Preloader.astro`)

- Every flat-lay length is a multiple of `--u` (1px at the 1440 artboard, 1px per
  px on a 390 phone); anchors are the nearest edges. Props show only where the
  free bands above and below the centre stack can hold them.
- The envelope picks its layout by its own width: the desktop face needs about
  44rem. `--c` is 1px at a 350px envelope and grows with it up to 40rem.
- The Turnstile widget's height is reserved from the start, so the prefetched
  iframe never moves the centred column (72px, also in `Rsvp.astro`).

### Marquee loop (`src/components/interactive/Marquee.astro`)

- Two panels and the gap between them, moved by exactly one panel and one gap,
  which lands the copy where the original began. A panel is never narrower than
  its strip, so the copy still covers the strip when the original leaves.
- The copy is server-rendered and kept out of the accessibility tree and tab
  order. Items keep a fixed height with the markup's ratio, so a loading image
  never changes the panel width (`--_item-height`). The pace is seconds per item,
  so any count keeps the same speed.
- Focus inside holds the track. Reduced motion holds it still; it runs only when
  the visitor starts it.

## Consequences

- A change to any value above checks the paired values named with it.
