import test from "node:test";
import assert from "node:assert/strict";
import {
  isWithinRateLimit,
  isRsvpActionClosed,
  findNearGuestName,
  parseGuestRows,
  RSVP_DEADLINE_TIME,
  signRsvpToken,
  validateSubmission,
  validateSubmissionProblems,
  verifyRsvpToken,
} from "../src/lib/rsvp/logic.ts";
import { normalizeGuestName } from "../src/lib/rsvp/store.ts";
import { createFakeRsvpStore, fakeFixtures } from "../src/lib/rsvp/store.ts";
import { SLIPPER_SIZES } from "../src/lib/rsvp/slippers.ts";
import { rsvpSubmitInput } from "../src/lib/rsvp/input.ts";
import { MAX_SEATS } from "../src/lib/rsvp/limits.ts";
import { runGreetAction } from "../src/lib/guest-actions.ts";
import {
  buildResponseRow,
  createSheetsRsvpStore,
  parsePreviousResponseRow,
} from "../src/lib/rsvp/legacy-sheets/sheets.ts";
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

test("finds only safe, unambiguous near guest names", async () => {
  assert.equal(findNearGuestName("Mateo Cruz", fakeFixtures), "Mateo Cruz");
  assert.equal(findNearGuestName("Meteo Cruz", fakeFixtures), "Mateo Cruz");
  assert.equal(findNearGuestName("Matoe Cruz", fakeFixtures), "Mateo Cruz");
  assert.equal(findNearGuestName("Mteo Cruz", fakeFixtures), "Mateo Cruz");
  assert.equal(findNearGuestName("Mato Cruz", fakeFixtures), "Mateo Cruz");
  assert.equal(findNearGuestName("Bae Garcia", fakeFixtures), null);
  assert.equal(findNearGuestName("Remedio Cruz", fakeFixtures), "Remedios Cruz");
  assert.equal(findNearGuestName("Paulo Garcia", fakeFixtures), "Paolo Garcia");
  assert.equal(
    findNearGuestName("Maria Santos", [
      { id: "middle", householdName: "Middle", ticketCode: "MIDDLE", members: ["Maria Clara Santos"], seats: 1 },
    ]),
    "Maria Clara Santos",
  );
  assert.equal(
    findNearGuestName("Maria Jane Santos", [
      { id: "middle", householdName: "Middle", ticketCode: "MIDDLE", members: ["Maria Clara Santos"], seats: 1 },
    ]),
    null,
  );
  assert.equal(
    findNearGuestName("Maria Clara Santos", [
      { id: "middle", householdName: "Middle", ticketCode: "MIDDLE", members: ["Maria Clara Santos"], seats: 1 },
    ]),
    "Maria Clara Santos",
  );
  assert.equal(findNearGuestName("Mateo Wrong", fakeFixtures), null);
  assert.equal(findNearGuestName("Cruz", fakeFixtures), null);
  assert.equal(findNearGuestName("Mateo", fakeFixtures), null);
  assert.equal(findNearGuestName("M Cruz", fakeFixtures), null);
  assert.equal(findNearGuestName("Cruz Mateo", fakeFixtures), null);
  assert.equal(
    findNearGuestName("Mateo Cruz", [
      ...fakeFixtures,
      { id: "other", householdName: "Other", ticketCode: "OTHER", members: ["Meteo Cruz"], seats: 1 },
    ]),
    null,
  );
  assert.equal(
    findNearGuestName("Liza Santos", fakeFixtures, [], ["liza santos"]),
    null,
  );
  assert.equal(
    findNearGuestName("Mateo Cruz", fakeFixtures, ["cruz"]),
    null,
  );
  assert.deepEqual(await createFakeRsvpStore().findInvite("Matoe Cruz"), {
    invite: null,
    suggestion: "Mateo Cruz",
  });
  const duplicateFixtures = [
    { id: "santos-one", label: "One_Test", householdName: "One", ticketCode: "ONE111", members: ["Maria Santos"], seats: 1, seatList: [{ seatId: 1, kind: "member" as const, invitedName: "Maria Santos", name: "Maria Santos" }] },
    { id: "santos-two", label: "Two_Test", householdName: "Two", ticketCode: "TWO222", members: ["Maria Santos"], seats: 1, seatList: [{ seatId: 2, kind: "member" as const, invitedName: "Maria Santos", name: "Maria Santos" }] },
  ];
  assert.equal(await createFakeRsvpStore(duplicateFixtures).findInvite("Maira Santos"), null);
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
  const invite = { id: "x", householdName: "X", ticketCode: "XXXXXX", members: ["A", "B"], seats: 2 };
  const seats = (a = true, b = false) => [
    { original: "A", name: "A", attending: a, slipperSize: a ? "W 7.5" : undefined },
    { original: "B", name: "B", attending: b, slipperSize: b ? "M 10" : undefined },
  ];
  assert.equal(SLIPPER_SIZES[0], "W 5");
  assert.equal(SLIPPER_SIZES.at(-1), "M 13");
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
    validateSubmission({ attending: true, seats: [{ ...seats()[0], slipperSize: "XL" }, seats()[1]], invite }),
    false,
  );
  assert.equal(
    validateSubmission({ attending: true, seats: [{ ...seats()[0], slipperSize: undefined }, seats()[1]], invite }),
    false,
  );
  assert.equal(
    validateSubmission({ attending: true, seats: [seats()[0], { ...seats()[1], slipperSize: "W 7" }], invite }),
    false,
  );
  assert.equal(
    validateSubmission({ attending: false, seats: seats(false, false), invite }),
    true,
  );
  assert.equal(
    validateSubmission({ attending: false, seats: [{ ...seats(false, false)[0], slipperSize: "W 7" }, seats(false, false)[1]], invite }),
    false,
  );
});

const hostValidationInvite = {
  householdName: "Fictional Family",
  ticketCode: "HOST01",
  members: ["Ada Fiction", "Bea Fiction"],
  seats: 2,
  seatList: [
    { seatId: 1, kind: "member" as const, invitedName: "Ada Fiction", name: "Ada Fiction" },
    { seatId: 2, kind: "member" as const, invitedName: "Bea Fiction", name: "Bea Fiction" },
  ],
};
const hostValidationBase = [
  { seatId: 1, shownName: "Ada Fiction", name: "Ada Fiction", attending: true, slipperSize: "W 7" },
  { seatId: 2, shownName: "Bea Fiction", name: "Bea Fiction", attending: false, slipperSize: undefined },
];
const hostProblems = (input: Parameters<typeof validateSubmissionProblems>[0]) =>
  validateSubmissionProblems(input).map((problem) => problem.message);

test("submission problems refuse a missing answer", () => {
  assert.deepEqual(hostProblems({ attending: null, seats: hostValidationBase, invite: hostValidationInvite }), ["Choose Yes or No."]);
});
test("submission problems refuse Yes with no attending seats", () => {
  assert(hostProblems({ attending: true, seats: hostValidationBase.map((seat) => ({ ...seat, attending: false })), invite: hostValidationInvite }).includes("Tick at least one guest, or choose No."));
});
test("submission problems refuse a ticked seat without a slipper size", () => {
  assert(hostProblems({ attending: true, seats: hostValidationBase.map((seat) => ({ ...seat, slipperSize: seat.attending ? undefined : undefined })), invite: hostValidationInvite }).includes("Pick a slipper size for Ada."));
});
test("submission problems refuse a ticked seat without a name", () => {
  assert(hostProblems({ attending: true, seats: hostValidationBase.map((seat) => ({ ...seat, name: seat.seatId === 1 ? "" : seat.name, slipperSize: undefined })), invite: hostValidationInvite, requireMemberNames: true }).includes("Add a name to tick this seat."));
});
test("submission problems refuse a blank member name", () => {
  assert(hostProblems({ attending: false, seats: hostValidationBase.map((seat) => ({ ...seat, name: "", attending: false })), invite: hostValidationInvite, requireMemberNames: true }).includes("Add a name, or untick the seat."));
});
test("submission problems refuse duplicate attending names", () => {
  assert(hostProblems({ attending: true, seats: hostValidationBase.map((seat) => ({ ...seat, attending: true, name: "Same Fiction", slipperSize: "W 7" })), invite: hostValidationInvite }).includes("Same Fiction is on two seats. Change one of them."));
});
test("submission problems refuse an overlong name", () => {
  assert(hostProblems({ attending: true, seats: [{ ...hostValidationBase[0], name: "x".repeat(121), slipperSize: "W 7" }, hostValidationBase[1]], invite: hostValidationInvite }).includes("Keep names under 120 characters."));
});
test("submission problems refuse an overlong note", () => {
  assert(hostProblems({ attending: true, seats: hostValidationBase, invite: hostValidationInvite, note: "x".repeat(1001) }).includes("Keep the note under 1,000 characters."));
});
test("submission problems refuse an invalid slipper size", () => {
  assert(hostProblems({ attending: true, seats: [{ ...hostValidationBase[0], slipperSize: "XL" }, hostValidationBase[1]], invite: hostValidationInvite }).includes("Pick a slipper size for Ada."));
});

test("rejects invalid seat counts, duplicate seat ids, and unknown seat ids directly", () => {
  const member = (seatId: number) => ({ seatId, kind: "member" as const, invitedName: `Guest ${seatId}`, name: `Guest ${seatId}` });
  const submitted = (seatId: number) => ({ seatId, name: `Guest ${seatId}`, attending: false });
  assert.equal(validateSubmission({ attending: false, invite: { householdName: "Empty", ticketCode: "EMPTY1", members: [], seats: 0, seatList: [] }, seats: [] }), false);
  assert.equal(validateSubmission({ attending: false, invite: { householdName: "Large", ticketCode: "LARGE1", members: Array.from({ length: MAX_SEATS + 1 }, (_, index) => `Guest ${index + 1}`), seats: MAX_SEATS + 1, seatList: Array.from({ length: MAX_SEATS + 1 }, (_, index) => member(index + 1)) }, seats: Array.from({ length: MAX_SEATS + 1 }, (_, index) => submitted(index + 1)) }), false);
  const invite = { householdName: "Pair", ticketCode: "PAIR11", members: ["Guest 1", "Guest 2"], seats: 2, seatList: [member(1), member(2)] };
  assert.equal(validateSubmission({ attending: false, invite, seats: [submitted(1), submitted(1)] }), false);
  assert.equal(validateSubmission({ attending: false, invite, seats: [submitted(1), submitted(999)] }), false);
});

test("RSVP submit input rejects seat arrays outside one through MAX_SEATS", () => {
  const payload = {
    token: "token",
    name: "Fictional Guest",
    attending: false,
    email: "fictional@example.com",
    turnstileToken: "",
  };
  assert.equal(rsvpSubmitInput.safeParse({ ...payload, seats: [] }).success, false);
  assert.equal(rsvpSubmitInput.safeParse({ ...payload, seats: Array.from({ length: MAX_SEATS + 1 }, (_, index) => ({ seatId: index + 1, name: "", attending: false })) }).success, false);
});

test("keeps the deadline boundary exact", () => {
  assert.equal(
    new Date("2026-12-14T23:59:59+08:00").getTime(),
    RSVP_DEADLINE_TIME,
  );
  assert.equal(
    RSVP_DEADLINE_TIME + 1000,
    new Date("2026-12-15T00:00:00+08:00").getTime(),
  );
});

test("keeps guest greeting available after the RSVP deadline", async () => {
  const afterDeadline = RSVP_DEADLINE_TIME + 1000;
  assert.equal(isRsvpActionClosed("greet", afterDeadline), false);
  assert.equal(isRsvpActionClosed("find", afterDeadline), true);
  assert.equal(isRsvpActionClosed("submit", afterDeadline), true);
  assert.deepEqual(await runGreetAction(createFakeRsvpStore(), "Liza Santos"), {
    invite: { householdName: "Santos Family", seats: 2 },
    matchedName: "Liza Santos",
  });
});

test("parses guest rows and detects duplicate ids and names", () => {
  const result = parseGuestRows([
    ["santos", "Santos Family", "Liza Santos", ""],
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
      { original: "Mateo Cruz", name: "Mateo Cruz", attending: true, slipperSize: "M 9" },
      { original: "Sofía Cruz", name: "Sofia Cruz", attending: true, slipperSize: "W 7" },
      { original: "Remedios Cruz", name: "Remedios Cruz", attending: false },
      { original: null, name: "Jun Dela Cruz", attending: true, slipperSize: "M 9" },
    ],
  });
  assert.equal(row[6], "Sofia Cruz; Jun Dela Cruz");
  assert.equal(row[8], "Mateo Cruz; Sofia Cruz; Jun Dela Cruz");
  assert.equal(row[9], "(plus-one) → Jun Dela Cruz");
  assert.equal(row[10], "Mateo Cruz: M 9; Sofia Cruz: W 7; Jun Dela Cruz: M 9");
  assert.equal(buildResponseRow({
    inviteId: "cruz", name: "Mateo Cruz", attending: false, guests: 0,
    email: "mateo@example.com", seats: [
      { original: "Mateo Cruz", name: "Mateo Cruz", attending: false },
      { original: "Sofía Cruz", name: "Sofía Cruz", attending: false },
    ],
  })[10], "");
});

test("parses current and legacy previous response rows", () => {
  const invite = { id: "cruz", householdName: "Cruz", ticketCode: "CRUZAA", members: ["Mateo Cruz", "Sofía Cruz", "Remedios Cruz"], seats: 4 };
  const current = parsePreviousResponseRow([
    "2026-01-02T00:00:00.000Z", "cruz", "Mateo Cruz", "yes", "2", "a@example.com", "Sofia Cruz", "note", "Mateo Cruz; Sofia Cruz", "", "Mateo Cruz: M 9; Sofia Cruz: W 7",
  ], invite);
  assert.equal(current?.previous.seats[1].name, "Sofia Cruz");
  assert.equal(current?.previous.seats[1].attending, true);
  assert.equal(current?.previous.seats[0].slipperSize, "M 9");
  assert.equal(current?.previous.seats[1].slipperSize, "W 7");
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
