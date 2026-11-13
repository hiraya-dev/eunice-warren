import { spawn } from "node:child_process";

// `npm run prepush`: the one local gate before every push (local-checks skill).
// It binds no port and opens no browser.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = ["check:lessons", "test:ci-scripts", "test:hooks", "test:unit", "lint:md", "check"];

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(npm, ["run", step], { stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

for (const step of steps) {
  console.log(`\nprepush: ${step}`);
  let code;
  try {
    code = await runStep(step);
  } catch (error) {
    console.error(`prepush failed at ${step}: ${error.message}`);
    process.exit(1);
  }
  if (code !== 0) {
    console.error(`prepush failed at ${step}`);
    process.exit(code);
  }
}

console.log("\nprepush: all checks passed");
