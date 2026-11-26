import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BASELINE = "scripts/ci/comment-baseline.json";
const SOURCE = /\.(ts|mts|mjs|js|astro|css|jsonc|yml|yaml)$/;
const EXCLUDED = [/^migrations\//];

const DIRECTIVE = /^(\/\/\/?|\/\*\*?|#)\s*(@ts-|@type\s|eslint-|prettier-ignore|biome-ignore|<reference\s|shellcheck\s|yaml-language-server:)/;
const PROP = /^\s*(readonly\s+)?["']?[\w-]+["']?\??\s*:/;

function scanScript(source, from, to, comments, { css = false } = {}) {
  let i = from;
  while (i < to) {
    const c = source[i];
    const d = source[i + 1];
    if (!css && c === "/" && d === "/") {
      const end = lineEnd(source, i, to);
      comments.push([i, end]);
      i = end;
    } else if (c === "/" && d === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close < 0 || close + 2 > to ? to : close + 2;
      comments.push([i, end]);
      i = end;
    } else if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i, to);
    } else if (!css && c === "/" && startsRegex(source, i)) {
      i = skipRegex(source, i, to);
    } else {
      i++;
    }
  }
}

function lineEnd(source, i, to) {
  const end = source.indexOf("\n", i);
  return end < 0 || end > to ? to : end;
}

function skipString(source, start, to) {
  const quote = source[start];
  let i = start + 1;
  while (i < to && source[i] !== quote) {
    if (source[i] === "\\") i++;
    else if (quote !== "`" && source[i] === "\n") return i;
    else if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
      i = skipExpression(source, i + 2, to);
      continue;
    }
    i++;
  }
  return i + 1;
}

function skipExpression(source, start, to) {
  let depth = 1;
  let i = start;
  while (i < to && depth > 0) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i, to);
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") depth--;
    i++;
  }
  return i;
}

function startsRegex(source, i) {
  let j = i - 1;
  while (j >= 0 && (source[j] === " " || source[j] === "\t")) j--;
  if (j < 0 || source[j] === "\n") return true;
  if ("=(,:;!&|?{}[+-*%<>~^".includes(source[j])) return true;
  return /\b(return|typeof|case|in|of|void|delete|throw|new)$/.test(source.slice(Math.max(0, j - 7), j + 1));
}

function skipRegex(source, start, to) {
  let i = start + 1;
  let inClass = false;
  while (i < to && source[i] !== "\n") {
    if (source[i] === "\\") i += 2;
    else {
      if (source[i] === "[") inClass = true;
      else if (source[i] === "]") inClass = false;
      else if (source[i] === "/" && !inClass) return i + 1;
      i++;
    }
  }
  return start + 1;
}

function scanYaml(source, comments) {
  let i = 0;
  while (i < source.length) {
    if (source[i] === "#" && (i === 0 || /\s/.test(source[i - 1]))) {
      const end = lineEnd(source, i, source.length);
      comments.push([i, end]);
      i = end;
    } else i++;
  }
}

function scanAstro(source, comments) {
  let i = 0;
  const frontmatter = /^---\r?\n/.exec(source);
  if (frontmatter) {
    const close = source.indexOf("\n---", frontmatter[0].length);
    const end = close < 0 ? source.length : close;
    scanScript(source, frontmatter[0].length, end, comments);
    i = close < 0 ? source.length : close + 4;
  }
  while (i < source.length) {
    if (source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      const end = close < 0 ? source.length : close + 3;
      comments.push([i, end]);
      i = end;
      continue;
    }
    const block = /^<(script|style)\b[^>]*>/.exec(source.slice(i, i + 200));
    if (block) {
      const tag = block[1];
      const start = i + block[0].length;
      const close = source.indexOf(`</${tag}>`, start);
      const end = close < 0 ? source.length : close;
      scanScript(source, start, end, comments, { css: tag === "style" });
      i = end;
      continue;
    }
    if (source[i] === "{") {
      const end = skipExpression(source, i + 1, source.length);
      scanScript(source, i + 1, end - 1, comments);
      i = end;
      continue;
    }
    i++;
  }
}

export function scanComments(source, file) {
  const spans = [];
  if (/\.astro$/.test(file)) scanAstro(source, spans);
  else if (/\.ya?ml$/.test(file)) scanYaml(source, spans);
  else scanScript(source, 0, source.length, spans, { css: /\.css$/.test(file) });
  const types = typeBlocks(source);
  return spans.map(([start, end]) => ({
    line: source.slice(0, start).split("\n").length,
    text: source.slice(start, end),
    next: source.slice(end).replace(/^[ \t]*\n/, "").split("\n")[0],
    inType: types.some(([from, to]) => start > from && end < to),
  }));
}

function typeBlocks(source) {
  const blocks = [];
  for (const match of source.matchAll(/\b(interface\s+\w+[^{=;]*\{|type\s+\w+(?:<[^=]*>)?\s*=)/g)) {
    const from = match.index + match[0].length;
    if (match[1].startsWith("interface")) {
      blocks.push([from - 1, skipExpression(source, from, source.length)]);
      continue;
    }
    let depth = 0;
    let i = from;
    while (i < source.length && !(depth === 0 && (source[i] === ";" || source.startsWith("\n\n", i)))) {
      if ("([{".includes(source[i])) depth++;
      if (")]}".includes(source[i])) depth--;
      i++;
    }
    blocks.push([from, i]);
  }
  return blocks;
}

export function isAllowed(comment, file) {
  if (DIRECTIVE.test(comment.text)) return true;
  return /^src\/components\/.*\.astro$/.test(file) && comment.inType && comment.text.startsWith("/**") && PROP.test(comment.next ?? "");
}

export function countedComments(source, file) {
  return scanComments(source, file).filter((comment) => !isAllowed(comment, file));
}

export function trackedFiles(rootDirectory = root) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: rootDirectory, encoding: "utf8" })
    .split("\n")
    .filter((file) => SOURCE.test(file) && !EXCLUDED.some((pattern) => pattern.test(file)));
}

export function countComments({ rootDirectory = root, files = trackedFiles(rootDirectory) } = {}) {
  const counts = {};
  for (const file of files) {
    const full = path.join(rootDirectory, file);
    if (!fs.existsSync(full)) continue;
    const count = countedComments(fs.readFileSync(full, "utf8"), file).length;
    if (count > 0) counts[file] = count;
  }
  return counts;
}

export function compare(counts, baseline) {
  const over = [];
  const under = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) over.push({ file, count, allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = counts[file] ?? 0;
    if (count < allowed) under.push({ file, count, allowed });
  }
  return { over, under };
}

export function lowered(counts, baseline) {
  const next = {};
  for (const [file, allowed] of Object.entries(baseline)) {
    const count = Math.min(counts[file] ?? 0, allowed);
    if (count > 0) next[file] = count;
  }
  return next;
}

function readBaseline(rootDirectory) {
  const file = path.join(rootDirectory, BASELINE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

function writeBaseline(rootDirectory, baseline) {
  const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(path.join(rootDirectory, BASELINE), `${JSON.stringify(sorted, null, 2)}\n`);
}

function total(record) {
  return Object.values(record).reduce((sum, count) => sum + count, 0);
}

function list(rootDirectory, prefixes) {
  for (const file of trackedFiles(rootDirectory).filter((file) => prefixes.some((prefix) => file.startsWith(prefix)))) {
    for (const comment of countedComments(fs.readFileSync(path.join(rootDirectory, file), "utf8"), file)) {
      console.log(`${file}:${comment.line}: ${comment.text.replace(/\s*\n\s*/g, " ⏎ ")}`);
    }
  }
}

export function main(argv, rootDirectory = root) {
  const [mode, ...rest] = argv;
  if (mode === "--list") {
    list(rootDirectory, rest.length ? rest : [""]);
    return 0;
  }
  const counts = countComments({ rootDirectory });
  const baseline = readBaseline(rootDirectory);
  if (mode === "--init") {
    writeBaseline(rootDirectory, counts);
    console.log(`check-comments: baseline written, ${total(counts)} comments in ${Object.keys(counts).length} files`);
    return 0;
  }
  if (mode === "--update") {
    const next = lowered(counts, baseline);
    writeBaseline(rootDirectory, next);
    console.log(`check-comments: baseline lowered from ${total(baseline)} to ${total(next)}`);
    return compare(counts, next).over.length ? 1 : 0;
  }
  const { over, under } = compare(counts, baseline);
  for (const { file, count, allowed } of over) {
    console.error(`${file}: ${count} comments, baseline allows ${allowed}. Delete the new comment, or move a decision into docs/decisions/.`);
  }
  for (const { file, count, allowed } of under) {
    console.error(`${file}: ${count} comments, baseline still says ${allowed}. Run npm run check:comments -- --update.`);
  }
  if (over.length || under.length) return 1;
  console.log(`check-comments: ${total(counts)} comments left, none above the baseline`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
