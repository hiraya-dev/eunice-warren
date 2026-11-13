import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const RUNTIME_FILES = new Set([
  "package.json",
  "package-lock.json",
  "astro.config.mjs",
  "astro.config.ts",
  "astro.config.js",
  "tsconfig.json",
  "playwright.config.js",
  "playwright.config.ts",
]);

const RUNTIME_DIRECTORIES = ["src", "public", "tests"];

// Agent instructions and agent tooling config are operational code: .mcp.json
// wires tools into every session, and t3.json (T3 Code's host settings) runs
// setup scripts.
const WORKFLOW_FILES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "SETUP.md",
  ".mcp.json",
  "t3.json",
  ".markdownlint-cli2.jsonc",
  // The lessons ledger is read by Codex and the reviewer as rules, and
  // scripts/lessons/select.mjs --check validates it in the workflow job.
  ".agents/lessons.md",
  ".agents/lessons-archive.md",
  // The skills CLI manifest for vendored skills.
  "skills-lock.json",
]);

// Skills live in .agents/skills (linked into .claude/skills).
const WORKFLOW_DIRECTORIES = [
  ".agents/skills",
  ".claude",
  ".github",
  "scripts/ci",
  "scripts/hooks",
  "scripts/lessons",
  // Retired with the move to T3 Code (2026-11-13): Conductor settings, the codex
  // exec launcher, and the old skills/ directory. Kept so the deletion, or a
  // stray re-add, routes workflow instead of runtime.
  ".conductor",
  "scripts/codex",
  "skills",
];

const DOCS_FILES = new Set([".gitignore", ".gitkeep"]);

function isUnder(path, directory) {
  return path.startsWith(`${directory}/`);
}

function isNoise(path) {
  return path === ".DS_Store" || path.endsWith("/.DS_Store");
}

export function classifyPaths(files) {
  const paths = files.map((file) => file.trim()).filter(Boolean);

  let runtime = false;
  let workflow = false;
  let docs = false;
  const reasons = [];

  for (const file of paths) {
    // Runtime is checked first, so Markdown under src/ (content collections)
    // routes runtime: it is rendered by the build, not just read.
    if (
      RUNTIME_DIRECTORIES.some((directory) => isUnder(file, directory)) ||
      RUNTIME_FILES.has(file)
    ) {
      runtime = true;
      continue;
    }

    if (
      WORKFLOW_FILES.has(file) ||
      WORKFLOW_DIRECTORIES.some((directory) => isUnder(file, directory))
    ) {
      workflow = true;
      continue;
    }

    if (
      file.endsWith(".md") ||
      DOCS_FILES.has(file) ||
      isNoise(file)
    ) {
      docs = true;
      continue;
    }

    runtime = true;
    reasons.push(`unknown path fails closed: ${file}`);
  }

  if (paths.length === 0) {
    docs = true;
    reasons.push("nothing changed");
  }

  let route;
  if (runtime) {
    route = "runtime";
    reasons.unshift("runtime-affecting files changed");
  } else if (workflow) {
    route = "workflow";
    reasons.unshift("workflow instructions or CI tooling changed");
  } else {
    route = "docs";
    if (paths.length > 0) reasons.unshift("documentation or ignored metadata changed");
  }

  return { route, reasons, runtime, workflow, docs };
}

async function readCliFiles() {
  if (process.argv.length > 2) return process.argv.slice(2);
  if (process.stdin.isTTY) return [];

  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input.split(/\r?\n/);
}

async function main() {
  const result = classifyPaths(await readCliFiles());
  const output = [
    `route=${result.route}`,
    `runtime=${result.runtime}`,
    `workflow=${result.workflow}`,
    `docs=${result.docs}`,
    `reasons=${result.reasons.join("; ")}`,
  ].join("\n") + "\n";

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, output);
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
