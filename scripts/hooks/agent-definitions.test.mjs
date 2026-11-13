// Guard (from adc-website's lesson L-042): a subagent that sets `omitClaudeMd: true` never receives
// CLAUDE.md, so its definition must say so and must not tell the agent to follow
// CLAUDE.md. A mention is allowed only in the description (a pointer for Claude)
// or as an on-demand Read ("Open `CLAUDE.md` with Read only when …").
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const directory = join(import.meta.dirname, "..", "..", ".claude", "agents");
const files = readdirSync(directory).filter((name) => name.endsWith(".md"));

function split(text) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(match, "agent file starts with YAML frontmatter");
  return { frontmatter: match[1], body: match[2] };
}

test("finds the agent definitions", () => {
  assert.ok(files.length > 0);
});

// Phrases that tell the agent to follow CLAUDE.md. A pointer ("a workflow file
// (`CLAUDE.md`, …)") or an on-demand Read ("Open `CLAUDE.md` with Read only when")
// is fine.
const FOLLOW = /\b(read|follow|see|per|according to|as)\s+`?CLAUDE\.md`?(?!\s+with Read only when)/i;

for (const name of files) {
  test(`${name}: omitClaudeMd agents say what they read instead of CLAUDE.md`, () => {
    const { frontmatter, body } = split(readFileSync(join(directory, name), "utf8"));
    if (!/^omitClaudeMd:\s*true\s*$/m.test(frontmatter)) return;
    const text = body.replace(/\s+/g, " ");
    assert.match(text, /do not load `CLAUDE\.md`/, "body says the agent does not load CLAUDE.md");
    const hit = FOLLOW.exec(text);
    assert.equal(hit, null, `${name}: "${hit?.[0]}" tells the agent to follow CLAUDE.md`);
  });
}

test("the follow-phrase check catches an instruction and allows an on-demand Read", () => {
  assert.ok(FOLLOW.test("Read `CLAUDE.md` before you start."));
  assert.ok(FOLLOW.test("Work as CLAUDE.md says."));
  assert.equal(FOLLOW.test("Open `CLAUDE.md` with Read only when the diff changes it."), false);
  assert.equal(FOLLOW.test("a workflow file (`CLAUDE.md`, `AGENTS.md`)"), false);
});
