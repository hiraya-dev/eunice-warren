import assert from "node:assert/strict";
import test from "node:test";
import { workersBuildRsvpStore } from "../src/utils/workers-build.ts";

test("keeps main builds unchanged", () => {
  assert.equal(
    workersBuildRsvpStore({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }),
    undefined,
  );
});

test("uses the fake store for non-main Workers Builds branches", () => {
  assert.equal(
    workersBuildRsvpStore({
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "feature/rsvp",
    }),
    "fake",
  );
});

test("keeps non-Workers Builds unchanged", () => {
  assert.equal(
    workersBuildRsvpStore({ WORKERS_CI_BRANCH: "feature/rsvp" }),
    undefined,
  );
});

test("keeps an explicitly configured public store", () => {
  assert.equal(
    workersBuildRsvpStore({
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "feature/rsvp",
      PUBLIC_RSVP_STORE: "sheets",
    }),
    "sheets",
  );
});
