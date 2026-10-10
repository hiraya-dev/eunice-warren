import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { decide } from "./block-codex-rescue.mjs";

const script = fileURLToPath(new URL("./block-codex-rescue.mjs", import.meta.url));

function run(input) {
  return spawnSync(process.execPath, [script], { input, encoding: "utf8" });
}

test("denies codex-rescue subagents", () => {
  for (const subagentType of ["codex-rescue", "codex:codex-rescue"]) {
    const result = decide({ tool_input: { subagent_type: subagentType } });
    assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  }
});

test("allows every other subagent, including none", () => {
  assert.deepEqual(decide({ tool_input: { subagent_type: "haiku-edit" } }), {});
  assert.deepEqual(decide({ tool_input: {} }), {});
});

test("CLI prints the decision as JSON and exits zero", () => {
  const result = run(JSON.stringify({ tool_input: { subagent_type: "codex:codex-rescue" } }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("CLI fails closed with exit 2 on unreadable input", () => {
  const result = run("not json");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not read its input/);
});
