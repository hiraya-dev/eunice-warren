import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
async function main() {
  const directory = await mkdtemp(join(tmpdir(), "ew-playwright-list-"));
  const report = join(directory, "playwright-list.json");
  try {
    const output = createWriteStream(report);
    const written = new Promise((resolve, reject) => {
      output.once("error", reject);
      output.once("close", resolve);
    });
    const playwright = spawn(
      npx,
      ["playwright", "test", "--list", "--reporter=json"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    playwright.stdout.pipe(output);
    const code = await new Promise((resolve, reject) => {
      playwright.once("error", reject);
      playwright.once("close", (status, signal) =>
        resolve(status ?? (signal ? 1 : 0)),
      );
    });
    await written;
    process.exitCode =
      code === 0
        ? await run(process.execPath, [
            "scripts/ci/check-sweep-tags.mjs",
            report,
          ])
        : code;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
await main();
