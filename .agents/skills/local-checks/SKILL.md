---
name: local-checks
description: The local checks Claude runs before every commit and push in this repo — npm run prepush as the only local gate, the one run a new or changed Playwright spec gets from its author, what never runs on the Mac, how to record it in the PR body, and how CI routes a change. Use after reviewing a returned diff and before any git commit or git push.
---

# Local checks

Claude runs these after reviewing a returned diff (`CLAUDE.md` **Git** step 6). CI's
`gate` is the browser proof: the Mac runs no full Playwright suite before a commit.
The local run catches what is cheap to catch here and keeps the user's Mac usable.
Codex cannot run any of this (it cannot bind a port).

## Before every commit and push

- `git status -sb` and confirm the task branch (L-007). Strip debug, temporary and
  unrelated changes.
- **`npm run prepush`**, before every push, on every route and round:
  `npm run prepush && git push …`. It runs the lessons ledger check, the
  `scripts/ci` and hook tests, the RSVP and With Love unit tests, markdownlint, and
  `astro check`. It binds no port and opens no browser.
- Chain the commit or push on the check with `&&`, never after a pipe
  (`npm run prepush | tail && git push` sees `tail`'s exit status). Trim output with
  `set -o pipefail;` first. The hook `scripts/hooks/guard-git.mjs` rule pipe-commit
  blocks the piped form before a commit.
- No full Playwright run gates a commit. Commit, then push; CI runs the suite.
- **Push once per round.** Every push to an open PR starts a CI run, and a
  superseded run is cancelled half done. Commit each step locally and push when the
  round is done: the first push of a PR, each fix round, and a merge of `main`. Never
  push a half-done round to "see what CI says"; `prepush` catches type and unit-test
  errors in seconds.

## A new or changed spec runs once

Whoever writes a browser spec runs it before handing it back. For Claude:

```bash
nice -n 15 npx playwright test tests/<spec>.spec.ts
```

Playwright builds first (`webServer` in `playwright.config.ts`, on the fake RSVP
store) and serves on a port derived from the checkout path (L-008). Run only the
specs the diff adds or changes, to green. A motion spec also runs under load once,
`--repeat-each 20 --workers 8`, since a frame-timed assertion passes on an idle Mac
(L-009).

Tag each new test: `@smoke` for a fast happy path the draft tier should run,
`@sweep` for load-sensitive motion or geometry (then add its file to `SWEEP_SPECS`
in `scripts/ci/classify-paths.mjs`; `npm run check:sweep-tags` enforces both
ways), and `@single` when it pins its own viewport or ignores it and does not
depend on pointer or touch type, so the `mobile` project skips it. Use the `tag`
option, never the title.

## Select the specs

Use `scripts/ci/select-specs.mjs`; never pick specs by hand. Feed it every path that
differs from the branch point, committed or not:

```bash
{ git diff --name-only $(git merge-base origin/main HEAD); git ls-files -o --exclude-standard; } | node scripts/ci/select-specs.mjs
```

It prints `none` (no runtime path changed), `broad` (the paths that forced it are
on stderr: **Broaden it**), or the spec files to pass to `npx playwright test`.
`--json` gives the reason per path. It walks the import graph from each changed
file up to the section or component a spec owns (`SPEC_SOURCES`); a narrow list
always carries the site-wide specs (`["*"]`). A new spec must be added to
`SPEC_SOURCES` (`--check`, in the CI `checks` job).

## Broaden it

Run the full non-sweep suite (`nice -n 15 npx playwright test --grep-invert @sweep`),
or add the `ci:full` label to the draft, when the diff touches a shared client
script (`src/scripts/**`: Lenis, fade-in, scroll), global CSS or tokens, a layout or
page, a component used by several sections (`Button`, `Img`, the nav), `src/lib/**`,
fonts, dependencies or config, or whenever it is unclear which specs cover it.
`select-specs.mjs` returns `broad` for all of these, and for a path it cannot map;
never narrow a `broad` result by hand. If unsure, broaden it.

## Targeted run

For each later round (Local review feedback, a `CHANGES_REQUIRED` fix, a red CI
job): the specs **Select the specs** returns for the round's own paths
(`git diff --name-only HEAD` plus the untracked files), `--last-failed` after a
failure, plus the browser check the change needs. A round that meets a **Broaden
it** condition, or a merge of `main` that needed conflicts resolved, gets the broad
run.

Never on the Mac:

- the whole suite as a gate. CI runs it when the PR is marked ready.
- a long flake hunt. Reproduce briefly with `--repeat-each 20 --workers 6-8`
  (raise workers, not repeats, for pointer and overlay races), then prove the fix
  with `flake-check.yml` (**CI routes**).
- any load against a hosted deploy (L-012).

## Browser check

Do the browser and responsive checks the change needs on the dev server
(`astro dev --background`) or the T3 `preview` script, measuring against the Paper
artboard at 390 and 1440 for visual work. That is QA for the review, not a gate.

## Record it

One line in the PR body:

`Local: prepush @ <sha>; select-specs <specs | broad: <why> | none>; specs run: <spec files | broad | none> (motion under load: <specs> | none); browser: <what was checked | none>; targeted @ <sha>: <specs>`

## CI routes

`scripts/ci/classify-paths.mjs` routes the changed paths (header of
`.github/workflows/ci.yml`). To see a branch's route before pushing:

```bash
git diff --name-only origin/main...HEAD | node scripts/ci/classify-paths.mjs
```

- **`runtime`** (`src/**`, `public/**`, `tests/**`, `package.json`, the lockfile,
  Astro, TypeScript and Playwright config, `wrangler.jsonc`, `.nvmrc`, and any
  unknown path) runs `build` (`astro check`, the unit tests, and the production
  `astro build`) and `e2e` on the fake-store build, in the Playwright image matching
  the lockfile, with two workers. The tier is in the job name:
  - `e2e (smoke)` on a draft PR: the `@smoke` tests only, on the `chromium` and
    `mobile` projects.
  - `e2e (full)` on a ready PR, a draft labelled `ci:full` (add it, then
    `gh run rerun <run-id>`), a push to `main` and a manual run: every test not
    tagged `@sweep`, plus `sweeps (1/2)` and `sweeps (2/2)`, the `@sweep` tests
    sharded two ways at one worker each. Full runs every project, so the `@smoke`
    tests also run on `webkit` (iPhone 14 Safari). A local spec run includes
    `webkit` for any `@smoke` test in it; install it once with
    `npx playwright install webkit`.

  CI retries a failed test once. Tests that pass only on the retry are listed as
  flaky in the job summary: treat each as a lesson to capture, not as green.
- **`workflow`** (the paths in `WORKFLOW_FILES` and `WORKFLOW_DIRECTORIES`) and
  **`docs`** run one `checks` job: markdownlint, plus the routing, CI-script, hook
  and lessons tests, the lessons ledger and actionlint when a workflow path
  changed.
- CI runs on drafts, again when a PR is marked ready, on every push to `main`, and
  by hand: `gh workflow run ci.yml --ref <branch>` runs the full tier on a branch.
  A push to `main` whose tree a full-tier PR run already passed skips every job
  (`scripts/ci/already-tested.mjs`, which fails closed); a smoke-tier run never
  counts. A PR that
  adds or changes a CI job proves it on that PR, by touching a path that selects
  it or by running it by hand.
- `gate` fails if any job the route and tier need did not succeed. A skipped `gate` is
  never green.
- **Flakes** are proven on a runner, not the Mac:
  `gh workflow run flake-check.yml --ref <branch> -f grep='<test title or spec file name>' -f repeat=20`
  (4 workers, no retries, so a flake fails the run). `--grep` matches the title
  path, which starts at the file name, so pass `footer.spec.ts`, not
  `tests/footer.spec.ts`.
