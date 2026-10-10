import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { classifyPaths } from "./classify-paths.mjs";

const cases = [
  ["docs/example.md only → docs", ["docs/example.md"], "docs"],
  ["README.md only → docs", ["README.md"], "docs"],
  [".gitkeep only → docs", [".gitkeep"], "docs"],
  ["AGENTS.md only → workflow", ["AGENTS.md"], "workflow"],
  ["CLAUDE.md only → workflow", ["CLAUDE.md"], "workflow"],
  ["skills/review-pr/SKILL.md only → workflow", ["skills/review-pr/SKILL.md"], "workflow"],
  [".github/workflows/ci.yml only → workflow", [".github/workflows/ci.yml"], "workflow"],
  [".claude/settings.json only → workflow", [".claude/settings.json"], "workflow"],
  [".claude/agents/haiku-edit.md only → workflow", [".claude/agents/haiku-edit.md"], "workflow"],
  ["SETUP.md only → workflow", ["SETUP.md"], "workflow"],
  [".mcp.json only → workflow", [".mcp.json"], "workflow"],
  [".conductor/settings.toml only → workflow", [".conductor/settings.toml"], "workflow"],
  [".gitignore only → docs", [".gitignore"], "docs"],
  ["scripts/ci/classify-paths.mjs only → workflow", ["scripts/ci/classify-paths.mjs"], "workflow"],
  ["scripts/codex/run-handoff.mjs only → workflow", ["scripts/codex/run-handoff.mjs"], "workflow"],
  ["src/pages/index.astro only → runtime", ["src/pages/index.astro"], "runtime"],
  ["src/content/blog/post.md only → runtime", ["src/content/blog/post.md"], "runtime"],
  ["public/favicon.svg only → runtime", ["public/favicon.svg"], "runtime"],
  ["tests/example.spec.ts only → runtime", ["tests/example.spec.ts"], "runtime"],
  ["package.json only → runtime", ["package.json"], "runtime"],
  ["package-lock.json only → runtime", ["package-lock.json"], "runtime"],
  ["astro.config.mjs only → runtime", ["astro.config.mjs"], "runtime"],
  ["tsconfig.json only → runtime", ["tsconfig.json"], "runtime"],
  ["playwright.config.ts only → runtime", ["playwright.config.ts"], "runtime"],
  ["docs/example.md + src/pages/index.astro → runtime", ["docs/example.md", "src/pages/index.astro"], "runtime"],
  ["AGENTS.md + README.md → workflow", ["AGENTS.md", "README.md"], "workflow"],
  ["AGENTS.md + src/pages/index.astro → runtime", ["AGENTS.md", "src/pages/index.astro"], "runtime"],
  ["unknown foo/bar.txt → runtime", ["foo/bar.txt"], "runtime"],
  ["committed dist/ fails closed → runtime", ["dist/index.html"], "runtime"],
  ["[] → docs", [], "docs"],
];

for (const [name, files, route] of cases) {
  test(name, () => {
    assert.equal(classifyPaths(files).route, route);
  });
}

test("empty list reason says nothing changed", () => {
  assert.ok(classifyPaths([]).reasons.includes("nothing changed"));
});

function assertWorkflowOutput(output) {
  assert.match(output, /^route=workflow$/m);
  assert.match(output, /^runtime=false$/m);
  assert.match(output, /^workflow=true$/m);
  assert.match(output, /^docs=true$/m);
}

test("CLI output contains GitHub Actions key=value lines", () => {
  const script = fileURLToPath(new URL("./classify-paths.mjs", import.meta.url));
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  const result = spawnSync(process.execPath, [script, "AGENTS.md", "README.md"], {
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 0, result.stderr);
  assertWorkflowOutput(result.stdout);
});

test("CLI appends GitHub Actions key=value lines to GITHUB_OUTPUT", (t) => {
  const script = fileURLToPath(new URL("./classify-paths.mjs", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "classify-paths-"));
  const outputPath = join(directory, "github-output");
  t.after(() => rmSync(directory, { recursive: true }));
  writeFileSync(outputPath, "existing=true\n");

  const result = spawnSync(process.execPath, [script, "AGENTS.md", "README.md"], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: outputPath },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const output = readFileSync(outputPath, "utf8");
  assert.match(output, /^existing=true$/m);
  assertWorkflowOutput(output);
});
