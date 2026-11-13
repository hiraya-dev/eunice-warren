# Eunice & Warren

The wedding site for Eunice and Warren — 14 January 2027, Boracay, Philippines.
It carries the invitation, schedule, travel and stay details, entourage, and the
RSVP flow. Designs live in Paper; this repository owns everything that ships.

Built with [Astro](https://astro.build) on
[Lumos for Astro](https://lumosframework.com) (version in `package.json` under
`lumos`). Read `LUMOS.md` before adding a page, component, or style. Hosted on
Cloudflare Workers: `wrangler.jsonc` configures the Worker that serves the build and
runs the RSVP, song and With Love actions (`docs/rsvp-backend.md`). Workers Builds
deploys `main` to production.

Agent workflow: `CLAUDE.md`, `AGENTS.md`, `.agents/skills/` and `.agents/lessons.md`,
run from T3 Code (`t3.json`). How it is set up: `SETUP.md`.

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
| `npm run test:unit` | Runs the RSVP and With Love unit tests |
| `npm run prepush` | The local gate before every push: lessons, script and hook tests, unit tests, Markdown lint, type-check |
| `npm run test:ci-scripts` | Tests the CI path classifier |
| `npm run test:hooks` | Tests the Claude Code hooks and the lessons tooling |

## License

The Lumos for Astro framework code is MIT licensed; see `LICENSE`.
