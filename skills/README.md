# Skills

Reusable, repo-specific instructions for coding agents working on this project
(Claude Code and Codex both read this folder — see wiring below).

## Convention

Each skill is a folder with a `SKILL.md`:

```
skills/
  <skill-name>/
    SKILL.md      required — what it's for, when to use it, the steps
    *             optional supporting files (templates, scripts, references)
```

`SKILL.md` starts with YAML frontmatter carrying only `name` (the folder name) and
`description` — what the skill does and when to use it. Claude Code decides when to
load a skill from that description alone, so name the triggers. Below the
frontmatter it stays plain markdown, so it reads the same whether it's loaded by
Claude Code's Skill tool or pulled in by Codex via AGENTS.md.

## Wiring

- **Claude Code** discovers skills via `.claude/skills`, which is a symlink to this
  folder — add a skill here and it's automatically available, no duplication.
- **Codex** has its own skills and subagent mechanisms, but this repo does not use
  them: `AGENTS.md` at the repo root points Codex here and tells it to read the
  relevant `SKILL.md` before doing related work, so both agents follow one copy.

## Current skills

- `astro-component/` — how Claude reads a Paper design into a handoff, and the
  conventions Codex follows for pages, components, images, content, and client
  scripts.
- `codex-handoff/` — how Claude launches Codex through the supervised runner, hands
  off repository work, and reads the report Codex returns.
- `review-pr/` — the risk-tiered PR review Claude runs inline after CI settles: what
  it reads, the verdict posted on the PR, fix rounds, and merge authorization.
- `fix-bug/` — the owner-tagged bug workflow: acceptance criteria, `fix/` branch,
  early draft PR, reproduce-then-fix, validation, review, and cleanup.

### Lumos skills

Shipped with Lumos for Astro. The source lives in `.agents/skills/`; each entry
here is a symlink to it, so a Lumos upgrade updates one copy.

- `lumos-audit-props/` — checks component prop order and tooltip consistency.
- `lumos-scaling-graphic/` — builds an editable graphic that scales as one piece.
- `lumos-upgrade-version/` — upgrades Lumos without losing customizations.
