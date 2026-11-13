---
name: review-pr
description: Review an open pull request, draft or ready, as soon as it opens, in parallel with CI. Saves the diff and criteria, runs the pr-reviewer subagent (Sonnet 5.5), adds the Codex second opinion on a risky change, posts the PASS / CHANGES_REQUIRED / BLOCKED verdict on the PR once gate settles on the head, runs Local review on the Cloudflare preview for runtime changes, runs fix rounds, squash-merges on PASS (runtime also needs "ship it"), and confirms the Workers Build that deploys main to production.
---

# Review a Pull Request

Every PR gets a review before it is considered complete. This skill defines who
reviews, what they judge, what verdict they return, and what happens next. Run it
as soon as the PR is open, draft or ready, in parallel with CI: the
reviewer reads the diff while `gate` runs, and the verdict is posted once `gate`
has settled on the same head. For `runtime` the verdict goes in the review pack
(**Local review** below); a runtime `PASS` is necessary for the merge, not
sufficient. For a bug fix, this is step 8 of `.agents/skills/fix-bug/SKILL.md`.

## The `pr-reviewer` subagent reviews

The review runs in a fresh `pr-reviewer` subagent (`.claude/agents/pr-reviewer.md`,
pinned to Claude Sonnet 5.5). It has no memory of how the change was built, so it
judges the diff rather than the intent. A PASS can authorize a merge, which
deploys to production, so the reviewer must not be the session that built the
change. Spawn it
without a per-call `model` override.

The subagent can only read files. Before spawning it, Claude saves its inputs to
`.context/review-<pr>/`:

```bash
mkdir -p .context/review-<pr>
gh pr diff <pr> > .context/review-<pr>/diff.patch
gh pr checks <pr> > .context/review-<pr>/checks.txt
gh pr diff <pr> --name-only | node scripts/lessons/select.mjs > .context/review-<pr>/lessons.md
```

`lessons.md` holds the `.agents/lessons.md` entries whose **Paths** match the diff
(`CLAUDE.md` **Lessons**), or a note that none match.

and writes `.context/review-<pr>/task.md` with:

- the task description and the acceptance criteria the user approved
- the CI route (the review tier)
- who implemented it: Codex (and on which model), `layout-implementer`, or Claude
  directly
- on a risky PR, the Codex second-opinion findings (below), saved as
  `codex-review.md`
- test evidence and measurements, for example a regression spec failing on
  `origin/main` and passing on the branch
- on a repeat round, the previous findings and how each was resolved

Then spawn `pr-reviewer` with: "Review PR <pr>. Inputs are in
`.context/review-<pr>/`." Its report is the verdict.

Claude does not overrule a `CHANGES_REQUIRED` or `BLOCKED` verdict. If Claude thinks
a finding is wrong, it records why in `task.md` and runs another round. That still
counts toward the three-round cap.

The Codex report's `VALIDATION` block is evidence, not a review pass.

## Codex second opinion (risky PRs)

A different model family tends to catch different mistakes, so a risky `runtime`
PR (`CLAUDE.md` **Roles**: the RSVP, song and With Love actions and stores, the API
routes, dependencies, or root config such as `wrangler.jsonc` and
`astro.config.mjs`) also gets a read-only Codex review. Every other PR is reviewed by `pr-reviewer` alone. It uses the
ChatGPT plan, not the Claude plan.

1. As soon as the PR is open (a draft runs CI too), save `gh pr diff <pr>` and the
   approved acceptance criteria to `.context/review-<pr>/`, and start the review with
   `delegate_task`: `role: "review"`, `gpt-5.6-luna`, `isolation: "shared"`, and a
   `clientRequestId` of `<branch>-codex-review`. Never use the Codex plugin or `/codex:review`.
2. The brief: "Read-only review. Do not modify, create, or delete any file. Report
   only bugs you can verify from the code, each with `path:line`, the failing input
   or scenario, and the evidence. No style or naming comments, and no suggestions
   without a bug behind them. If you find nothing, say `NO FINDINGS`."
3. When it ends, run `git status` and confirm nothing changed. A change means the run
   broke its brief: revert nothing yourself, stop, and tell the user.
4. Save its findings as `codex-review.md` for `pr-reviewer`. The reviewer upholds a
   finding only if the evidence holds, and its verdict stays the only verdict. An
   upheld finding is a normal `CHANGES_REQUIRED` finding. The verdict comment
   records the counts (**Verdicts**); no tally file is kept.

If the Codex review fails or hits the plan's usage limit, note it in `task.md` and
review without it.

## Commit bookkeeping before the first verdict

The first `pr-reviewer` verdict covers every commit the PR already knows it needs:
lessons entries and docs rows. Landing them after the `PASS` costs a second `gate`
wait and a delta re-review.

1. Commit every lessons and docs change the PR needs before opening it, or in one
   commit right after, before the review starts.
2. Save the diff of that head and run `pr-reviewer` on it while CI runs
   (**Review in parallel with CI**). The Codex second opinion, when the PR is risky,
   starts at the same time.

The one exception is a lesson that a `CHANGES_REQUIRED` verdict itself triggers: it
can only be written after that verdict, so it goes in with the fix commit, which gets
a delta re-review anyway (**A new push voids the verdict**).

## Review in parallel with CI

The reviewer reads the diff; CI runs the tests. Neither waits for the other. Once
the PR is open and its inputs are saved, spawn `pr-reviewer` at once, with
`checks.txt` showing the pending checks and `task.md` saying that CI is still
running on this head. The reviewer judges the diff, the criteria and the evidence,
and treats CI as unknown: it returns its verdict on the code alone. Claude holds that
verdict until `gate` settles.

CI runs on every push to a PR, draft or ready, and `gh pr ready <pr>` starts no
run. A skipped `gate` is not green. After each push, start the review,
then wait for CI on the head: call `watch_pull_request` on the PR (its URL, or
`repository` plus `number`) and end the turn. Do not poll, sleep, or run
`gh pr checks --watch`. T3 checks the PR every two minutes and wakes the thread when
a check fails, the required checks pass, someone else comments or reviews, or the
branch starts to conflict with its base. Only comments posted after the call wake
it, so handle existing ones first. A wake is news, not a verdict: read
`gh pr checks <pr>` and confirm `gate` on the head commit.

The verdict comment is posted only after `gate` has settled on the head commit, and
it records the settled result. Green `gate` plus the reviewer's `PASS` is a posted
`PASS`. Red `gate` with a `PASS` from the reviewer is posted as `CHANGES_REQUIRED`
with the failed job as a finding; route the failure like any other finding, push the
fix, and re-review the delta on the new head. A reviewer `CHANGES_REQUIRED` is
posted as such once `gate` settles, with the CI line filled in either way.

## Review tiers

Use the CI `classify` route from `gh run view` / the `classify` job log, or classify
the committed diff locally:

```bash
git diff --name-only origin/main...HEAD | node scripts/ci/classify-paths.mjs
```

- **Full (`runtime`)** — `src/**`, `public/**`, `tests/**`, Astro / TypeScript /
  Playwright config, `wrangler.jsonc`, or dependencies. Run the full process below:
  review in parallel with CI, judge every applicable axis, and allow up to three
  rounds. Bug-fix gates still apply. CI runs the full suite (`local-checks` **CI
  routes**). `task.md` records the `Local:` line from
  `local-checks` (`prepush`, the specs the author ran once, the browser check); a
  new or changed spec with no recorded run is a finding. Before the review, Claude
  performs browser and responsive verification where the diff reaches them,
  comparing against the Paper artboard for visual work, and records it in `task.md`.
- **Workflow (`workflow`)** — `AGENTS.md`, `CLAUDE.md`, `SETUP.md`, `.agents/skills/**`,
  `.agents/lessons*.md`, `.claude/**`, `.github/**`, `scripts/ci/**`,
  `scripts/hooks/**`, `scripts/lessons/**`, `.mcp.json`, `.markdownlint-cli2.jsonc`,
  `skills-lock.json` or `t3.json` (`.conductor/**`, `scripts/codex/**` and `skills/**`
  too, so their deletion routes here). Run one focused mandatory
  review. Check internal consistency between the agent files
  and skills, explicit ownership for every step, that Codex is never told to exceed
  its sandbox, fail-closed CI routing, and the model policy. Do not browser-test
  unless runtime files are also present. Workflow instructions are operational code:
  a wrong instruction ships a wrong process.
- **Docs quick (`docs`)** — substantive prose. `pr-reviewer` performs one diff review
  for accuracy against the code described,
  links, and scope. A finding goes back through the handoff or, if Claude authored the change,
  is fixed directly and re-pushed. There is no formal three-round loop.
- **Trivial docs** — typo- or formatting-only Markdown with no meaning change, made
  under `CLAUDE.md` **Task routing** (mechanical edits). `pr-reviewer` still reviews it, with tier
  `trivial`, and Claude merges on PASS once `gate` is green.

## What the review does not do

The review is a reading pass, not a second CI run.

- **Do not build or run the test suite.** CI does, on the same commit, in a clean
  environment. Read `gh pr checks <pr>`; a red check is a finding on its own, and a
  pending one is noted as unknown and settled by Claude before the verdict is
  posted (**Review in parallel with CI**).
- **Do not check out `main` to verify a regression test fails there.** That evidence
  belongs in the PR body, put there by whoever wrote the fix
  (`.agents/skills/fix-bug/SKILL.md` requires it). Its *absence* is the finding.
- **Do not re-derive measurements the PR already reports.** Judge whether the number
  answers the criterion and whether the method behind it is sound.
- **Do not fix anything during full or workflow review.** Findings go back through
  the loop below. For docs, follow the tier rule above.

## What the reviewer judges

Judge what the diff actually touches. Skip axes the change cannot reach — a CSS-only
diff has no hydration surface, and a test-only diff has no responsive behavior.

Always:

- the diff against the stated task and acceptance criteria
- correctness and regression risk
- scope — anything in the diff that the task did not ask for
- repository architecture and project conventions (`LUMOS.md`,
  `.agents/skills/astro-component/SKILL.md`, existing patterns in `src/`)
- code quality and maintainability
- whether the reported validation actually covers the criteria, and whether any check
  was claimed rather than run
- every lesson in `lessons.md`, as a checklist: a change that breaks one is a finding
  that cites its ID (`path:line — breaks L-NNN: problem — fix`)

Where the diff reaches them:

- fidelity to the Paper design: tokens used rather than raw values, spacing, type
- responsive behavior at 390 and 1440, and nothing broken at 320 and 768
- copy: `.agents/product-marketing.md` **Rules** (no em dashes in new or changed
  copy, no invented dates, names or prices)
- client JavaScript: whether it is needed at all, hydration directive, cleanup,
  duplicate initialization
- accessibility — semantics, focus, contrast, `prefers-reduced-motion`
- performance — image handling, shipped JS, layout shift
- metadata, and `SITE_INDEXABLE` staying `false` until the user launches
- guest data: no real guest names or contact details in the repository or the
  client bundle; the RSVP, song and With Love paths keep the fake store outside
  production
- Playwright specs: they assert width-independent invariants and time motion by the
  clock, not frame counts (L-009)
- flake fixes: the PR body shows the failure reproduced under load before the fix
  and gone after: a `flake-check.yml` run (20 repeats under load, no retries)
  before and after, or `--repeat-each 20 --workers 8` locally when the flake
  reproduces there. A green "before" run cited as proof is `CHANGES_REQUIRED`

## Verdicts

The reviewer returns exactly one of `PASS`, `CHANGES_REQUIRED`, or `BLOCKED`.
File findings use `path:line — problem — fix`. A blocker with no file location uses
`N/A — blocker — <required input>`.

Claude posts the verdict on the PR, once `gate` has settled on the head, before
doing anything else with it:

```bash
gh pr comment <pr> --body "$(cat <<'EOF'
## Review — <PASS|CHANGES_REQUIRED|BLOCKED> @ <head sha>

- Tier: <full|workflow|docs|trivial>
- Axes judged: ...
- CI: gate <result>, jobs run: <list>
- Findings: <none | path:line — problem — fix | N/A — blocker — required input, one per line>
- Lessons checked: <L-NNN, … | none matched>
- Reviewer: pr-reviewer (Sonnet 5.5)
- Authorship: <Codex luna | Codex sol | layout-implementer | Claude>
- Codex second opinion: <N raised, N upheld | NO FINDINGS | skipped: not a risky PR | failed>
EOF
)"
```

The comment is the record that a review happened. A merge with no review comment on
the head commit is a contract violation, not a shortcut.

### A new push voids the verdict

A verdict and a green `gate` belong to one head SHA. Any push after them, a fix,
a feedback round, or a merge of `main`, voids both for the new head: run a targeted
re-review at once (`pr-reviewer` with the delta since the reviewed SHA,
`git diff <reviewed sha>..HEAD`, saved as `delta.patch` next to the full diff, and
the prior verdict in `task.md`), wait for `gate` on the new head, and post the new
verdict with the new head SHA.
Every commit the PR needs (lessons, docs rows) goes in before the first
verdict (**Commit bookkeeping before the first verdict**), so on `runtime` the review
pack and "ship it" never meet an unreviewed head.

### PASS

Only when all of these hold:

- no blocking findings remain
- CI checks pass, per `gh pr checks <pr>`; the posted verdict waits for `gate`
- applicable tests pass
- every acceptance criterion is satisfied
- the diff is limited to the intended scope
- no debug or temporary code remains

### CHANGES_REQUIRED

Something concrete must change. Route each finding by ownership:

- **finding in a `layout-implementer` change** → a new `layout-implementer` run
  carrying the findings (`CLAUDE.md` **Task routing**). After two failed runs
  on the same finding, Claude takes over.
- **finding in a mechanical edit Claude made** → Claude corrects it directly if it
  is still mechanical, or routes it to Codex if fixing it needs logic.
- **repository code finding** → Claude turns it into a fix request and sends it to
  Codex as a fix round (see `.agents/skills/codex-handoff/SKILL.md`): a new
  `delegate_task` call carrying the original handoff, all findings, Codex's previous
  report, and unresolved objections, under a new `clientRequestId`. It names the same
  branch. Codex fixes and self-validates; Claude runs `local-checks`, reviews the
  diff, commits, and pushes.
- **design finding** (the design itself is ambiguous or wrong) → Claude checks Paper
  and, if Paper does not settle it, returns `BLOCKED` for the user.

If a fix changes what renders, it goes back to the user for local review on the
rebuilt preview, with the new verdict in the pack (**Local review** below,
steps 2–5). A test-only or CI-only fix does not, but it still needs `gate` and a
fresh verdict on its head before any merge.

Return all findings from one round to Codex together in one fix round, never one
at a time. Push the round once, when all its fixes are in (`local-checks` **Push
once per round**). After the fix is pushed, refresh `.context/review-<pr>/` and spawn a new
`pr-reviewer`, with the prior findings and their resolution in `task.md`; post its
verdict once `gate` settles on the new head.

**Cap the loop at three review rounds.** If round three does not return `PASS`, stop
and return `BLOCKED`. A finding that survives three attempts is a design problem, not
an implementation slip, and it belongs with the user.

### BLOCKED

Use it when proceeding safely needs user judgment, missing requirements,
unavailable credentials, inaccessible infrastructure, ambiguous acceptance criteria,
a dependency the agents cannot resolve, or a third failed review round.

Call `unwatch_pull_request` first. Hand the PR to the user with the PR
link, what is blocked, what has already been
verified, and the exact decision or input required, written as
`N/A — blocker — <required input>`.

Never merge a blocked PR.

## Local review (`runtime`)

The user reviews a `runtime` change on the PR's Cloudflare preview while the PR is a
draft, after CI and this review. Previews build every non-`main` branch with
`npx wrangler preview`; `wrangler.jsonc` `previews` gives them the fake RSVP, song
and With Love store, so nothing a reviewer submits reaches the guest sheet.

1. **Push a draft.** After the local checks (`local-checks`), commit, push, and
   `gh pr create --draft --base main` (a bug fix pushes to its existing draft).
   `link_pull_request`. The push starts the preview build and CI in parallel. Every
   lessons and docs commit the PR already needs goes in now (**Commit bookkeeping
   before the first verdict**). After "ship it", commit only a needed fix.
2. **Confirm the preview.** Wait for the Workers Builds check on the head commit (red:
   read the build log and fix). The URL is
   `https://<branch, / as ->-eunice-warren.neil-e89.workers.dev`; the Workers Builds
   comment on the PR also lists it. Load it once with `curl -sI` and expect `200`;
   never in a loop (L-012).
3. **Review the draft.** As soon as it is open, run this skill: `pr-reviewer`, and
   the Codex second opinion on a risky PR, in parallel with CI. Post the verdict once
   `gate` settles on the head. A `CHANGES_REQUIRED` finding is fixed before the pack
   goes out.
4. **Post the review pack** with `gh pr comment`: the preview URL, the changed paths,
   what Claude checked and at which widths, the verdict and its head SHA, doubts, and
   open questions. Screenshots (QA at 390 and 1440, plus 320 or 768 when the layout
   changes there, a Paper side-by-side for design work, a recording when motion
   changed) go to `.context/review/<pr>/round-<k>/` and are linked by path. Never
   upload them anywhere.
5. **Stop and wait.** The user reviews on the link, on any device. Claude never
   starts a review server for them; the T3 `dev` and `preview` scripts are their
   optional local path.
   - **Feedback** → route per `CLAUDE.md` **Task routing**, `local-checks`, commit,
     push, and repeat steps 2–4 naming what changed. A new push voids the head's CI
     result and verdict: re-review the delta, wait for `gate` on the new head, and
     post the verdict before the pack. Then stop again.
   - **"Ship it"** (or "push", "merge", "go") → **Merging**.
6. A fix after "ship it" comes back for review only if it changes what renders. A
   test-only or CI-only fix does not stop, but it still needs `gate` and a fresh
   verdict on its head before the merge.

## Merging

- **`docs` and `workflow`**: a posted `PASS` on the PR's head commit plus green
  `gate` authorizes Claude to merge, without asking the user, once the branch is up
  to date with `main`. A PR opened as a draft is marked ready first
  (`gh pr ready <pr>`; it starts no run).
- **`runtime`**: the merge needs the user's "ship it" **and** a posted `PASS` on
  the current head. On "ship it", verify that `PASS`, green `gate` on the same head,
  and the up-to-date check below; if all hold, run `gh pr ready <pr>` and
  `gh pr merge <pr> --squash` at once. There is no new CI run to wait for.

Check immediately before merging. `main` has no branch protection (the user
declined the paid plan), so this check is the only guard against a race:

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
```

If that fails, `main` moved since CI ran: `git merge --no-edit origin/main` on the
task branch, push, run a short fresh review of the integration delta while `gate`
runs on the new head (**A new push voids the verdict**): a clean merge of `main`
gets a fresh verdict too. It goes back to the user for **Local review** only if the
resolution changes what renders. Then check again. This makes the
squashed commit's tree the tree CI passed. Then merge:

```bash
gh pr merge <pr> --squash
```

One commit per PR on `main`; the hook blocks `--merge`, `--rebase` and
`--delete-branch` (L-001).

Confirm it landed with `gh pr view <pr> --json state,mergedAt` before cleaning up.
A `CLOSED` PR with no `mergedAt` did not merge, and its branch must not be deleted.
Then delete the remote branch with `git push origin --delete <branch>` and run
`git fetch origin --prune`. Leave the worktree on the merged branch; the app removes
it, not Claude. Archiving the thread does not: T3's "Delete merged worktrees" cleanup removes it once the PR is
merged and its commits are in `main`, or when the thread is deleted, and it keeps a
worktree with uncommitted changes. Check `list_thread_pull_requests` before
finishing.

A bug fix must additionally pass every gate in `.agents/skills/fix-bug/SKILL.md` step 9. A
`PASS` here does not replace any of them.

Never merge on `CHANGES_REQUIRED` or `BLOCKED`, past a red or pending check, or past
a failed bug-fix gate. In those cases report the verdict and the PR link and hand it
to the user.

Call `unwatch_pull_request` on the PR before handing it back, whether it
merged or not, so the thread returns to the user's inbox.

## Merging deploys production

Cloudflare Workers Builds deploys `main` to the `eunice-warren` Worker
(`https://eunice-warren.neil-e89.workers.dev`) on every push. PR branches get only a
preview, for **Local review**.

After every merge, Claude confirms the Workers Build for the merge commit's SHA
reached `build_outcome: success` and reports the result. With the Cloudflare
plugin's API access (read-only is enough):

1. `GET /accounts/{account_id}/workers/scripts` for the `eunice-warren` worker tag.
2. `GET /accounts/{account_id}/builds/workers/{worker_tag}/builds`, and find the
   build whose `build_trigger_metadata.commit_hash` is the merge commit's SHA.
3. Wait for `status: stopped` with `build_outcome: success`.

The GitHub check alone is not proof: a queued build can end `skipped` when a later
push to `main` supersedes it (then the later build must succeed, and the report says
so). A failed build leaves the previous deploy serving: report it to the user with
the build log, and fix it in a new thread. Rolling back or deploying by hand with
`wrangler` still needs the user to ask (and `permissions.deny` blocks it for
Claude).

Check a hosted deploy a few times by hand at most, never in a loop (L-012).
