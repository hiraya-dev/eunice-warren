# Agent notes — Eunice Warren (Astro)

This repo is the Eunice Warren site, built with Astro. Designs live in Paper; the
repository owns everything that ships. See `README.md` for the app overview.

## Your role

Claude orchestrates this project and owns design reading, browser QA, and Git. You
own repository code.

```
Claude: classify → branch → delegate → wait → validate → commit → push → PR
Codex:  inspect → implement → add tests → report
```

You implement Astro pages, layouts and components, styles, client scripts,
content-collection schemas, utilities, tests, build config, refactors, and bug fixes
— anything with logic in it. Purely mechanical edits (copy, content entries with no
schema change, token values) go to a Haiku subagent instead, so a handoff you receive
is expected to need real implementation.
You cannot see the Paper designs — Claude puts the values you need (tokens, spacing,
type, breakpoints, asset paths) in the handoff. If a task needs a design decision the
handoff does not contain, report `BLOCKED` with the question rather than guessing.

**You do not touch Git.** Your sandbox mounts `.git` read-only, so writes fail with
`could not lock config file .git/config: Operation not permitted`. Do not create a
branch, commit, push, or open a PR. Leave your work uncommitted in the working tree
and report it; Claude reviews the diff, runs the remaining checks, and takes it from
there.

Claude sends work through `skills/codex-handoff/SKILL.md`. That handoff carries the
task, acceptance criteria, branch name, and the report format to return. Follow it.

## Models

Claude Opus is the orchestrator, planner, reviewer, and merger. Haiku subagents
handle read-only lookups and mechanical edits that have no logic in them; everything
with logic comes to you. Every Codex task uses `gpt-5.6-luna`. The sandbox sets the boundary: a task that modifies repository
files uses the workspace-write sandbox; read-only, non-intensive inspection, summaries,
inventory, and log triage use the read-only sandbox. A read-only task never expands
into file changes: if it finds a mutation is needed, recommend it so Claude can start
a fresh workspace-write task or resume the branch's existing session.

## Skills

Before doing related work, check `skills/` for a relevant `SKILL.md` and follow it.
Start with `skills/README.md` for the index and conventions. Component conventions
are in `skills/astro-component/SKILL.md`.

When a bug is reported, follow `skills/fix-bug/SKILL.md`.

## Lumos for Astro

The site is built on **Lumos for Astro** (version and commit in `package.json` under
`lumos`), an Astro component framework styled with plain CSS and custom properties.
Do not apply conventions from **Lumos for Webflow**. Read `LUMOS.md` before adding a
page, component, or style: compose pages from the existing components in
`src/components/`, and add CSS only through the checklist there.

Lumos ships its own skills in `.agents/skills/`: `lumos-audit-props`,
`lumos-scaling-graphic`, and `lumos-upgrade-version`. They are linked into
`skills/` so both agents find them. The Figma and Webflow import skills were removed
because the designs live in Paper.

Read the relevant [Astro documentation](https://docs.astro.build) guide before
routing, components, framework islands, content collections, styling, or i18n work.

## Validation

Run `npm run check` and `npm run build` whenever a change touches `src/**`,
`public/**`, `package.json`, the lockfile, `astro.config.*`, or `tsconfig.json`. Run
`npm run test:routing` whenever it touches `scripts/ci/**`, and
`npm run test:codex-handoff` whenever it touches `scripts/codex/**`. These work in
your sandbox.

Write or update Playwright specs, but do not run `npm run test:e2e`, `npm run dev`,
or `npm run preview`: each binds a port and your sandbox refuses with `EPERM`.
Claude runs the suite.

Do not `npm install`: your sandbox has no network. Claude installs any dependency the
task needs before the handoff. If you find you need one that is not installed, report
`BLOCKED` with the package name.

Never claim a check passed unless it ran. If a check cannot run, say why.

Codex self-validation is evidence for Claude's review, never merge authorization.

## Git

Claude prepares the branch before handing work to you and owns every Git operation
after it. You work in the tree you are given.

If no task branch exists yet, stop and report that the implementation needs one —
do not create one.

After implementing:

1. Review your own diff.
2. Remove debug and temporary code.
3. Return control to Claude with the report from the handoff skill.

Keep the change to one logical unit. Preserve any unrelated uncommitted changes
already in the working tree — never discard them.

- Never write to `.git`: no branch, no commit, no push, no PR.
- Never continue working in the background after you have returned a result. A late
  write into a shared checkout overwrites whatever Claude did in the meantime.

### Bug fixes

Bug fixes use `fix/` branches and follow `skills/fix-bug/SKILL.md`. The short form:

- Reproduce or confirm the bug before changing anything.
- Keep the branch to the one bug — no unrelated refactors or cleanup.
- Add a regression test whenever the bug can be reproduced in automation. It should
  fail against the broken behavior and pass after the fix — Claude confirms both, since
  you cannot run the suite.
- Run `npm run check` and `npm run build` and report only checks that actually ran.
- The fix is not done until it meets the acceptance criteria; never hide or skip a
  failing test.
- For a scroll-driven or animated bug, sample per animation frame during real
  continuous motion. Reading a settled position passes on a broken animation.

### Client-side behavior

- Prefer zero JavaScript: static Astro markup and CSS first, a client script or
  island only when behavior needs it.
- Clean up listeners, observers, and animations you create; guard against duplicate
  initialization (including across view transitions, if enabled).
- Respect `prefers-reduced-motion`.
- Verify behavior during continuous motion, not only at settled positions.
