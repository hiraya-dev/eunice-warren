#!/usr/bin/env node
// Claude Code PreToolUse hook for T3 Code's `delegate_task` MCP tool. It blocks a
// shared-worktree handoff when the worktree has no installed dependencies, or
// when they are older than package-lock.json, so Codex never starts without the
// packages its `npm run check` needs (L-006 in .agents/lessons-archive.md).
//
// T3 workaround, 2026-11-13 (adc-website saw it first, 2026-11-04): T3's project
// setup script (`npm ci` in t3.json) does not run on worktree creation. Remove
// this hook once T3 runs it.
//
// Input: the hook payload on stdin ({ tool_name, tool_input, cwd }).
// Exit 2 with a reason on stderr blocks the call; exit 0 allows it.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL = "mcp__t3-code__delegate_task";

// Returns null when dependencies are fine, otherwise a short reason.
// `node_modules/.package-lock.json` is written by every npm install, so its mtime
// is the install time.
export function checkDeps(dir) {
  const lock = join(dir, "package-lock.json");
  if (!existsSync(lock)) return null;
  const installed = join(dir, "node_modules", ".package-lock.json");
  if (!existsSync(installed)) return "node_modules is missing";
  if (statSync(lock).mtimeMs > statSync(installed).mtimeMs) {
    return "node_modules is older than package-lock.json";
  }
  return null;
}

export function blockMessage(dir, reason) {
  return `Blocked by scripts/hooks/guard-deps.mjs (L-006 in .agents/lessons-archive.md): ${reason} in ${dir}. Run \`npm ci\` there first, then retry the handoff. Codex cannot install packages from its sandbox, so without them its \`npm run check\` fails.`;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  if (payload?.tool_name !== TOOL) process.exit(0);
  // A child in its own worktree does not use this checkout.
  if (payload?.tool_input?.isolation === "worktree") process.exit(0);
  const dir = process.env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd();
  const reason = checkDeps(dir);
  if (reason) {
    process.stderr.write(`${blockMessage(dir, reason)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
