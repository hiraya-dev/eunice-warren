import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { BASELINE, compare, countedComments, lowered, main, scanComments } from "./check-comments.mjs";

const texts = (source, file) => countedComments(source, file).map((comment) => comment.text);

test("finds line and block comments in scripts, not look-alikes in strings, URLs or regexes", () => {
  const source = [
    "// one",
    'const url = "https://example.com/*not*/";',
    "const glob = 'src/**/*.json';",
    "const t = `a ${b} // not`; /* two */",
    "const re = /^https?:\\/\\//i.test(url);",
    "const half = width / 2; /* three */",
  ].join("\n");
  assert.deepEqual(texts(source, "src/x.ts"), ["// one", "/* two */", "/* three */"]);
});

test("CSS counts only block comments", () => {
  assert.deepEqual(texts("a { background: url(//cdn/x.png); } /* one */", "src/styles/x.css"), ["/* one */"]);
});

test("YAML counts a hash only at a line start or after whitespace", () => {
  assert.deepEqual(texts("# one\nrun: echo $# 'a#b' # two\n", ".github/workflows/x.yml"), ["# one", "# two"]);
});

test("Astro counts frontmatter, template, script and style comments, not apostrophes in text", () => {
  const source = [
    "---",
    "// one",
    "const a = 1;",
    "---",
    "<p>Don't stop // not a comment</p>",
    "<!-- two -->",
    "{/* three */}",
    "<script>// four\n</script>",
    "<style>/* five */ a { color: red; }</style>",
  ].join("\n");
  assert.deepEqual(texts(source, "src/pages/x.astro"), ["// one", "<!-- two -->", "{/* three */}".slice(1, -1), "// four", "/* five */"]);
});

test("tool directives and component prop docs are allowed", () => {
  assert.deepEqual(texts("// @ts-check\n/** @type {import('x').Y} */\nconst y = 1;", "astro.config.mjs"), []);
  const component = "---\ninterface Props {\n  /** Disable the button. */\n  disabled?: boolean;\n}\n/** Not a prop. */\nconst x = 1;\n---";
  assert.deepEqual(texts(component, "src/components/Button.astro"), ["/** Not a prop. */"]);
  assert.deepEqual(texts(component, "src/pages/index.astro"), ["/** Disable the button. */", "/** Not a prop. */"]);
});

test("reports the line a comment starts on", () => {
  assert.deepEqual(
    scanComments("a;\n\n/* x\n y */", "src/x.ts").map((comment) => comment.line),
    [3],
  );
});

test("compare flags files above and below the baseline", () => {
  const { over, under } = compare({ "a.ts": 3, "new.ts": 1, "b.ts": 1 }, { "a.ts": 2, "b.ts": 4, "gone.ts": 1 });
  assert.deepEqual(over, [
    { file: "a.ts", count: 3, allowed: 2 },
    { file: "new.ts", count: 1, allowed: 0 },
  ]);
  assert.deepEqual(under, [
    { file: "b.ts", count: 1, allowed: 4 },
    { file: "gone.ts", count: 0, allowed: 1 },
  ]);
});

test("lowered never raises a count or adds a file", () => {
  assert.deepEqual(lowered({ "a.ts": 5, "b.ts": 1, "new.ts": 2 }, { "a.ts": 2, "b.ts": 4, "gone.ts": 1 }), { "a.ts": 2, "b.ts": 1 });
});

function repo(files) {
  const rootDirectory = mkdtempSync(join(tmpdir(), "check-comments-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(rootDirectory, file)), { recursive: true });
    writeFileSync(join(rootDirectory, file), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: rootDirectory });
  execFileSync("git", ["add", "."], { cwd: rootDirectory });
  return rootDirectory;
}

test("the check fails on a new comment and passes once it is deleted", () => {
  const rootDirectory = repo({ "src/a.ts": "// old\nconst a = 1;\n", [BASELINE]: JSON.stringify({ "src/a.ts": 1 }) });
  assert.equal(main([], rootDirectory), 0);
  writeFileSync(join(rootDirectory, "src/a.ts"), "// old\n// new\nconst a = 1;\n");
  assert.equal(main([], rootDirectory), 1);
  writeFileSync(join(rootDirectory, "src/a.ts"), "const a = 1;\n");
  assert.equal(main([], rootDirectory), 1);
  assert.equal(main(["--update"], rootDirectory), 0);
  assert.deepEqual(JSON.parse(readFileSync(join(rootDirectory, BASELINE), "utf8")), {});
  assert.equal(main([], rootDirectory), 0);
});
