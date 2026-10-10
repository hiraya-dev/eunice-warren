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
// wires tools into every session, and Conductor settings can run setup scripts.
const WORKFLOW_FILES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "SETUP.md",
  ".mcp.json",
  ".markdownlint-cli2.jsonc",
]);

const WORKFLOW_DIRECTORIES = [
  "skills",
  ".claude",
  ".github",
  "scripts/codex",
  "scripts/ci",
  ".conductor",
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
