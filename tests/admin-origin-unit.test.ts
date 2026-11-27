import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginPost } from "../src/lib/admin/origin.ts";

const url = new URL("https://example.test/admin/songs");
test("same-origin POST requires a matching Origin header", () => {
  assert.equal(isSameOriginPost(new Request(url), url), false);
  assert.equal(isSameOriginPost(new Request(url, { headers: { Origin: "https://other.test" } }), url), false);
  assert.equal(isSameOriginPost(new Request(url, { headers: { Origin: url.origin } }), url), true);
});
