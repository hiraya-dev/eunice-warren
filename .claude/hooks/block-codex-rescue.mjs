// PreToolUse hook for the Agent tool. Denies codex-rescue subagents: that path is
// background-only, silently drops --wait/--fresh, and writes to the shared checkout
// after the handoff appears to have returned. See CLAUDE.md, Delegating.
//
// Fails closed: if the hook input cannot be read, exit 2 blocks the call. A broken
// hook must not quietly let codex-rescue through.
import process from "node:process";
import { pathToFileURL } from "node:url";

const REASON =
  "Blocked by repo contract: codex-rescue via the Agent tool is background-only, " +
  "silently drops --wait/--fresh, and writes to the shared checkout after the " +
  "handoff appears to have returned. Delegate through: " +
  "node scripts/codex/run-handoff.mjs. See CLAUDE.md.";

export function decide(input) {
  const subagentType = String(input?.tool_input?.subagent_type ?? "");
  if (!/codex-rescue/.test(subagentType)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: REASON,
    },
  };
}

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  try {
    process.stdout.write(`${JSON.stringify(decide(JSON.parse(raw)))}\n`);
  } catch (error) {
    process.stderr.write(`block-codex-rescue hook could not read its input: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
