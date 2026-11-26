---
name: delete-comment
description: Audit the code comments in one area of the repo, sort each into Tautology, Excuse, Stale or Decision Record, delete them, file issues for the excuses, move decisions into ADRs, and lower the comment baseline. Use when asked to delete comments, clean up comments, run the comment audit, or when check:comments says a file is below its baseline.
---

# Delete comments

The repo bans code comments (`docs/decisions/0002-no-code-comments.md`).
`npm run check:comments` holds each file at its count in
`scripts/ci/comment-baseline.json`; this skill brings an area down to zero.

## 1. Pick the area

One area per PR, so the review stays readable and the route stays one class
(`CLAUDE.md` **Roles**). Any `src/lib/**`, `src/actions/**` or
`src/pages/api/**` file makes the PR **Risky**. List what is left:

```bash
node scripts/ci/check-comments.mjs --list <path-prefix> [<path-prefix> …]
```

## 2. Sort every comment

Read the code around it, not only the comment. Each comment gets one kind:

| Kind | Test | Action |
| --- | --- | --- |
| Tautology | The code or a name already says it. | Delete. |
| Stale | It names code, a value, a file or behaviour that is no longer true. | Delete. |
| Excuse | It explains away a workaround, magic number, retry, wait, `any`, or "for now". | Delete; file an issue (step 4). |
| Decision Record | Changing the code without knowing it would break something or undo a choice. | Move into an ADR (step 3), then delete. |

When a comment mixes kinds, split it: the decision goes to the ADR, the rest is
deleted. When a decision is small enough to live in a name (a constant, a
function, a test title), rename instead of writing an ADR. A comment that names a
lesson (`L-0xx`) is a pointer: the ADR links the lesson.

Record the sort in `.context/<task>/comments.md` (one line each:
`file:line kind reason`) for the PR body.

## 3. Write the ADRs

One ADR per topic, not per comment, in `docs/decisions/NNNN-<slug>.md` with the
next free number and the format of `0001`: **Status**, **Date**, **Context**,
**Decision**, **Consequences**. Name the files and symbols it covers, so a reader
can find it from the code with `grep`. Extend an existing ADR when the topic
already has one.

## 4. File the excuses

One issue per hack (`create_issue`, label `enhancement`, title `debt: …`): the file and line on
`origin/main`, what the hack does, what the comment said, and the fix it points
to. Link each issue in the PR body. Never fix the hack in the same PR: the issue
routes per `CLAUDE.md` **Task routing**.

## 5. Delete and check

- Delete the comment and any blank line left doubled. Never change code in the
  same edit; a deletion that changes behaviour is a bug.
- `npm run check:comments -- --update` lowers the baseline; commit it with the
  deletions.
- `npm run prepush`, then the PR per `CLAUDE.md` **Git**. The PR body gives the
  counts per kind, the ADRs, the issues, and the lines shed (`git diff --stat`).

## Rules

- The baseline only goes down. Never raise a count to make a check pass: delete
  the new comment, or move its decision into an ADR.
- Not counted, so leave them: tool directives, Lumos prop JSDoc in
  `src/components/**/*.astro`, and `migrations/**`.
