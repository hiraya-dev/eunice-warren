# Claude Code notes — Eunice Warren (Astro)

This repo is the Eunice Warren site, built with Astro. Designs live in Paper; the
repository owns everything that ships. See `README.md` for the app overview and
`SETUP.md` for how this workflow was installed.

## Agent roles

Claude orchestrates; Codex implements repository code that has logic in it; Haiku
subagents handle read-only lookups and mechanical edits.

```
Claude: classify → branch → delegate → wait → validate → commit → push → PR
Codex:  inspect → implement → add tests → report
Haiku:  look up or make a fully specified edit → report
```

**Claude owns** reading designs from Paper (the Paper MCP plugin), turning them into
task descriptions and acceptance criteria, visual and responsive QA in a real
browser, deploy-preview verification, the whole Git lifecycle — branch, commit,
push, PR, review, merge, cleanup — and every check Codex cannot run.

**Codex owns** writing repository code: Astro pages, layouts and components,
styles, client scripts, content-collection schemas, utilities, tests, build config,
refactors, and bug fixes. It reports; it does not commit, push, or open a PR.

**Haiku owns** nothing on its own authority. Two subagents in `.claude/agents/` run
on Claude Haiku 5.5 and do work Claude specifies completely: `haiku-lookup` answers
read-only questions, `haiku-edit` makes mechanical edits. Their tool lists enforce
the boundary — neither has Bash, so neither can touch Git, run a build, or install
anything. See **Task routing**.

### What Codex cannot do here

Measured with `codex exec --sandbox workspace-write` (in the project this setup was
extracted from; re-run the probe in `SETUP.md` to confirm on this machine): writing a
workspace file and a production build both succeed, but `git config --local` fails
with `could not lock config file .git/config: Operation not permitted`, and binding
`127.0.0.1:4199` fails with `EPERM`. The workspace-write sandbox also has no network
by default (not yet measured here — the probe checks it), so Codex cannot
`npm install`: Claude installs dependencies, and a handoff that needs a new package
says the package is already installed.

`astro dev`, `astro preview`, and Playwright all bind a port, so **`npm run test:e2e`
can never run inside Codex.** The split is forced by capability, not preference.
Never write a handoff that tells Codex to commit, push, start a dev server, or run the
end-to-end suite — it cannot comply, and saying so invites a false report.

### Delegating

Delegate one way only, from the prepared branch, through the supervised launcher:

```bash
node scripts/codex/run-handoff.mjs --model gpt-5.6-luna --sandbox workspace-write --timeout-seconds 540 --prompt "<scoped task>"
```

Use the nine-minute override for small foreground tasks so the command ends before
Bash's 10-minute ceiling. A real handoff has taken 13 minutes, so use the launcher's
30-minute default with `run_in_background: true` when the task may exceed 10 minutes.
In either mode, run one launcher invocation only; never combine Git preparation,
review, a fix round, polling, or log following into the same shell.

The root cause of the observed zero-event stall was `codex exec` reading a non-TTY
stdin and waiting for EOF. The launcher closes Codex's stdin, streams JSONL, and
permits one turn. Exit zero plus `turn.completed` is success; timeout, missing or
failed terminal state, and a terminal event followed by a process that does not exit
are failures.

After a non-zero launcher result, confirm it terminated the Codex process group
before inspecting partial edits. Do not implement fallback work in the same shell.

**Never delegate through the Agent tool** (`subagent_type: codex:codex-rescue`) **or
the `/codex:rescue` command.** The Agent tool is background-only in Claude Code,
silently drops `--wait` and `--fresh`, and keeps writing to the shared checkout
minutes after the handoff appears to have returned — overwriting whatever Claude did
in the meantime. A `PreToolUse` hook in `.claude/settings.json` denies that call. The
Codex plugin stays installed for ad-hoc use by a person, but nothing in this workflow
goes through it.

Claude does not edit delegated files while the process is alive. If a run has to be
abandoned, kill it and confirm no `codex` process is still running against this
checkout before taking over.

**Fallback.** If `codex exec` is missing, unauthenticated, or reaches a terminal
failure — `turn.failed`, `error`, or a non-zero exit — Claude implements the change
directly and says so in the PR body. Delegation is not a reason to leave work undone.

Start the fallback only once the process has actually exited. While a run is alive,
wait for it; if it must be abandoned, kill it and confirm no `codex` process survives
first.

See `docs/claude-codex-handoff-resolution.md` for how this contract was arrived at.

### Models

Claude Opus orchestrates, plans, reviews, and merges. Mechanical work runs on Claude
Haiku 5.5 (`claude-haiku-5-5`, pinned in each agent file with `effort: low`). Spawn
those agents without a per-call `model` override — it would replace the pinned model.

Every Codex task runs on `gpt-5.6-luna` (`gpt-6-luna` is rejected on ChatGPT-account
Codex). The sandbox, not the model, sets the boundary: a task that modifies
repository files runs with `--sandbox workspace-write`; a read-only task that needs
to run commands — reproducing a failing build, triaging with real output — runs with
`--sandbox read-only`. Questions answerable by reading alone go to `haiku-lookup`
instead. A read-only task never expands into a repository mutation: if it finds
files need to change, it ends with a recommendation and Claude starts a fresh
workspace-write task or resumes the branch's existing session. Fix rounds use a new launcher invocation with
`--resume <thread_id>`; the launcher supplies Codex's different resume syntax. See
`skills/codex-handoff/SKILL.md`.

## Task routing

Classify before implementing. One question decides between Haiku and Codex: **does
the change need any logic, or an understanding of the code around it?** No → Haiku.
Yes → Codex. Judgment, Git, and every gate stay with Claude.

| Lane | Takes | Examples |
| --- | --- | --- |
| **Claude** (Opus, inline) | judgment, gates, Paper, Git | classifying, acceptance criteria, reading Paper, visual QA against an artboard, every review and merge, workflow rule changes, a one-line edit cheaper to make than to delegate |
| **`haiku-lookup`** | read-only questions answerable by reading | where X is defined or used, summaries of files or a diff, inventories (assets, tokens, pages missing alt text or metadata), the failure in a CI or Playwright log Claude saved to `.context/` |
| **`haiku-edit`** | mechanical edits Claude can specify completely | content entries that need no schema change, copy and wording, typos, alt text, a token value or class name, Markdown lint fixes, config values, dependency pins — including batches of these |
| **Codex** | anything with logic or behavior | new pages, sections, or components; client scripts and animation; content-schema changes; tests; bug fixes that need a root cause; refactors; build config with logic in it; the code half of design → code |

- **Design** — reading a Paper artboard, extracting tokens, spacing, type, and
  assets, and writing them into a task description. Claude does it directly, per
  `skills/astro-component/SKILL.md` **From Paper**. Claude never edits the Paper file
  unless the task asks for it.
- **Design → code** — Claude reads Paper and writes the acceptance criteria, Codex
  implements, Claude validates the rendered result against the Paper artboard at
  each breakpoint.

### Mechanical edits

A delegated Codex run is a full inspect-implement-validate cycle — measured at ~10
minutes for a real component, of which only seconds are process start-up. Do not pay
that for a change that has no behavior in it. An edit is **mechanical** when **both**
of these hold:

- no new logic — no new branch, loop, listener, component prop, island, route, or
  schema field; no change to what an existing one does
- the whole diff can be written from the task description alone, without reading
  around it to understand the code

A mechanical edit goes to `haiku-edit`, with an instruction naming every file and
value. Claude makes it directly instead when it is at most two files and a few lines
— a subagent starts cold, and for an edit that small, delegating costs more than
doing it. If `haiku-edit` returns `BLOCKED`, the edit was not mechanical: route it to
Codex.

Workflow instructions — `AGENTS.md`, `CLAUDE.md`, `SETUP.md`, `skills/**`,
`.github/**`, `scripts/ci/**`, `scripts/codex/**`, `.claude/**`, `.mcp.json`,
`.conductor/**` — are operational code, not prose. A typo or wording fix in them is
mechanical. A change that adds or alters a rule, a step, an owner, a model, or a CI
condition is not: Claude writes it, because it is a process decision rather than
code to implement. Neither kind skips the focused workflow review in
`skills/review-pr/SKILL.md` **Review tiers**.

Everything with logic in it goes to Codex. If unsure whether an edit is mechanical,
it is not.

A mechanical edit still gets a branch, a PR, CI, an inline review, and a merge per
**Git** — only the Codex handoff is skipped. Claude reads Haiku's diff before
committing it, exactly as it reads Codex's. Say in the PR body who implemented it
(`haiku-edit` or Claude directly) and why it qualified as mechanical.

### One writer at a time

Only one agent edits the checkout at a time: never run `haiku-edit` while a Codex
launcher is alive, or the reverse. `haiku-lookup` may run alongside either, since it
only reads.

## Approval

After classifying a task, state the classification and the acceptance criteria, then
stop for the user's OK. Once approved, the rest of the chain — branch, handoff, PR,
review, merge, cleanup — runs without further check-ins.

For a new page or visual feature, recommend an approach first (options, trade-offs)
and stop; build only after the user picks.

## Skills

Before doing work related to components, design implementation, delegation, bugs, or
PR review, check `skills/` for a relevant `SKILL.md` and follow it. Start with
`skills/README.md` for the index and conventions.

- Building a page or component, or implementing a Paper design →
  `skills/astro-component/SKILL.md`
- Bug reported → `skills/fix-bug/SKILL.md`
- Handing repo work to Codex → `skills/codex-handoff/SKILL.md`
- Reviewing a PR → `skills/review-pr/SKILL.md`

## Git

Feature-branch workflow. Never make feature commits directly on `main`.

For every feature, fix, refactor, or maintenance task:

1. Fetch the latest `origin/main`: `git fetch origin`.
2. Create the task branch from it without checking out `main`:
   `git switch -c <prefix>/<name> origin/main`.
3. Never check out `main` itself. Git lets a branch be checked out in only one
   worktree, and Conductor runs several — a workspace sitting on `main` makes
   `git switch main` fail in every other one. Diff against `origin/main`, not a local
   `main` that nothing keeps current.
4. Prefix the branch by kind: `feat/` new features, `fix/` bug fixes,
   `refactor/` code restructuring, `chore/` maintenance.
5. Keep the branch focused on one logical change.
6. Define the acceptance criteria and get the user's OK (see **Approval**).
7. Route the work per **Task routing**: design reading to Claude, mechanical edits
   to `haiku-edit`, code with logic to Codex via `skills/codex-handoff/SKILL.md`. For a bug fix, the draft PR from
   `skills/fix-bug/SKILL.md` step 4 exists before the handoff; for other work it may
   be opened after the first push.
8. Review the returned diff, then run the checks Codex could not — `npm run test:e2e`
   plus browser and responsive verification. Strip debug, temporary, and unrelated
   changes, then commit and push.
9. Open a pull request targeting `main`.
10. Review the PR inline per `skills/review-pr/SKILL.md`, at the tier the CI
    `classify` route selects, after `gate` settles, and post the verdict on the PR
    with `gh pr comment <pr> --body` — the review is not done until that comment
    exists.
11. Merge the PR yourself once the posted review says `PASS` and the `gate` check
    is green on the PR's head commit (`gh pr merge <pr> --squash` — never
    `--delete-branch`; see **Traps**).
    No review comment on the head commit means no merge. A bug fix must
    additionally pass every gate in `skills/fix-bug/SKILL.md`. A `CHANGES_REQUIRED`
    or `BLOCKED` verdict, a red or pending check, or a failed bug-fix gate means
    hand the PR to the user instead — never merge past one.
12. After the merge: confirm it landed (`gh pr view <pr> --json state,mergedAt`),
    delete the remote branch (`git push origin --delete <branch>`), and run
    `git fetch origin --prune`. In a Conductor workspace, leave the worktree on the merged
    branch — archiving the workspace removes it. Elsewhere, `git switch --detach
    origin/main` and then delete the local branch. A `CLOSED` PR is not a merged PR —
    never clean up a branch whose PR did not merge.

If the working tree already has uncommitted changes when a task starts,
`git switch -c` carries them onto the new branch; keep them out of the task's commits
unless they belong to it.

If a feature branch already has commits for the task at hand, keep using it
rather than opening another branch for the same logical change.

- Never add a `Co-authored-by` trailer (or any co-author attribution) to commits.
- Pushing a feature branch and opening its PR needs no separate approval; pushing
  to `main` itself is never done.
- "CI is green" means the `gate` job of the `CI` workflow passed on the head commit.
  One workflow runs on every PR; its `classify` job routes the changed paths
  (`scripts/ci/classify-paths.mjs`) and `gate` fails if any job the route requires
  did not succeed. Routes: `runtime` (`src/**`, `public/**`, `tests/**`,
  `package.json`, lockfile, Astro, TypeScript and Playwright config) runs `build`
  (`astro check` + `astro build`) and `e2e` in parallel; `workflow` (`AGENTS.md`,
  `CLAUDE.md`, `SETUP.md`, `skills/**`, `.claude/**`, `.github/**`, `scripts/ci/**`,
  `scripts/codex/**`, `.mcp.json`, `.conductor/**`) runs `docs` and `workflow` (routing and launcher tests +
  actionlint); `docs` (other Markdown) runs `docs` only. Unknown paths route
  `runtime`. A skipped job is not a pass: `gate` treats a skipped required job as a
  failure. Check locally with
  `git diff --name-only origin/main...HEAD | node scripts/ci/classify-paths.mjs`.
- `main` has no branch protection. Nothing on GitHub enforces the merge gates — they
  are self-enforced, so never merge past a red or pending check.
- Deploying is a separate act from merging. Claude may check the host's preview
  deployment for a PR whenever a change needs verification on a real deploy, and
  says so in the PR. Promoting to production still requires the task to ask for it.

### Bug fixes

Bug fixes use `fix/` branches and follow `skills/fix-bug/SKILL.md`. The short form:

- Restate actual vs. expected behavior, reproduction steps, and acceptance criteria
  before writing code.
- Reproduce or confirm the bug before changing anything.
- Open a draft PR early so the PR is the running record of the fix.
- Keep the branch to the one bug — no unrelated refactors or cleanup.
- Run the repo's real checks (`npm run check`, `npm run build`, `npm run test:e2e`,
  plus browser and responsive checks) and report only checks that actually ran.
- The fix is not done until it meets the acceptance criteria; never hide or skip a
  failing test.
- Review the diff and strip debug code before committing.
- Preserve any unrelated uncommitted changes already in the working tree — never
  discard them, and never fold them into the fix commit.
- For a scroll-driven or animated bug, sample per animation frame during real
  continuous motion. Reading a settled position passes on a broken animation.
- A bug fix merges only when it passes every gate in the skill on top of the
  general `PASS` + green CI rule.

## Traps

Learned the hard way, mostly on the project this workflow came from. Each one cost a
false green, a lost edit, or a blocked checkout.

- **`gh pr merge --delete-branch` switches the checkout to `main`.** Run from the
  PR's branch, it deletes the local branch and checks out `main` to do it — in a
  worktree, that claims `main` and blocks every other workspace (see **Git** step
  3). It happened merging this workflow's own PR. Merge with
  `gh pr merge <pr> --squash` and delete the remote branch with
  `git push origin --delete <branch>`.

- **Shared ports across worktrees.** Conductor runs several checkouts of this repo at
  once and a port is machine-wide. A hardcoded Playwright port with
  `reuseExistingServer` once tested *another checkout's* code and reported green.
  `playwright.config.ts` derives its port from the checkout path and never reuses a
  server — keep it that way. When a suite behaves as if a change is missing, check
  `lsof -nP -iTCP:<port> -sTCP:LISTEN` first.
- **Shared checkout, moving HEAD.** Another session can switch branches or edit files
  in the same worktree mid-task. Run `git status -sb` and confirm the branch right
  before every handoff, commit, and push. A hunk that is not yours is never "stray":
  leave it.
- **Settled reads lie about motion.** Never assert an animation's value "N frames
  later" in headless Chrome — rAF frames can arrive 5–12 ms apart. Sample over
  wall-clock time and assert the peak or the spread.
- **Load flakes.** Reproduce with `--repeat-each 20 --workers 6-8`; raise workers,
  not repeats, for pointer and overlay races. `click({ force: true })` still clicks
  the element's centre.
- **Your test traffic is the user's IP.** Bulk headless loads of a hosted deploy
  (~20 in 20 minutes) once tripped the host's DDoS mitigation and blocked the user's
  own browser. Test against the local build; check the deploy preview a few times by
  hand, never in a loop.
- **A red `e2e` may be a cancel.** Check whether the job hit `timeout-minutes` before
  blaming the PR. Raising it or sharding is its own `chore/` PR.
- **A backgrounded tab freezes `requestAnimationFrame`.** Measure motion in
  Playwright's own browser, not a backgrounded DevTools tab.
