import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RULES, checkCommand, splitCommands } from "./guard-git.mjs";

const script = fileURLToPath(new URL("./guard-git.mjs", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));

const blocked = [
  // merge-flags
  ["gh pr merge 12 --delete-branch", "merge-flags"],
  ["gh pr merge 12 --squash --delete-branch", "merge-flags"],
  ["gh pr merge 12 -d", "merge-flags"],
  ["gh pr merge 12 --merge", "merge-flags"],
  ["gh pr merge 12 -m", "merge-flags"],
  ["gh pr merge 12 --rebase", "merge-flags"],
  ["gh pr merge 12 -r", "merge-flags"],
  ["gh pr merge 12 -sd", "merge-flags"],
  ["cd /tmp && gh pr merge 12 --merge --admin", "merge-flags"],
  // checkout-main
  ["git checkout main", "checkout-main"],
  ["git switch main", "checkout-main"],
  ["git checkout -f main", "checkout-main"],
  ["git -C ../other checkout main", "checkout-main"],
  ["git switch refs/heads/main", "checkout-main"],
  ["git checkout -B main origin/main", "checkout-main"],
  ["git switch -c main", "checkout-main"],
  ["git fetch origin && git checkout main && git pull", "checkout-main"],
  ["/usr/bin/git switch main", "checkout-main"],
  ["git checkout -t origin/main", "checkout-main"],
  ["git switch --track origin/main", "checkout-main"],
  // worktree-add
  ["git worktree add ../x origin/main", "worktree-add"],
  ["git worktree add -b feat ../x", "worktree-add"],
  // co-author
  ['git commit -m "fix: x\n\nCo-authored-by: A <a@b.c>"', "co-author"],
  ["git commit -m 'fix' --trailer 'co-authored-by: A <a@b.c>'", "co-author"],
  ["git commit -m fix --trailer=Co-authored-by=A", "co-author"],
  ['git commit -m "fix" -m "Co-authored-by: A <a@b.c>"', "co-author"],
  [
    "git commit -F - <<'EOF'\nfix: thing\n\nCo-Authored-By: Bot <bot@example.com>\nEOF",
    "co-author",
  ],
  // push-protected
  ["git push origin main", "push-protected"],
  ["git push origin HEAD:main", "push-protected"],
  ["git push origin HEAD:refs/heads/main", "push-protected"],
  ["git push origin +feat:main", "push-protected"],
  ["git push origin --delete main", "push-protected"],
  ["git push origin :main", "push-protected"],
  ["git push -u origin main", "push-protected"],
  ["git push --force origin t3/x main", "push-protected"],
  ["git push --all origin", "push-protected"],
  ["git push --mirror origin", "push-protected"],
  ["npm run build && git push origin main 2>&1 | tail -5", "push-protected"],
  // pipe-commit
  ["npx playwright test x | tail -20 && git commit -m \"m\"", "pipe-commit"],
  ["npm run build && npx playwright test | tee log && git commit -m \"m\"", "pipe-commit"],
  ["cmd | tail && echo ok && git commit -m \"m\"", "pipe-commit"],
  ["cmd |& tail && git commit -m m", "pipe-commit"],
  ["cmd | tail && set -o pipefail && git commit -m m", "pipe-commit"],
  // A pipeline anywhere in the same and/or list also counts across `||`.
  ["cmd | tail || git commit -m m", "pipe-commit"],
  ['bash -c "cmd | tail && git commit -m m"', "pipe-commit"],
  ['zsh -c "cmd | tail && git commit -m m"', "pipe-commit"],
  ["cmd | tail && git -C dir commit -m m", "pipe-commit"],
  ["cmd | tail && FOO=1 git commit -m m", "pipe-commit"],
  ["(cmd | tail) && git commit -m m", "pipe-commit"],
  ["out=$(cmd | tail) && git commit -m m", "pipe-commit"],
  ["set -o pipefail; set +o pipefail; cmd | tail && git commit -m m", "pipe-commit"],
  ["setopt pipefail; unsetopt pipe_fail; cmd | tail && git commit -m m", "pipe-commit"],
  ['bash +o pipefail -c "cmd | tail && git commit -m m"', "pipe-commit"],
  ["echo $(git push origin main)", "push-protected"],
  // wrappers
  ['bash -c "git push origin main"', "push-protected"],
  ["GIT_TRACE=1 git push origin main", "push-protected"],
  ["env FOO=1 git checkout main", "checkout-main"],
  ["(cd .. && git switch main)", "checkout-main"],
];

const allowed = [
  "gh pr merge 12 --squash",
  "gh pr merge 12 -s",
  "gh pr merge 12 --squash --body '-d -m --merge'",
  "gh pr merge https://github.com/o/r/pull/12 --squash",
  "gh pr view 12 --json state,mergedAt",
  'gh pr create --base main --title "x" --body "never --merge or --delete-branch"',
  "git push origin --delete t3/shared-lessons-git-hooks",
  "git push -u origin HEAD",
  "git push origin t3/main-nav-fix",
  "git push",
  "git -C dir commit -m m",
  "FOO=1 git -C dir commit -m m",
  "git push --dry-run origin t3/x",
  "git checkout -b feat main",
  "git checkout main -- src/styles/global.css",
  "git checkout origin/main -- package.json",
  "git switch --detach main",
  "git checkout t3/x",
  "git checkout -t origin/t3/x",
  "git diff origin/main...HEAD",
  "git merge --no-edit origin/main",
  "git merge-base --is-ancestor origin/main HEAD",
  "git log main..HEAD",
  "git fetch origin --prune",
  "git worktree list",
  "git worktree prune",
  'git commit -m "docs: never git push origin main or git checkout main"',
  "git commit -F - <<'EOF'\ndocs: forbid git push origin main\n\ngit checkout main is blocked too\nEOF",
  'grep -n "git checkout main" CLAUDE.md',
  "rg 'gh pr merge .* --merge' .agents",
  'echo "git push origin main"',
  "cat <<EOF > notes.txt\ngit push origin main\nEOF",
  "# git push origin main\nls",
  'grep -i "co-authored-by" CLAUDE.md',
  'git commit -m "feat: hook blocks Co-authored-by commits and trailers"',
  "git commit -F - <<'EOF'\nfeat: block Co-authored-by: trailers\n\nbody\nEOF",
  "npm run build && npx playwright test tests/home.spec.ts && git commit -m 'fix: rail'",
  "set -o pipefail; cmd | tail && git commit -m m",
  "set -o pipefail && cmd | tail && git commit -m m",
  "set -euo pipefail; cmd | tail && git commit -m m",
  "set -eo pipefail; cmd | tail && git commit -m m",
  "set -e -o pipefail; cmd | tail && git commit -m m",
  "setopt pipefail; cmd | tail && git commit -m m",
  "setopt pipe_fail; cmd | tail && git commit -m m",
  "setopt PIPE_FAIL; cmd | tail && git commit -m m",
  'bash -o pipefail -c "cmd | tail && git commit -m m"',
  'bash -euo pipefail -c "cmd | tail && git commit -m m"',
  'zsh -o pipefail -c "cmd | tail && git commit -m m"',
  'git commit -m "$(cat msg | head -1)"',
  "npm run build && npx playwright test x && git commit -m \"m\"",
  "git commit -m \"m\" | tail",
  "a || b && git commit -m \"m\"",
  "cmd | tail; git status",
  "cmd | tail; git commit -m m",
  "cmd >| out && git commit -m m",
  'grep "| tail && git commit" CLAUDE.md',
  'git commit -m "a | b && c"',
  "git commit -m 'a | b && c'",
  "cat <<EOF\ncmd | tail && git commit -m x\nEOF",
  "node --test scripts/hooks/guard-git.test.mjs",
];

for (const [command, rule] of blocked) {
  test(`blocks ${JSON.stringify(command)}`, () => {
    assert.equal(checkCommand(command), rule);
  });
}

for (const command of allowed) {
  test(`allows ${JSON.stringify(command)}`, () => {
    assert.equal(checkCommand(command), null);
  });
}

test("splitCommands keeps quoted operators and drops heredoc bodies", () => {
  assert.deepEqual(splitCommands(`a "x && y" | b 'c;d' 2>&1\ncat <<EOF\ngit push origin main\nEOF\nz`), [
    ["a", "x && y"],
    ["b", "c;d"],
    ["cat"],
    ["z"],
  ]);
});

function runHook(payload) {
  return spawnSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: "utf8" });
}

test("hook exits 2 with the reason and lesson on a blocked command", () => {
  const result = runHook({ tool_name: "Bash", tool_input: { command: "gh pr merge 3 --delete-branch" } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /merge-flags/);
  assert.match(result.stderr, /L-001/);
});

test("hook exits 0 on an allowed command", () => {
  const result = runHook({ tool_name: "Bash", tool_input: { command: "gh pr merge 3 --squash" } });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("hook ignores other tools and unreadable input", () => {
  assert.equal(runHook({ tool_name: "Read", tool_input: { file_path: "x" } }).status, 0);
  const garbage = spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" });
  assert.equal(garbage.status, 0);
});

test(".claude/settings.json runs the guard before every Bash call", () => {
  const settings = JSON.parse(readFileSync(`${root}.claude/settings.json`, "utf8"));
  const entries = settings.hooks?.PreToolUse ?? [];
  const bash = entries.filter((entry) => entry.matcher === "Bash");
  assert.ok(
    bash.some((entry) => entry.hooks?.some((hook) => hook.type === "command" && hook.command.includes("scripts/hooks/guard-git.mjs"))),
    "no PreToolUse Bash hook runs scripts/hooks/guard-git.mjs",
  );
});

test("every rule cites a lesson recorded in the archive or a skill that states the rule", () => {
  const archive = readFileSync(`${root}.agents/lessons-archive.md`, "utf8");
  for (const [rule, { lesson, skill }] of Object.entries(RULES)) {
    if (skill) {
      assert.equal(lesson, undefined, `${rule} cites both a lesson and a skill`);
      const text = readFileSync(`${root}${skill}`, "utf8");
      assert.match(text, new RegExp(`guard-git\\.mjs\` rule ${rule}`), `${skill} does not name the ${rule} guard`);
      continue;
    }
    assert.match(archive, new RegExp(`^### ${lesson} `, "m"), `${rule} cites ${lesson}, which is not in the archive`);
    assert.match(archive, new RegExp(`guard-git\\.mjs\` rule ${rule}$`, "m"), `${lesson} does not name the ${rule} guard`);
  }
});

test("the pipe-commit block names the local-checks skill", () => {
  const result = runHook({ tool_name: "Bash", tool_input: { command: "npm run prepush | tail && git commit -m m" } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /pipe-commit, \.agents\/skills\/local-checks\/SKILL\.md/);
});
