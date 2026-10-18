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
import {
  buildResponseRow,
  createSheetsRsvpStore,
  parsePreviousResponseRow,
} from "../src/lib/rsvp/sheets.ts";
import {
  RSVP_EVENT,
  calendarIcs,
  seatWord,
  ticketNames,
  ticketReference,
} from "../src/lib/rsvp/event.ts";

test("builds ticket data and an RFC 5545 calendar event", () => {
  assert.equal(seatWord(2), "Two");
  assert.equal(seatWord(12), "Twelve");
  assert.equal(
    ticketNames(["Liza Santos", "Marco Santos"]),
    "Liza & Marco",
  );
  assert.equal(ticketReference("santos"), "SANTOS");
  const ics = calendarIcs();
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20270114T070000Z\r\n/);
  assert.match(ics, new RegExp(`LOCATION:${RSVP_EVENT.location}`));
});

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

test("validates seat checklist rules", () => {
  const invite = { id: "x", householdName: "X", members: ["A", "B"], seats: 2 };
  const seats = (a = true, b = false) => [
    { original: "A", name: "A", attending: a },
    { original: "B", name: "B", attending: b },
  ];
  assert.equal(
    validateSubmission({ attending: true, seats: seats(), invite }),
    true,
  );
  assert.equal(
    validateSubmission({ attending: true, seats: [{ original: "A", name: "A", attending: true }], invite }),
    false,
  );
  assert.equal(
    validateSubmission({ attending: true, seats: [{ original: "A", name: "A", attending: true }, { original: "B", name: "", attending: true }], invite }),
    false,
  );
  assert.equal(
    validateSubmission({ attending: true, seats: seats(false, false), invite }),
    false,
  );
  assert.equal(
    validateSubmission({ attending: false, seats: seats(false, false), invite }),
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

test("builds attendee, companion, and seat-change columns", () => {
  const row = buildResponseRow({
    inviteId: "cruz",
    name: "Mateo Cruz",
    attending: true,
    guests: 3,
    email: "mateo@example.com",
    seats: [
      { original: "Mateo Cruz", name: "Mateo Cruz", attending: true },
      { original: "Sofía Cruz", name: "Sofia Cruz", attending: true },
      { original: "Remedios Cruz", name: "Remedios Cruz", attending: false },
      { original: null, name: "Jun Dela Cruz", attending: true },
    ],
  });
  assert.equal(row[6], "Sofia Cruz; Jun Dela Cruz");
  assert.equal(row[8], "Mateo Cruz; Sofia Cruz; Jun Dela Cruz");
  assert.equal(row[9], "(plus-one) → Jun Dela Cruz");
});

test("parses current and legacy previous response rows", () => {
  const invite = { id: "cruz", householdName: "Cruz", members: ["Mateo Cruz", "Sofía Cruz", "Remedios Cruz"], seats: 4 };
  const current = parsePreviousResponseRow([
    "2026-01-02T00:00:00.000Z", "cruz", "Mateo Cruz", "yes", "2", "a@example.com", "Sofia Cruz", "note", "Mateo Cruz; Sofia Cruz", "",
  ], invite);
  assert.equal(current?.previous.seats[1].name, "Sofia Cruz");
  assert.equal(current?.previous.seats[1].attending, true);
  assert.deepEqual(Object.keys(current?.previous ?? {}).sort(), ["attending", "seats"]);
  const legacy = parsePreviousResponseRow([
    "2026-01-01T00:00:00.000Z", "cruz", "Mateo Cruz", "yes", "1", "a@example.com", "", "",
  ], invite);
  assert.equal(legacy?.previous.seats.filter((seat) => seat.attending).length, 1);
  assert.doesNotThrow(() => parsePreviousResponseRow(["bad", "cruz", "Mateo Cruz", "no", "0"], invite));
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
      seats: [{ original: "Liza Santos", name: "Liza Santos", attending: true }],
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
