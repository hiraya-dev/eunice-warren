import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSpecSources,
  selectSpecs,
  SPEC_SOURCES,
} from "./select-specs.mjs";
const root = process.cwd();
const choose = (paths) => selectSpecs(paths, { root });
test("docs-only changes select none", () =>
  assert.equal(choose(["README.md"]).mode, "none"));
test("FAQ section selects its spec and wildcard invariants", () => {
  const result = choose(["src/components/sections/Faq.astro"]);
  assert.equal(result.mode, "specs");
  assert.ok(result.specs.includes("tests/faq.spec.ts"));
  assert.ok(result.specs.includes("tests/smoke.spec.ts"));
  assert.ok(result.specs.includes("tests/tokens.spec.ts"));
});
test("global styles are broad", () =>
  assert.equal(choose(["src/styles/global.css"]).mode, "broad"));
test("shared scripts that reach the layout are broad", () => {
  assert.equal(choose(["src/scripts/fade-in.ts"]).mode, "broad");
  assert.equal(choose(["src/scripts/scroll.ts"]).mode, "broad");
});
test("Nav stops at its three owning specs", () => {
  const result = choose(["src/components/global/Nav.astro"]);
  assert.equal(result.mode, "specs");
  assert.deepEqual(result.specs, [
    "tests/button-hover.spec.ts",
    "tests/grain-and-buttons.spec.ts",
    "tests/nav-hover.spec.ts",
    "tests/nav-scrollbar.spec.ts",
    "tests/nav.spec.ts",
    "tests/smoke.spec.ts",
    "tests/tokens.spec.ts",
  ]);
  assert.notEqual(result.mode, "broad");
});
test("FAQ stops at its owner before shared layout importers", () => {
  const result = choose(["src/components/sections/Faq.astro"]);
  assert.deepEqual(result.specs, [
    "tests/button-hover.spec.ts",
    "tests/faq.spec.ts",
    "tests/grain-and-buttons.spec.ts",
    "tests/smoke.spec.ts",
    "tests/tokens.spec.ts",
  ]);
});
test("highlight text is owned by invitation and wildcard specs", () => {
  assert.deepEqual(choose(["src/scripts/highlight-text.ts"]).specs, [
    "tests/button-hover.spec.ts",
    "tests/grain-and-buttons.spec.ts",
    "tests/invitation.spec.ts",
    "tests/smoke.spec.ts",
    "tests/tokens.spec.ts",
  ]);
});
test("a changed spec selects only itself", () =>
  assert.deepEqual(choose(["tests/faq.spec.ts"]).specs, ["tests/faq.spec.ts"]));
test("content prefix selects its owning section", () =>
  assert.ok(
    choose(["src/content/explore/crystal-cove.json"]).specs.includes(
      "tests/explore.spec.ts",
    ),
  ));
test("unmapped source fails closed", () =>
  assert.equal(choose(["src/new-runtime.ts"]).mode, "broad"));
test("button is broad even though button-hover is wildcard", () =>
  assert.equal(choose(["src/components/Button.astro"]).mode, "broad"));
test("check covers every real spec and source", () => {
  const result = checkSpecSources({ root, specSources: SPEC_SOURCES });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});
test("fixture graph selects a section plus wildcard specs", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ew-select-specs-"));
  mkdirSync(join(fixture, "src/components/sections"), { recursive: true });
  writeFileSync(join(fixture, "src/components/sections/Faq.astro"), "<div />");
  const sources = {
    "tests/faq.spec.ts": ["src/components/sections/Faq.astro"],
    "tests/smoke.spec.ts": ["*"],
  };
  const result = selectSpecs(["src/components/sections/Faq.astro"], {
    root: fixture,
    specSources: sources,
  });
  assert.deepEqual(result.specs, ["tests/faq.spec.ts", "tests/smoke.spec.ts"]);
});
test("fixture layout importer is broad unless it is a listed source", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ew-select-specs-layout-"));
  mkdirSync(join(fixture, "src/layouts"), { recursive: true });
  mkdirSync(join(fixture, "src/scripts"), { recursive: true });
  writeFileSync(
    join(fixture, "src/scripts/shared.ts"),
    "export const shared = true;",
  );
  writeFileSync(
    join(fixture, "src/scripts/unowned.ts"),
    "export const unowned = true;",
  );
  writeFileSync(
    join(fixture, "src/layouts/Base.astro"),
    "---\nimport '../scripts/shared';\nimport '../scripts/unowned';\n---",
  );
  const sources = { "tests/shared.spec.ts": ["src/scripts/shared.ts"] };
  assert.equal(
    selectSpecs(["src/scripts/shared.ts"], {
      root: fixture,
      specSources: sources,
    }).mode,
    "specs",
  );
  assert.equal(
    selectSpecs(["src/scripts/unowned.ts"], {
      root: fixture,
      specSources: sources,
    }).mode,
    "broad",
  );
});
test("fixture fan-in, unmapped source, and docs fail closed as required", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ew-select-specs-"));
  mkdirSync(join(fixture, "src/components/sections"), { recursive: true });
  writeFileSync(
    join(fixture, "src/components/sections/Shared.astro"),
    "<div />",
  );
  for (const name of ["A", "B", "C"])
    writeFileSync(
      join(fixture, `src/components/sections/${name}.astro`),
      "---\nimport './Shared.astro';\n---",
    );
  const sources = { "tests/a.spec.ts": ["src/components/sections/A.astro"] };
  assert.equal(
    selectSpecs(["src/components/sections/Shared.astro"], {
      root: fixture,
      specSources: sources,
    }).mode,
    "broad",
  );
  assert.equal(
    selectSpecs(["src/unmapped.ts"], { root: fixture, specSources: sources })
      .mode,
    "broad",
  );
  assert.equal(
    selectSpecs(["README.md"], { root: fixture, specSources: sources }).mode,
    "none",
  );
});
