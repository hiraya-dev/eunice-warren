import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { TOOL, checkDeps } from "./guard-deps.mjs";

const script = fileURLToPath(new URL("./guard-deps.mjs", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));

function project({ lock = true, installed = false, installedAge = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "guard-deps-"));
  if (lock) writeFileSync(join(dir, "package-lock.json"), "{}");
  if (installed) {
    mkdirSync(join(dir, "node_modules"));
    const file = join(dir, "node_modules", ".package-lock.json");
    writeFileSync(file, "{}");
    const t = new Date(Date.now() + installedAge * 1000);
    utimesSync(file, t, t);
  }
  return dir;
}

function runHook(payload, dir) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  return spawnSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: "utf8", env });
}

const handoff = { tool_name: TOOL, tool_input: { isolation: "shared", task: "x" } };

test("checkDeps: missing node_modules", () => {
  assert.equal(checkDeps(project()), "node_modules is missing");
});

test("checkDeps: install older than the lockfile", () => {
  assert.equal(checkDeps(project({ installed: true, installedAge: -60 })), "node_modules is older than package-lock.json");
});

test("checkDeps: fresh install passes", () => {
  assert.equal(checkDeps(project({ installed: true, installedAge: 60 })), null);
});

test("checkDeps: no package-lock.json passes", () => {
  assert.equal(checkDeps(project({ lock: false })), null);
});

test("hook blocks a shared handoff without dependencies", () => {
  const result = runHook(handoff, project());
  assert.equal(result.status, 2);
  assert.match(result.stderr, /L-006/);
  assert.match(result.stderr, /npm ci/);
});

test("hook blocks a handoff that omits isolation", () => {
  const result = runHook({ tool_name: TOOL, tool_input: { task: "x" } }, project());
  assert.equal(result.status, 2);
});

test("hook allows a shared handoff with fresh dependencies", () => {
  assert.equal(runHook(handoff, project({ installed: true, installedAge: 60 })).status, 0);
});

test("hook allows a worktree-isolated child", () => {
  const payload = { tool_name: TOOL, tool_input: { isolation: "worktree" } };
  assert.equal(runHook(payload, project()).status, 0);
});

test("hook ignores other tools and unreadable input", () => {
  assert.equal(runHook({ tool_name: "Bash", tool_input: { command: "ls" } }, project()).status, 0);
  const garbage = spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" });
  assert.equal(garbage.status, 0);
});

test(".claude/settings.json runs the hook on delegate_task", () => {
  const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  const entry = settings.hooks.PreToolUse.find((h) => h.matcher === TOOL);
  assert.ok(entry, `no PreToolUse entry matches ${TOOL}`);
  assert.ok(entry.hooks.some((h) => h.command.includes("scripts/hooks/guard-deps.mjs")));
});
