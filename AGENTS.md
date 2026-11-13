# Lumos for Astro — Eunice Warren

This is the Eunice Warren wedding site, built on **Lumos for Astro** (version and
commit in `package.json` under `lumos`), an Astro component framework styled with
plain CSS and custom properties. Do not apply conventions from **Lumos for
Webflow**. Project conventions live in `LUMOS.md` and `.agents/skills/`. See
`README.md` for the app overview.

## Development

Claude runs the dev server, in background mode. Codex cannot: its sandbox refuses
to bind a port (see **Codex: your role**).

```
astro dev --background
```

Use `astro dev stop`, `astro dev status`, and `astro dev logs` to manage it. Copy
`.dev.vars.example` to `.dev.vars` first (T3's `setup` script does it) so the RSVP,
song and With Love actions use the fake store. The user can also start `dev` (hot
reload) or `preview` (a fake-store production build) from T3 Code's scripts menu
(`t3.json`, Astro's default port or the next free one).

## Astro documentation

Use the relevant [Astro documentation](https://docs.astro.build) before working
on these areas:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Actions](https://docs.astro.build/en/guides/actions/)

## Building

Read [LUMOS.md](LUMOS.md) before adding a page, component, or style: compose the
page from the existing components in `src/components/`, and add CSS only through
the checklist there. Every section gets an `id`.

The RSVP, song and With Love features run as Astro actions in the Cloudflare
Worker, against a Google Sheet in production and a fake store everywhere else
(`docs/rsvp-backend.md`). Keep guest data out of the repository and the client
bundle; fixtures are fictional.

## Skills

Task-specific procedures live in `.agents/skills/<name>/SKILL.md`, alongside
any scripts they need.

- `astro-component` — how Claude reads Paper into a handoff, and the component,
  image, content and client-script conventions.
- `codex-handoff` — how Claude hands code to Codex, and the report Codex returns.
- `local-checks` — the checks Claude runs before every commit and push.
- `review-pr` — the review, merge, and deploy check for every PR.
- `fix-bug` — reproduce, fix, and gate a reported bug.
- `lumos-audit-props` — check prop order and tooltip consistency.
- `lumos-scaling-graphic` — build an editable graphic that scales as one piece.
- `lumos-upgrade-version` — upgrade Lumos without losing customizations.

`.agents/skills/` is the source of truth. Claude Code loads the same skills from
relative symlinks in `.claude/skills/`. For each new skill, add
`.claude/skills/<name>` pointing to `../../.agents/skills/<name>`.

- Codex: use `$lumos-audit-props` or ask for the skill by name. Restart Codex
  if a new skill does not appear.
- Claude Code: use `/lumos-audit-props` or let it load the skill when relevant.

## Codex: your role

Claude orchestrates this project and owns design reading, building, browser QA, and
Git. You (Codex) own repository code that has logic in it. `CLAUDE.md` holds the full
workflow.

```
Claude: classify → approve → delegate → wait → validate → commit → PR → review → merge
Codex:  inspect → implement → add tests → report
```

You implement sections and components, client scripts and animation, the RSVP, song
and With Love actions, content schemas, utilities, tests, build config, scripts and
CI, refactors, and bug fixes that need a root cause. Claude makes purely mechanical
edits itself, so a handoff you receive is expected to need real implementation.

You cannot see the Paper designs. Claude puts the values you need (tokens, spacing,
type, breakpoints, asset paths) in the handoff. If a task needs a design decision
the handoff does not contain, report `NEEDS_DESIGN_INPUT` with the question rather
than guessing.

Claude sends work through `.agents/skills/codex-handoff/SKILL.md`. That handoff
carries the task, acceptance criteria, branch name, and the report format to return.
Follow it. Before related work, read the relevant `SKILL.md` in `.agents/skills/`;
for a bug, follow `.agents/skills/fix-bug/SKILL.md`.

### Lessons

`.agents/lessons.md` records mistakes this repo has already paid for, each with a
rule and a check. Before implementing, read the entries whose **Paths** match the
files you will touch, and follow their rules. The handoff quotes the matching ones,
but the ledger is the source. If a lesson conflicts with the handoff, say so under
**RISKS / NOTES** rather than silently picking one. Do not edit the ledger; Claude
maintains it.

### What your sandbox cannot do

Claude reaches you through T3 Code's `delegate_task`. It runs you in a
`workspace-write` sandbox (measured 2026-10-26; table in
`.agents/skills/codex-handoff/references/codex-sandbox.md`):

- **Git writes fail** (`could not lock config file .git/config: Operation not
  permitted`). Do not create a branch, commit, push, or open a PR. Leave your work
  uncommitted in the working tree and report it.
- **Binding a port fails** (`EPERM`). So `npm run build` fails too: Astro's fonts
  API binds a local server during the build. Do not run `npm run build`,
  `npm run test:e2e`, `npm run dev`, `npm run preview`, or `astro dev`. Claude runs
  them.
- **There is no network.** Do not `npm install`. Claude installs any dependency the
  task needs before the handoff. If you need one that is not installed, report
  `BLOCKED` with the package name.

### Validation

- Run `npm run check` whenever a change touches `src/**`, `public/**`,
  `package.json`, the lockfile, `astro.config.*`, or `tsconfig.json`.
- Run `npm run test:unit` whenever it touches `src/lib/**`, `src/actions/**`,
  `src/pages/api/**`, or a `tests/*-unit.test.ts` file.
- Run `npm run test:ci-scripts` whenever it touches `scripts/ci/**`, and
  `npm run test:hooks` whenever it touches `scripts/hooks/**` or
  `scripts/lessons/**`.
- Write or update Playwright specs in `tests/`, but do not run them.
- Never claim a check passed unless it ran. If a check cannot run, say why.
- Your self-validation is evidence for the review, never merge authorization.

### Git

Claude has the task branch checked out before handing work to you, and owns
every Git operation after it. If no task branch is checked out, stop and report it.

After implementing:

1. Review your own diff.
2. Remove debug and temporary code.
3. Return control to Claude with the report from the handoff skill.

Keep the change to one logical unit. Preserve any unrelated uncommitted changes
already in the working tree; never discard them. Never continue working in the
background after you have returned a result: a late write into a shared checkout
overwrites whatever Claude did in the meantime.

### Bug fixes

Follow `.agents/skills/fix-bug/SKILL.md`. Work from the reproduction Claude puts in
the handoff, state the root cause before the fix, keep the change to the one bug,
and write a regression spec that fails on the broken behavior; Claude confirms it
fails on `main` and passes on the branch, since you cannot run it.

### Client-side behavior

- Prefer zero JavaScript: static Astro markup and CSS first, a client script or
  island only when behavior needs it.
- Clean up listeners, observers, and animations you create; guard against duplicate
  initialization.
- Respect `prefers-reduced-motion`.
- Animation uses GSAP. Keep per-frame work inside the frame budget (L-011), and
  write motion specs that time assertions by the clock, not by frames (L-009).
- Verify behavior during continuous motion, not only at settled positions.
