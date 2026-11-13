import { access, appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function flakyTestsFromSuite(suite, parents = [], isTopLevel = false) {
  // Only omit the title of report.suites entries; nested describes also carry file.
  const titles = suite.title && !isTopLevel ? [...parents, suite.title] : parents;
  const tests = (suite.specs ?? []).flatMap((spec) =>
    (spec.tests ?? [])
      .filter((test) => test.status === "flaky")
      .map((test) => ({
        file: spec.file ?? suite.file,
        title: [...titles, spec.title].filter(Boolean).join(" › "),
        project: test.projectName,
      })),
  );
  return [...tests, ...(suite.suites ?? []).flatMap((child) => flakyTestsFromSuite(child, titles))];
}

export function findFlakyTests(report) {
  return (report.suites ?? []).flatMap((suite) => flakyTestsFromSuite(suite, [], true));
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.log("No Playwright JSON report path provided; skipping flaky test summary.");
    return;
  }

  try {
    await access(reportPath);
  } catch {
    console.log(`Playwright JSON report not found at ${reportPath}; skipping flaky test summary.`);
    return;
  }

  let flaky;
  try {
    flaky = findFlakyTests(JSON.parse(await readFile(reportPath, "utf8")));
  } catch (error) {
    console.log(`Could not read Playwright JSON report: ${error.message}`);
    return;
  }

  for (const test of flaky) {
    console.log(`::warning title=Flaky test::${test.file} › ${test.title} [${test.project}]`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ["## Flaky tests", ""];
    if (flaky.length === 0) lines.push("No flaky tests.");
    else lines.push(...flaky.map(({ file, title, project }) => `- ${file} › ${title} [${project}]`));
    try {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
    } catch (error) {
      console.log(`Could not append flaky test summary: ${error.message}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
