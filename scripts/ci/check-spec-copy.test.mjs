import { deepStrictEqual, strictEqual } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findViolations } from "./check-spec-copy.mjs";

function fixture({ answer = "A fixture answer that is long" , testSource = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "spec-copy-"));
  mkdirSync(join(root, "src/content"), { recursive: true });
  mkdirSync(join(root, "src/components"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  mkdirSync(join(root, "scripts/ci"), { recursive: true });
  writeFileSync(join(root, "src/content/faq.json"), JSON.stringify({ answer }));
  writeFileSync(join(root, "src/components/Copy.astro"), "<p>A component sentence that is long</p>");
  writeFileSync(join(root, "scripts/ci/spec-copy-allowlist.json"), "[]");
  writeFileSync(join(root, "tests/example.spec.ts"), testSource);
  return root;
}

test("fails when a spec pins a FAQ answer", () => {
  const root = fixture({ testSource: 'expect(page).toHaveText("A fixture answer that is long")' });
  try {
    deepStrictEqual(findViolations({ rootDirectory: root }).map(({ value }) => value), ["A fixture answer that is long"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("allows an explicitly listed fact", () => {
  const root = fixture({ answer: "01.14.27", testSource: 'expect(page).toHaveText("01.14.27")' });
  writeFileSync(join(root, "scripts/ci/spec-copy-allowlist.json"), JSON.stringify([{ value: "01.14.27", reason: "date" }]));
  try { strictEqual(findViolations({ rootDirectory: root }).length, 0); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("passes a structural spec", () => {
  const root = fixture({ testSource: 'await expect(page.locator("[data-faq]")).toBeVisible()' });
  try { strictEqual(findViolations({ rootDirectory: root }).length, 0); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("detects static component text nodes", () => {
  const root = fixture({ testSource: 'expect(page).toHaveText("A component sentence that is long")' });
  try {
    strictEqual(findViolations({ rootDirectory: root })[0].value, "A component sentence that is long");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
