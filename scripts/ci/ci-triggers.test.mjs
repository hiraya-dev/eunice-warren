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

test("pull_request runs on opened, synchronize and reopened only", () => {
  // A ready_for_review run would race the draft's run in the same concurrency
  // group, and cancel-in-progress could leave gate cancelled.
  const types = ci.match(/^ {4}types: \[(.*)\]$/m);
  assert.ok(types);
  assert.deepEqual(types[1].split(",").map((type) => type.trim()), ["opened", "synchronize", "reopened"]);
});

test("no job skips drafts and gate always runs", () => {
  assert.doesNotMatch(ci, /pull_request\.draft/);
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

test("runtime runs the production build with unit tests, and every spec in the matching image", () => {
  const build = jobBlock("build");
  assert.match(build, /npm run check/);
  assert.match(build, /npm run test:unit/);
  assert.match(build, /npm run build/);
  const e2e = jobBlock("e2e");
  assert.match(e2e, /image: mcr\.microsoft\.com\/playwright:v\$\{\{ needs\.classify\.outputs\.playwright \}\}-noble/);
  assert.match(e2e, /npm run test:e2e$/m);
  assert.doesNotMatch(e2e, /--grep/);
  assert.match(e2e, /flaky-summary\.mjs test-results\/results\.json/);
});

test("checks covers docs and workflow, and gate needs every job", () => {
  const checks = jobBlock("checks");
  for (const step of ["lint:md", "test:ci-scripts", "test:hooks", "check:lessons", "actionlint"]) {
    assert.match(checks, new RegExp(step.replace(":", "\\:")));
  }
  assert.match(ci, /needs: \[classify, build, e2e, checks\]/);
});

test("flake-check runs only by hand, without retries", () => {
  assert.match(flake, /^on:\n {2}workflow_dispatch:$/m);
  assert.match(flake, /--retries 0/);
});
