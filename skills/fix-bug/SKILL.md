# Fix a Bug

Use this whenever a bug is reported against the site — locally, on a preview deploy,
or in production. It is the detailed procedure behind the short Git rules in
`AGENTS.md` / `CLAUDE.md`.

Do not start editing code before step 4. The point of this skill is that the branch,
the acceptance criteria, and the PR exist before the fix does.

**Ownership:** Claude owns requirements, acceptance criteria, clean `main`, the
branch and draft PR, all browser / E2E / deploy-preview validation, review, Git,
merge, and cleanup. Codex owns repository inspection, root-cause diagnosis,
implementation, regression specs, applicable check/build/routing checks, self-review,
and its report. Codex never deploys, commits, pushes, creates branches, or opens PRs.

## Procedure

### 1. Understand and restate the bug — Claude

Before touching git, write a short summary back to the user covering:

- **Actual behaviour** — what happens now, on which page/component/breakpoint.
- **Expected behaviour** — what should happen instead (link the Paper artboard if
  the bug is visual).
- **Reproduction steps** — URL or local route, viewport, browser, interaction.
- **Acceptance criteria** — the concrete, checkable conditions that make this fixed.

Ask for the missing pieces if the report is thin. The acceptance criteria are the
contract for the rest of the workflow.

### 2. Prepare a clean `main` — Claude

```bash
git status --porcelain    # must be empty, or see below
git checkout main
git pull origin main
```

If the working tree has unrelated uncommitted changes, **preserve them**. Do not
stash-and-forget, reset, or check out over them. Create the branch from the current
state so the changes are carried along, tell the user those changes are present, and
keep them out of the bug-fix commit.

### 3. Branch — Claude

```bash
git checkout -b fix/<short-kebab-description>
```

Name it after the symptom, not the guessed cause: `fix/mobile-nav-overflow`. One bug
per branch.

### 4. Open a draft PR early — Claude

GitHub refuses a PR with nothing in it, so give the branch an empty commit to hang the
PR on:

```bash
git commit --allow-empty -m "chore: open <branch> for <summary>"
git push -u origin fix/<branch>
gh pr create --draft --base main --title "fix: <summary>" --body "<problem + acceptance criteria>"
```

Seed the body with the step 1 summary. The empty commit is absorbed by the squash
merge. This draft PR must exist before the Codex handoff.

### 5. Reproduce, then find the root cause — Codex (Claude confirms in browser)

Reproduce the bug before changing code. Claude performs browser reproduction and
gives Codex the evidence; Codex inspects the repository and states the root cause.

- `npm run dev` for the dev server; `npm run build && npm run preview` when the bug
  may only exist in the production build (bundling, image optimisation, hydration).
- Use browser tooling to inspect the failing element, console errors, network, and
  computed layout at the reported breakpoint.
- **A backgrounded browser tab cannot measure animation** — `requestAnimationFrame`
  is frozen there. Check `document.visibilityState` if a measurement looks
  impossibly clean. Playwright's own browser is fine.

State the root cause explicitly before writing the fix. "Changing this line made the
symptom go away" is not a root cause.

### 6. Implement the smallest fix — Codex

Touch only what the root cause requires. No opportunistic renames, reformatting,
dependency bumps, or refactors — those belong on their own `refactor/` or `chore/`
branch. Follow `skills/astro-component/SKILL.md`.

### 7. Checks — Codex writes specs and self-validates; Claude runs browser checks

| Check | Command | When |
| --- | --- | --- |
| Types — Codex | `npm run check` | Any runtime path changed. |
| Build — Codex | `npm run build` | Any runtime path changed. |
| Routing — Codex | `npm run test:routing` | `scripts/ci/**` changed. |
| E2E — Claude | `npm run test:e2e` | Always for behaviour or layout changes. |
| Headed debugging — Claude | `npm run test:e2e:headed` / `npm run test:e2e:ui` | While diagnosing a failing spec. |
| Browser check — Claude | manual, via `npm run dev` or the preview deploy | Always for visual bugs. |
| Responsive check — Claude | manual, at the report's breakpoints | Whenever layout is involved. |

Add or extend a Playwright spec in `tests/` when the bug is reproducible headlessly.
A spec that **fails on `main` and passes on the branch** is the only objective proof
the fix works, and it is a hard requirement for auto-merge (step 10). Codex writes the
spec before the fix. Claude runs it against `main` to confirm it fails, against the
branch to confirm it passes, and records both results in the PR body.

#### Motion bugs need per-frame samples

For anything scroll-driven or animated, **sampling settled positions is not
evidence.** Scroll somewhere, wait, read the value back, and a broken animation reads
perfect. Drive real continuous motion and read on every frame:

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
back to step 5. Never skip, delete, or `test.skip` a failing test.

### 8. Review the full working tree, then commit — Codex, then Claude

```bash
git status -sb            # confirm the branch has not moved under you
git diff HEAD
git diff --stat HEAD
```

`git diff main...HEAD` misses the changes Codex left in the working tree. Remove
anything accidental: `console.log`, commented-out experiments, debug outlines,
unrelated files, `test-results/`.

```bash
git add src/... tests/...
git commit -m "fix: <imperative summary>"
git push
```

Conventional Commit, `fix:` type. Never add a `Co-authored-by` trailer.

### 9. Update the PR and mark it ready — Claude

Rewrite the PR body as the full record: **Problem**, **Root cause**, **Solution**,
**Files changed**, **Testing performed** (exact commands and results — never a check
that did not run), **Verification against acceptance criteria**, **Screenshots** for
visual fixes, **Caveats**. Mark it ready (`gh pr ready`), then run
`skills/review-pr/SKILL.md`.

### 10. Merge or hand off — Claude

A bug fix may merge itself **only** when every gate passes. One failure means hand
off.

| # | Gate | How to verify |
| --- | --- | --- |
| 1 | CI is green on the PR | `gh pr checks <pr>`. Never merge past a red or pending run. |
| 2 | A regression spec fails on `main` and passes on the branch | Both results recorded in the PR, from step 7. A flaky-spec fix, where this cannot apply, hands off. |
| 3 | The diff touches only `src/` and `tests/` (plus `public/` if the bug is an asset) | `git diff --name-only main...HEAD`. Any change to `package.json`, lockfile, Astro / TS / Playwright config, `.github/`, `skills/`, or `docs/` disqualifies. |
| 4 | The source diff is at most 50 changed lines, excluding `tests/` | `git diff --shortstat main...HEAD -- src`. |
| 5 | The acceptance criteria came from the user | Criteria you inferred do not count — ask, or hand off. |
| 6 | Every acceptance criterion is met by a measured check | A committed spec, or a measurement recorded in the PR body with command, viewport, and numbers. "Looked fixed" is not a measurement. |
| 7 | The root cause is inside this repo | A root cause in hosting, a third-party service, or the design itself hands off. |

**If all gates pass:** `gh pr merge <pr> --squash --delete-branch`, then report what
merged, which gates passed, and the CI run link.

**If any gate fails:** mark the PR ready, stop, and report the PR link plus exactly
which gate failed and why.

### 11. After the merge — Claude

```bash
gh pr view <pr> --json state,mergedAt    # state MERGED, mergedAt non-null
git checkout main
git pull origin main
git branch -d fix/<branch>
git push origin --delete fix/<branch>   # if not deleted automatically
git status --porcelain
```

## Never

- Work directly on `main`, or push to `main`.
- Say something was tested when it was not, or report a check that did not run.
- Leave a failing test hidden, skipped, or deleted.
- Mix unrelated changes into the bug-fix PR.
- Commit debug code.
- Rewrite or discard the user's existing uncommitted changes.
- Bypass a repo convention without saying, in the PR, which one and why.
