---
name: codex-handoff
description: Hand repository code work to Codex through T3 Code's delegate_task. Use for any code task or the code half of a design-to-code task, for fix rounds after CHANGES_REQUIRED, and when reading the report Codex returns.
---

# Codex Handoff

How Claude hands repository code work to Codex, and what Codex returns.

Use this whenever a task is code work, or when the code half of a design → code task
is ready to implement. Claude classifies the task, gets the user's OK, confirms the
task branch is checked out, reads the Paper design and writes its values into the
handoff, and only then sends the handoff below.

## Rules for every handoff

Codex runs through T3 Code's `delegate_task` (**Launch: `delegate_task`**), the only
path (`CLAUDE.md` **Host**). Every handoff sends the
**Handoff template** and gets the same report back. These rules hold:

- Every task starts on `gpt-5.6-luna`. Step up to `gpt-5.6-sol` only for a hard
  round (`CLAUDE.md` **Roles**): a second failed fix round on one finding, a flaky
  test, or tricky animation logic. Say in the PR body which rounds did.
- A question answerable by reading alone — where something is used, a summary, an
  inventory, a saved log — goes to the `haiku-lookup` subagent instead; it is faster
  and does not hold the checkout. See `CLAUDE.md` **Task routing**.
- A read-only task must not expand into a repository mutation; if it finds changes
  are needed, it ends with a recommendation and Claude starts a write task (a fresh
  handoff or a fix round on the branch's existing work).
- While Codex is working: no edits to repository files, no Git writes, and no build.
  Reading Paper may continue because it does not touch the checkout. Never run
  `layout-implementer` while Codex is working: one writer at a time.
- Do not hand off a mechanical edit — Claude makes it directly; see
  **Task routing** in `CLAUDE.md`.
- A task that is mainly layout, CSS, or animation goes to the `layout-implementer`
  subagent instead of Codex (**Briefing `layout-implementer`** below). Logic still
  comes here.
- **Never delegate Codex through a Codex plugin, the Agent tool, or a slash command.**
  The plugin's Agent-tool path is background-only, and it once kept writing to the
  shared checkout after the handoff appeared to have returned, overwriting whatever
  Claude did in the meantime (`docs/claude-codex-handoff-resolution.md`).
- Do not start a second writer against the same checkout.

## Launch: `delegate_task`

### How to launch it

From the thread's own worktree, one call:

```json
{
  "title": "<branch>: <task>",
  "task": "<the handoff below>",
  "role": "implementation",
  "target": {
    "providerInstanceId": "codex",
    "model": "gpt-5.6-luna",
    "options": { "reasoningEffort": "medium", "serviceTier": "default" }
  },
  "mode": "async",
  "isolation": "shared",
  "clientRequestId": "<branch>-r1"
}
```

- **Model and options.** Step up with `"model": "gpt-5.6-sol"` per **Rules for every handoff**.
  Reasoning settings go in `target.options`, never only in the prompt. Read the
  model's option descriptors from `orchestrator_capabilities` first (on 2026-10-26,
  luna: `reasoningEffort` `low`–`max`, default `medium`; `serviceTier` `default` or
  `priority`; sol adds `ultra`). Use only advertised values.
- **Check the result.** The call returns `taskId`, `childThreadId`, and the resolved
  `providerInstanceId`, `model`, and `options`. Compare them with what was requested.
  A mismatch is a failed launch: cancel the task and treat it as **Fallback** below
  or retry with the same `clientRequestId`.
- **Runtime mode.** Leave `runtimeMode` unset so Codex inherits this thread's mode.
  A narrower mode is not a read-only switch: it makes the child wait for a person at
  each approval, which this thread cannot give.
- **Read-only tasks.** Use `"role": "research"` and say in the brief that it must not
  modify, create, or delete any file. Since nothing enforces it, run `git status`
  when the task ends and treat any change as a failed task.
- **Isolation.** `"isolation": "shared"` makes Codex edit this thread's worktree,
  which is what a handoff needs. Never use `"worktree"` for a handoff: it starts
  from the last commit, drops uncommitted edits, and splits one task across two
  branches.
- **Async, no polling.** `"mode": "async"` returns at once, and the task's completion
  wakes this thread. End the turn; do not poll, sleep, or start a watcher. Call
  `task_status` only when the result is needed mid-turn. Its `summary` holds the
  final report.

### Fix rounds

A fix round is a **new** `delegate_task` call. Never continue a round with
`t3_thread_send` on the `childThreadId`. The new task starts without the earlier
conversation, so its `task` carries what Codex needs, and no more:

- the original **Task**, **Acceptance criteria** and **Relevant context** sections,
  unchanged
- a **Where things stand** block of about ten lines, so Codex does not re-investigate
  from nothing: `git diff --stat` of the working tree, the root cause and key decisions
  from Codex's previous report, and what its validation showed. Do not paste the whole
  previous report.
- all findings from the round, together, never one at a time
- every objection still unresolved, with Codex's previous response to it
- "start from the files above and read further only where a finding needs it; fix
  these on the current branch, run the applicable self-validation, report in the same
  structure"

Each round has its own `taskId` and a distinct `clientRequestId`
(`<branch>-r2`, `<branch>-r3`, …) that stays the same across retries of that round.
A round may switch `target.model` to `gpt-5.6-sol` per **Rules for every handoff**.

### Questions and approvals

If `task_status` (or the completion notice) shows `hasPendingQuestion` or a
`pendingApproval`, Codex is waiting. Read and answer it with `t3_pending_request`
on the `childThreadId`. If the answer needs the user's judgment, a design
decision Paper does not settle, or credentials, ask the user instead.

### Ending, abandoning, falling back

A task is finished only when `task_status` shows it terminal (`completed`, `failed`,
or `cancelled`) and `hasPendingChildRuns: false`. Until then Claude does not edit
the delegated files. To abandon a run, call `task_cancel`, then confirm the same way
before taking over.

**Fallback.** If `delegate_task` errors, or the task ends `failed` or `cancelled`,
implement the change yourself once the task is terminal, and note that in the PR
body. Do not leave the task unstarted.

## What Codex cannot do here

Codex cannot build, bind a port, use the network or write Git. `npm run build`,
`astro dev`, `astro preview`, and Playwright's `webServer` all bind a port, so none of
them can run inside Codex. Do not ask for them. Do not ask for a commit, a push, or a
PR either: `.git` is read-only. Asking for something the sandbox forbids invites a
report that claims it happened. The measured probe results are in
`references/codex-sandbox.md`; re-run the `SETUP.md` probe on a new machine or after a
Codex upgrade and update that file.

Codex writes the code and tests, self-reviews its full working-tree diff, and runs
`npm run check` and the script tests that match the changed paths (`AGENTS.md`
**Validation**). Claude runs `local-checks` and owns Git; CI runs the browser suite.
Codex self-validation is evidence for Claude's review, never merge authorization.

## Briefing `layout-implementer`

A layout task (`CLAUDE.md` **Task routing**) goes to the `layout-implementer`
subagent (`.claude/agents/layout-implementer.md`), spawned natively with the Agent
tool and `run_in_background: false`, never with a per-call `model`, except the one
override in `CLAUDE.md` **Roles**: `model: "opus"` with `effort: "medium"` on a fix
round for animation or scroll-driven motion, after one failed run at the pinned
Sonnet 5.5 `high`. Its brief is the **Handoff template** below with these
differences:

- **Already established** carries a `haiku-lookup` list of the files, components and
  tokens the task needs, so the implementer does not explore.
- **Lessons that apply** is the `select.mjs --brief` output, as for Codex.
- The branch line, the sandbox section and the Git section stay: the implementer can
  build and run Playwright, but never runs a Git command that changes state, and
  never submits a form outside the local fake-store build.
- It returns the **Return** block of its agent file (STATUS, CHANGES, CHECKS, TREE,
  DOUBTS), not the Codex report.

A fix round is a new run carrying the findings and the previous DOUBTS. After two
failed runs on the same finding, Claude takes over and says why in the PR body. The
PR body names the implementer, the runs and the effort used. One writer at a time:
never run it while Codex is working, and never edit the checkout while it runs.

## Before handing off

Five things must be true, or the handoff is premature:

1. The task is classified as logic, or the logic half of a design → code task
   (`CLAUDE.md`, **Task routing**).
2. The acceptance criteria exist and the user has approved them.
3. The task branch is checked out in the task's own worktree (`git status -sb`:
   another session may have moved it; also `t3_worktree_status`). T3 created it with
   the thread. Codex works on that branch;
   it will stop rather than create one.
4. For a bug fix, the draft PR and empty commit from
   `.agents/skills/fix-bug/SKILL.md` step 3 exist before handoff. For other work, the draft PR
   may be opened after the first push.
5. Dependencies are installed and current: `node_modules` exists and is newer than
   `package-lock.json`, or run `npm ci` first (`CLAUDE.md` **Git** step 1). Codex
   cannot install packages, so without them its `npm run check` fails. The
   `guard-deps.mjs` hook blocks the `delegate_task` call until this holds (L-006).

Codex cannot see Paper. Every design value the code needs — token names and values,
spacing, type scale, breakpoints, exported asset paths — goes into **Relevant
context**, read with the Paper MCP tools. Export assets into
`public/` or `src/assets/` before handing off.

Quote the lessons that apply. List the files the task is expected to touch and pick
the matching `.agents/lessons.md` entries (`CLAUDE.md` **Lessons**):

```bash
printf '%s\n' src/components/sections/Playlist.astro tests/playlist.spec.ts \
  | node scripts/lessons/select.mjs --brief
```

Paste the output verbatim under **Lessons that apply**. If nothing matches, say
"None match".

## Handoff template

Fill this in and send it as the task. Delete bracketed placeholders; do not send a
placeholder through.

---

## Task

Implement the repository code changes required for:

[Concise description of the requested change]

Branch: `[branch name — the T3 thread's task branch, already checked out]`

## Expected behavior

Current behavior:
[What happens now]

Expected behavior:
[What should happen after the change]

## Acceptance criteria

The task is complete only when:

- [criterion 1]
- [criterion 2]
- [criterion 3]
- Existing related behavior continues to work.
- No unrelated refactors or cleanup are included.

## Relevant context

Project:
Eunice Warren wedding site (a one-page invitation with RSVP), built with Lumos for
Astro on Cloudflare Workers.

Design (from Paper, read by Claude):

- [artboard name(s) and the breakpoints they represent]
- [tokens: colour, type, spacing — names and values]
- [layout notes: grid, max widths, alignment, responsive changes]
- [asset paths already exported into the repo]
- Hi-fi artboards are 1440 desktop and 390 mobile; tokens are fluid between
  `--viewport-min` 320 and 1440, so a 390 artboard shows values slightly above
  their `-min` token.

Lessons that apply (from `.agents/lessons.md`; read the full entries there):

- [output of `scripts/lessons/select.mjs --brief`, verbatim, or "None match"]

Relevant implementation details:

- [relevant page / component / layout]
- [relevant files if already known]

Already established (verify, do not rediscover):

- [facts Claude has confirmed, with evidence: a reproduction, a measured value, the
  line where the behavior starts. Write "None" if Claude has not investigated.]

Inspect the repository yourself before making changes. Do not assume the suggested
files are the only files involved, but start from the files and facts above.

Follow the repository's `AGENTS.md`, `LUMOS.md`, and applicable `.agents/skills/`
instructions.

## Constraints, validation and Git

Follow `AGENTS.md` **Codex: your role**: its sandbox limits, **Validation**, **Git**
and **Client-side behavior** sections apply in full. Keep the diff to this task, leave
your work uncommitted, and never claim a check that did not run.

[Only if the task needs more: name extra checks to run or files not to touch.]

## Return to Claude

Return a concise implementation report in this exact structure:

### STATUS

`DONE`, `BLOCKED`, or `NEEDS_DESIGN_INPUT`

### CHANGES

- files changed
- concise explanation of the implementation

### VALIDATION

- command/check: PASS | FAIL | NOT RUN
- command/check: PASS | FAIL | NOT RUN

### ACCEPTANCE CRITERIA

- criterion: PASS | FAIL

### DESIGN QUESTIONS

List any design values or decisions the handoff did not provide.

Write `None` if there are none.

### RISKS / NOTES

Only include relevant implementation risks, assumptions, or follow-up concerns.

### HANDBACK

Files left modified in the working tree:
Anything intentionally left unfinished:
Validation Claude still needs to run:

---

## Reading the report

**`DONE`** — treat each `PASS` line as a claim to check, not a result to accept.
Read the diff for scope: files the task did not need, debug code, stray or
unrelated hunks, and any check the report claims but could not have run. Correctness
review is `pr-reviewer`'s job (and the Codex second opinion's on a risky PR); do not
duplicate it here. Then run `local-checks` (Codex cannot run its own specs, so they
may arrive failing), commit, and push: `runtime` to a draft PR for **Local review**,
`docs` and `workflow` to a ready PR. Then run `.agents/skills/review-pr/SKILL.md`.

**`NEEDS_DESIGN_INPUT`** — Codex hit a design value or decision the handoff did not
contain. Read it from Paper (or ask the user if Paper does not answer it), then send
the answer as a fix round (a new `delegate_task` call carrying the original handoff and the
report). Read the `HANDBACK` block: it says what is sitting in the
working tree.

**`BLOCKED`** — Codex could not proceed. If the blocker is missing information or an
ambiguous criterion, resolve it and re-hand off. If it needs the user's judgment,
credentials, or infrastructure you do not have, stop and hand the whole task to the
user with the blocker and what has already been verified.

Any `FAIL` or unexplained `NOT RUN` in `VALIDATION`, or any `FAIL` in
`ACCEPTANCE CRITERIA`, means the task is not done regardless of the `STATUS` line.
Send it back.
