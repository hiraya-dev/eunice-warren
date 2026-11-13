import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ARCHIVE_PATH, LIVE_PATH, compareWithBase, globToRegExp, parseLedger, selectLessons, validate } from "./select.mjs";

const script = fileURLToPath(new URL("./select.mjs", import.meta.url));

function entry(id, overrides = {}) {
  const fields = {
    Date: "2026-11-03",
    Trigger: "PR #1 CHANGES_REQUIRED",
    Symptom: "s",
    "Root cause": "r",
    Rule: "do x",
    Check: "look",
    Guard: "none",
    Paths: "`src/**`",
    ...overrides,
  };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `- **${name}:** ${value}`);
  return [`### ${id} — Title ${id}`, ...lines].join("\n");
}

const ledger = (...entries) => `# Lessons\n\nIntro.\n\n## Section\n\n${entries.join("\n\n")}\n`;

test("parses entries, fields, wrapped lines and paths", () => {
  const text = ledger(entry("L-001", { Paths: "`src/components/**`, `tests/*.spec.ts`" }), entry("L-002")).replace(
    "- **Rule:** do x",
    "- **Rule:** do x\n  and keep going",
  );
  const [first, second] = parseLedger(text);
  assert.equal(first.id, "L-001");
  assert.equal(first.title, "Title L-001");
  assert.equal(first.fields.Rule, "do x and keep going");
  assert.deepEqual(first.paths, ["src/components/**", "tests/*.spec.ts"]);
  assert.equal(second.id, "L-002");
});

test("a section heading ends an entry", () => {
  const [only] = parseLedger(`${entry("L-001")}\n\n## Next section\n\nProse that is not part of L-001.\n`);
  assert.ok(!only.lines.join("\n").includes("Prose"));
});

test("the format example in a code fence is not an entry", () => {
  assert.equal(parseLedger("```markdown\n### L-NNN — Short title\n- **Date:** x\n```\n").length, 0);
});

test("globs match like the paths they describe", () => {
  const cases = [
    ["src/**", "src/components/Button.astro", true],
    ["src/**", "srcx/a", false],
    ["**", "anything/at/all.md", true],
    ["src/components/**", "src/components/content/HomeOffers.astro", true],
    ["src/components/content/Home*.astro", "src/components/content/HomeOffers.astro", true],
    ["src/components/content/Home*.astro", "src/components/content/home/x.astro", false],
    ["src/**/*.css", "src/styles/global.css", true],
    ["src/**/*.css", "src/a.css", true],
    ["tests/*.spec.ts", "tests/a/b.spec.ts", false],
    ["CLAUDE.md", "CLAUDE.md", true],
    ["CLAUDE.md", "docs/CLAUDE.md", false],
  ];
  for (const [glob, file, expected] of cases) {
    assert.equal(globToRegExp(glob).test(file), expected, `${glob} vs ${file}`);
  }
});

test("selects only entries whose paths match the changed files", () => {
  const entries = parseLedger(ledger(entry("L-001", { Paths: "`src/**`" }), entry("L-002", { Paths: "`tests/**`" })));
  assert.deepEqual(selectLessons(entries, ["src/a.astro", ""]).map((e) => e.id), ["L-001"]);
  assert.deepEqual(selectLessons(entries, ["docs/x.md"]).map((e) => e.id), []);
});

test("validate accepts a well-formed ledger", () => {
  const live = parseLedger(ledger(entry("L-002")));
  const archive = parseLedger(ledger(entry("L-001", { Guard: "hook `scripts/hooks/guard-git.mjs` rule x" })));
  assert.deepEqual(validate(live, archive), []);
});

test("validate reports each kind of problem", () => {
  const live = parseLedger(
    ledger(
      entry("L-001", { Check: undefined }),
      entry("L-002", { Date: "3 Nov" }),
      entry("L-003", { Seen: "2" }),
      entry("L-004", { Guard: "maybe" }),
      entry("L-005", { Guard: "test tests/x.spec.ts" }),
      entry("L-006", { Paths: "everything" }),
      entry("L-007", { Owner: "me" }),
    ),
  );
  const archive = parseLedger(ledger(entry("L-001")));
  const errors = validate(live, archive).join("\n");
  assert.match(errors, /L-001: missing field "Check"/);
  assert.match(errors, /L-002: Date is not YYYY-MM-DD/);
  assert.match(errors, /L-003: unknown field "Seen"/);
  assert.match(errors, /L-004: Guard must start with/);
  assert.match(errors, /L-005: hook\/test\/lint guarded entries belong in lessons-archive\.md/);
  assert.match(errors, /L-006: Paths needs at least one/);
  assert.match(errors, /L-007: unknown field "Owner"/);
  assert.match(errors, /lessons-archive\.md L-001: duplicate ID/);
});

test("validate accepts taste guards in the live ledger", () => {
  assert.deepEqual(validate(parseLedger(ledger(entry("L-001", { Guard: "taste — a judgment call" }))), []), []);
});

test("compareWithBase permits a retitle when the ID exists at the merge-base", () => {
  const mergeBase = parseLedger(ledger(entry("L-001")));
  const base = parseLedger(ledger(entry("L-001").replace("Title L-001", "Base title"), entry("L-004")));
  const working = parseLedger(ledger(entry("L-001").replace("Title L-001", "Working title")));
  assert.deepEqual(compareWithBase(base, working, mergeBase), []);
});

test("compareWithBase reports a divergent title collision and names the next free ID", () => {
  const mergeBase = parseLedger(ledger(entry("L-002")));
  const base = parseLedger(ledger(entry("L-001").replace("Title L-001", "Base title"), entry("L-004")));
  const working = parseLedger(ledger(entry("L-001").replace("Title L-001", "Working title")));
  assert.match(compareWithBase(base, working, mergeBase).join("\n"), /L-001: title differs from base; use next free ID L-005/);
});

test("compareWithBase permits the same title added on both sides", () => {
  const base = parseLedger(ledger(entry("L-001").replace("Title L-001", "Shared title")));
  const working = parseLedger(ledger(entry("L-001").replace("Title L-001", "Shared title")));
  assert.deepEqual(compareWithBase(base, working, []), []);
});

test("the repository ledger is valid", () => {
  const live = parseLedger(readFileSync(LIVE_PATH, "utf8"));
  const archive = parseLedger(readFileSync(ARCHIVE_PATH, "utf8"));
  assert.ok(live.length > 0 && archive.length > 0);
  assert.deepEqual(validate(live, archive), []);
});

test("CLI prints matching entries, brief lines, and a no-match note", () => {
  const run = (args, input) => spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8" });
  const full = run([], "src/components/Button.astro\n");
  assert.equal(full.status, 0);
  assert.match(full.stdout, /^### L-011 — /m);
  assert.match(full.stdout, /- \*\*Rule:\*\* /);

  const brief = run(["--brief"], "src/components/Button.astro\n");
  assert.match(brief.stdout, /^- L-011 — .+ Rule: .+ Check: /m);
  assert.doesNotMatch(brief.stdout, /\*\*Symptom/);

  // L-007 applies to every path (`**`), so a docs file matches it and nothing else.
  const docs = run([], "docs/notes.md\n").stdout;
  assert.match(docs, /^### L-007 — /m);
  assert.doesNotMatch(docs, /^### L-011 — /m);
  assert.match(run([], "\n").stdout, /No lessons match/);
  assert.match(run(["--archive"], "docs/x.md\n").stdout, /^### L-001 — /m);
  assert.equal(run(["--check"], "").status, 0);
});

test("CLI --check --base uses a three-way merge-base and the ledger root", () => {
  const directory = mkdtempSync(`${tmpdir()}/lessons-select-`);
  try {
    mkdirSync(`${directory}/.agents`);
    writeFileSync(`${directory}/.agents/lessons.md`, `${entry("L-001")}\n`);
    writeFileSync(`${directory}/.agents/lessons-archive.md`, "# Lessons archive\n");
    const git = (args) => spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(git(["init", "-q"]).status, 0);
    assert.equal(git(["config", "user.email", "test@example.com"]).status, 0);
    assert.equal(git(["config", "user.name", "Lessons test"]).status, 0);
    assert.equal(git(["add", "."]).status, 0);
    assert.equal(git(["commit", "-qm", "base"]).status, 0);
    const mergeBase = git(["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(git(["checkout", "-qb", "working"]).status, 0);
    writeFileSync(`${directory}/.agents/lessons.md`, [
      entry("L-001"),
      entry("L-002").replace("Title L-002", "Working title"),
      entry("L-004"),
    ].join("\n\n") + "\n");
    assert.equal(git(["add", "."]).status, 0);
    assert.equal(git(["commit", "-qm", "working adds L-002 and L-004"]).status, 0);
    assert.equal(git(["checkout", "-qb", "base", mergeBase]).status, 0);
    writeFileSync(`${directory}/.agents/lessons.md`, [
      entry("L-001").replace("Title L-001", "Base title"),
      entry("L-002").replace("Title L-002", "Base title"),
      entry("L-004"),
    ].join("\n\n") + "\n");
    assert.equal(git(["add", "."]).status, 0);
    assert.equal(git(["commit", "-qm", "base diverges"]).status, 0);
    assert.equal(git(["checkout", "working"]).status, 0);
    const run = (ref) => spawnSync(process.execPath, [script, "--check", "--base", ref], {
      cwd: tmpdir(),
      env: { ...process.env, LESSONS_ROOT: directory },
      encoding: "utf8",
    });
    const collision = run("base");
    assert.equal(collision.status, 1);
    assert.doesNotMatch(collision.stderr, /L-001/);
    assert.match(collision.stderr, /L-002: title differs from base; use next free ID L-005/);
    const unreadable = run("missing-base-ref");
    assert.equal(unreadable.status, 1);
    assert.match(unreadable.stderr, /missing-base-ref/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
