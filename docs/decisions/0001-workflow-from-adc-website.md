# 0001: The agent workflow comes from adc-website

- **Status:** accepted; the CI test tiers amended 2026-11-13 (below)
- **Date:** 2026-11-13

## Context

This repository ran its agent workflow under Conductor: Conductor created each
workspace and ran `npm ci`, Claude reached Codex through a supervised `codex exec`
launcher (`scripts/codex/run-handoff.mjs`), Claude reviewed its own PRs inline, and
the full Playwright suite ran on the Mac before every commit.

The user moved to T3 Code and asked for the setup already running in adc-website,
adapted to this site: a personal project, close to a marketing site, with one page,
one production Worker, and an RSVP backend on a Google Sheet.

## Decision

Take adc-website's workflow, in three PRs:

1. **Host and safety.** T3 Code is the only host (`t3.json`). Codex runs through
   `delegate_task`. The `guard-git` and `guard-deps` hooks and `permissions.deny`
   enforce the Git traps. A lessons ledger (`.agents/lessons.md`) records what this
   repo has paid for. Skills live in `.agents/skills/`. `npm run prepush` is the
   only local gate; CI is the browser proof.
2. **Review pipeline.** A `pr-reviewer` subagent (Sonnet 5.5) reviews every PR in
   parallel with CI, with a Codex second opinion on risky PRs.
   `layout-implementer` (Sonnet 5.5) takes layout, CSS and animation, since it can
   build, run Playwright and check the browser. `runtime` changes stop for the
   user's Local review on the Cloudflare preview, then merge on "ship it". The
   vendored `copy-editing` skill edits copy against `.agents/product-marketing.md`.
3. **CI.** The workflow and docs checks, triggers and flake tooling follow adc.

Adapted rather than copied:

- **Squash merges**, not merge commits: one commit per PR on `main`. The hook allows
  only `--squash`.
- **One production Worker**, no staging or promotion: merging deploys production,
  and Claude confirms the build.
- **Previews run the fake store** (`wrangler.jsonc` `previews`), since previews share
  the Worker's secrets and would otherwise write to the guest sheet.
- `test:unit` (RSVP and With Love) runs in `prepush`.

Left out, as specific to adc-website's business site: Sanity and the Studio, the
staging and promotion flow and the `deploy` skill, Lighthouse budgets, Markdown
pages for AI agents, the scorecard and usage
reports, the issue tracker and triage labels, the marketing skills other than
`copy-editing`, and the Claude Code Bash sandbox (adc-website did not adopt it:
Playwright cannot run inside it).

### Amendment: test tiers (2026-11-13)

`select-specs`, the `@smoke` tier and `already-tested.mjs` were first left out, on the
grounds that this is one page and Actions minutes are free on a public repository.
That reasoning priced the wrong thing. The suite had grown to 326 test runs (two
projects) on one worker, so every `runtime` push waited about 13 minutes for `e2e`
(12m22s to 12m50s on #69, #70 and the push after #70), and the same tree ran again
on `main` after the merge. The cost is the user's waiting time, not minutes.

They are now ported, adapted:

- A draft runs the `@smoke` tier; marking it ready (or `ci:full`, a manual run, or
  an untested push to `main`) runs every test not tagged `@sweep` on two workers,
  plus the `@sweep` motion and geometry tests sharded two ways at one worker
  (`check:sweep-tags` keeps the tag and `SWEEP_SPECS` in step). adc runs its full
  tier on a promotion PR; this repository has no staging, so it runs on ready,
  before the merge that deploys production.
- `already-tested.mjs` accepts only a passed full-tier PR run, and proves the
  squash-merge commit's tree equals that run's head tree (adc proves a two-parent
  merge).
- `select-specs.mjs` maps section components, not routes, and widens to `broad` for
  any path it cannot map.
- `@single` tests skip the Pixel 7 project when they pin their own viewport and use
  no pointer or touch.
- CI retries a failed test once, not twice; `flaky-summary.mjs` still lists each
  test that passed only on its retry.

## Consequences

- Workflow fixes made in adc-website do not arrive here on their own; port them by
  hand when they apply.
- `guard-deps.mjs` and the `npm ci` step in `CLAUDE.md` **Git** stay until T3 runs
  its setup script on worktree creation (L-006).
- The full Playwright suite no longer runs on the Mac before a commit. A new or
  changed spec runs once, by its author, plus what `select-specs` picks.
- CI runs `@smoke` on each draft push and the full suite once, when the PR is
  marked ready. A regression outside the smoke tier surfaces at "ship it", not on
  the draft; a draft whose change is `broad` gets the `ci:full` label. The merge
  needs a green full-tier `gate`, so `main` gets the same proof as before.
- A test is tagged when it is written (`local-checks`), and a new spec is added to
  `SPEC_SOURCES` (`select-specs --check` in CI).
