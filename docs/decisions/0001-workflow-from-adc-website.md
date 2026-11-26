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

## CI jobs and routes (2026-11-26)

Moved here from the comments in `.github/workflows/ci.yml`,
`.github/workflows/flake-check.yml`, `scripts/ci/*.mjs` and
`.markdownlint-cli2.jsonc` (ADR 0002). The workflow files carry no comments; this
section is why they are shaped the way they are.

### Routes (`scripts/ci/classify-paths.mjs`)

| Route | Paths | `ci.yml` jobs |
| --- | --- | --- |
| `runtime` | `src`, `public`, `tests`, `RUNTIME_FILES`, and any unknown path (fails closed) | `build`, `e2e`; `sweeps` and `webkit` on the full tier |
| `content` | only `src/content/**/*.json` (`isContentData`) | `build`, `e2e`, smoke tier on every event |
| `workflow` | `WORKFLOW_FILES`, `WORKFLOW_DIRECTORIES` | `checks` with the workflow steps |
| `docs` | other `.md`, `DOCS_FILES`, `.DS_Store` | `checks`, Markdown lint and `check:comments` only |

- Runtime is checked first, so Markdown under `src/` (content collections) routes
  `runtime`: the build renders it.
- `content` is still runtime underneath, so `build` and `e2e` run. Anything else in
  the diff, an image or a schema included, makes it plain `runtime`. The schemas in
  `src/content.config.ts` reject a bad file at build time, and specs never pin site
  copy (L-017), so the smoke tier is enough and the PR merges with no Local review
  (`CLAUDE.md` **Roles**).
- Agent instructions and agent tooling config are operational code, so they route
  `workflow`: `.mcp.json` wires tools into every session, `t3.json` runs setup
  scripts, the lessons ledger is read as rules and validated by
  `scripts/lessons/select.mjs --check`, and `skills-lock.json` is the manifest for
  vendored skills. Skills live in `.agents/skills`, linked into `.claude/skills`.
- `.conductor`, `scripts/codex` and `skills` were retired with the move to T3 Code
  (2026-11-13). They stay in `WORKFLOW_DIRECTORIES` so a deletion, or a stray
  re-add, routes `workflow` instead of `runtime`.

### Tiers (the `classify` job)

- **Changed files.** A pull request diffs its base; a manual run lists the whole
  tree, so it tests everything; a push diffs `before`, or the parent commit when a
  new branch or a force-push left `before` unreachable, or the whole tree for a
  root commit.
- **Tier.** A content diff is smoke on every event, and this check comes before
  the event and draft checks, so neither a ready PR nor a push to `main` promotes it
  (`ci-triggers.test.mjs` pins the order). A push or manual run is full, a ready PR
  is full, and a draft is smoke unless labelled `ci:full`. Labels are read from the
  API, not the event payload, so adding `ci:full` and rerunning picks the label up.
  The API call stands on its own line, so an API error fails the step instead of
  reading as "no label".
- **Ready supersedes draft.** `pull_request` also triggers on `ready_for_review`,
  and `cancel-in-progress` cancels the draft's run on the same head, so the head's
  last `gate` is the full tier's.
- **Already tested.** A push to `main` whose tree a full-tier PR run already passed
  skips every check (`scripts/ci/already-tested.mjs`). It fails closed: any doubt
  or error leaves `tested=false`. It counts only a passed `gate` on a full-tier run,
  because a run whose jobs all skip still concludes success.
- **Playwright image.** The e2e container tag is read from `package-lock.json`,
  which `npm ci` installs, so the image's browsers always match
  `@playwright/test`. The `e2e` job checks the two agree. `flake-check.yml` reads it
  the same way.

### Jobs

- **`build`** runs the production build (top-level `wrangler.jsonc` vars, no fake
  store), which the e2e job's fake-store build does not cover, plus the checks that
  need `node_modules` and no browser. It also runs `select-specs --check`, since a
  runtime-only PR can add a spec.
- **`e2e`** runs in the Playwright image at two workers on the runner's four vCPUs.
  `--ipc=host` because Chromium runs out of shared memory in Docker's default 64 MB
  `/dev/shm`. Its `[[ ]]` steps set `shell: bash`, because the container's default
  shell is `sh`. The job name carries the tier (`e2e (full)`, `e2e (smoke)`), so the
  merge rule and `already-tested.mjs` can tell a full run from a smoke run. The smoke
  tier runs only the two Chromium projects.
- **`sweeps`** runs the `@sweep` motion and geometry tests, sharded two ways at the
  config's one worker each: they are load-sensitive, so shards add machines, not
  workers. Full tier only.
- **`webkit`** runs the `@smoke` tests on WebKit, full tier only, at one worker in a
  container of its own. WebKit on the Linux runner renders in software: sharing the
  `e2e` container with two Chromium workers starved it of frames (4–15 s between
  paints), and actionability waits and key presses timed out (#75).
- **Flaky tests.** CI retries once, so a test that passes only on its retry is
  flaky. `scripts/ci/flaky-summary.mjs` lists each one in the job summary and as a
  warning, so flakes are counted, not absorbed by a green run (L-009, L-010).
- **`checks`** is one short job for docs and workflow changes. Its npm scripts run
  plain Node, so it needs no `npm ci`. It checks out full history
  (`fetch-depth: 0`) because `check:lessons` compares the ledger with `origin/main`
  and its merge-base.
- **`gate`** always runs and fails closed: a selected job that was skipped, failed
  or cancelled fails it, and so does a classification that selects no route.
- CI never deploys: Workers Builds deploys `main` to production.

### `flake-check.yml`

Proves a spec stable under load, or reproduces a load flake, on a runner instead of
the user's Mac (L-009, L-010). Run it by hand:

```bash
gh workflow run flake-check.yml --ref <branch> -f grep='<test title or spec file name>' -f repeat=20
```

- `grep` matches the title path, which starts at the spec file name: pass
  `footer.spec.ts`, not `tests/footer.spec.ts`.
- It runs in the CI image at four workers on four vCPUs, with no retries, so a
  flake fails the run instead of being absorbed. It gates nothing and never runs on
  its own.
- Inputs reach the script through `env`, never inline, so a pattern with shell
  syntax in it stays a string.

### Check scripts

- `npm run prepush` (`scripts/ci/prepush.mjs`) is the one local gate before every
  push (`local-checks`). It binds no port and opens no browser.
- `scripts/ci/check-spec-copy.mjs` reads only static text between tags, not Astro
  expressions; a copy pin built from an expression is not caught.
- `scripts/ci/check-sweep-tags.mjs` and `flaky-summary.mjs` read Playwright's JSON
  report: file suites hold nested describe suites, every suite carries `file` and
  only the top-level entries omit `title`, and each spec carries its tags.
- `select-specs.mjs` walks each importer branch up to the spec source that owns
  it. Reaching a layout or page no spec owns means the changed module is shared by
  the whole runtime, so the selection widens to `broad`.
- **Fixtures come from real output (L-019).** The fixtures in
  `scripts/ci/check-sweep-tags.test.mjs` are trimmed from a real
  `playwright test --list --reporter=json` report (adc-website's
  `.context/adc-ci/playwright-list.sample.json`): each file suite holds its specs in
  nested describe suites, and each spec keeps `title`, `file`, `line`, `column`,
  `tags` and `tests`. The `env` fixtures in `scripts/ci/already-tested.test.mjs` are
  trimmed from real `gh api` responses for a commit's pulls, the commit, the
  workflow runs and a run's jobs (`gh-commit-pulls`, `gh-commit`, `gh-runs` and
  `gh-jobs.sample.json` in the same folder). Its API-failure test stubs the parent
  lookup as `"HEAD PARENT"`, a one-parent commit, so the API is reached even in CI's
  shallow checkout. A new fixture for tool output names its source here.
- `scripts/hooks/agent-definitions.test.mjs` carries adc-website's lesson L-042: a
  subagent with `omitClaudeMd: true` never receives `CLAUDE.md`, so its definition
  must say so and must not tell the agent to follow it. A pointer in the
  description or an on-demand Read ("Open `CLAUDE.md` with Read only when …") is
  allowed.

### Markdown lint (`.markdownlint-cli2.jsonc`)

Structural problems only; prose style is not linted. MD022 and MD032 are off
because the lessons ledger puts each entry's field list directly under its heading,
the format `scripts/lessons/select.mjs` parses. It ignores `src/**` (content
rendered by the build), `.context/**` (local scratch and saved logs), and
`.agents/skills/copy-editing/**`, a vendored skill kept byte-for-byte as published
(`skills-lock.json`).
