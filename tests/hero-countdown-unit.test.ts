import assert from "node:assert/strict";
import test from "node:test";
import { countdownState, HERO_COUNTDOWN_AFTER_MS, HERO_COUNTDOWN_TODAY_START_MS } from "../src/scripts/hero-countdown.ts";

test("countdown state changes at Manila midnight boundaries", () => {
  assert.equal(countdownState(HERO_COUNTDOWN_TODAY_START_MS - 1).state, "counting");
  assert.deepEqual(countdownState(HERO_COUNTDOWN_TODAY_START_MS), { state: "today" });
  assert.equal(countdownState(HERO_COUNTDOWN_AFTER_MS - 1).state, "today");
  assert.deepEqual(countdownState(HERO_COUNTDOWN_AFTER_MS), { state: "after" });
});
