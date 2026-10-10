# Setup — Claude + Codex workflow for Astro

This repo carries the agent workflow extracted from the AVPN project: Claude
orchestrates (design reading, QA, Git, review, merge), Codex implements repository
code through a supervised launcher, and CI routes every PR by the paths it changes.

## What is here

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | Claude's contract: roles, routing, approval, Git lifecycle, traps |
| `AGENTS.md` | Codex's contract: what it owns, what its sandbox cannot do |
| `skills/` | `astro-component`, `codex-handoff`, `fix-bug`, `review-pr` |
| `.claude/skills` | symlink to `skills/` so Claude Code discovers them |
| `.claude/settings.json` | Paper + Chrome DevTools plugins; hook that blocks `codex-rescue` via the Agent tool |
| `scripts/codex/run-handoff.mjs` | supervised `codex exec` launcher (closes stdin, JSONL lifecycle, timeouts, process-group kill, `--resume`) |
| `scripts/ci/classify-paths.mjs` | routes changed paths to `runtime` / `workflow` / `docs` |
| `.github/workflows/ci.yml` | `classify` → `build` + `e2e` / `docs` + `workflow` → `gate` |
| `.markdownlint-cli2.jsonc` | structural Markdown lint for the `docs` job |
| `docs/claude-codex-handoff-resolution.md` | why the contract looks the way it does |

## Prerequisites

- Node 22, `gh` (authenticated), `jq` (the settings hook uses it)
- Codex CLI, logged in: `codex login`. Model `gpt-5.6-luna` (ChatGPT-account Codex
  rejects `gpt-6-luna`).
- The Paper desktop app and the `paper-desktop@paper` Claude Code plugin. The project
  settings enable it and register the `paper` marketplace; approve the install the
  first time Claude Code opens the repo.

## 1. Scaffold the Astro app

`npm create astro` will not scaffold cleanly into a non-empty directory, so create it
beside the repo and copy it in:

```bash
npm create astro@latest ../ew-scaffold -- --template minimal --no-git --install
rsync -a --exclude node_modules --exclude .git ../ew-scaffold/ ./
rm -rf ../ew-scaffold
npm install
npm install -D @astrojs/check typescript @playwright/test
```

Keep this repo's `.gitignore` additions if the scaffold overwrote it (see step 4).

## 2. Add the scripts

Merge into `package.json`:

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test:codex-handoff": "node --test scripts/codex/run-handoff.test.mjs",
    "test:routing": "node --test scripts/ci/classify-paths.test.mjs",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:report": "playwright show-report",
    "test:e2e:install": "playwright install chromium chromium-headless-shell"
  }
}
```

## 3. Add `playwright.config.ts`

The port is derived from the checkout path so parallel Conductor worktrees never test
each other's server (see **Traps** in `CLAUDE.md`).

```ts
import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// A port is machine-wide, but this repository is checked out in several worktrees
// at once. Deriving the port from this checkout's path keeps it stable here and
// distinct per worktree. Override with PW_PORT when it has to be pinned by hand.
const HOST = "127.0.0.1";
const PORT = Number(process.env.PW_PORT) || derivePort(process.cwd());
const ORIGIN = `http://${HOST}:${PORT}`;

function derivePort(dir: string) {
  const digest = createHash("sha1").update(dir).digest();
  return 41000 + (digest.readUInt16BE(0) % 2000);
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  webServer: {
    // Test the production build, not the dev server. reuseExistingServer: false
    // makes Playwright refuse a port something else already answers on.
    command: `npm run build && npm run preview -- --host ${HOST} --port ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
```

Add one smoke spec so `e2e` has something to run:

```ts
// tests/home.spec.ts
import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
});
```

Then `npm run test:e2e:install` once per machine.

## 4. `.gitignore`

Make sure it contains:

```gitignore
node_modules/
dist/
.astro/
.env
.env.*
!.env.example
playwright-report/
test-results/
.context/
.DS_Store
```

`dist/` is never committed — CI builds it. A committed `dist/` path routes `runtime`
(unknown paths fail closed).

## 5. Fill the placeholders

- `README.md` (from the scaffold): one paragraph on what the site is, plus the
  scripts. `CLAUDE.md` and `AGENTS.md` point at it.
- The deploy host. When it is chosen, add its preview-URL pattern to `CLAUDE.md`
  **Git** (the "Deploying is a separate act" bullet) and `skills/review-pr/SKILL.md`
  **Deploying is separate**.
- Design tokens in `src/styles/`, created from Paper's tokens
  (`get_tokens`), before the first component handoff.

## 6. Probe the Codex sandbox on this machine

`CLAUDE.md` states what Codex cannot do. Confirm it here once:

```bash
node scripts/codex/run-handoff.mjs --model gpt-5.6-luna --sandbox workspace-write --timeout-seconds 300 --prompt "Run each and report the exact exit code and error: (1) git config --local probe.x 1  (2) node -e \"require('net').createServer().listen(4199,'127.0.0.1',()=>{console.log('bound');process.exit(0)}).on('error',e=>{console.log(e.code);process.exit(1)})\"  (3) npm run build. Do not change any files."
```

Expect `could not lock config file`, `EPERM`, and a successful build. If a result
differs, update **What Codex cannot do here** in `CLAUDE.md` and the table in
`skills/codex-handoff/SKILL.md`.

## 7. Land it

Commit on a `chore/` branch, open the PR, and let CI run. The first PR is `runtime`
(the scaffold), so `build` and `e2e` must both go green before merge.

```bash
git diff --name-only main...HEAD | node scripts/ci/classify-paths.mjs
npm run test:routing && npm run test:codex-handoff
```

## Reusing this in another Astro project

Copy everything in the table above, then repeat steps 2–7. The only project-specific
text is the project name at the top of `CLAUDE.md` and `AGENTS.md`, and the
**Relevant context → Project** line in `skills/codex-handoff/SKILL.md`.
