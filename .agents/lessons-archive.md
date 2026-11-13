# Lessons archive

Entries from `lessons.md` that no longer need reading before every change: a
deterministic guard now enforces them, or they went quiet. The format and rules are
in `lessons.md`. `scripts/lessons/select.mjs --archive` searches this file too.

IDs stay unique across both files. If an archived lesson happens again, move it back
to `lessons.md` (when it is unguarded) or fix the guard (when the guard missed it).

## Guarded

The Git rules below are enforced by the Claude Code `PreToolUse` hook in
`.claude/settings.json`, which runs `scripts/hooks/guard-git.mjs` before every Bash
call and blocks with the rule name and the lesson ID. Its tests are in
`scripts/hooks/guard-git.test.mjs` (CI `workflow` job). The hook covers every Bash
call in the Claude Code session, subagents included. Codex runs outside it but
cannot commit or push from its sandbox.

### L-001 — Merge with `--squash` only
- **Date:** 2026-10-11
- **Trigger:** carried over from the source workflow; it happened merging this workflow's own PR (CLAUDE.md **Traps**)
- **Symptom:** `gh pr merge --delete-branch` switched the worktree's checkout to `main`, which blocked every other workspace.
- **Root cause:** `--delete-branch` deletes the local branch too, so `gh` checks out the default branch first.
- **Rule:** merge with `gh pr merge <pr> --squash` (one commit per PR on `main`), then delete the remote branch with `git push origin --delete <branch>`.
- **Check:** the merge command has no `--delete-branch`, `--merge` or `--rebase`.
- **Guard:** hook `scripts/hooks/guard-git.mjs` rule merge-flags
- **Paths:** `**`

### L-002 — Never check out `main`
- **Date:** 2026-10-11
- **Trigger:** carried over from the source workflow (CLAUDE.md **Git**)
- **Symptom:** a worktree holding `main` blocks every other workspace from it.
- **Root cause:** Git lets a branch be checked out in only one worktree.
- **Rule:** stay on the task branch and diff against `origin/main`. `git checkout main -- <path>` (restoring a file) and `--detach` are fine.
- **Check:** `git status -sb` names the task branch.
- **Guard:** hook `scripts/hooks/guard-git.mjs` rule checkout-main
- **Paths:** `**`

### L-003 — Worktrees come from the host app
- **Date:** 2026-11-13
- **Trigger:** the move to T3 Code (CLAUDE.md **Host**)
- **Symptom:** a shell-made worktree is not bound to any T3 thread, so T3 does not track or clean it.
- **Root cause:** T3 owns worktree creation and cleanup.
- **Rule:** start unrelated work in a new T3 thread: `t3_thread_launch` with a `workspaceStrategy`.
- **Check:** no `git worktree add` in the session.
- **Guard:** hook `scripts/hooks/guard-git.mjs` rule worktree-add
- **Paths:** `**`

### L-004 — No co-author trailers
- **Date:** 2026-10-11
- **Trigger:** the user's rule (CLAUDE.md **Git**)
- **Symptom:** commits carrying `Co-authored-by` attribution.
- **Root cause:** default tool attribution.
- **Rule:** commit messages carry no `Co-authored-by` trailer or any co-author attribution.
- **Check:** `git log origin/main..HEAD --format=%B` has no `Co-authored-by`.
- **Guard:** hook `scripts/hooks/guard-git.mjs` rule co-author
- **Paths:** `**`

### L-005 — Never push to `main`
- **Date:** 2026-10-11
- **Trigger:** the user's rule (CLAUDE.md **Git**)
- **Symptom:** a direct push skips the PR, CI and review, and Workers Builds deploys it to production at once.
- **Root cause:** `main` has no branch protection, so nothing on GitHub stops it.
- **Rule:** push only the task branch; changes reach `main` by a reviewed PR. Never delete `main`.
- **Check:** every push names the task branch.
- **Guard:** hook `scripts/hooks/guard-git.mjs` rule push-protected
- **Paths:** `**`

The entry below is guarded by a hook on T3's delegation tool.

### L-006 — Install dependencies before a T3 handoff
- **Date:** 2026-11-13
- **Trigger:** the move to T3 Code: this repo's first T3 worktree had no `node_modules`; adc-website recorded the same as its L-036 on 2026-11-04
- **Symptom:** a fresh T3 worktree has no `node_modules`, so Codex's `npm run check` fails with "astro executable is unavailable" and the handoff returns no type-check evidence.
- **Root cause:** T3's project setup script (`npm ci`, `runOnWorktreeCreate: true` in `t3.json`) does not run on worktree creation. Codex cannot install packages from its sandbox.
- **Rule:** in **Git** step 1, run `npm ci` when `node_modules` is missing or older than `package-lock.json`, before any handoff or check. T3 workaround; remove it and the guard once T3 runs its setup script.
- **Check:** `node_modules/.package-lock.json` exists and is newer than `package-lock.json`.
- **Guard:** hook `scripts/hooks/guard-deps.mjs` (`PreToolUse` on `mcp__t3-code__delegate_task`), tests in `scripts/hooks/guard-deps.test.mjs` (CI `workflow` job)
- **Paths:** `**`
