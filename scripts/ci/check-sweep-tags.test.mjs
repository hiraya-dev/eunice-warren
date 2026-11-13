import assert from "node:assert/strict";
import test from "node:test";
import { checkSweepTags } from "./check-sweep-tags.mjs";

// This shape is trimmed from .context/adc-ci/playwright-list.sample.json:
// Playwright puts each file suite's specs inside nested describe suites, and
// each spec retains title, file, line, column, tags, and tests fields.
function spec(title, tags = [], file = "tests/rail.spec.ts") {
  return {
    title,
    file,
    line: 10,
    column: 1,
    tags,
    tests: [{ title, projectName: "desktop", results: [] }],
  };
}
function report(suites) {
  return { suites };
}
function fileSuite(file, suites) {
  return {
    title: file,
    file: file.replace("tests/", ""),
    line: 1,
    column: 1,
    specs: [],
    suites,
  };
}
const SWEEPS = new Set(["tests/rail.spec.ts"]);

test("passes when tagged files exactly match SWEEP_SPECS", () => {
  const result = checkSweepTags(
    report([
      fileSuite("tests/rail.spec.ts", [
        {
          title: "describe rail",
          file: "tests/rail.spec.ts",
          line: 2,
          column: 1,
          specs: [spec("sweeps", ["@sweep"]), spec("quick")],
        },
      ]),
    ]),
    SWEEPS,
  );
  assert.deepEqual(result.errors, []);
  assert.ok(result.ok);
});

test("accepts tags reported without the @", () => {
  const result = checkSweepTags(
    report([
      fileSuite("tests/rail.spec.ts", [
        {
          title: "nested describe",
          file: "tests/rail.spec.ts",
          line: 2,
          column: 1,
          specs: [spec("sweeps", ["sweep"])],
        },
      ]),
    ]),
    SWEEPS,
  );
  assert.ok(result.ok, result.errors.join("\n"));
});

test("fails when nothing is tagged", () => {
  const result = checkSweepTags(
    report([
      fileSuite("tests/rail.spec.ts", [
        {
          title: "nested describe",
          file: "tests/rail.spec.ts",
          line: 2,
          column: 1,
          specs: [spec("sweeps")],
        },
      ]),
    ]),
    SWEEPS,
  );
  assert.ok(!result.ok);
  assert.ok(result.errors.includes("no test is tagged @sweep"));
});

test("allows a sweep file to mix tagged and untagged tests", () => {
  const result = checkSweepTags(
    report([
      fileSuite("tests/rail.spec.ts", [
        {
          title: "nested describe",
          file: "tests/rail.spec.ts",
          line: 2,
          column: 1,
          specs: [spec("sweeps", ["@sweep"]), spec("unit check")],
        },
      ]),
    ]),
    SWEEPS,
  );
  assert.ok(result.ok, result.errors.join("\n"));
});

test("fails when a tagged file is missing from SWEEP_SPECS", () => {
  const result = checkSweepTags(
    report([
      fileSuite("tests/rail.spec.ts", [
        {
          title: "describe rail",
          file: "tests/rail.spec.ts",
          line: 2,
          column: 1,
          specs: [spec("sweeps", ["@sweep"])],
        },
      ]),
      fileSuite("tests/home-wide.spec.ts", [
        {
          title: "nested describe",
          file: "tests/home-wide.spec.ts",
          line: 2,
          column: 1,
          specs: [spec("wide", ["@sweep"], "tests/home-wide.spec.ts")],
        },
      ]),
    ]),
    SWEEPS,
  );
  assert.match(
    result.errors.join("\n"),
    /home-wide\.spec\.ts has @sweep tests but is not in SWEEP_SPECS/,
  );
});

test("fails when SWEEP_SPECS lists a file with no tagged tests", () => {
  const result = checkSweepTags(
    report([
      fileSuite("tests/rail.spec.ts", [
        {
          title: "describe rail",
          file: "tests/rail.spec.ts",
          line: 2,
          column: 1,
          specs: [spec("sweeps", ["@sweep"])],
        },
      ]),
      fileSuite("tests/gone.spec.ts", [
        {
          title: "nested describe",
          file: "tests/gone.spec.ts",
          line: 2,
          column: 1,
          specs: [spec("untagged", [], "tests/gone.spec.ts")],
        },
      ]),
    ]),
    new Set([
      "tests/rail.spec.ts",
      "tests/gone.spec.ts",
      "tests/missing.spec.ts",
    ]),
  );
  assert.match(
    result.errors.join("\n"),
    /gone\.spec\.ts, but none of its tests is tagged/,
  );
  assert.match(
    result.errors.join("\n"),
    /missing\.spec\.ts, which has no tests/,
  );
});
