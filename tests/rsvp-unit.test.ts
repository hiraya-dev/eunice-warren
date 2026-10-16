import test from "node:test";
import assert from "node:assert/strict";
import {
  isWithinRateLimit,
  parseGuestRows,
  RSVP_DEADLINE_TIME,
  signRsvpToken,
  validateSubmission,
  verifyRsvpToken,
} from "../src/lib/rsvp/logic.ts";
import { normalizeGuestName } from "../src/lib/rsvp/store.ts";
import { createSheetsRsvpStore } from "../src/lib/rsvp/sheets.ts";

test("normalizes accents, case, and spacing", () => {
  assert.equal(normalizeGuestName("  Sofía   CRUZ "), "sofia cruz");
});

test("signs, verifies, expires, and rejects tampered tokens", async () => {
  const token = await signRsvpToken("santos", 2_000, "secret");
  assert.deepEqual(await verifyRsvpToken(token, "secret", 1_999), {
    inviteId: "santos",
    expiresAt: 2_000,
  });
  assert.equal(await verifyRsvpToken(token, "secret", 2_000), null);
  assert.equal(
    await verifyRsvpToken(token.slice(0, -1) + "x", "secret", 1_999),
    null,
  );
});

test("validates seat and companion rules", () => {
  assert.equal(
    validateSubmission({ attending: true, guests: 1, seats: 2 }),
    true,
  );
  assert.equal(
    validateSubmission({ attending: true, guests: 3, seats: 2 }),
    false,
  );
  assert.equal(
    validateSubmission({
      attending: true,
      guests: 1,
      seats: 2,
      companionName: "Guest",
    }),
    false,
  );
  assert.equal(
    validateSubmission({
      attending: true,
      guests: 2,
      seats: 2,
      companionName: "Guest",
    }),
    true,
  );
  assert.equal(
    validateSubmission({ attending: false, guests: 0, seats: 2 }),
    true,
  );
});

test("keeps the deadline boundary exact", () => {
  assert.equal(
    new Date("2026-12-31T23:59:59+08:00").getTime(),
    RSVP_DEADLINE_TIME,
  );
  assert.equal(
    RSVP_DEADLINE_TIME + 1000,
    new Date("2027-01-01T00:00:00+08:00").getTime(),
  );
});

test("parses guest rows and detects duplicate ids and names", () => {
  const result = parseGuestRows([
    ["santos", "The Santos Family", "Liza Santos", ""],
    ["", "Ignored", "Nobody", "4"],
    ["santos", "Duplicate", "Ana Reyes", "1"],
    ["reyes", "Another", "liza santos", "1"],
  ]);
  assert.equal(result.invites[0].seats, 2);
  assert.deepEqual(result.duplicateIds, ["santos"]);
  assert.deepEqual(result.duplicateNames, ["liza santos"]);
});

test("appends response rows as RAW values", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    if (String(input).includes("oauth2.googleapis.com")) {
      return new Response(
        JSON.stringify({ access_token: "token", expires_in: 3600 }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    );
    let binary = "";
    for (const byte of pkcs8) binary += String.fromCharCode(byte);
    const pem =
      "-----BEGIN PRIVATE KEY-----\n" +
      btoa(binary) +
      "\n-----END PRIVATE KEY-----";
    await createSheetsRsvpStore({
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "test@example.com",
        private_key: pem,
      }),
      GOOGLE_SHEET_ID: "sheet",
    }).submit({
      inviteId: "santos",
      name: "Liza Santos",
      attending: true,
      guests: 1,
      email: "liza@example.com",
      note: "=not-a-formula",
    });
    const append = requests.find((request) =>
      request.url.includes("values/Responses"),
    );
    assert.match(append?.url ?? "", /valueInputOption=RAW/);
    assert.equal(
      ((await append?.json()) as { values: string[][] }).values[0][7],
      "=not-a-formula",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("calls the rate limiter with an options object, as Cloudflare requires", async () => {
  const calls: unknown[] = [];
  // Mirrors the Workers binding, which throws when given a bare string.
  const limiter = {
    async limit(options: { key: string }) {
      if (typeof options !== "object" || typeof options?.key !== "string")
        throw new TypeError(
          "Failed to execute 'limit' on 'Ratelimit': parameter 1 is not of type 'RatelimitOptions'.",
        );
      calls.push(options);
      return { success: calls.length <= 1 };
    },
  };
  assert.equal(await isWithinRateLimit(limiter, "203.0.113.7"), true);
  assert.equal(await isWithinRateLimit(limiter, "203.0.113.7"), false);
  assert.deepEqual(calls[0], { key: "203.0.113.7" });
  assert.equal(await isWithinRateLimit(undefined, "203.0.113.7"), true);
});
