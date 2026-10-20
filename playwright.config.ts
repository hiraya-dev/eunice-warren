import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// A port is machine-wide, but this repository is checked out in several worktrees
// at once. Deriving the port from this checkout's path keeps it stable here and
// distinct per worktree. Override with PW_PORT when it has to be pinned by hand.
const HOST = "127.0.0.1";
const PORT = Number(process.env.PW_PORT) || derivePort(process.cwd());
const ORIGIN = `http://${HOST}:${PORT}`;

function derivePort(dir: string) {
  const digest = createHash("sha1").update(dir).digest();
  return 41000 + (digest.readUInt16BE(0) % 2000);
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: ORIGIN,
    storageState: {
      cookies: [],
      origins: [{
        origin: ORIGIN,
        localStorage: [{ name: "ew-guest-v1", value: JSON.stringify({ skipped: true, at: "2026-01-01T00:00:00.000Z" }) }],
      }],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  webServer: {
    // Test the production build, not the dev server. reuseExistingServer: false
    // makes Playwright refuse a port something else already answers on.
    // Astro 7 backgrounds `astro preview` when CLAUDECODE is set, which would
    // end the webServer process at once; unset it so the server stays attached.
    command: `CLOUDFLARE_ENV=test PUBLIC_RSVP_STORE=fake npm run build && env -u CLAUDECODE CLOUDFLARE_ENV=test npm run preview -- --host ${HOST} --port ${PORT}`,
    env: {
      ...process.env,
      RSVP_STORE: "fake",
      PUBLIC_RSVP_STORE: "fake",
      PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
