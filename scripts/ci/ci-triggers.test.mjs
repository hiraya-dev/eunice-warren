import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Pins the CI contract the workflow docs rely on (local-checks **CI routes**,
// review-pr **Local review**).
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const flake = readFileSync(new URL("../../.github/workflows/flake-check.yml", import.meta.url), "utf8");

function jobBlock(name) {
  const start = ci.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `job ${name} not found in ci.yml`);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test("pull_request also runs when a PR is marked ready", () => {
  // Marking a runtime PR ready starts the full tier. The ready run supersedes the
  // draft's run on the same head (cancel-in-progress), so the head's last gate is
  // the full tier's.
  const types = ci.match(/^ {4}types: \[(.*)\]$/m);
  assert.ok(types);
  assert.deepEqual(types[1].split(",").map((type) => type.trim()), [
    "opened",
    "synchronize",
    "reopened",
    "ready_for_review",
  ]);
});

test("only the tier step reads draft state, and gate always runs", () => {
  const drafts = ci.match(/pull_request\.draft/g) ?? [];
  assert.equal(drafts.length, 1);
  assert.match(jobBlock("classify"), /DRAFT: \$\{\{ github\.event\.pull_request\.draft \}\}/);
  assert.match(jobBlock("gate"), /^ {4}if: always\(\)$/m);
});

test("classify is unconditional and superseded pushes cancel", () => {
  assert.doesNotMatch(jobBlock("classify"), /^ {4}if:/m);
  assert.match(ci, /^ {2}cancel-in-progress: true$/m);
});

test("main pushes and manual runs are triggers; nothing is scheduled", () => {
  assert.match(ci, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(ci, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(ci, /^ {2}schedule:/m);
});

test("classify decides the tier from the labels API and checks an already-tested tree", () => {
  const classify = jobBlock("classify");
  assert.match(classify, /full: \$\{\{ steps\.tier\.outputs\.full \}\}/);
  assert.match(classify, /tested: \$\{\{ steps\.tested\.outputs\.tested \}\}/);
  assert.match(classify, /issues\/\$PR_NUMBER\/labels/);
  assert.match(classify, /grep -qx 'ci:full'/);
  assert.match(classify, /node scripts\/ci\/already-tested\.mjs/);
});

test("runtime runs the build, and e2e names its tier and runs it on two workers", () => {
  const build = jobBlock("build");
  assert.match(build, /npm run check/);
  assert.match(build, /npm run test:unit/);
  assert.match(build, /npm run build/);
  assert.match(build, /select-specs\.mjs --check/);
  const e2e = jobBlock("e2e");
  assert.match(e2e, /name: e2e \(\$\{\{ needs\.classify\.outputs\.full == 'true' && 'full' \|\| 'smoke' \}\}\)/);
  assert.match(e2e, /image: mcr\.microsoft\.com\/playwright:v\$\{\{ needs\.classify\.outputs\.playwright \}\}-noble/);
  assert.match(e2e, /npm run check:sweep-tags/);
  assert.match(e2e, /npm run test:e2e -- --grep-invert @sweep --workers=2$/m);
  assert.match(e2e, /npm run test:e2e -- --grep @smoke --workers=2 --project=chromium --project=mobile$/m);
  assert.match(e2e, /flaky-summary\.mjs test-results\/results\.json/);
});

test("sweeps run only on the full tier, sharded two ways at the config's one worker", () => {
  const sweeps = jobBlock("sweeps");
  assert.match(sweeps, /name: sweeps \(\$\{\{ matrix\.shard \}\}\/2\)/);
  assert.match(sweeps, /needs\.classify\.outputs\.full == 'true'/);
  assert.match(sweeps, /fail-fast: false/);
  assert.match(sweeps, /shard: \[1, 2\]/);
  assert.match(sweeps, /npm run test:e2e -- --grep @sweep --shard=\$\{\{ matrix\.shard \}\}\/2$/m);
  assert.doesNotMatch(sweeps, /--workers/);
});

test("an already-tested tree skips every check job", () => {
  for (const job of ["build", "e2e", "sweeps", "checks"]) {
    assert.match(jobBlock(job), /needs\.classify\.outputs\.tested != 'true'/, job);
  }
});

test("checks covers docs and workflow, and gate needs every job and fails closed", () => {
  const checks = jobBlock("checks");
  for (const step of ["lint:md", "test:ci-scripts", "test:hooks", "check:lessons", "actionlint", "select-specs\\.mjs --check"]) {
    assert.match(checks, new RegExp(step.replace(":", "\\:")));
  }
  const gate = jobBlock("gate");
  assert.match(gate, /needs: \[classify, build, e2e, sweeps, checks\]/);
  assert.match(gate, /SWEEPS_RESULT: \$\{\{ needs\.sweeps\.result \}\}/);
  assert.match(gate, /"\$FULL" == "true" && "\$SWEEPS_RESULT" != "success"/);
});

test("flake-check runs only by hand, without retries", () => {
  assert.match(flake, /^on:\n {2}workflow_dispatch:$/m);
  assert.match(flake, /--retries 0/);
});
