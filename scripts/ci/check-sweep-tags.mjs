import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SWEEP_SPECS } from "./classify-paths.mjs";

// The report shape is Playwright's --list --reporter=json output; suites retain
// their file and nested suites, while specs carry their tags.
export function checkSweepTags(report, sweepSpecs = SWEEP_SPECS) {
  const files = new Map();
  function visit(suite, path) {
    for (const spec of suite.specs ?? []) {
      const entry = files.get(path) ?? { tagged: 0 };
      if ((spec.tags ?? []).some((tag) => tag === "sweep" || tag === "@sweep"))
        entry.tagged += 1;
      files.set(path, entry);
    }
    for (const child of suite.suites ?? []) visit(child, path);
  }
  for (const suite of report.suites ?? []) visit(suite, `tests/${suite.file}`);
  const tagged = [...files]
    .filter(([, entry]) => entry.tagged > 0)
    .map(([file]) => file);
  const errors = [];
  if (tagged.length === 0) errors.push("no test is tagged @sweep");
  for (const file of tagged)
    if (!sweepSpecs.has(file))
      errors.push(`${file} has @sweep tests but is not in SWEEP_SPECS`);
  for (const file of sweepSpecs) {
    if (!files.has(file))
      errors.push(`SWEEP_SPECS lists ${file}, which has no tests`);
    else if (files.get(file).tagged === 0)
      errors.push(
        `SWEEP_SPECS lists ${file}, but none of its tests is tagged @sweep`,
      );
  }
  return { ok: errors.length === 0, errors, tagged };
}

async function main() {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error(
      "usage: node scripts/ci/check-sweep-tags.mjs <playwright --list json>",
    );
    process.exit(2);
  }
  const result = checkSweepTags(JSON.parse(await readFile(path, "utf8")));
  for (const error of result.errors) console.error(error);
  if (!result.ok) process.exit(1);
  console.log(`@sweep specs: ${result.tagged.join(", ")}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
