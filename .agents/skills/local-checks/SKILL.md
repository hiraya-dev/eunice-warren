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
- **Push once per round.** Every push to an open PR starts a full CI run, and a
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

Never on the Mac:

- the whole suite as a gate. CI runs it on every `runtime` push.
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

`Local: prepush @ <sha>; specs run: <spec files | none>; browser: <what was checked | none>`

## CI routes

`scripts/ci/classify-paths.mjs` routes the changed paths (header of
`.github/workflows/ci.yml`). To see a branch's route before pushing:

```bash
git diff --name-only origin/main...HEAD | node scripts/ci/classify-paths.mjs
```

- **`runtime`** (`src/**`, `public/**`, `tests/**`, `package.json`, the lockfile,
  Astro, TypeScript and Playwright config, `wrangler.jsonc`, `.nvmrc`, and any
  unknown path) runs `build` (`astro check`, the unit tests, and the production
  `astro build`) and `e2e` (every spec on the fake-store build, in the Playwright
  image matching the lockfile). Tests that pass only on a retry are listed as
  flaky in the job summary: treat each as a lesson to capture, not as green.
- **`workflow`** (the paths in `WORKFLOW_FILES` and `WORKFLOW_DIRECTORIES`) and
  **`docs`** run one `checks` job: markdownlint, plus the routing, CI-script, hook
  and lessons tests, the lessons ledger and actionlint when a workflow path
  changed.
- CI runs on drafts too, on every push to `main`, and by hand:
  `gh workflow run ci.yml --ref <branch>` runs everything on a branch. A PR that
  adds or changes a CI job proves it on that PR, by touching a path that selects
  it or by running it by hand.
- `gate` fails if any job the route needs did not succeed. A skipped `gate` is
  never green.
- **Flakes** are proven on a runner, not the Mac:
  `gh workflow run flake-check.yml --ref <branch> -f grep='<title or file>' -f repeat=20`
  (4 workers, no retries, so a flake fails the run).
