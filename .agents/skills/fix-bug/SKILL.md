---
name: fix-bug
description: Fix a reported bug in the site (local or production). Restate the bug and acceptance criteria, open a draft PR on the workspace branch, reproduce, hand the fix to Codex, validate, and merge or hand off through the bug-fix gates.
---

# Fix a Bug

Use this whenever a bug is reported against the site — locally or in production. It is the detailed procedure behind the short Git rules in
`AGENTS.md` / `CLAUDE.md`.

Do not start editing code before step 3. The point of this skill is that the branch,
the acceptance criteria, and the PR exist before the fix does.

A bug whose cause and fix are layout, CSS, or animation goes to the
`layout-implementer` subagent instead of Codex (`CLAUDE.md` **Task routing**): it
diagnoses and fixes in the same run, and can reproduce in the browser itself. Every
gate below still applies; read "Codex" in steps 4–7 as that implementer.

**Ownership:** Claude owns requirements, acceptance criteria, a current `origin/main`, the
branch and draft PR, the build, reproduction and the browser check, review, Git,
merge, and cleanup; CI runs the browser suite. Codex owns repository inspection, root-cause diagnosis,
implementation, regression specs, applicable check/routing checks, self-review,
and its report. Codex never deploys, commits, pushes, creates branches, or opens PRs.

## Procedure

### 1. Understand and restate the bug — Claude

Before touching git, write a short summary back to the user covering:

- **Actual behaviour** — what happens now, on which page/component/breakpoint.
- **Expected behaviour** — what should happen instead (link the Paper artboard if
  the bug is visual).
- **Reproduction steps** — URL or local route, viewport, browser, interaction.
- **Acceptance criteria** — the concrete, checkable conditions that make this fixed.

Ask for the missing pieces if the report is thin, then stop for the user's OK
(`CLAUDE.md` **Approval**). The acceptance criteria are the contract for the rest of
the workflow.

### 2. Check the workspace branch — Claude

One bug per T3 thread (`CLAUDE.md` **Host**). T3 created the thread's worktree and
branch from `origin/main`; that branch is the fix branch. Do not create or rename
branches. First confirm with
`t3_worktree_status` that the thread is attached to its worktree.

```bash
git status -sb            # on the workspace branch, tree clean or see below
git fetch origin
git log --oneline origin/main..HEAD    # empty for a fresh workspace
```

Never check out `main` itself — see `CLAUDE.md` **Git**: in a worktree it blocks
every other workspace from doing the same.

If the working tree has unrelated uncommitted changes, **preserve them**. Do not
stash-and-forget, reset, or check out over them. Tell the user those changes are
present, and keep them out of the bug-fix commit.

### 3. Open a draft PR early — Claude

GitHub refuses a PR with nothing in it, so give the branch an empty commit to hang the
PR on:

```bash
git commit --allow-empty -m "chore: open <branch> for <summary>"
git push -u origin <branch>
gh pr create --draft --base main --title "fix: <summary>" --body "<problem + acceptance criteria>"
```

Seed the body with the step 1 summary. Call `link_pull_request` with the
PR URL right after creating it. This draft PR must exist before the Codex handoff.

CI runs on drafts: every push to this PR runs its route, and Workers Builds builds
a preview of the branch. The empty commit routes as `docs` and runs only the
Markdown lint.

### 4. Reproduce, then find the root cause — Claude reproduces, Codex diagnoses

Reproduce the bug before changing code. Claude reproduces it in the browser and puts
the evidence in the handoff's **Already established** section (route, viewport,
steps, console errors, computed layout, screenshots). Claude stops at reproduction:
it does not also diagnose in the code, since Codex would only rediscover it. Codex
works from that evidence plus reading the code, and states the root cause. Codex
cannot run any of the commands below.

**Claude only:**

- `astro dev --background` for the dev server (with `.dev.vars` from
  `.dev.vars.example`, so RSVP uses the fake store); the T3 `preview` script
  (`t3.json`: a fake-store build served with `env -u CLAUDECODE`) when the bug may
  only exist in the production build (bundling, image optimisation, hydration).
  Never reproduce RSVP, song or With Love submissions against the live store.
- Use browser tooling to inspect the failing element, console errors, network, and
  computed layout at the reported breakpoint.
- **A backgrounded browser tab cannot measure animation** — `requestAnimationFrame`
  is frozen there. Check `document.visibilityState` if a measurement looks
  impossibly clean. Playwright's own browser is fine.

State the root cause explicitly before writing the fix. "Changing this line made the
symptom go away" is not a root cause.

### 5. Implement the smallest fix — Codex

Touch only what the root cause requires. No opportunistic renames, reformatting,
dependency bumps, or refactors — those belong on their own `refactor/` or `chore/`
branch. Follow `LUMOS.md`.

### 6. Checks — Codex writes specs and self-validates; Claude runs browser checks

| Check | Command | When |
| --- | --- | --- |
| Types — Codex | `npm run check` | Any runtime path changed. |
| Build — Claude | `npm run build` | Any runtime path changed. Codex's sandbox cannot build (`.agents/skills/codex-handoff/SKILL.md`). |
| CI scripts — Codex | `npm run test:ci-scripts` | `scripts/ci/**` changed. |
| E2E — Claude | the new or changed spec once, `nice -n 15 npx playwright test <spec>` (`local-checks`) | Whenever the fix adds or changes a spec. CI runs the tier; no other local Playwright run. |
| Headed debugging — Claude | `npm run test:e2e:headed` / `npm run test:e2e:ui` | While diagnosing a failing spec. |
| Browser check — Claude | manual, via the dev server or `npm run preview` | Always for visual bugs. |
| Responsive check — Claude | manual, at the report's breakpoints | Whenever layout is involved. |

Add or extend a Playwright spec in `tests/` when the bug is reproducible headlessly.
A spec that **fails on `main` and passes on the branch** is the only objective proof
the fix works, and it is a hard requirement for auto-merge (step 9). Codex writes the
spec before the fix. Claude confirms it fails without the fix and passes with it, and
records both results in the PR body. These are local runs: CI runs only the branch,
so the failing-on-`main` result exists only in the PR body.

Never check out `main` and never `git worktree add` (both are hook-blocked). With the
fix committed, put the fixed source files back to `origin/main` in place, run the
spec, then restore them. Leave the spec file at the branch version throughout.

```bash
git restore --source=origin/main --worktree -- <fixed src files>
nice -n 15 npx playwright test <spec>      # expect FAIL
git restore --source=HEAD --worktree -- <fixed src files>
git status --porcelain                     # expect clean
```

#### Motion bugs need per-frame samples

For anything scroll-driven or animated, **sampling settled positions is not
evidence** (L-009). Scroll somewhere, wait, read the value back, and a broken
animation reads perfect. Drive real continuous motion and read on every frame:

```js
await page.evaluate(() => {
  window.__frames = [];
  const el = document.querySelector("<selector>");
  const tick = () => {
    window.__frames.push({ y: window.scrollY, top: el.getBoundingClientRect().top });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.mouse.move(600, 450);
for (let i = 0; i < 55; i += 1) {
  await page.mouse.wheel(0, 60);
  await page.waitForTimeout(40);
}
```

Assert on the spread or the peak across the frames in range, never a single reading.
Use `page.mouse.wheel`, not `window.scrollTo` — the bug may need real scroll input.

Check the result against the step 1 acceptance criteria one by one. If any fails, go
back to step 4. Never skip, delete, or `test.skip` a failing test.

### 7. Review the full working tree, then commit — Codex, then Claude

```bash
git status -sb            # confirm the branch has not moved under you
git diff HEAD
git diff --stat HEAD
```

`git diff origin/main...HEAD` misses the changes Codex left in the working tree. Remove
anything accidental: `console.log`, commented-out experiments, debug outlines,
unrelated files, `test-results/`.

```bash
git add src/... tests/...
git commit -m "fix: <imperative summary>"
```

Conventional Commit, `fix:` type. Never add a `Co-authored-by` trailer.

Then push to the draft PR. The push starts its CI run and its preview build:

```bash
git push
```

### 8. Update the PR, review the draft, then Local review — Claude

Rewrite the PR body as the full record: **Problem**, **Root cause**, **Solution**,
**Files changed**, **Testing performed** (exact commands and results — never a check
that did not run), **Verification against acceptance criteria**, **Screenshots** for
visual fixes (described, with their `.context/review/` paths: images are not
uploaded), **Caveats**. Commit any lessons entry the fix needs now, before the
review. As soon as the draft is open, run `.agents/skills/review-pr/SKILL.md`
on the draft and post its verdict.

A fix on the `runtime` route then goes to **Local review** (`review-pr`). Go on to
step 9 only once the user ships it.

### 9. Merge or hand off — Claude

A bug fix may merge itself **only** when every gate passes. One failure means hand
off.

| # | Gate | How to verify |
| --- | --- | --- |
| 1 | CI is green on the PR, and a `PASS` is posted, on the same head commit | `gh pr checks <pr>` and the `## Review — PASS @ <sha>` comment. A skipped `gate` is not green. Never merge past a red, pending, or skipped run, or a verdict on an older head. |
| 2 | A regression spec fails on `main` and passes on the branch | Both results recorded in the PR, from step 6. A flaky-spec fix, where this cannot apply, hands off. |
| 3 | The diff touches only `src/` and `tests/` (plus `public/` if the bug is an asset, and `.agents/lessons.md` for the step 8 lessons entry) | `git diff --name-only origin/main...HEAD`. Any change to `package.json`, lockfile, Astro / TS / Playwright / Wrangler config, `.github/`, `.claude/`, `docs/`, or `.agents/` other than `lessons.md` disqualifies. |
| 4 | The source diff is at most 50 changed lines, excluding `tests/` | `git diff --shortstat origin/main...HEAD -- src`. |
| 5 | The acceptance criteria came from the user | Criteria you inferred do not count — ask, or hand off. |
| 6 | Every acceptance criterion is met by a measured check | A committed spec, or a measurement recorded in the PR body with command, viewport, and numbers. "Looked fixed" is not a measurement. |
| 7 | The root cause is inside this repo | A root cause in hosting, a third-party service (Google Sheets, Cloudflare, Spotify), or the design itself hands off. |

**If all gates pass:** confirm the branch is up to date (`git fetch origin` and
`git merge-base --is-ancestor origin/main HEAD`; see `review-pr` **Merging** if
not), then `gh pr ready <pr>` and `gh pr merge <pr> --squash` (never `--merge`,
never `--delete-branch`; L-001). Merging deploys production, so confirm the Workers
Build for the merge reached success (`review-pr` **Deploying**), then report what
merged, which gates passed, the CI run link, and the deploy result.

Call `unwatch_pull_request` on the PR before either report below.

**If any gate fails:** mark the PR ready, stop, and report the PR link plus exactly
which gate failed and why.

### 10. After the merge — Claude

```bash
gh pr view <pr> --json state,mergedAt    # state MERGED, mergedAt non-null
git push origin --delete <branch>
git fetch origin --prune
git status --porcelain
```

Leave the worktree on the merged branch; the app removes it, not Claude. Archiving the
thread does not: T3's "Delete merged worktrees" cleanup removes it once the PR is merged and its
commits are in `main`, or when the thread is deleted, and keeps a worktree with
uncommitted changes. Check `list_thread_pull_requests` before finishing.

## Never

- Work directly on `main`, or push to `main`.
- Say something was tested when it was not, or report a check that did not run.
- Leave a failing test hidden, skipped, or deleted.
- Mix unrelated changes into the bug-fix PR.
- Commit debug code.
- Rewrite or discard the user's existing uncommitted changes.
- Bypass a repo convention without saying, in the PR, which one and why.
