# Astro Component

How pages and components are built in this repo, and how Claude turns a Paper design
into a handoff Codex can implement without seeing Paper.

## From Paper — Claude

Paper is the design source. Codex cannot see it, so Claude reads it and writes the
values into the handoff's **Relevant context**.

1. Load the Paper guide once per session (`get_guide`, topic
   `paper-mcp-instructions`), then `get_basic_info` for the file's artboards.
2. Find the artboard for each breakpoint the task covers. Read structure with
   `get_tree_summary` / `get_children`, and exact values with `get_computed_styles`
   and `get_jsx`. **Never read sizes or colours off a screenshot.**
3. Map every value to a design token in `src/styles/` (colour, type scale, spacing,
   radius). Use the token name in the handoff, not the raw value. A value with no
   token is a finding: either it is a one-off (say so) or the token set needs a new
   entry (make that its own step in the task).
4. Export images and icons with `get_fill_image` / `export` into `src/assets/`
   (processed by `astro:assets`) or `public/` (served as-is), and list the paths.
5. Take one `get_screenshot` per artboard and save it under `.context/` for the
   visual comparison after implementation.

Claude does not edit the Paper file unless the task asks for it.

## Conventions — Codex

- **Zero JS by default.** Static `.astro` markup and CSS first. Add a `<script>` or a
  framework island only for behavior that needs it, and choose the laziest
  `client:*` directive that works (`client:visible` over `client:load`).
- **Tokens, not values.** Colours, type, spacing, and radii come from the tokens in
  `src/styles/`. A raw hex or px in a component needs a reason in the PR.
- **Images** go through `astro:assets` (`<Image>` / `<Picture>`) with explicit
  dimensions or aspect ratio, so nothing shifts on load.
- **Components** live in `src/components/`, one per file, props typed with an
  `interface Props`. Layouts in `src/layouts/`, routes in `src/pages/`.
- **Content** with a shape (posts, projects, testimonials) uses a content collection
  with a schema, not hand-written arrays in pages.
- **Client scripts** guard against running twice, clean up what they create, and
  re-initialise correctly if view transitions are enabled
  (`astro:page-load` / `astro:before-swap`).
- **Motion** respects `prefers-reduced-motion`, animates `transform` and `opacity`,
  and is verified during continuous motion, not only at rest.
- **Accessibility**: semantic elements, visible focus, alt text that describes the
  image's purpose, sufficient contrast.

## Tests

Each component with behavior gets a Playwright spec in `tests/`. Static components
get a spec when they have responsive behavior worth pinning (a layout change at a
breakpoint). Specs run against the production build served by `astro preview` — see
`playwright.config.ts`.

## Verifying against the design — Claude

After CI is green, open the page at each artboard's width and compare with the saved
Paper screenshot. Report differences as findings with numbers (measured px or
computed style vs. the Paper value), not impressions.
