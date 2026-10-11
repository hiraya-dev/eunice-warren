# Eunice & Warren

The wedding site for Eunice and Warren — 14 January 2027, Boracay, Philippines.
It carries the invitation, schedule, travel and stay details, entourage, and the
RSVP flow. Designs live in Paper; this repository owns everything that ships.

Built with [Astro](https://astro.build) on
[Lumos for Astro](https://lumosframework.com) (version in `package.json` under
`lumos`). Read `LUMOS.md` before adding a page, component, or style. Hosted on
Cloudflare: `wrangler.jsonc` deploys the build as an assets-only Worker.

Agent workflow: `CLAUDE.md`, `AGENTS.md`, and `skills/`. How it was installed:
`SETUP.md`.

## Scripts

Node 22.19 or newer is required.

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the dev server |
| `npm run build` | Builds the site to `dist/` |
| `npm run preview` | Serves the built site |
| `npm run check` | Type-checks every `.astro` file |
| `npm run format` | Formats the project with Prettier |
| `npm run test:e2e` | Builds, serves, and runs the Playwright suite in `tests/` |
| `npm run test:e2e:install` | Installs Playwright's Chromium (once per machine) |
| `npm run test:routing` | Tests the CI path classifier |
| `npm run test:codex-handoff` | Tests the Codex launcher |

## License

The Lumos for Astro framework code is MIT licensed; see `LICENSE`.
