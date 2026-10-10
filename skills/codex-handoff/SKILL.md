---
name: codex-handoff
description: Hand repository code work to Codex through scripts/codex/run-handoff.mjs. Use for any code task or the code half of a design-to-code task, for fix rounds after CHANGES_REQUIRED, and when reading the report Codex returns.
---

# Codex Handoff

How Claude hands repository code work to Codex, and what Codex returns.

Use this whenever a task is code work, or when the code half of a design → code task
is ready to implement. Claude classifies the task, gets the user's OK, creates the
branch, reads the Paper design and writes its values into the handoff, and only then
sends the handoff below.

## How to launch it

One path, from the prepared branch, through the lifecycle supervisor:

```bash
node scripts/codex/run-handoff.mjs --model gpt-5.6-luna --sandbox workspace-write --timeout-seconds 540 --prompt "<the handoff below>"
```

Claude Opus is the orchestrator, planner, reviewer, and merger. Every task runs on
`gpt-5.6-luna`; the sandbox sets the boundary. A task that modifies repository files
uses `--sandbox workspace-write`. A read-only task that needs to run commands —
reproducing a failing build, triaging with real output — instead runs as:

```bash
node scripts/codex/run-handoff.mjs --model gpt-5.6-luna --sandbox read-only --timeout-seconds 540 --prompt "<question>"
```

A question answerable by reading alone — where something is used, a summary, an
inventory, a saved log — goes to the `haiku-lookup` subagent instead; it is faster
and does not hold the checkout. See `CLAUDE.md` **Task routing**.

The read-only sandbox enforces the boundary. A read-only task must not expand into a
repository mutation; if it finds changes are needed, it ends with a recommendation
and Claude starts a fresh workspace-write task or resumes the branch's existing
session.

For a small task, use the nine-minute override above and keep the Bash command in the
foreground so it ends before Bash's 10-minute ceiling. A real handoff has taken 13
minutes, so omit `--timeout-seconds 540` and use the launcher's 30-minute default with
`run_in_background: true` when the task may exceed 10 minutes. In either mode, run
exactly one launcher invocation. Do not combine it with Git preparation, another
Codex turn, review, polling, `tail -f`, or a custom wait loop.

The measured zero-event stall came from `codex exec` reading stdin when stdin was not
a TTY and blocking until EOF. The launcher closes Codex's stdin, streams JSONL, and
fails closed on timeout, a missing or failed terminal event, or a terminal event
followed by a process that does not exit. Exit zero plus `turn.completed` is success;
`thread.started` and `turn.started` only mean work began.

Keep the `thread_id` from the `thread.started` event. It is the session id for
**Fix rounds** below.

## Fix rounds

When the review returns `CHANGES_REQUIRED` on repository code, do not send a fresh
handoff — Codex would rebuild its understanding of the branch from nothing. Resume
the session that wrote the code:

```bash
node scripts/codex/run-handoff.mjs --resume <thread_id> --model gpt-5.6-luna --sandbox workspace-write --prompt "<all findings from the round, plus: fix these on the current branch, run the applicable self-validation, report in the same structure>"
```

The launcher translates `--resume` to Codex's required `-c sandbox_mode` form. A fix
round is a separate launcher command after Claude's review; it is never part of the
original shell invocation. Use the same foreground/background rule as the initial
handoff. Resume only for the same branch and task.

While a launcher is alive: no edits to repository files, no Git writes, and no build.
Reading Paper may continue because it does not touch the checkout. After any non-zero
result, confirm no `codex` process survives before editing files.

Do not hand off a mechanical edit — it goes to `haiku-edit` or Claude directly; see
**Mechanical edits** in `CLAUDE.md`. Never run `haiku-edit` while a launcher is
alive: one writer at a time.

**Never delegate through the Agent tool** (`subagent_type: codex:codex-rescue`) **or
the `/codex:rescue` command.** The Agent tool is background-only in Claude Code, its
`--wait` and `--fresh` flags are silently ignored there, and it keeps writing to the
shared checkout after the handoff appears to have returned — overwriting whatever
Claude does in the meantime. That is not hypothetical; it is what went wrong and
produced `docs/claude-codex-handoff-resolution.md`. The plugin stays installed for
ad-hoc use by a person; no handoff goes through it.

Do not start a second writer against the same checkout. The launcher owns timeout and
process-group termination; do not wrap it in a custom background or polling layer.

## What Codex cannot do here

Measured with `codex exec --sandbox workspace-write` (re-run the probe in `SETUP.md`
on a new machine):

| Operation | Result |
| --- | --- |
| Write a workspace file | exit 0 |
| Production build | exit 0 |
| `git status` | exit 0 |
| `git config --local` | exit 255, `could not lock config file .git/config: Operation not permitted` |
| Bind `127.0.0.1:4199` | `EPERM` |
| Network (`npm install`, `npm view`) | expected to fail — no network by default; the `SETUP.md` probe confirms |

`astro dev`, `astro preview`, and Playwright's `webServer` all bind a port, so none of
them can run inside Codex. Do not ask for them. Do not ask for a commit, a push, or a
PR either — `.git` is read-only. Asking for something the sandbox forbids invites a
report that claims it happened.

Codex writes the code and tests, self-reviews its full working-tree diff, and runs
`npm run check` and `npm run build` when the change touches `src/**`, `public/**`,
`package.json`, the lockfile, `astro.config.*`, or `tsconfig.json`. It runs
`npm run test:routing` when the change touches `scripts/ci/**`, and
`npm run test:codex-handoff` when it touches `scripts/codex/**`. Claude runs the
browser suite and owns Git. Codex self-validation is evidence for Claude's review,
never merge authorization.

## Before handing off

Four things must be true, or the handoff is premature:

1. The task is classified as code or the code half of a design → code task
   (`CLAUDE.md`, **Task routing**).
2. The acceptance criteria exist and the user has approved them.
3. The task branch exists and is checked out (`git status -sb` — another session may
   have moved it). Codex works on the branch you made; it will stop rather than
   create one.
4. For a bug fix, the draft PR and empty commit from
   `skills/fix-bug/SKILL.md` step 4 exist before handoff. For other work, the draft PR
   may be opened after the first push.

Codex cannot see Paper. Every design value the code needs — token names and values,
spacing, type scale, breakpoints, exported asset paths — goes into **Relevant
context**, per `skills/astro-component/SKILL.md` **From Paper**. Export assets into
`public/` or `src/assets/` before handing off.

If `codex exec` is missing, unauthenticated, or reaches a terminal failure —
`turn.failed`, `error`, or a non-zero exit — implement the change yourself and note
that in the PR body. Do not leave the task unstarted.

Begin only after the process has exited. If a run has to be abandoned, kill it and
confirm no `codex` process survives before touching the delegated files.

## Handoff template

Fill this in and send it as the task. Delete bracketed placeholders; do not send a
placeholder through.

---

## Task

Implement the repository code changes required for:

[Concise description of the requested change]

Branch: `[branch name — already created and checked out]`

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
Eunice Warren site, built with Astro.

Design (from Paper, read by Claude):

- [artboard name(s) and the breakpoints they represent]
- [tokens: colour, type, spacing — names and values]
- [layout notes: grid, max widths, alignment, responsive changes]
- [asset paths already exported into the repo]

Relevant implementation details:

- [relevant page / component / layout]
- [relevant files if already known]

Inspect the repository yourself before making changes. Do not assume the suggested
files are the only files involved.

Follow the repository's `AGENTS.md`, `README.md`, and applicable `skills/`
instructions.

## Constraints

- Repository code only.
- Keep the diff focused on this task.
- Preserve existing architecture and conventions unless changing them is required
  for correctness.
- Preserve unrelated uncommitted changes.
- Do not add debug code to the final implementation.
- Do not add `Co-authored-by` or other co-author attribution.
- Do not create branches, commit, push, or open a PR.
- Do not continue working in the background after returning a result.

For client-side behavior and animation:

- prefer static markup and CSS; add JavaScript only where behavior needs it
- clean up listeners, observers, and animations; avoid duplicate initialization
- respect `prefers-reduced-motion`
- test behavior during continuous motion, not only at settled positions

## Validation

Run the checks applicable to the changed paths, and report their real results:

```bash
npm run check              # src/**, public/**, package.json, lockfile, astro/ts config
npm run build              # same paths
npm run test:routing       # scripts/ci/**
npm run test:codex-handoff # scripts/codex/**
```

Do **not** attempt `npm run test:e2e`, `npm run dev`, or `npm run preview`. Each binds
a local port and your sandbox refuses with `EPERM`. Write or update the specs; Claude
runs them.

Never claim a check passed unless it actually ran. If something cannot run, say so and
name the limitation. Codex self-validation is evidence for Claude's review, never
merge authorization.

## Git behavior

Do not touch Git. `.git` is read-only in your sandbox — `git status` works, writes do
not. Do not create a branch, commit, push, or open a PR.

Claude has already prepared the branch named above. Leave your work uncommitted in the
working tree and report what you changed. Claude reviews the diff, runs the remaining
checks, commits and pushes.

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

**`DONE`** — verify the claims rather than trusting them. Read the diff yourself, and
treat any `PASS` line as a claim to check, not a result to accept. Then run the suite,
commit, push, open the PR, and run `skills/review-pr/SKILL.md`. Codex cannot run its
own specs, so they may arrive failing.

**`NEEDS_DESIGN_INPUT`** — Codex hit a design value or decision the handoff did not
contain. Read it from Paper (or ask the user if Paper does not answer it), then resume
the session with the answer. Read the `HANDBACK` block: it says what is sitting in the
working tree.

**`BLOCKED`** — Codex could not proceed. If the blocker is missing information or an
ambiguous criterion, resolve it and re-hand off. If it needs the user's judgment,
credentials, or infrastructure you do not have, stop and hand the whole task to the
user with the blocker and what has already been verified.

Any `FAIL` or unexplained `NOT RUN` in `VALIDATION`, or any `FAIL` in
`ACCEPTANCE CRITERIA`, means the task is not done regardless of the `STATUS` line.
Send it back.
