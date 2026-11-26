# 0015: The Playwright harness tests the fake-store build on a per-checkout port

- **Status:** accepted
- **Date:** 2026-11-26

## Context

`playwright.config.ts` serves every browser test in this repo, locally and in the
CI jobs of ADR 0001. Its reasons lived in comments until ADR 0002 moved them here.

## Decision

- **Port.** A port is machine-wide, but this repo is checked out in several
  worktrees at once. `derivePort` hashes the checkout path into 41000–42999, so the
  port is stable per worktree and distinct across them; `PW_PORT` pins it by hand.
  `reuseExistingServer: false` makes Playwright refuse a port something else already
  answers on (L-008).
- **Server.** The suite tests the production build with the fake store
  (`CLOUDFLARE_ENV=test`, `RSVP_STORE=fake`, Turnstile's always-pass test key), not
  the dev server. `astro preview` runs under `env -u CLAUDECODE`: Astro 7
  backgrounds `astro preview` when `CLAUDECODE` is set, which would end the
  `webServer` process at once (L-008, #168).
- **Only browser specs.** `testMatch` takes `*.spec.ts`. `tests/*-unit.test.ts` are
  `node:test` files (`npm run test:unit`); loading them here runs them at import and
  prints TAP into `playwright test --list --reporter=json`, which `check:sweep-tags`
  reads.
- **Retries and workers.** CI retries once, so a test that passes only on its retry
  is reported as flaky (`scripts/ci/flaky-summary.mjs`), not absorbed. The config
  default stays one worker in CI, which the `@sweep` shards and the `webkit` job use;
  `e2e` passes `--workers=2`.
- **Reporters.** CI writes HTML for the failure upload and JSON
  (`test-results/results.json`) for the flaky-test summary.
- **Storage state.** Every test starts as a guest who skipped the envelope
  (`ew-guest-v2`) with the preloader off (`ew-test-skip-preloader`).
- **Projects.** `chromium` (Desktop Chrome) and `mobile` (Pixel 7). Tests that set
  their own viewport, or do not depend on it, are tagged `@single` and run once,
  under `chromium`. `webkit` (iPhone 14) exists because most guests open the site in
  Safari on an iPhone; it runs only `@smoke`, and only in CI's full tier, in the
  `webkit` job. `@single` does not skip it: `@single` is about the viewport, not the
  engine.

## Consequences

- Two worktrees can run the suite side by side. When a suite acts as if a change is
  missing, `lsof` the port first (L-008).
- A new spec file must end in `.spec.ts` to run.
