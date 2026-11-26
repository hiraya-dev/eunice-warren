import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const minimumLength = 12;

function walk(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file, extension) : path.extname(file) === extension ? [file] : [];
  });
}

function collectJsonStrings(value, strings = new Set()) {
  if (typeof value === "string" && value.length >= minimumLength) strings.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectJsonStrings(item, strings));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectJsonStrings(item, strings));
  return strings;
}

function collectComponentText(source, strings = new Set()) {
  // Deliberately simple: only static text between tags, excluding Astro expressions.
  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (text.length >= minimumLength && /\S/.test(text)) strings.add(text);
  }
  return strings;
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function literalIndexes(source, value) {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const forms = [`"${escaped}"`, `\`${value}\``, `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`];
  return forms.flatMap((form) => {
    const indexes = [];
    let from = 0;
    while (true) {
      const index = code.indexOf(form, from);
      if (index < 0) return indexes;
      indexes.push(index);
      from = index + form.length;
    }
  });
}

export function findViolations({ rootDirectory = root } = {}) {
  const strings = new Set();
  for (const file of walk(path.join(rootDirectory, "src/content"), ".json")) {
    collectJsonStrings(JSON.parse(fs.readFileSync(file, "utf8")), strings);
  }
  for (const file of walk(path.join(rootDirectory, "src/components"), ".astro")) {
    collectComponentText(fs.readFileSync(file, "utf8"), strings);
  }

  const allowlist = new Set(JSON.parse(fs.readFileSync(path.join(rootDirectory, "scripts/ci/spec-copy-allowlist.json"), "utf8")).map((entry) => entry.value));
  const violations = [];
  for (const file of walk(path.join(rootDirectory, "tests"), ".ts").filter((file) => file.endsWith(".spec.ts"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const value of strings) {
      if (allowlist.has(value)) continue;
      for (const index of literalIndexes(source, value)) {
        violations.push({ file: path.relative(rootDirectory, file), line: lineNumber(source, index), value });
      }
    }
  }
  return violations;
}

const violations = findViolations();
if (violations.length) {
  for (const violation of violations) console.error(`${violation.file}:${violation.line}: ${violation.value}`);
  process.exitCode = 1;
} else {
  console.log("check-spec-copy: no couple copy literals found in specs");
}
