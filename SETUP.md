# Setup — Claude + Codex workflow

Claude orchestrates (design reading, build, QA, Git, review, merge), Codex
implements logic through T3 Code's `delegate_task`, and CI routes every PR by the
paths it changes. Tasks run in T3 Code (`CLAUDE.md` **Host**).

The workflow was first built for the AVPN project, then run here under Conductor
with a supervised `codex exec` launcher. On 2026-11-13 it moved to T3 Code and was
re-adapted from adc-website, which had already made that move. `scripts/codex/`,
`.conductor/`, the `haiku-edit` subagent and the `codex-rescue` hook were removed.

## What is here

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | Claude's contract: host, roles, models, routing, approval, Git, deploys, lessons, traps |
| `AGENTS.md` | Project and Lumos conventions, plus Codex's contract under **Codex: your role** |
| `.agents/skills/` | `astro-component`, `codex-handoff`, `local-checks`, `review-pr`, `fix-bug`, `copy-editing` (vendored, pinned in `skills-lock.json`), and the Lumos skills |
| `.agents/product-marketing.md` | the site's audience, voice and copy rules, read by `copy-editing` and `pr-reviewer` |
| `.claude/skills/` | links into `.agents/skills/` so Claude Code finds them |
| `.claude/settings.json` | pins Opus 5.5; enables the Paper, Chrome DevTools and Cloudflare plugins; denies destructive commands and unused connectors; runs `scripts/hooks/guard-git.mjs` before every Bash call and `scripts/hooks/guard-deps.mjs` before T3's `delegate_task` |
| `.claude/agents/` | `haiku-lookup` (Haiku 5.5, read-only), `layout-implementer` (Sonnet 5.5, builds and runs Playwright) and `pr-reviewer` (Sonnet 5.5, read-only); `scripts/hooks/agent-definitions.test.mjs` checks the definitions |
| `t3.json` | T3 Code: new threads start in a worktree; `setup` runs `npm ci` and copies `.dev.vars.example`, but T3 does not run it yet (L-006), so Claude runs `npm ci` itself (`CLAUDE.md` **Git** step 1, hook `guard-deps.mjs`); `dev` and a fake-store `preview` on Astro's default port or the next free one |
| `.agents/lessons.md`, `.agents/lessons-archive.md`, `scripts/lessons/` | the lessons ledger, its archive, and the matcher and validator (`select.mjs`) |
| `scripts/hooks/` | `guard-git.mjs`, the Git-trap hook; `guard-deps.mjs`, the T3 dependency hook; `agent-definitions.test.mjs`; and their tests |
| `scripts/ci/classify-paths.mjs` | routes changed paths to `runtime` / `workflow` / `docs` |
| `scripts/ci/prepush.mjs` | `npm run prepush`, the one local gate before every push (`local-checks`) |
| `.github/workflows/ci.yml` | `classify` → `build` (type-check, unit tests, production build) + `e2e` (every spec, in the Playwright image matching the lockfile) / `checks` (docs and workflow) → `gate`; runs on drafts, pushes to `main`, and by hand |
| `.github/workflows/flake-check.yml` | repeats a spec on a runner by hand, 4 workers, no retries (L-009, L-010) |
| `scripts/ci/flaky-summary.mjs` | lists tests that passed only on a retry in the e2e job summary |
| `.nvmrc` | Node 22.23.4 for CI |
| `playwright.config.ts`, `tests/` | Chromium at desktop and Pixel 7; builds and serves the fake-store site on a port derived from the checkout path (L-008) |
| `.markdownlint-cli2.jsonc` | structural Markdown lint, in `prepush` and the `checks` job |
| `docs/claude-codex-handoff-resolution.md` | why the handoff contract looks the way it does |
| `docs/rsvp-backend.md` | the RSVP backend, its Sheet layout and its production setup |
| `docs/decisions/0001-workflow-from-adc-website.md` | what was taken from adc-website, what was adapted, and what was left out |

## Prerequisites

- Node 22.19 or newer, `gh` authenticated.
- T3 Code, with the Codex provider enabled with models `gpt-5.6-luna` and
  `gpt-5.6-sol`, and **Delete merged worktrees** turned on in its storage cleanup
  settings.
- The Paper desktop app and the `paper-desktop@paper` Claude Code plugin. The
  project settings enable it; approve the install the first time Claude Code opens
  the repo.
- Playwright's browser, once per machine: `npm run test:e2e:install`.

## Probe the Codex sandbox

`codex-handoff` states what Codex cannot do. Re-run this on a new machine, or after a
Codex upgrade. From a T3 thread, run `npm ci` in the worktree first, then send these
seven commands with `delegate_task` (`target`
`{"providerInstanceId":"codex","model":"gpt-5.6-luna"}`, `isolation: "shared"`,
`mode: "async"`):

```text
Capability probe. Run each command and report the exact exit code and the first line of any error: (1) git config --local probe.x 1  (2) node -e "require('net').createServer().listen(4199,'127.0.0.1',()=>{console.log('bound');process.exit(0)}).on('error',e=>{console.log(e.code);process.exit(1)})"  (3) npm run build  (4) npm view astro version  (5) npm run check  (6) git status --short  (7) echo ok > .context/codex-probe.txt. Change no other files.
```

Then send a one-line task on `gpt-5.6-sol` to confirm that model name is accepted.
Afterwards delete `.context/codex-probe.txt`, and unset `probe.x` with
`git config --local --unset probe.x` if the write succeeded. If a result changes,
update `.agents/skills/codex-handoff/references/codex-sandbox.md` and **What your
sandbox cannot do** in `AGENTS.md`.

## Deploys: Cloudflare Workers Builds

One Worker, `eunice-warren`, builds from this repository. Every push to `main`
deploys production at `https://eunice-warren.neil-e89.workers.dev`; every other
branch builds a preview at `https://<branch, / as ->-eunice-warren.neil-e89.workers.dev`
with `npx wrangler preview`; that is where the user does **Local review**. CI never
deploys and holds no Cloudflare token. The RSVP secrets are Worker secrets
(`docs/rsvp-backend.md`), shared by previews, so `wrangler.jsonc` `previews` runs
previews on the fake store.

## Check it locally

```bash
npm run prepush
git diff --name-only origin/main...HEAD | node scripts/ci/classify-paths.mjs
```

`prepush` is the only local gate; a Playwright spec runs locally only once, by its
author, when it is new or changed (`.agents/skills/local-checks/SKILL.md`).
