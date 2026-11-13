#!/usr/bin/env node
// Reads the lessons ledger (.agents/lessons.md) and prints the entries whose
// Paths globs match a list of changed files, one path per line on stdin.
//
//   git diff --name-only origin/main...HEAD | node scripts/lessons/select.mjs
//   printf '%s\n' src/components/Button.astro | node scripts/lessons/select.mjs --brief
//   node scripts/lessons/select.mjs --check    # validate both ledger files
//   node scripts/lessons/select.mjs --check --base origin/main # catch an ID both sides added
//
// --brief prints one line per entry (for Codex handoffs); the default prints
// whole entries (for the pr-reviewer checklist). --archive also searches
// .agents/lessons-archive.md.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.env.LESSONS_ROOT ? resolve(process.env.LESSONS_ROOT) : fileURLToPath(new URL("../../", import.meta.url));
export const LIVE_PATH = join(root, ".agents/lessons.md");
export const ARCHIVE_PATH = join(root, ".agents/lessons-archive.md");
export const FIELDS = ["Date", "Trigger", "Symptom", "Root cause", "Rule", "Check", "Guard", "Paths"];

const HEADING = /^### (L-\d{3}) — (.+)$/;
const FIELD = /^- \*\*([^*]+):\*\* ?(.*)$/;

export function parseLedger(text) {
  const entries = [];
  let current = null;
  let lastField = null;
  for (const line of text.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      current = { id: heading[1], title: heading[2].trim(), fields: {}, lines: [line] };
      entries.push(current);
      lastField = null;
      continue;
    }
    if (!current) continue;
    if (/^#{1,3} /.test(line)) {
      current = null; // a non-entry heading ends the entry
      continue;
    }
    current.lines.push(line);
    const field = line.match(FIELD);
    if (field) {
      lastField = field[1].trim();
      current.fields[lastField] = field[2].trim();
    } else if (lastField && /^ {2,}\S/.test(line)) {
      current.fields[lastField] += ` ${line.trim()}`;
    } else if (line.trim() === "") {
      lastField = null;
    }
  }
  for (const entry of entries) {
    while (entry.lines.at(-1)?.trim() === "") entry.lines.pop();
    entry.paths = [...(entry.fields.Paths ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  }
  return entries;
}

export function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      // `**/` matches zero or more directories; a bare `**` matches anything.
      if (glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function matches(entry, files) {
  const patterns = entry.paths.map(globToRegExp);
  return files.some((file) => patterns.some((pattern) => pattern.test(file)));
}

export function selectLessons(entries, files) {
  const clean = files.map((f) => f.trim()).filter(Boolean);
  return entries.filter((entry) => matches(entry, clean));
}

export function formatBrief(entry) {
  return `- ${entry.id} — ${entry.title}. Rule: ${entry.fields.Rule} Check: ${entry.fields.Check}`;
}

export function validate(live, archive) {
  const errors = [];
  const seen = new Map();
  const check = (entry, file) => {
    const where = `${file} ${entry.id}`;
    if (seen.has(entry.id)) errors.push(`${where}: duplicate ID (also in ${seen.get(entry.id)})`);
    seen.set(entry.id, file);
    for (const name of FIELDS) {
      if (!entry.fields[name]) errors.push(`${where}: missing field "${name}"`);
    }
    for (const name of Object.keys(entry.fields)) {
      if (!FIELDS.includes(name)) errors.push(`${where}: unknown field "${name}"`);
    }
    if (entry.fields.Date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.fields.Date)) errors.push(`${where}: Date is not YYYY-MM-DD`);
    const guard = entry.fields.Guard ?? "";
    if (guard && !/^(none|hook|test|lint|taste)\b/.test(guard)) errors.push(`${where}: Guard must start with none, hook, test, lint or taste`);
    if (file === "lessons.md" && /^(hook|test|lint)\b/.test(guard)) errors.push(`${where}: hook/test/lint guarded entries belong in lessons-archive.md`);
    if (entry.fields.Paths && entry.paths.length === 0) errors.push(`${where}: Paths needs at least one \`glob\``);
  };
  for (const entry of live) check(entry, "lessons.md");
  for (const entry of archive) check(entry, "lessons-archive.md");
  return errors;
}

export function compareWithBase(baseEntries, entries, mergeBaseEntries) {
  const errors = [];
  const baseById = new Map(baseEntries.map((entry) => [entry.id, entry]));
  const mergeBaseById = mergeBaseEntries ? new Map(mergeBaseEntries.map((entry) => [entry.id, entry])) : undefined;
  const allEntries = [...baseEntries, ...entries, ...(mergeBaseEntries ?? [])];
  const highestId = allEntries.reduce((highest, entry) => Math.max(highest, Number(entry.id.slice(2))), 0);
  const nextId = `L-${String(highestId + 1).padStart(3, "0")}`;
  for (const entry of entries) {
    const base = baseById.get(entry.id);
    const mergeBase = mergeBaseById?.get(entry.id);
    if (mergeBaseById && base?.title && !mergeBase && base.title !== entry.title) {
      errors.push(`${entry.id}: title differs from base; use next free ID ${nextId}`);
    }
  }
  return errors;
}

function readBaseLedger(ref, relativePath, root) {
  const options = { cwd: root, encoding: "utf8" };
  const verify = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], options);
  if (verify.status !== 0) throw new Error(`Unable to read base ref "${ref}"`);
  const shown = spawnSync("git", ["show", `${ref}:${relativePath}`], options);
  if (shown.status === 0) return shown.stdout;
  const exists = spawnSync("git", ["cat-file", "-e", `${ref}:${relativePath}`], options);
  if (exists.status !== 0) return "";
  throw new Error(`Unable to read base ref "${ref}"`);
}

function main(argv) {
  if (argv.includes("--base") && !argv.includes("--check")) {
    process.stderr.write("--base must be used with --check\n");
    process.exitCode = 1;
    return;
  }
  const live = parseLedger(readFileSync(LIVE_PATH, "utf8"));
  const archive = parseLedger(readFileSync(ARCHIVE_PATH, "utf8"));
  if (argv.includes("--check")) {
    const baseIndex = argv.indexOf("--base");
    const baseRef = baseIndex >= 0 ? argv[baseIndex + 1] : undefined;
    if (baseIndex >= 0 && !baseRef) {
      process.stderr.write("--base requires a git ref\n");
      process.exitCode = 1;
      return;
    }
    let errors = validate(live, archive);
    if (baseRef) {
      try {
        const baseLive = parseLedger(readBaseLedger(baseRef, ".agents/lessons.md", root));
        const baseArchive = parseLedger(readBaseLedger(baseRef, ".agents/lessons-archive.md", root));
        const mergeBase = spawnSync("git", ["merge-base", "HEAD", baseRef], { cwd: root, encoding: "utf8" });
        if (mergeBase.status !== 0) throw new Error(`Unable to find merge-base with ref "${baseRef}"`);
        const mergeBaseRef = mergeBase.stdout.trim();
        const mergeBaseLive = parseLedger(readBaseLedger(mergeBaseRef, ".agents/lessons.md", root));
        const mergeBaseArchive = parseLedger(readBaseLedger(mergeBaseRef, ".agents/lessons-archive.md", root));
        errors = [...errors, ...compareWithBase([...baseLive, ...baseArchive], [...live, ...archive], [...mergeBaseLive, ...mergeBaseArchive])];
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
        return;
      }
    }
    for (const error of errors) process.stderr.write(`${error}\n`);
    if (errors.length) process.exit(1);
    process.stdout.write(`lessons ok: ${live.length} live, ${archive.length} archived\n`);
    return;
  }
  const files = readFileSync(0, "utf8").split("\n");
  const pool = argv.includes("--archive") ? [...live, ...archive] : live;
  const picked = selectLessons(pool, files);
  if (!picked.length) {
    process.stdout.write("No lessons match these paths.\n");
    return;
  }
  const brief = argv.includes("--brief");
  process.stdout.write(`${picked.map((entry) => (brief ? formatBrief(entry) : entry.lines.join("\n"))).join(brief ? "\n" : "\n\n")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
