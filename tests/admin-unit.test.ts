import test from "node:test";
import assert from "node:assert/strict";
import {
  adminRejectResponse,
  authenticateAdmin,
  parseAdminHosts,
  resetJwksCacheForTests,
  verifyAccessJwt,
} from "../src/lib/admin/auth.ts";
import {
  deadlineStamp,
  adminHistoryHeading,
  adminTimestamp,
  greeting,
  memberLine,
  plusOneChipText,
  relativeTime,
  renameNote,
  replyCountText,
  rsvpChangeSummary,
  rsvpHistoryBody,
  rowSlippersText,
  seatSubline,
} from "../src/lib/admin/presentation.ts";
import { csvCell, rsvpCsv, rsvpCsvResponse } from "../src/lib/admin/csv.ts";
import { loadAdminRsvps } from "../src/lib/admin/rsvps.ts";
import { createD1AdminStore } from "../src/lib/admin/d1.ts";
import { selectAdminStore } from "../src/lib/admin/store.ts";
import { SqliteD1 } from "./helpers/d1-sqlite.ts";
import {
  createFakeAdminStore,
  fakeAdminFixtures,
  fakeAdminResponses,
} from "../src/lib/admin/fake.ts";

const config = {
  ACCESS_TEAM_DOMAIN: "warren.cloudflareaccess.com",
  ACCESS_AUD: "app-aud",
  ADMIN_HOSTS: JSON.stringify({ "HOST@EXAMPLE.COM": "Eunice" }),
};
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
async function token(
  overrides: Record<string, unknown> = {},
  keyOverride?: CryptoKey,
) {
  const pair = keyOverride
    ? null
    : await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      );
  const privateKey = keyOverride ?? (pair as CryptoKeyPair).privateKey;
  const publicKey = pair
    ? await crypto.subtle.exportKey("jwk", pair.publicKey)
    : { kty: "RSA", n: "bad", e: "AQAB" };
  const header = encode({ alg: "RS256", kid: "key-1" });
  const claims = {
    iss: "https://warren.cloudflareaccess.com",
    aud: "app-aud",
    exp: 2000,
    nbf: 900,
    iat: 900,
    email: "host@example.com",
    ...overrides,
  };
  const payload = encode(claims);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return {
    token: `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`,
    keys: { "key-1": publicKey },
  };
}

test("valid Access JWT verifies and email matching is case insensitive", async () => {
  resetJwksCacheForTests();
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const made = await token({}, (pair as CryptoKeyPair).privateKey);
  made.keys["key-1"] = await crypto.subtle.exportKey(
    "jwk",
    (pair as CryptoKeyPair).publicKey,
  );
  const result = await authenticateAdmin(
    new Request("https://example.test/admin", {
      headers: { "Cf-Access-Jwt-Assertion": made.token },
    }),
    config,
    { fetchJwks: async () => made.keys, now: () => 1000 },
  );
  assert.deepEqual(result.host, {
    email: "host@example.com",
    firstName: "Eunice",
    sample: false,
  });
});
test("bad signatures are rejected", async () => {
  resetJwksCacheForTests();
  const made = await token();
  assert.equal(
    await verifyAccessJwt(`${made.token.slice(0, -2)}AA`, config, {
      fetchJwks: async () => made.keys,
      now: () => 1000,
    }),
    null,
  );
});

for (const [name, claims] of [
  ["wrong aud", { aud: "wrong" }],
  ["wrong iss", { iss: "wrong" }],
  ["expired", { exp: 900 }],
  ["expired within the clock leeway", { exp: 990 }],
  ["missing exp", { exp: undefined }],
  ["nbf in future", { nbf: 1061 }],
  ["iat in future", { iat: 1061 }],
  ["blank email", { email: " " }],
] as const) {
  test(`rejects ${name}`, async () => {
    resetJwksCacheForTests();
    const made = await token(claims);
    assert.equal(
      await verifyAccessJwt(made.token, config, {
        fetchJwks: async () => made.keys,
        now: () => 1000,
      }),
      null,
    );
  });
}

test("rejects a missing email", async () => {
  resetJwksCacheForTests();
  const made = await token({ email: undefined });
  assert.equal(
    await verifyAccessJwt(made.token, config, {
      fetchJwks: async () => made.keys,
      now: () => 1000,
    }),
    null,
  );
});

test("rejects alg none and HS256", async () => {
  const made = await token();
  for (const alg of ["none", "HS256"]) {
    const parts = made.token.split(".");
    const header = encode({ alg, kid: "key-1" });
    assert.equal(
      await verifyAccessJwt(`${header}.${parts[1]}.${parts[2]}`, config, {
        fetchJwks: async () => made.keys,
        now: () => 1000,
      }),
      null,
    );
  }
});

test("rejects missing and unknown key ids, refetching once for an unknown id", async () => {
  const made = await token();
  const parts = made.token.split(".");
  const missing = `${encode({ alg: "RS256" })}.${parts[1]}.${parts[2]}`;
  assert.equal(
    await verifyAccessJwt(missing, config, {
      fetchJwks: async () => made.keys,
      now: () => 1000,
    }),
    null,
  );
  resetJwksCacheForTests();
  let fetches = 0;
  const unknown = `${encode({ alg: "RS256", kid: "unknown" })}.${parts[1]}.${parts[2]}`;
  assert.equal(
    await verifyAccessJwt(unknown, config, {
      fetchJwks: async () => {
        fetches += 1;
        return made.keys;
      },
      now: () => 1000,
    }),
    null,
  );
  assert.equal(fetches, 2);
});

test("rejects malformed tokens", async () => {
  assert.equal(await verifyAccessJwt("not.a.jwt", config), null);
});

test("accepts the second configured audience and an audience array", async () => {
  resetJwksCacheForTests();
  const made = await token({ aud: ["other", "second"] });
  const multi = { ...config, ACCESS_AUD: "first, second, third" };
  assert.ok(
    await verifyAccessJwt(made.token, multi, {
      fetchJwks: async () => made.keys,
      now: () => 1000,
    }),
  );
});
for (const [name, env] of [
  [
    "missing domain",
    { RSVP_STORE: "d1", ACCESS_AUD: "aud", ADMIN_HOSTS: config.ADMIN_HOSTS },
  ],
  [
    "missing audience",
    {
      RSVP_STORE: "d1",
      ACCESS_TEAM_DOMAIN: "domain",
      ADMIN_HOSTS: config.ADMIN_HOSTS,
    },
  ],
  [
    "missing hosts",
    { RSVP_STORE: "d1", ACCESS_TEAM_DOMAIN: "domain", ACCESS_AUD: "aud" },
  ],
  ["invalid hosts JSON", { ...config, ADMIN_HOSTS: "{" }],
  ["empty hosts object", { ...config, ADMIN_HOSTS: "{}" }],
] as const) {
  test(`config ${name} fails closed`, async () => {
    assert.equal(
      (await authenticateAdmin(new Request("https://example.test/admin"), env))
        .reason,
      "forbidden",
    );
  });
}

test("fake mode uses sample host when Access config is unset", async () => {
  assert.equal(
    (
      await authenticateAdmin(new Request("https://example.test/admin"), {
        RSVP_STORE: "fake",
      })
    ).host?.sample,
    true,
  );
});

test("fake mode uses the real host when a valid token and Access config are present", async () => {
  resetJwksCacheForTests();
  const made = await token();
  const result = await authenticateAdmin(
    new Request("https://example.test/admin", {
      headers: { "Cf-Access-Jwt-Assertion": made.token },
    }),
    { ...config, RSVP_STORE: "fake" },
    { fetchJwks: async () => made.keys, now: () => 1000 },
  );
  assert.equal(result.host?.sample, false);
});

test("a valid token for a non-host returns not-host and distinct rejection copy", async () => {
  resetJwksCacheForTests();
  const made = await token({ email: "guest@example.com" });
  const result = await authenticateAdmin(
    new Request("https://example.test/admin", {
      headers: { "Cf-Access-Jwt-Assertion": made.token },
    }),
    config,
    { fetchJwks: async () => made.keys, now: () => 1000 },
  );
  assert.equal(result.reason, "not-host");
  assert.notEqual(
    adminRejectResponse("not-host").body,
    adminRejectResponse("forbidden").body,
  );
});

test("fake admin store never touches DB", async () => {
  const database = new Proxy(
    {},
    {
      get() {
        throw new Error("DB touched");
      },
    },
  );
  const store = selectAdminStore("fake", database as never);
  await store.getOverview();
  await store.getGuestList();
});

test("presentation helpers format members, plus-one chips, rename notes, relative times, and deadlines", () => {
  assert.equal(
    memberLine(["Ana Dela Cruz", "Jose Dela Cruz", "Maria Dela Cruz"]),
    "Ana, Jose & Maria Dela Cruz",
  );
  assert.equal(
    plusOneChipText({
      state: "open",
      name: null,
      namedBy: null,
      namedByKind: null,
    }),
    "+1 · no name yet",
  );
  assert.equal(
    plusOneChipText(
      {
        state: "named",
        name: "Jonas Ong",
        namedBy: "HOST@EXAMPLE.COM",
        namedByKind: "host",
      },
      { "host@example.com": "Eunice" },
    ),
    "Jonas Ong · +1, named by Eunice",
  );
  assert.equal(
    plusOneChipText({
      state: "freed",
      name: null,
      namedBy: null,
      namedByKind: null,
    }),
    "coming alone, seat freed",
  );
  assert.equal(
    renameNote(
      "Ana New",
      "Ana Old",
      "HOST@EXAMPLE.COM",
      "2026-11-19T02:00:00Z",
      { "host@example.com": "Eunice" },
    ),
    "Ana invited as Ana Old, renamed by Eunice · Nov 19",
  );
  const now = new Date("2026-11-21T04:00:00Z");
  assert.equal(relativeTime("2026-11-21T02:00:00Z", now), "2h ago");
  assert.equal(relativeTime("2026-11-20T04:00:00Z", now), "Yesterday");
  assert.equal(relativeTime("2026-11-19T04:00:00Z", now), "Nov 19");
  assert.match(deadlineStamp(new Date("2026-12-10T04:00:00Z")).text, /^2 days/);
  assert.match(deadlineStamp(new Date("2026-12-11T04:00:00Z")).text, /^1 day/);
  assert.match(deadlineStamp(new Date("2026-12-12T04:00:00Z")).text, /^Today/);
  assert.equal(deadlineStamp(new Date("2026-12-13T04:00:00Z")).closed, true);
  assert.match(greeting(now, "Eunice"), /Good afternoon/);
});

function adminDatabase() {
  const database = new SqliteD1();
  database.applyMigration();
  database.db.exec(`
    INSERT INTO households (id,label,display_name,ticket_code,status,created_at,updated_at) VALUES
      ('a','A-01','Alpha Family','AAAAAA','active','2026-11-01','2026-11-01'),
      ('b','B-02','Bravo Family','BBBBBB','active','2026-11-01','2026-11-01'),
      ('c','C-03','Charlie Cruz','CCCCCC','active','2026-11-01','2026-11-01'),
      ('d','D-04','Delta Doe','DDDDDD','active','2026-11-01','2026-11-01'),
      ('e','E-05','Echo Evans','EEEEEE','active','2026-11-01','2026-11-01'),
      ('f','F-06','Foxtrot Fox','FFFFFF','active','2026-11-01','2026-11-01'),
      ('archived','X-99','Archived Family','XXXXXX','archived','2026-11-01','2026-11-01');
    INSERT INTO invite_seats (id,household_id,kind,slot,status,invited_name,name_key,surname_key,name,named_by_kind,named_by,named_at,named_in_response_id,created_at,updated_at) VALUES
      (1,'a','member',1,'active','Alice Alpha','alice alpha','alpha','Alice Alpha',NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (2,'a','plus_one',2,'active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (3,'a','plus_one',NULL,'retired',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (4,'b','member',1,'active','Bella Bravo','bella bravo','bravo','Bella Bravo',NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (5,'b','plus_one',2,'active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (6,'c','member',1,'active','Cara Cruz','cara cruz','cruz','Cara Cruz',NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (7,'c','plus_one',2,'active',NULL,NULL,NULL,'Nina Cruz','host','host@example.com','2026-11-18T01:00:00Z',NULL,'2026-11-01','2026-11-01'),
      (8,'d','member',1,'active','Dina Doe','dina doe','doe','Dina Doe',NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (9,'d','plus_one',2,'active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (10,'e','member',1,'active','Elle Evans','elle evans','evans','Elle Evans',NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (11,'f','member',1,'active','Faye Fox','faye fox','fox','Faye Fox',NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01'),
      (12,'archived','member',1,'active','Aria Archived','aria archived','archived','Aria Archived',NULL,NULL,NULL,NULL,'2026-11-01','2026-11-01');
    INSERT INTO responses (id,household_id,submitted_at,respondent_name,attending,guest_count,email) VALUES
      (1,'a','2026-11-10T00:00:00Z','Alice Alpha',1,2,'a1@example.com'),
      (2,'a','2026-11-19T00:00:00Z','Alice Alpha',0,0,'a2@example.com'),
      (3,'c','2026-11-20T00:00:00Z','Cara Cruz',1,2,'c@example.com'),
      (4,'d','2026-11-18T00:00:00Z','Dina Doe',1,1,'d@example.com'),
      (5,'e','2026-11-17T00:00:00Z','Elle Evans',0,0,'e@example.com'),
      (6,'archived','2026-11-21T00:00:00Z','Aria Archived',1,1,'x@example.com'),
      (7,'a','2026-11-09T00:00:00Z','Alice Alpha',1,2,'a0@example.com'),
      (13,'f','2026-11-03T00:00:00Z','Faye Fox',0,0,'f@example.com'),
      (12,'c','2026-11-21T00:00:00Z','Cara Cruz',1,2,'c2@example.com');
    INSERT INTO response_seats (response_id,seat_id,kind,name,attending) VALUES
      (1,1,'member','Alice Alpha',1),(1,2,'plus_one','',1),(2,1,'member','Alice Alpha',0),(3,6,'member','Cara Cruz',1),(3,7,'plus_one','Nina Cruz',1),(4,8,'member','Dina Doe',1),(4,9,'plus_one','',0),(5,10,'member','Elle Evans',0),(12,6,'member','Cara Cruz',1),(12,7,'plus_one','Nina Cruz',1),(13,11,'member','Faye Fox',0);
    UPDATE invite_seats SET named_in_response_id = 12 WHERE id = 7;
  `);
  return database;
}

test("D1 admin overview uses newest responses and excludes archived and retired seats", async () => {
  const database = adminDatabase();
  const overview = await createD1AdminStore(database).getOverview();
  assert.equal(overview.seatsOffered, 10);
  assert.equal(overview.guestsComing, 3);
  assert.deepEqual(overview.households, {
    invited: 6,
    attending: 2,
    declined: 3,
    waiting: 1,
  });
  assert.equal(overview.repliedPercent, 83);
  assert.equal(overview.latestReplies.length, 4);
  assert.deepEqual(overview.latestReplies[0], {
    displayName: "Charlie Cruz",
    attending: true,
    coming: 2,
    seatCount: 2,
    submittedAt: "2026-11-21T00:00:00Z",
    namedPlusOnes: [{ name: "Nina Cruz", namedBy: "host@example.com" }],
  });
  assert.equal(overview.waiting.total, 1);
  assert.deepEqual(
    overview.waiting.households.map((row) => row.displayName),
    ["Bravo Family"],
  );
  database.close();
});

test("D1 admin guest list exposes plus-one states, rename metadata, RSVP states, and totals", async () => {
  const database = adminDatabase();
  const result = await createD1AdminStore(database).getGuestList();
  assert.deepEqual(result.totals, {
    households: 6,
    seatsOffered: 10,
    unnamedPlusOnes: 1,
  });
  assert.deepEqual(
    result.rows.map((row) => row.displayName),
    [
      "Alpha Family",
      "Bravo Family",
      "Charlie Cruz",
      "Delta Doe",
      "Echo Evans",
      "Foxtrot Fox",
    ],
  );
  const alpha = result.rows[0];
  assert.equal(alpha.rsvp.state, "declined");
  assert.equal(result.rows[1].rsvp.state, "waiting");
  assert.deepEqual(result.rows[2].rsvp, { state: "coming", coming: 2 });
  assert.deepEqual(result.rows[3].rsvp, { state: "coming", coming: 1 });
  assert.equal(result.rows[1].seats[1].state, "open");
  assert.equal(result.rows[2].seats[1].state, "named");
  assert.equal(result.rows[2].seats[1].namedBy, "host@example.com");
  assert.equal(result.rows[3].seats[1].state, "freed");
  database.close();
});

test("D1 RSVP list/detail uses newest host edit, seat ids, waiting, and archived rules", async () => {
  const database = adminDatabase();
  database.db.exec(
    "INSERT INTO responses (id,household_id,submitted_at,respondent_name,attending,guest_count,email,source,edited_by,note) VALUES (14,'c','2026-11-22T00:00:00Z','Eunice',1,1,'c@example.com','host','host@example.com','host note'); INSERT INTO response_seats (response_id,seat_id,kind,name,attending,slipper_size) VALUES (14,6,'member','Cara Cruz',1,'W 8')",
  );
  const store = createD1AdminStore(database);
  const list = await store.getRsvpList();
  assert.equal(
    list.rows.find((row) => row.id === "c")?.submittedAt,
    "2026-11-22T00:00:00Z",
  );
  assert.equal(list.rows.find((row) => row.id === "b")?.state, "waiting");
  const detail = await store.getRsvpDetail("c");
  assert(detail);
  assert.equal(detail.history[0]?.source, "host");
  assert.equal(
    detail.history[0]?.seats.find((seat) => seat.seatId === 6)?.slipperSize,
    "W 8",
  );
  assert.equal(await store.getRsvpDetail("archived"), null);
  assert.equal(await store.getRsvpDetail("missing"), null);
  const waiting = await store.getRsvpDetail("b");
  assert.equal(waiting?.versionCount, 0);
  const declined = await store.getRsvpDetail("a");
  assert(declined);
  assert.equal(
    declined.seats.every((seat) => !seat.coming && seat.slipperSize === null),
    true,
  );
  database.close();
});

for (const [name, raw] of [
  ["invalid JSON", "{"],
  ["an array", "[]"],
  ["an empty object", "{}"],
  ["a blank first name", JSON.stringify({ "host@example.com": " " })],
  ["a non-string first name", JSON.stringify({ "host@example.com": 1 })],
  ["a blank email", JSON.stringify({ " ": "Eunice" })],
] as const) {
  test(`ADMIN_HOSTS with ${name} is rejected`, () => {
    assert.equal(parseAdminHosts(raw), null);
  });
}

test("ADMIN_HOSTS keys are lower-cased and names trimmed", () => {
  assert.deepEqual(
    parseAdminHosts(JSON.stringify({ "Host@Example.com": " Eunice " })),
    {
      "host@example.com": "Eunice",
    },
  );
});

test("memberLine keeps a single name as is", () => {
  assert.equal(memberLine(["Madonna"]), "Madonna");
  assert.equal(memberLine(["Sofía Peña"]), "Sofía Peña");
});

test("fake unnamed plus-ones count open seats, not households", async () => {
  const expected = fakeAdminFixtures
    .filter((row) => row.rsvp.state !== "declined")
    .flatMap((row) => row.seats)
    .filter((s) => s.kind === "plus_one" && s.state === "open").length;
  const list = await createFakeAdminStore().getGuestList();
  assert.equal(list.totals.unnamedPlusOnes, expected);
});

test("RSVP list separates waiting from replies and detects renamed seats", async () => {
  const list = await createFakeAdminStore().getRsvpList();
  const latest = new Map<string, (typeof fakeAdminResponses)[number]>();
  for (const response of fakeAdminResponses) {
    const saved = latest.get(response.householdId);
    if (
      !saved ||
      response.submittedAt > saved.submittedAt ||
      (response.submittedAt === saved.submittedAt && response.id > saved.id)
    )
      latest.set(response.householdId, response);
  }
  const replied = fakeAdminFixtures.filter((row) => latest.has(row.id));
  assert.deepEqual(list.totals, {
    all: replied.length,
    attending: replied.filter((row) => latest.get(row.id)?.attending).length,
    declined: replied.filter((row) => !latest.get(row.id)?.attending).length,
    seatChanges: replied.filter((row) =>
      row.seats.some(
        (seat) =>
          (seat.name && seat.invitedName && seat.name !== seat.invitedName) ||
          (seat.kind === "plus_one" && seat.name && !seat.invitedName),
      ),
    ).length,
    waiting: fakeAdminFixtures.length - replied.length,
  });
  assert.equal(
    list.rows.find((row) => row.id === "hh-dela-cruz")?.seatChange,
    true,
  );
  assert.equal(
    list.rows.find((row) => row.id === "hh-santos")?.state,
    "waiting",
  );
});

test("RSVP detail returns history and waiting households, rejecting only unknown ids", async () => {
  const store = createFakeAdminStore();
  const detail = await store.getRsvpDetail("hh-ramos");
  assert(detail);
  assert.deepEqual(
    detail.history.map((version) => version.source),
    ["host", "guest", "guest"],
  );
  assert.equal(detail.history.length, 3);
  assert.deepEqual(
    rsvpChangeSummary(detail.history[0], detail.history[1], {
      "eunice@example.com": "Eunice",
    }),
    ["Bea Ramos → Beatriz Ramos, renamed by Eunice"],
  );
  assert.deepEqual(rsvpChangeSummary(detail.history[0], detail.history[1]), [
    "Bea Ramos → Beatriz Ramos, renamed by eunice@example.com",
  ]);
  assert.deepEqual(rsvpChangeSummary(detail.history[1], detail.history[2]), [
    "Paolo Ramos → Bea Ramos, renamed by Liza Ramos",
    "Bea Ramos M 10 → W 7",
  ]);
  assert.equal(await store.getRsvpDetail("missing"), null);
  assert.equal((await store.getRsvpDetail("hh-santos"))?.versionCount, 0);
});

test("fake RSVP details preserve explicit attendance, sizes, and first-version formatting", async () => {
  const store = createFakeAdminStore();
  const villanueva = await store.getRsvpDetail("hh-villanueva");
  assert.deepEqual(
    villanueva?.seats.filter((seat) => !seat.coming).map((seat) => seat.name),
    ["Lolo Ben Villanueva", "Lola Cora Villanueva"],
  );
  const delaCruz = await store.getRsvpDetail("hh-dela-cruz");
  assert.deepEqual(
    delaCruz?.seats.map((seat) => seat.slipperSize),
    ["W 7", "M 9", "W 6", "M 5"],
  );
  assert.equal(
    rsvpHistoryBody(delaCruz!.history[0]),
    "Maria Dela Cruz, Jose Dela Cruz, Anna Dela Cruz, Miguel Dela Cruz",
  );
  const declined = await store.getRsvpDetail("hh-pena");
  assert.equal(rsvpHistoryBody(declined!.history[0]), "Not coming");
  const missingSeats = await store.getRsvpDetail("hh-mendoza");
  assert.deepEqual(
    missingSeats?.seats.map((seat) => [seat.coming, seat.slipperSize]),
    [
      [true, null],
      [false, null],
    ],
  );
});

test("admin RSVP timestamps use Manila and history headings read yes or no", () => {
  assert.equal(adminTimestamp("2026-11-20T13:14:00.000Z"), "Nov 20, 9:14 PM");
  assert.equal(
    adminHistoryHeading({
      submittedAt: "2026-11-20T13:14:00.000Z",
      attending: true,
      coming: 2,
    }),
    "Nov 20, 9:14 PM · Yes, 2 coming",
  );
  assert.equal(
    adminHistoryHeading({
      submittedAt: "2026-11-20T13:14:00.000Z",
      attending: false,
      coming: 0,
    }),
    "Nov 20, 9:14 PM · No",
  );
});

test("admin presentation helpers cover reply, slipper, and seat variants", () => {
  assert.equal(replyCountText(1), "once");
  assert.equal(replyCountText(2), "twice");
  assert.equal(replyCountText(4), "4 times");
  assert.equal(rowSlippersText({ state: "declined", slippers: [] }), "None");
  assert.equal(
    rowSlippersText({
      state: "attending",
      slippers: [
        { firstName: "Bea", size: "W 7" },
        { firstName: "First", size: null },
      ],
    }),
    "Bea W 7 · First —",
  );
  assert.equal(
    seatSubline({
      kind: "member",
      invitedName: "Paolo",
      name: "Bea",
      namedBy: "Liza",
      namedByKind: "guest",
    }),
    "Invited as Paolo · renamed",
  );
  assert.equal(
    seatSubline({
      kind: "plus_one",
      invitedName: null,
      name: null,
      namedBy: null,
      namedByKind: null,
      state: "open",
    }),
    "+1 · no name yet",
  );
  assert.equal(
    seatSubline(
      {
        kind: "plus_one",
        invitedName: null,
        name: "Bea",
        namedBy: "host@example.com",
        namedByKind: "host",
        state: "named",
      },
      { "host@example.com": "Eunice" },
    ),
    "+1, named by Eunice",
  );
});

test("RSVP CSV guards formulas and formats Manila timestamps", async () => {
  assert.equal(csvCell('a"b,c\r\nd'), '"a""b,c\r\nd"');
  for (const value of ["=x", "+x", "-x", "@x", "\tx"])
    assert.equal(csvCell(value), `'${value}`);
  assert.equal(csvCell("\rx"), `"'\rx"`);
  const list = await createFakeAdminStore().getRsvpList();
  const { body, date } = rsvpCsv(list, new Date("2026-11-30T18:00:00.000Z"));
  assert.equal(date, "2026-12-01");
  assert.match(body, /2026-11-15 13:00/);
  assert.match(body, /,waiting,,,,,1,/);
});

test("RSVP CSV returns a private 503 response when the store fails", async () => {
  const response = await rsvpCsvResponse(() => {
    throw new Error("store unavailable");
  });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.doesNotMatch(body, /text\/csv|household|email|Maria|@/i);
  assert.equal(
    response.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
});

test("RSVP page loader renders failure state when the store fails", async () => {
  const loaded = await loadAdminRsvps(() => {
    throw new Error("store unavailable");
  }, null);
  assert.deepEqual(loaded, {
    data: null,
    detail: null,
    counts: undefined,
    failed: true,
    notFound: false,
  });
});

test("empty RSVP household query is treated like no household", async () => {
  const store = createFakeAdminStore();
  const loaded = await loadAdminRsvps(() => store, "");
  assert.equal(loaded.failed, false);
  assert.equal(loaded.detail, null);
  assert.equal(loaded.notFound, false);
});
