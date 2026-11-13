import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findFlakyTests } from "./flaky-summary.mjs";

test("finds flaky tests in nested suites with full titles", () => {
  const report = {
    suites: [{
      title: "tests/landing.spec.ts",
      file: "tests/landing.spec.ts",
      line: 1,
      column: 1,
      suites: [{
        title: "landing one-pager",
        file: "tests/landing.spec.ts",
        line: 3,
        column: 1,
        suites: [{
          title: "phone menu",
          file: "tests/landing.spec.ts",
          line: 5,
          column: 3,
          specs: [{
            title: "opens menu",
            file: "tests/landing.spec.ts",
            line: 7,
            column: 5,
            tests: [{ projectName: "desktop", status: "flaky" }],
          }],
        }],
      }],
    }],
  };

  assert.deepEqual(findFlakyTests(report), [{
    file: "tests/landing.spec.ts",
    title: "landing one-pager › phone menu › opens menu",
    project: "desktop",
  }]);
});

test("keeps nested describe titles when spec titles repeat", () => {
  const suite = (describeTitle) => ({
    title: describeTitle,
    file: "tests/reveals.spec.ts",
    line: 3,
    column: 1,
    specs: [{
      title: "keeps reveal targets visible",
      file: "tests/reveals.spec.ts",
      line: 5,
      column: 3,
      tests: [{ projectName: "mobile", status: "flaky" }],
    }],
  });
  const report = {
    suites: [{
      title: "tests/reveals.spec.ts",
      file: "tests/reveals.spec.ts",
      line: 1,
      column: 1,
      suites: [suite("element reveal without JavaScript on /home-v7/"), suite("element reveal without JavaScript on /")],
    }],
  };

  assert.deepEqual(findFlakyTests(report).map(({ title }) => title), [
    "element reveal without JavaScript on /home-v7/ › keeps reveal targets visible",
    "element reveal without JavaScript on / › keeps reveal targets visible",
  ]);
});

test("returns an empty list when there are no flaky tests", () => {
  assert.deepEqual(findFlakyTests({ suites: [{
    title: "tests/stable.spec.ts",
    file: "tests/stable.spec.ts",
    line: 1,
    column: 1,
    specs: [{
      title: "stable",
      file: "tests/stable.spec.ts",
      line: 3,
      column: 1,
      tests: [{ status: "expected" }],
    }],
  }] }), []);
});

test("includes only flaky statuses among mixed results", () => {
  const report = { suites: [{
    title: "tests/a.spec.ts",
    file: "tests/a.spec.ts",
    line: 1,
    column: 1,
    specs: [{
      title: "check",
      file: "tests/a.spec.ts",
      line: 3,
      column: 1,
      tests: [
        { projectName: "desktop", status: "expected" },
        { projectName: "mobile", status: "flaky" },
        { projectName: "rail", status: "unexpected" },
      ],
    }],
  }] };
  assert.deepEqual(findFlakyTests(report), [{ file: "tests/a.spec.ts", title: "check", project: "mobile" }]);
});

test("CLI prints warnings and appends the GitHub step summary", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flaky-summary-"));
  try {
    const reportPath = path.join(directory, "report.json");
    const summaryPath = path.join(directory, "summary.md");
    await writeFile(reportPath, JSON.stringify({ suites: [{
      title: "tests/a.spec.ts",
      file: "tests/a.spec.ts",
      line: 1,
      column: 1,
      suites: [{
        title: "checkout",
        file: "tests/a.spec.ts",
        line: 3,
        column: 1,
        specs: [{
          title: "submits the form",
          file: "tests/a.spec.ts",
          line: 5,
          column: 3,
          tests: [{ projectName: "desktop", status: "flaky" }],
        }],
      }],
    }] }));
    const result = spawnSync(process.execPath, ["scripts/ci/flaky-summary.mjs", reportPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /::warning title=Flaky test::tests\/a\.spec\.ts › checkout › submits the form \[desktop\]/);
    assert.equal(await readFile(summaryPath, "utf8"),
      "## Flaky tests\n\n- tests/a.spec.ts › checkout › submits the form [desktop]\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI continues when the GitHub step summary cannot be appended", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flaky-summary-"));
  try {
    const reportPath = path.join(directory, "report.json");
    await writeFile(reportPath, JSON.stringify({ suites: [] }));
    const result = spawnSync(process.execPath, ["scripts/ci/flaky-summary.mjs", reportPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: directory },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Could not append flaky test summary/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing report CLI path exits successfully with a note", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flaky-summary-"));
  try {
    const missingPath = path.join(directory, "missing.json");
    const result = spawnSync(process.execPath, ["scripts/ci/flaky-summary.mjs", missingPath], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /report not found/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
