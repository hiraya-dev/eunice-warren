# 0014: The Git and dependency hooks parse commands instead of matching text

- **Status:** accepted
- **Date:** 2026-11-26

## Context

`CLAUDE.md` forbids Git and GitHub commands that each cost this repo once: the
lessons L-001 to L-006 in `.agents/lessons-archive.md`, and L-058, a push that went
out on a failing check. Prose alone did not hold them, so two Claude Code
PreToolUse hooks enforce them. Their reasons lived in comments in
`scripts/hooks/guard-git.mjs`, `scripts/hooks/guard-deps.mjs`,
`scripts/hooks/guard-git.test.mjs` and `scripts/lessons/select.mjs` until ADR 0002
moved them here.

## Decision

### `guard-git.mjs` (Bash tool)

- **Contract.** It reads the hook payload on stdin
  (`{ tool_name, tool_input: { command } }`). Exit 2 with a reason on stderr blocks
  the call; exit 0 allows it. Unreadable input is allowed rather than breaking every
  Bash call; `guard-git.test.mjs` pins the payload shape.
- **Rules.** `RULES` holds each rule's id, its lesson (or, for `pipe-commit`, the
  `local-checks` skill, which owns "run, then commit"), and the reason.
  `blockMessage` prints both, so the block message is where a reader finds the
  lesson.
- **A lexer, not a regex.** `lexCommands` splits the command into simple commands
  with the operator that ends each one. It handles quotes, escapes, operators,
  redirections, comments and heredocs, so a command that only mentions a forbidden
  string (`grep "git checkout main" CLAUDE.md`, a commit message) is not blocked.
  A redirection's target, a file descriptor before `>` (`2>`) and the target of
  `>&2` are not words; heredoc bodies are skipped. In `(a | b) && c` the `&&` after
  `)` belongs to `b`. `bash -c "<script>"` (and `sh`, `zsh`, `dash`) is checked
  recursively, three levels deep, inheriting `pipefail` from `-o pipefail`.
- **Wrappers.** `stripAssignments` drops leading `VAR=value`, `env`, `command`,
  `exec` and `time`; `gitSubcommand` drops Git's global options (`-C <path>`,
  `-c <k=v>`, `--no-pager`, `--git-dir`, `--work-tree`, `--namespace`).
- **`merge-flags` (L-001).** `checkGh` skips the value of every `gh pr merge` flag
  that takes one, so a body text such as `-d` is not read as a flag. In a flag
  cluster, `b`, `F`, `t` or `A` makes the rest of the cluster a value.
- **`checkout-main` (L-002).** A detached HEAD at main's commit does not claim the
  branch, and `git checkout main -- <path>` restores files, so both are allowed.
  Creating a branch named `main`, or `--track origin/main` (which creates a local
  `main`), is blocked; any other new branch is not this rule's concern.
- **`push-protected` (L-005).** `--all`, `--mirror` and `--branches` push every
  local branch, `main` included, so they are blocked; a refspec's target (after the
  last `:`) is checked against `PROTECTED_PUSH`.
- **`co-author` (L-004).** A trailer is a message line that starts with
  `Co-authored-by:`. The message may come from `-m`, a heredoc or `--trailer`, so
  the whole command text is searched for such a line, and each `-m` is checked on
  its own, since each is its own paragraph. A mention mid-sentence is fine.
- **`pipe-commit`, `pipe-push` (L-058).** A pipeline's exit status is its last
  command's, so `cmd | tail && git commit` commits even when `cmd` fails. A commit
  or push chained by `&&` or `||` after an unchecked pipe in the same and/or list is
  blocked, unless `pipefail` is on (`set -o pipefail`, `set -euo pipefail`,
  `setopt pipefail`; `set +o pipefail` and `unsetopt` turn it off). A subshell or
  `$(…)` exits with its pipeline's status too, so parentheses do not end the list;
  only `;`, `&` and a newline do.

### `guard-deps.mjs` (`delegate_task`)

- It blocks a shared-worktree Codex handoff when `node_modules` is missing or older
  than `package-lock.json`, since Codex cannot install packages from its sandbox and
  its `npm run check` would fail (L-006).
- `node_modules/.package-lock.json` is written by every npm install, so its mtime is
  the install time.
- A child with `isolation: "worktree"` does not use this checkout, so it is allowed.
- It works around T3 not running the project setup script (`npm ci` in `t3.json`)
  on worktree creation (adc-website saw it 2026-11-04, this repo 2026-11-13). It
  and the `npm ci` step in `CLAUDE.md` **Git** go once T3 runs it (#167).

### `scripts/lessons/select.mjs`

Usage is in `.agents/lessons.md`. Two flags are not: `--archive` also searches
`.agents/lessons-archive.md`, and `--check --base origin/main` catches an ID that
both sides of a merge added. In a `Paths` glob, `**/` matches zero or more
directories and a bare `**` matches anything; a heading that is not an entry ends
the entry above it.

## Consequences

- A new rule is a `RULES` entry with its lesson, plus a case in
  `guard-git.test.mjs` under the rule's id; `npm run test:hooks` runs them.
- The lexer is a small tokenizer, not a shell. It errs toward allowing: a command it
  cannot read is let through, so the hooks are a guard rail, not a sandbox.
  `permissions.deny` in `.claude/settings.json` still blocks force pushes and
  deploys.
