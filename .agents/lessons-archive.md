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

### L-058 — Never pipe the gate in front of a push
- **Date:** 2026-11-22
- **Trigger:** #102, a failing head pushed (a730968)
- **Symptom:** `npm run prepush 2>&1 | tail -1 && git push` printed "prepush failed at test:unit" and pushed anyway, because the `&&` saw `tail`'s exit status. The failure was a real same-millisecond ordering bug in the D1 host save.
- **Root cause:** the pipe-commit hook rule covers commits only; the same pipe before `git push` is not caught, and trimming output with a pipe felt harmless.
- **Rule:** run the gate unpiped and redirect its output to a file instead: `npm run prepush > .context/<task>/prepush.log 2>&1 && git push`, then read the log. Never put `| tail`, `| head` or `| grep` between a check and `&&`.
- **Check:** every push in the thread follows an unpiped `prepush` whose exit status gates it.
- **Guard:** hook `scripts/hooks/guard-git.mjs` rule pipe-push
- **Paths:** `.agents/skills/local-checks/**`, `scripts/hooks/**`

### L-030 — A full-bleed decoration must escape the global `svg` max-width
- **Date:** 2026-11-17
- **Trigger:** #83, the user's correction; escape: runtime #79 (the attire clothesline string stopped at the content edges on a wide screen)
- **Symptom:** an SVG sized `width: 100vw` and centred to bleed past its container stopped at the container's width: 64–1376 at 1440 and 240–1680 at 1920.
- **Root cause:** `src/styles/base.css` caps every `svg` at `max-width: 100%`, which wins over `width: 100vw` and limits the SVG to its parent's width. Nobody measured the string wider than 1440.
- **Rule:** a full-bleed SVG (or img) sets `max-width: none` beside its viewport width, and its spec measures its box against the viewport at a wide width (1920 and 2560) as well as the artboard widths.
- **Check:** the spec asserts the decoration's bounding box runs from 0 to the viewport width at 1920 and 2560, and that `scrollWidth` equals the viewport width.
- **Guard:** test — `tests/attire.spec.ts` ("runs the clothesline string edge to edge at …px", 320–2560)
- **Paths:** `src/components/**`, `src/styles/base.css`

### L-040 — An entrance behind an overlay plays to no one
- **Date:** 2026-11-20
- **Trigger:** escape: runtime #89 Local-review round (the user asked to check the hero reveal after the envelope; it had already finished behind the preloader)
- **Symptom:** the hero entrance ran on page load under the envelope preloader, so first-time guests never saw it; only returning guests, who skip the envelope, did.
- **Root cause:** `initHero` started its timeline on module load with no knowledge of the preloader, and a motion audit of sections reviewed each reveal on its own, not what covers it.
- **Rule:** an entrance animation for content under an overlay (preloader, modal) starts when the overlay begins closing, from a document event the overlay dispatches (`ew:preloader-close`), with a fail-safe that reveals the content if the overlay goes away without it. The handler respects reduced motion on its own; the event can arrive with reduced motion on.
- **Check:** `tests/preloader.spec.ts` "reveals the hero when just browsing closes the preloader" asserts the hero is hidden while the envelope is open and visible after it closes.
- **Guard:** test — the spec above
- **Paths:** `src/components/sections/Hero.astro`, `src/components/global/Preloader.astro`

### L-048 — Size a heading by its longest real text at the narrowest width
- **Date:** 2026-11-21
- **Trigger:** #96 Local review round 1 (the user's correction: the phone Overview greeting "Good evening, Eunice" wrapped to 3 lines beside the deadline stamp; 2 lines is the limit)
- **Symptom:** a display heading that shares a row with a side element (stamp, button) fits the artboard copy but wraps to three or more lines with real text at phone widths.
- **Root cause:** the layout matched Paper's short "Hi, Eunice" and kept the side element in the heading's row, leaving the heading about 235px at 390.
- **Rule:** when a heading's text comes from data or a helper (greetings, names, counts), size and place it for the longest text it can produce at 320px, not the artboard sample. Give it the full width on phones if a side element would squeeze it, and cap the font with a `vw` term.
- **Check:** a spec sets the heading to its longest variant and asserts the line count at 320–1023 (`tests/admin.spec.ts` "keeps the greeting to two lines on phones").
- **Guard:** test — `tests/admin.spec.ts`
- **Paths:** `src/pages/**`, `src/styles/**`, `src/components/**`
