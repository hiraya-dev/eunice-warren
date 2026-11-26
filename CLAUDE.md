# Claude Code notes — Eunice Warren

The Eunice Warren wedding site: Lumos for Astro on Cloudflare Workers, with an RSVP
and song backend on Cloudflare D1 (`docs/rsvp-backend.md`). Designs live in Paper;
the repository owns everything that ships. Read `AGENTS.md` **Development**,
**Building** and **Skills** (the rest is for Codex) and `LUMOS.md` before UI work.
The workflow is adapted from adc-website; `SETUP.md` says what was kept and what was
left out.

## Host

T3 Code is the only host. Confirm the `t3-code` MCP tools answer at the start of a
task (`t3_worktree_status`); if not, stop and tell the user. One task lives in one
thread (`~/.t3/worktrees/eunice-warren/`); Codex runs through `delegate_task`;
waiting for CI is `watch_pull_request`, then end the turn.

## Talking to the user

The user has ADHD. Every reply to them follows these rules, all session, with no
`/i-have-adhd` needed; "stop adhd mode" turns them off for that session only. Repo
stops (**Approval**) and confirmations before destructive actions still win;
"explain" or "walk me through" gets a full answer under skimmable headers.

1. The first line is the next action: a command, a path, or the one decision needed.
2. More than one step → a numbered list, one bounded action per step, fewest steps.
3. Restate where the task stands ("PR open, CI running"), and end with one concrete
   next action the user can do in under two minutes.
4. Time estimates in real units ("about 10 minutes"), never "a bit of work".
5. Show wins concretely (what now works, how to see it); state errors as cause + fix.
6. No preamble, recap, sign-off or hedging filler. Finish one issue, then offer the
   next as a question. At most five items per list, grouped and ranked.

## Roles

Three change classes, read from the diff (`local-checks` **CI routes**):

- **Trivial**: the `docs` and `workflow` routes. A ready PR, `pr-reviewer`, merge on
  PASS. No Local review.
- **Normal**: `runtime`. A draft PR, `pr-reviewer` in parallel with CI, Local review.
- **Risky**: `runtime` touching the RSVP or song actions and stores
  (`src/actions/**`, `src/lib/**`, `src/pages/api/**`), dependencies, or root config
  (`wrangler.jsonc`, `astro.config.mjs`). The review adds the Codex second opinion.

Claude owns judgment, Git and every gate. Codex works in a sandbox (`codex-handoff`
**What Codex cannot do here**). `layout-implementer` can build, run Playwright and
check the browser, but never touches Git. `haiku-lookup` and `pr-reviewer` only read.

| Role | Model | Set in |
| --- | --- | --- |
| Orchestrator | Claude Opus 5.5 (Fable 5.2 via `/model` for one truly hard session) | `.claude/settings.json` |
| Codex | `gpt-5.6-luna` at `medium`; `gpt-6-astra` at `medium` for a hard round | each `delegate_task` call |
| `haiku-lookup` | Claude Haiku 5.5, `effort: low` | agent frontmatter |
| `pr-reviewer`; `layout-implementer` | Claude Sonnet 5.5, both at `effort: high` | agent frontmatter |

Spawn `.claude/agents` subagents natively with the Agent tool, never with a per-call
`model` and never as a `fork` (it re-reads the thread). The one allowed override is
`model: "opus"` with `effort: "medium"` on a `layout-implementer` fix round for
animation or scroll-driven motion, after one failed run at the pinned Sonnet 5.5
`high`. A hard Codex round (more than luna at `medium` needs, a second failed fix
round on one finding, a flaky test, tricky animation logic) moves to `gpt-6-astra` at
`medium`, never luna at `high`; the PR body says which rounds ran on astra and why.

When a run is not good enough: first check it can verify its own work (a test, build
or script), then (Claude subagents) raise effort one level, then move up one model at
a lower effort. Switch the orchestrator's model only at the start of a thread or
after `/compact`. A `t3_thread_launch` sets `modelSelection` to Opus 5.5 (it inherits
the parent's otherwise), except for the one truly hard session.

## Task routing

Classify before implementing. Needs no logic and no understanding of the code around
it → Claude makes it directly. Otherwise mainly layout, CSS or animation →
`layout-implementer`. Otherwise (the RSVP and song actions and stores,
client-script behavior, content schemas, scripts, tests, CI) → Codex. Judgment, Git
and gates stay with Claude. A task with both halves runs them one after the other.

| Lane | Takes |
| --- | --- |
| Claude, inline | classifying, criteria, Paper, builds, visual QA, Git, merges, workflow rule changes, mechanical edits, copy edits (`copy-editing`) |
| `haiku-lookup` | where X is defined or used, file or diff summaries, inventories, the failure in a log saved to `.context/` |
| Codex | actions and stores, API routes, client-script behavior, content schemas, tests, root-cause bug fixes, refactors, scripts, CI |
| `layout-implementer` | sections and components from Paper, responsive fixes, motion and scroll effects |
| `pr-reviewer` | the verdict on every PR, started when the PR opens; Codex second opinion only on a risky PR |

- **Design → code**: Claude reads Paper and writes the criteria with the values at
  390 and 1440 (`astro-component` **From Paper**); the implementer builds; Claude
  measures the result at both widths. Never edit the Paper file unasked.
- **Layout work**: brief and fix rounds per `codex-handoff` **Briefing
  `layout-implementer`**; after two failed runs on one finding, Claude takes over
  and says so in the PR body.
- **Mechanical edits** (copy, typos, alt text, a token value, lint fixes, config
  values, pins) add no logic (no new branch, loop, listener, prop, island, route or
  schema field, no change to what existing code does) **and** the whole diff can be
  written from the task description alone; if unsure, it is not. In workflow files
  (paths `scripts/ci/classify-paths.mjs` routes `workflow`) only a typo is
  mechanical; any change to a rule, step, owner, model or CI condition is Claude's to
  write. Both still get a PR, CI, a review and a merge; the PR body says why.
- **Read-only** work that must run commands goes to Codex as a research task, never
  a mutation. Questions answerable by reading go to `haiku-lookup`.
- **Delegating**: read `codex-handoff` before any Codex task; delegate only through
  `delegate_task`, never a Codex plugin, the Agent tool or a slash command. Claude
  does not touch delegated files until the run is terminal; if Codex fails, Claude
  implements the change after it ends and says so in the PR body. **One writer at a
  time**: Codex, `layout-implementer` and Claude never edit the checkout together.

## Approval

After classifying, state the classification, lane and acceptance criteria, then stop
for the user's OK. A new section or visual feature: recommend an approach first and
stop. Once approved, the chain runs without check-ins, except Local review on
`runtime`; after "ship it", the rest runs without asking. **QA fixer**: an open
`qa-auto` issue is pre-approved (user, 2026-11-26); its scheduled run merges on PASS
and a green full `gate`, no Local review, unless **Risky** → draft, `needs-human`.

**Local review**: a `runtime` change waits for the user on its draft PR's Cloudflare
preview (`https://<branch, / as ->-eunice-warren.warren-and-eunice.workers.dev`).
CI and the `pr-reviewer` verdict run on the draft first; then Claude posts the review
pack and **stops**. Feedback → a fix round and a new pack. "Ship it" (or "push",
"merge", "go") authorizes ready + merge. A fix after "ship it" comes back only if it
changes what renders. Procedure: `review-pr` **Local review**.

## Git

One thread, one worktree, one branch, one task. T3 creates the branch from
`origin/main`; never create, rename or switch branches, and never work in the root
checkout. Keep uncommitted changes found at the start out of the task's commits
unless they belong to it.

1. Confirm the binding (`t3_worktree_status`), `git status -sb`, `git fetch origin`.
   Run `npm ci` if `node_modules` is missing or older than `package-lock.json`
   (L-006).
   <!-- T3 workaround, 2026-11-13: remove this npm ci step and guard-deps.mjs once T3 runs its setup script. -->
2. Diff against `origin/main`, never a local `main`.
3. One logical change per branch; unrelated work → a new thread (`t3_thread_launch`
   with a `workspaceStrategy`). Never `git worktree add`.
4. Criteria approved; route per **Task routing**. A bug fix has its draft PR before
   the handoff (`fix-bug`).
5. Review the returned diff, then `local-checks`: `npm run prepush && git push …`
   before every push; a new or changed spec runs once, by its author. CI runs the
   full Playwright suite, never a local gate.
6. Open the PR: `runtime` as a draft (`gh pr create --draft --base main`), `docs`
   and `workflow` ready. `link_pull_request`, then start `review-pr` at once.
7. Merge per `review-pr` **Verdicts** and **Merging**: a posted `PASS` on the head,
   green `gate` on it, the branch up to date with `origin/main`, and "ship it" for
   `runtime`; `gh pr merge <pr> --squash`. Otherwise hand the PR to the user.

"CI is green" means the `gate` job of the `CI` workflow passed on the head commit; a
skipped `gate` is never green. A `runtime` merge needs the full tier (a draft runs
`@smoke`; `gh pr ready` starts the full run). Any new push voids the head's CI result
and verdict. `main` has no branch protection, so every merge gate is self-enforced.

## Deploys

Merging to `main` deploys production (Workers Builds, Worker `eunice-warren`); Claude
confirms that build succeeded and reports it (`review-pr` **Merging deploys
production**). Every other branch builds a preview. Never deploy by hand, roll back,
or change Workers routes, settings or secrets unless asked.

- Previews run the fake store (`wrangler.jsonc` `previews`), so a reviewer can try
  the RSVP and song forms there. Never submit any of them on production.
- `SITE_INDEXABLE` in `src/consts.ts` stays `false` until the user says to launch.

## Skills

Check `.agents/skills/` (linked from `.claude/skills/`) before related work. Beyond
those named above: sections and Paper → `astro-component` and `LUMOS.md`; site
copy → `copy-editing`, with the voice and rules in `.agents/product-marketing.md`.

## Lessons

Claude writes or updates a `.agents/lessons.md` entry on the task branch after a
`CHANGES_REQUIRED`, a red CI job that was not a timeout or cancel (L-013), a revert,
a flaky test, a Local review fix round, or a correction from the user (format and
upkeep: the file). A bug the user finds is an `escape: <route> #PR` in **Trigger**,
and the fix PR adds a test that fails on the old code when one can measure it. A
repeat adds the PR to **Trigger** and sharpens the rule.

**Guards earn their place.** A lesson gets a hook, lint or test guard only when the
guard cuts cost (CI minutes, tokens, or the user's time) or catches an escape the
user found.

## Traps

One line each; the ledger has the detail. Hooks: `guard-git.mjs` before every Bash
call (subagents too), `guard-deps.mjs` before `delegate_task`. `permissions.deny` in
`.claude/settings.json` blocks force pushes, deploys and other destructive commands.
If either blocks something the user asked for, say so; never work around it.

- Hooks block: `--merge`, `--rebase`, `--delete-branch` (L-001); checking out `main`
  (L-002); `git worktree add` (L-003); co-author trailers (L-004); any push to `main`
  (L-005); a commit chained after a pipe, or a push chained after one (L-058); a
  Codex handoff without `node_modules` (L-006).
- `git status -sb` before each handoff, commit and push; others' hunks are not
  "stray" (L-007).
- Shared ports: when a suite acts as if a change is missing, `lsof` the port. Keep
  `CLAUDECODE` unset for `astro preview` (L-008).
- Time motion assertions by the clock, never by frames; background tabs freeze
  `requestAnimationFrame` (L-009). Release snap drags at rest (L-010). Prove load
  flakes on a runner with `flake-check.yml`, not on the Mac.
- Never load a hosted deploy in a loop (L-012). A red `e2e` may be a cancel (L-013).
