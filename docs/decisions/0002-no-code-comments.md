# 0002: Code carries no comments; decisions live here

- **Status:** accepted
- **Date:** 2026-11-26

## Context

An audit found 1,249 comments in 140 source files, about 1,550 lines. They fell
into four kinds:

- **Tautology:** repeats what the code already says.
- **Excuse:** explains away a hack, so the next change copies the hack.
- **Stale:** describes code or behaviour that has since changed.
- **Decision Record:** a non-obvious decision that someone changing the code
  needs to know.

Only the last kind is worth keeping, and a comment is a poor place for it: it is
not reviewed as a decision, it goes stale silently, and agents read it as
permission.

## Decision

- Source files carry no comments. Tautology and Stale comments are deleted.
  Excuse comments are deleted and get a GitHub issue to fix the hack. Decision
  Records move into an ADR in this folder, one per topic, named by the code it
  covers.
- `npm run check:comments` (`scripts/ci/check-comments.mjs`) enforces it as a
  ratchet. `scripts/ci/comment-baseline.json` records how many comments each file
  may hold. A file above its count fails; a file below it fails until
  `npm run check:comments -- --update` lowers the baseline. The baseline never
  rises; a new file starts at zero.
- The check runs in `npm run prepush` and in CI's `build` and `checks` jobs.
- Not counted: tool directives (`@ts-check`, `@ts-expect-error`, `@type`,
  `eslint-*`, `prettier-ignore`, `/// <reference>`), the JSDoc directly above a
  prop in `src/components/**/*.astro` (Lumos prop docs, which become editor
  tooltips and which `lumos-audit-props` checks), and `migrations/**`, since
  applied migrations are never edited.
- The `delete-comment` skill (`.agents/skills/delete-comment/SKILL.md`) repeats
  the audit on an area and lowers the baseline.

## Consequences

- Removing every comment sheds about 1,550 lines plus the blank lines they leave.
  The cleanup lands area by area; until then the baseline holds the rest.
- The scanner is a small tokenizer, not a parser. It skips strings, template
  literals, regex literals and URLs, but misses a comment inside a template
  literal's `${}`. A miss only under-counts; it never fails a clean file.
- A reason a future reader needs goes in an ADR, a test name, or a well-named
  function, not a comment.
