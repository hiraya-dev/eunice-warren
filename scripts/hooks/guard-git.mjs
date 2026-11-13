#!/usr/bin/env node
// Claude Code PreToolUse hook for the Bash tool. It blocks the Git and GitHub
// commands CLAUDE.md forbids, so those rules no longer rely on prose alone.
// Each Git rule names the lesson in .agents/lessons-archive.md that records why.
// It also blocks a commit chained after a pipeline (`cmd | tail && git commit`)
// unless pipefail is on, since the chain then sees the pipe's last exit status;
// that rule cites the local-checks skill, which owns the "run, then commit" rule.
//
// Input: the hook payload on stdin ({ tool_name, tool_input: { command } }).
// Exit 2 with a reason on stderr blocks the call; exit 0 allows it.
//
// The command is split into simple commands with a small shell lexer (quotes,
// escapes, operators, redirections, heredocs), so a command that only mentions
// a forbidden string, such as `grep "git checkout main" CLAUDE.md` or a commit
// message, is not blocked. `bash -c "<script>"` is checked recursively.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export const RULES = {
  "merge-flags": {
    lesson: "L-001",
    reason:
      "merge with `gh pr merge <pr> --squash` only. --delete-branch switches this worktree to main, and --merge or --rebase breaks the one-commit-per-PR history on main.",
  },
  "checkout-main": {
    lesson: "L-002",
    reason:
      "never check out main. Git allows a branch in only one worktree, so it blocks every other workspace. Diff against origin/main instead.",
  },
  "worktree-add": {
    lesson: "L-003",
    reason:
      "never create a worktree in a shell. T3 creates them (t3_thread_launch with a workspaceStrategy).",
  },
  "co-author": {
    lesson: "L-004",
    reason: "commits never carry a Co-authored-by trailer or any co-author attribution.",
  },
  "push-protected": {
    lesson: "L-005",
    reason:
      "never push to or delete main. Push the task branch and merge through a reviewed PR; main deploys production.",
  },
  "pipe-commit": {
    skill: ".agents/skills/local-checks/SKILL.md",
    reason:
      "a pipeline's exit status is its last command's, so the commit runs even if the test fails; fix with `set -o pipefail; …` or drop the pipe.",
  },
};

const PROTECTED_PUSH = new Set(["main"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);

// ---------------------------------------------------------------- lexer

// Returns simple commands plus the operator that terminated each command.
function lexCommands(source) {
  const commands = [];
  let words = [];
  let word = null; // null = no word in progress
  let skipNextWord = false; // the next word is a redirection target
  const pendingHeredocs = [];
  let i = 0;

  const endWord = () => {
    if (word === null) return;
    if (skipNextWord) {
      skipNextWord = false;
      if (pendingHeredocs.length && pendingHeredocs.at(-1).delimiter === null) {
        pendingHeredocs.at(-1).delimiter = word;
      }
    } else {
      words.push(word);
    }
    word = null;
  };
  const endCommand = (operator = null) => {
    endWord();
    if (words.length) commands.push({ words, operator });
    // `(a | b) && c`: the `&&` after `)` ends no words, so it belongs to `b`.
    else if (operator && commands.at(-1)?.operator === ")") commands.at(-1).operator = operator;
    words = [];
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\n") {
      endCommand("newline");
      i += 1;
      // Skip heredoc bodies that start after this line.
      while (pendingHeredocs.length) {
        const { delimiter, stripTabs } = pendingHeredocs.shift();
        if (delimiter === null) continue;
        while (i < source.length) {
          const end = source.indexOf("\n", i);
          const line = source.slice(i, end === -1 ? source.length : end);
          i = end === -1 ? source.length : end + 1;
          if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
        }
      }
      continue;
    }
    if (ch === " " || ch === "\t") {
      endWord();
      i += 1;
      continue;
    }
    if (ch === "#" && word === null) {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === ";" || ch === "&" || ch === "|" || ch === "(" || ch === ")") {
      let operator = ch;
      if ((ch === "&" || ch === "|") && source[i + 1] === ch) {
        operator += ch;
        i += 1;
      } else if (ch === "|" && source[i + 1] === "&") {
        operator += "&";
        i += 1;
      }
      endCommand(operator);
      i += 1;
      continue;
    }
    if (ch === "<" || ch === ">") {
      // A word of digits right before is a file descriptor (2>), not an argument.
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      let op = ch;
      i += 1;
      while (i < source.length && (source[i] === "<" || source[i] === ">")) {
        op += source[i];
        i += 1;
      }
      if (op === ">" && source[i] === "|") {
        op += "|";
        i += 1;
      }
      if (source[i] === "&") {
        // >&2, <&0: the descriptor is the target.
        i += 1;
      }
      if (op === "<<" || op === "<<-") {
        pendingHeredocs.push({ delimiter: null, stripTabs: op === "<<-" });
        if (source[i] === "-") i += 1;
      }
      skipNextWord = true;
      continue;
    }
    if (ch === "\\") {
      word = (word ?? "") + (source[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === "'") {
      const end = source.indexOf("'", i + 1);
      const stop = end === -1 ? source.length : end;
      word = (word ?? "") + source.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (ch === '"') {
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < source.length && '"\\$`\n'.includes(source[i + 1])) {
          value += source[i + 1];
          i += 2;
        } else {
          value += source[i];
          i += 1;
        }
      }
      word = (word ?? "") + value;
      i += 1;
      continue;
    }
    word = (word ?? "") + ch;
    i += 1;
  }
  endCommand();
  return commands;
}

// Returns an array of simple commands, each an array of words.
export function splitCommands(source) {
  return lexCommands(source).map(({ words }) => words);
}

// ---------------------------------------------------------------- rules

function stripAssignments(words) {
  let start = 0;
  while (start < words.length) {
    const w = words[start];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) start += 1;
    else if (w === "env" || w === "command" || w === "exec" || w === "time") start += 1;
    else break;
  }
  return words.slice(start);
}

function branchName(ref) {
  return ref.replace(/^\+/, "").replace(/^refs\/heads\//, "");
}

function checkGh(args) {
  if (args[0] !== "pr" || args[1] !== "merge") return null;
  // Flags of `gh pr merge` that take a value: skip the value so a body text
  // such as "-d" is not read as a flag.
  const withValue = new Set(["-b", "--body", "-F", "--body-file", "-t", "--subject", "-A", "--author-email", "--match-head-commit"]);
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i];
    if (withValue.has(arg)) {
      i += 1;
      continue;
    }
    if (/^--(delete-branch|merge|rebase)(=|$)/.test(arg)) return "merge-flags";
    if (/^-[A-Za-z]+$/.test(arg)) {
      for (const flag of arg.slice(1)) {
        if ("bFtA".includes(flag)) break; // the rest of the cluster is a value
        if ("dmr".includes(flag)) return "merge-flags";
      }
    }
  }
  return null;
}

// Drops git's global options (-C <path>, -c <k=v>, --no-pager, --git-dir=...).
function gitSubcommand(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-C" || args[i] === "-c" || args[i] === "--git-dir" || args[i] === "--work-tree" || args[i] === "--namespace") i += 2;
    else i += 1;
  }
  return { name: args[i], rest: args.slice(i + 1) };
}

function checkCheckout(name, args) {
  // A detached HEAD at main's commit does not claim the branch.
  if (args.includes("--detach") || (name === "switch" && args.includes("-d"))) return null;
  const createFlags = name === "checkout" ? ["-b", "-B", "--orphan"] : ["-c", "-C", "--create", "--force-create", "--orphan"];
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") return null; // `git checkout main -- <path>` restores files
    if (createFlags.includes(arg)) {
      // Creating a branch named main claims main; any other new branch is not
      // this rule's concern.
      return branchName(args[i + 1] ?? "") === "main" ? "checkout-main" : null;
    }
    const inline = arg.match(/^--(?:orphan|create|force-create)=(.*)$/);
    if (inline) return branchName(inline[1]) === "main" ? "checkout-main" : null;
    if (arg.startsWith("-")) continue;
    positionals.push(arg);
  }
  if (!positionals.length) return null;
  // --track origin/main creates (and checks out) a local branch named main.
  const tracking = args.some((arg) => arg === "-t" || arg === "--track" || arg.startsWith("--track="));
  const target = tracking ? positionals[0].split("/").at(-1) : branchName(positionals[0]);
  return target === "main" ? "checkout-main" : null;
}

function checkPush(args) {
  const withValue = new Set(["--repo", "-o", "--push-option", "--receive-pack", "--exec"]);
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (withValue.has(arg)) {
      i += 1;
      continue;
    }
    // --all and --mirror push every local branch, including any main.
    if (arg === "--all" || arg === "--mirror" || arg === "--branches") return "push-protected";
    if (arg.startsWith("-")) continue;
    positionals.push(arg);
  }
  for (const refspec of positionals.slice(1)) {
    const target = refspec.includes(":") ? refspec.slice(refspec.lastIndexOf(":") + 1) : refspec;
    if (PROTECTED_PUSH.has(branchName(target))) return "push-protected";
  }
  return null;
}

// A trailer is a message line that starts with `Co-authored-by:`. The message
// may come from -m, a heredoc, or --trailer, so look at the whole command text
// for such a line. Mentioning the trailer mid-sentence is fine.
function hasCoAuthorTrailer(args, source) {
  if (/^[ \t]*co-authored-by:/im.test(source)) return true;
  return args.some((arg, i) => {
    const previous = args[i - 1];
    if (arg.startsWith("--trailer=") || previous === "--trailer") {
      const value = arg.startsWith("--trailer=") ? arg.slice(10) : arg;
      return /^\s*co-authored-by\s*[:=]/i.test(value);
    }
    // Each -m is its own paragraph, so its text can start with the trailer.
    if (arg.startsWith("--message=") || previous === "-m" || previous === "--message") {
      return /^[ \t]*co-authored-by:/im.test(arg.replace(/^--message=/, ""));
    }
    return false;
  });
}

// `-o pipefail`, `-euo pipefail` (true); `+o pipefail` (false); otherwise null.
function pipefailOption(args) {
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] !== "pipefail") continue;
    if (/^-[a-zA-Z]*o$/.test(args[i - 1])) return true;
    if (/^\+[a-zA-Z]*o$/.test(args[i - 1])) return false;
  }
  return null;
}

// Returns true or false when the command turns pipefail on or off, else null.
function pipefailChange(words) {
  const command = stripAssignments(words);
  if (command[0] === "set") return pipefailOption(command);
  if (command[0] === "setopt" || command[0] === "unsetopt") {
    const named = command.slice(1).some((arg) => arg.replaceAll("_", "").toLowerCase() === "pipefail");
    return named ? command[0] === "setopt" : null;
  }
  return null;
}

function checkGit(args, source) {
  const { name, rest } = gitSubcommand(args);
  if (name === "checkout" || name === "switch") return checkCheckout(name, rest);
  if (name === "worktree") {
    const action = rest.find((arg) => !arg.startsWith("-"));
    return action === "add" ? "worktree-add" : null;
  }
  if (name === "commit") return hasCoAuthorTrailer(rest, source) ? "co-author" : null;
  if (name === "push") return checkPush(rest);
  return null;
}

function checkPipeCommit(commands, inheritedPipefail) {
  let pipefail = inheritedPipefail;
  let uncheckedPipelineInList = false;

  for (let i = 0; i < commands.length; i += 1) {
    const { words, operator } = commands[i];
    const command = stripAssignments(words);
    if (!command.length) continue;

    const change = pipefailChange(words);
    if (change !== null) pipefail = change;
    if (command[0] === "git") {
      const { name } = gitSubcommand(command.slice(1));
      if (name === "commit" && uncheckedPipelineInList && (i === 0 || ["&&", "||"].includes(commands[i - 1].operator))) {
        return "pipe-commit";
      }
    }

    if (operator === "|" || operator === "|&") {
      if (!pipefail) uncheckedPipelineInList = true;
    }
    // A subshell or $(…) exits with its pipeline's status too, so parentheses
    // do not end the list; only `;`, `&` and a newline do.
    if ([";", "newline", "&"].includes(operator)) {
      uncheckedPipelineInList = false;
    }
  }
  return null;
}

// Returns the id of the first rule the command breaks, or null.
export function checkCommand(source, depth = 0) {
  return checkCommandInternal(source, depth, false);
}

function checkCommandInternal(source, depth, inheritedPipefail) {
  if (typeof source !== "string" || depth > 3) return null;
  const commands = lexCommands(source);
  const pipeCommitRule = checkPipeCommit(commands, inheritedPipefail);
  if (pipeCommitRule) return pipeCommitRule;
  for (const { words: raw } of commands) {
    const words = stripAssignments(raw);
    if (!words.length) continue;
    const program = basename(words[0]);
    let rule = null;
    if (program === "git") rule = checkGit(words.slice(1), source);
    else if (program === "gh") rule = checkGh(words.slice(1));
    else if (SHELLS.has(program)) {
      const flag = words.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w));
      if (flag !== -1 && words[flag + 1] !== undefined) {
        rule = checkCommandInternal(words[flag + 1], depth + 1, pipefailOption(words) === true);
      }
    }
    if (rule) return rule;
  }
  return null;
}

export function blockMessage(rule) {
  const { lesson, skill, reason } = RULES[rule];
  const source = lesson ? `${lesson} in .agents/lessons-archive.md` : skill;
  return `Blocked by scripts/hooks/guard-git.mjs (${rule}, ${source}): ${reason} If the user explicitly asked for this, say the hook blocked it and let them run it themselves.`;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // Unreadable input: allow rather than break every Bash call. The tests pin
    // the payload shape.
    process.exit(0);
  }
  if (payload?.tool_name && payload.tool_name !== "Bash") process.exit(0);
  const rule = checkCommand(payload?.tool_input?.command);
  if (rule) {
    process.stderr.write(`${blockMessage(rule)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
