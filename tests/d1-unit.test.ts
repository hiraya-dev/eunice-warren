import test from "node:test";
import assert from "node:assert/strict";
import { createD1RsvpStore } from "../src/lib/rsvp/d1.ts";
import { getPlusOneStates, getHouseholdSummary, getUnnamedPlusOneCount } from "../src/lib/db/summary.ts";
import { createD1SongStore, SongCapError } from "../src/lib/songs/store.ts";
import { isD1LimitError } from "../src/lib/db/errors.ts";
import { addSeat, removeTrailingSeat, retireSeat, setInvitedName, setSeatName } from "../src/lib/rsvp/d1.ts";
import { SqliteD1 } from "./helpers/d1-sqlite.ts";
import { MAX_SEATS } from "../src/lib/rsvp/limits.ts";
import { readFileSync } from "node:fs";
import { buildFindActionResponse, GuestActionFailure, runFindAction, runSongAction, runSubmitAction, selectStore } from "../src/lib/guest-actions.ts";
import { createFakeRsvpStore, fakeFixtures, type RsvpStore } from "../src/lib/rsvp/store.ts";
import type { SongStore } from "../src/lib/songs/store.ts";
import { signRsvpToken, validateSubmission, verifyRsvpToken } from "../src/lib/rsvp/logic.ts";
import { ticketFilename, ticketReference } from "../src/lib/rsvp/event.ts";

const now = "2026-11-21T00:00:00.000Z";
const setup = () => {
  const database = new SqliteD1();
  database.applyMigration();
  database.db.exec(`INSERT INTO households (id,label,display_name,ticket_code,created_at,updated_at) VALUES ('toledo','Toledo_Sabang','The Toledo Family','TOLEDO','${now}','${now}');
    INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES
    ('toledo','member',1,'active','Luna Toledo','luna toledo','toledo','Luna Toledo','${now}','${now}'),
    ('toledo','member',2,'active','Mara Toledo','mara toledo','toledo','Mara Toledo','${now}','${now}'),
    ('toledo','plus_one',3,'active',NULL,NULL,NULL,NULL,'${now}','${now}');`);
  return database;
};

test("MAX_SEATS stays aligned with the migration slot check", () => {
  assert.equal(MAX_SEATS, 12);
  assert.match(readFileSync("migrations/0000_init.sql", "utf8"), /slot BETWEEN 1 AND 12/);
});

test("D1 lookup returns only the public invite shape and restores previous values by seatId after a seat-count change", async () => {
  const database = setup();
  const result = await createD1RsvpStore(database).findInvite("Luna Toledo");
  assert(result && result.invite);
  assert.deepEqual(Object.keys(result.invite).sort(), ["householdName", "members", "seatList", "seats", "ticketCode"]);
  assert.equal("id" in result.invite, false);
  assert.equal("label" in result.invite, false);
  assert.equal(result.invite.householdName, "The Toledo Family");
  assert.equal(result.invite.seatList?.[0].seatId, 1);
  database.db.exec(`INSERT INTO responses (household_id,submitted_at,respondent_name,attending,guest_count,email,note) VALUES ('toledo','2026-11-20T00:00:00.000Z','Luna Toledo',1,1,'luna@example.com','private');
    INSERT INTO response_seats (response_id,seat_id,kind,name,attending,slipper_size) VALUES (1,2,'member','Mara Toledo',0,NULL),(1,1,'member','Luna Toledo',1,'W 7');`);
  database.db.exec(`INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES ('toledo','plus_one',4,'active',NULL,NULL,NULL,NULL,'${now}','${now}')`);
  const previous = await createD1RsvpStore(database).findInvite("Mara Toledo");
  assert(previous && previous.invite && previous.previous);
  assert.equal(previous.previous.seats.find((seat) => seat.seatId === 1)?.slipperSize, "W 7");
  assert.equal(previous.previous.seats.find((seat) => seat.seatId === 2)?.attending, false);
  assert.equal(previous.previous.seats.find((seat) => seat.seatId === 4)?.attending, false);
  database.close();
});

test("D1 lookup resets member ticks after a decline and leaves plus-ones unticked", async () => {
  const database = setup();
  database.db.exec(`INSERT INTO responses (id,household_id,submitted_at,respondent_name,attending,guest_count,email) VALUES (1,'toledo','2026-11-20T00:00:00.000Z','Luna Toledo',0,0,'luna@example.com');
    INSERT INTO response_seats (response_id,seat_id,kind,name,attending) VALUES (1,1,'member','Luna Toledo',0),(1,2,'member','Mara Toledo',0),(1,3,'plus_one','Fictional Companion',0);`);
  const result = await createD1RsvpStore(database).findInvite("Luna Toledo");
  assert(result && result.invite && result.previous);
  assert.equal(result.previous.attending, false);
  assert.deepEqual(result.previous.seats.map(({ name, attending }) => ({ name, attending })), [
    { name: "Luna Toledo", attending: true },
    { name: "Mara Toledo", attending: true },
    { name: "", attending: false },
  ]);
  database.close();
});

test("D1 lookup does not suggest a duplicated active member name", async () => {
  const database = setup();
  database.db.exec(`INSERT INTO households (id,label,display_name,ticket_code,created_at,updated_at) VALUES
    ('santos-one','One_Test','One','ONE111','${now}','${now}'),
    ('santos-two','Two_Test','Two','TWO222','${now}','${now}');
    INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES
    ('santos-one','member',1,'active','Maria Santos','maria santos','santos','Maria Santos','${now}','${now}'),
    ('santos-two','member',1,'active','Maria Santos','maria santos','santos','Maria Santos','${now}','${now}');`);
  assert.equal(await createD1RsvpStore(database).findInvite("Maira Santos"), null);
  database.close();
});

test("guest action responses, signed token, ticket reference, and filename never expose labels or ids", async () => {
  const store = createFakeRsvpStore();
  for (const fixture of fakeFixtures.filter(({ id }) => id === "toledo" || id === "santos")) {
    const lookup = await store.findInvite(fixture.members[0]);
    assert(lookup && lookup.invite);
    const output = await buildFindActionResponse(lookup, "secret", 2_000);
    assert(output.invite && output.token);
    const decoded = await verifyRsvpToken(output.token, "secret", 1_999);
    const submitToken = await signRsvpToken(fixture.ticketCode, Date.now() + 60_000, "secret");
    const submitted = await runSubmitAction(store, { token: submitToken, name: fixture.members[0], attending: false, email: "fictional@example.com", seats: fixture.seatList!.map((seat) => ({ seatId: seat.seatId, name: seat.name ?? "", shownName: seat.name, attending: false })) }, "secret");
    const surfaces = [JSON.stringify(output), JSON.stringify(submitted), JSON.stringify(decoded), ticketReference(output.invite.ticketCode), ticketFilename(output.invite.ticketCode)];
    for (const surface of surfaces) {
      assert.equal(surface.includes(fixture.label), false);
      assert.equal(surface.includes(fixture.label.split("_")[1]), false);
      assert.equal(surface.includes(fixture.id), false);
    }
  }
});

test("fake mode never calls the D1/getDb factory", () => {
  let getDbCalls = 0;
  assert.equal(selectStore("fake", () => "fake", () => { getDbCalls += 1; return "d1"; }), "fake");
  assert.equal(getDbCalls, 0);
});

test("server validation rejects an attending blank name and duplicate normalized names", () => {
  const invite = fakeFixtures.find(({ id }) => id === "santos")!;
  const base = invite.seatList!.map((seat) => ({ seatId: seat.seatId, name: seat.name ?? "", shownName: seat.name, attending: seat.kind === "member", slipperSize: seat.kind === "member" ? "W 7" : undefined }));
  assert.equal(validateSubmission({ attending: true, invite, seats: base.map((seat, index) => index === 1 ? { ...seat, attending: true, name: "" } : seat) }), false);
  assert.equal(validateSubmission({ attending: true, invite, seats: base.map((seat) => ({ ...seat, attending: true, name: "  LIZA SANTOS  ", slipperSize: "W 7" })) }), false);
});

test("submit action rejects an attending seat with an empty name", async () => {
  const fixture = fakeFixtures.find(({ id }) => id === "santos")!;
  let submitted = false;
  const store: RsvpStore = {
    findInvite: async () => null,
    findInviteByTicketCode: async () => ({ invite: fixture, householdId: fixture.id, matchedName: fixture.members[0], previous: null }),
    submit: async () => { submitted = true; },
  };
  const token = await signRsvpToken(fixture.ticketCode, Date.now() + 60_000, "secret");
  await assert.rejects(() => runSubmitAction(store, { token, name: fixture.members[0], attending: true, email: "liza@example.com", seats: fixture.seatList!.map((seat) => ({ seatId: seat.seatId, name: "", attending: true, slipperSize: "W 7" })) }, "secret"), (error: unknown) => error instanceof GuestActionFailure && error.code === "CONFLICT");
  assert.equal(submitted, false);
});

test("D1 submit batches response rows and writes a nonblank changed name without touching invited lookup keys", async () => {
  const database = setup();
  const store = createD1RsvpStore(database);
  await store.submit({ inviteId: "toledo", name: "Luna Toledo", attending: true, guests: 2, email: "luna@example.com", seats: [
    { seatId: 1, name: "Luna Toledo", shownName: "Luna Toledo", attending: true, slipperSize: "W 7" },
    { seatId: 2, name: "Mara New", shownName: "Mara Toledo", attending: true, slipperSize: "W 7" },
    { seatId: 3, name: "", shownName: "", attending: false },
  ] });
  const row = database.db.prepare("SELECT invited_name, name_key, name, named_by_kind FROM invite_seats WHERE id = 2").get() as Record<string, unknown>;
  assert.equal(row.invited_name, "Mara Toledo");
  assert.equal(row.name_key, "mara toledo");
  assert.equal(row.name, "Mara New");
  assert.equal(row.named_by_kind, "guest");
  assert.equal(database.db.prepare("SELECT count(*) AS count FROM responses").get()?.count, 1);
  assert.equal(database.db.prepare("SELECT count(*) AS count FROM response_seats").get()?.count, 3);
  assert(database.statements.some((statement) => /insert into "responses"/i.test(statement.sql)));
  assert(database.statements.some((statement) => /insert into "response_seats"/i.test(statement.sql)));
  assert.equal(database.statements.some((statement) => /(?:update|delete)\s+"responses"/i.test(statement.sql)), false);
  database.close();
});

test("D1 naming keeps blank and unchanged shown names, permits guest overwrite, and preserves invited-name lookup", async () => {
  const database = setup();
  const store = createD1RsvpStore(database);
  await setSeatName(database, 3, "Host One", "host@example.com");
  await store.submit({ inviteId: "toledo", name: "Luna Toledo", attending: true, guests: 2, email: "one@example.com", seats: [
    { seatId: 1, name: "Luna Guest", shownName: "Luna Toledo", attending: true, slipperSize: "W 7" },
    { seatId: 2, name: "", shownName: "Mara Toledo", attending: false },
    { seatId: 3, name: "Guest Override", shownName: "Host One", attending: true, slipperSize: "W 7" },
  ] });
  let rows = database.db.prepare("SELECT id, invited_name, name, named_by_kind FROM invite_seats ORDER BY id").all() as Array<Record<string, unknown>>;
  assert.equal(rows[0].name, "Luna Guest");
  assert.equal(rows[1].name, "Mara Toledo");
  assert.equal(rows[2].name, "Guest Override");
  assert.equal(rows[2].named_by_kind, "guest");
  assert((await store.findInvite("Luna Toledo"))?.invite);
  assert.equal(rows[0].invited_name !== rows[0].name, true);

  const lookup = await store.findInvite("Luna Toledo");
  assert(lookup && lookup.invite);
  await setSeatName(database, 3, "Newer Host", "host@example.com");
  await store.submit({ inviteId: "toledo", name: "Luna Toledo", attending: true, guests: 2, email: "two@example.com", seats: lookup.invite.seatList!.map((seat) => ({ seatId: seat.seatId, name: seat.seatId === 3 ? "Guest Override" : seat.name ?? "", shownName: seat.name, attending: seat.seatId !== 2, slipperSize: seat.seatId !== 2 ? "W 7" : undefined })) });
  rows = database.db.prepare("SELECT id, name FROM invite_seats ORDER BY id").all() as Array<Record<string, unknown>>;
  assert.equal(rows[2].name, "Newer Host");
  database.close();
});

test("D1 store rejects a changed active seat set", async () => {
  const database = setup();
  await assert.rejects(() => createD1RsvpStore(database).submit({ inviteId: "toledo", name: "Luna Toledo", attending: true, guests: 1, email: "luna@example.com", seats: [
    { seatId: 1, name: "Luna Toledo", attending: true, slipperSize: "W 7" },
    { seatId: 2, name: "Mara Toledo", attending: false },
  ] }), /invite changed/);
  database.close();
});

test("blank submitted names never clear an existing seat name", async () => {
  const database = setup();
  await createD1RsvpStore(database).submit({ inviteId: "toledo", name: "Luna Toledo", attending: false, guests: 0, email: "luna@example.com", seats: [
    { seatId: 1, name: "", shownName: "Luna Toledo", attending: false },
    { seatId: 2, name: "", shownName: "Mara Toledo", attending: false },
    { seatId: 3, name: "", shownName: "", attending: false },
  ] });
  assert.deepEqual(database.db.prepare("SELECT name FROM invite_seats WHERE kind='member' ORDER BY slot").all().map((row) => row.name), ["Luna Toledo", "Mara Toledo"]);
  database.close();
});

test("submit action returns the documented conflict when the active seat ids change", async () => {
  const invite = fakeFixtures.find(({ id }) => id === "santos")!;
  const store: RsvpStore = {
    findInvite: async () => null,
    findInviteByTicketCode: async () => ({ invite: { ...invite, seatList: invite.seatList!.slice(0, 1), seats: 1 }, householdId: invite.id, matchedName: invite.members[0], previous: null }),
    submit: async () => { throw new Error("must not submit"); },
  };
  const token = await signRsvpToken(invite.ticketCode, Date.now() + 60_000, "secret");
  await assert.rejects(() => runSubmitAction(store, { token, name: invite.members[0], attending: false, email: "liza@example.com", seats: invite.seatList!.map((seat) => ({ seatId: seat.seatId, name: seat.name ?? "", attending: false })) }, "secret"), (error: unknown) => error instanceof GuestActionFailure && error.code === "CONFLICT" && error.message === "Your invite changed. Check the seats before sending.");
});

test("active households without an active member cannot be found", async () => {
  const database = setup();
  database.db.exec("UPDATE invite_seats SET status='retired', slot=NULL WHERE kind='member'");
  const store = createD1RsvpStore(database);
  assert.equal(await store.findInvite("Luna Toledo"), null);
  assert.equal(await store.findInviteByTicketCode!("TOLEDO", "Luna Toledo"), null);
  database.close();
});

test("fake store rejects duplicate normalized attending names", async () => {
  const store = createFakeRsvpStore();
  await assert.rejects(() => store.submit({ inviteId: "santos", name: "Liza Santos", attending: true, guests: 2, email: "liza@example.com", seats: [
    { seatId: 1, name: "Liza Santos", attending: true, slipperSize: "W 7" },
    { seatId: 2, name: "  LÍZA   SANTOS ", attending: true, slipperSize: "W 7" },
  ] }), /duplicate guest names/);
});

test("song caps are atomic and classify which limit blocked the insert", async () => {
  const database = setup();
  const store = createD1SongStore(database);
  for (let index = 0; index < 20; index += 1) await store.add({ name: "Luna Toledo", song: `Song ${index}` });
  await assert.rejects(() => store.add({ name: "Luna Toledo", song: "Song 21" }), (error: unknown) => error instanceof SongCapError && error.kind === "song-name-cap");
  database.db.exec("DELETE FROM songs");
  for (let index = 0; index < 500; index += 1) database.db.prepare("INSERT INTO songs (name,name_key,song,created_at) VALUES (?,?,?,?)").run(`Guest ${index}`, `guest ${index}`, `Song ${index}`, now);
  await assert.rejects(() => store.add({ name: "Luna Toledo", song: "Last song" }), (error: unknown) => error instanceof SongCapError && error.kind === "song-total-cap");
  database.close();
});

test("plus-one states move open to named to freed", async () => {
  const database = setup();
  let states = await getPlusOneStates(database, "toledo");
  assert.equal(states[0].state, "open");
  await setSeatName(database, 3, "Host Guest", "host@example.com");
  states = await getPlusOneStates(database, "toledo");
  assert.equal(states[0].state, "named");
  assert.equal(states[0].namedByKind, "host");
  database.db.exec(`INSERT INTO responses (household_id,submitted_at,respondent_name,attending,guest_count,email) VALUES ('toledo','2026-11-21T00:00:00.000Z','Luna Toledo',1,1,'luna@example.com'); INSERT INTO response_seats (response_id,seat_id,kind,name,attending) VALUES (1,3,'plus_one','Host Guest',0);`);
  states = await getPlusOneStates(database, "toledo");
  assert.equal(states[0].state, "freed");
  database.close();
});

test("summary reports every dashboard count and excludes declined-household unnamed plus-ones", async () => {
  const database = new SqliteD1();
  database.applyMigration();
  database.db.exec(`
    INSERT INTO households (id,label,display_name,ticket_code,created_at,updated_at) VALUES
      ('a','A_Test','A','AAAAAA','${now}','${now}'),('b','B_Test','B','BBBBBB','${now}','${now}'),('c','C_Test','C','CCCCCC','${now}','${now}');
    INSERT INTO invite_seats (id,household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES
      (1,'a','member',1,'active','A Member','a member','member','A Member','${now}','${now}'),
      (2,'a','plus_one',2,'active',NULL,NULL,NULL,'Named A','${now}','${now}'),
      (3,'a','plus_one',3,'active',NULL,NULL,NULL,NULL,'${now}','${now}'),
      (4,'b','member',1,'active','B Member','b member','member','B Member','${now}','${now}'),
      (5,'b','plus_one',2,'active',NULL,NULL,NULL,NULL,'${now}','${now}'),
      (6,'c','member',1,'active','C Member','c member','member','C Member','${now}','${now}'),
      (7,'c','plus_one',2,'active',NULL,NULL,NULL,NULL,'${now}','${now}');
    INSERT INTO responses (id,household_id,submitted_at,respondent_name,attending,guest_count,email) VALUES
      (1,'a','2026-11-20T00:00:00.000Z','A Member',1,2,'a@example.com'),
      (2,'c','2026-11-22T00:00:00.000Z','C Member',0,0,'c@example.com');
    INSERT INTO response_seats (response_id,seat_id,kind,name,attending,slipper_size) VALUES
      (1,1,'member','A Member',1,'W 7'),(1,2,'plus_one','Named A',1,NULL),(1,3,'plus_one','',0,NULL),
      (2,6,'member','C Member',0,NULL),(2,7,'plus_one','',0,NULL);
    INSERT INTO seating_tables (id,name,kind,capacity,sort_order,created_at,updated_at) VALUES (1,'One','round',10,1,'${now}','${now}');
    INSERT INTO seat_assignments (table_id,position,seat_id,created_at,updated_at) VALUES (1,1,1,'${now}','${now}'),(1,2,3,'${now}','${now}'),(1,3,5,'${now}','${now}');
  `);
  const summary = await getHouseholdSummary(database);
  assert.equal(summary.offered, 7);
  assert.equal(summary.attending, 2);
  assert.equal(summary.slipperOrder, 1);
  assert.equal(summary.slipperMissing, 1);
  assert.equal(summary.seated, 1);
  assert.equal(summary.pencilled, 1);
  assert.equal(summary.flagged, 1);
  assert.equal(summary.unnamedPlusOnes, 1);
  assert.equal(summary.latestReplyAt, "2026-11-22T00:00:00.000Z");
  assert.equal(await getUnnamedPlusOneCount(database), 1);
  database.close();
});

test("host seat functions enforce twelve seats, activity, seating, and member invariants", async () => {
  const database = setup();
  assert.equal(await addSeat(database, "toledo", "host@example.com"), 4);
  assert.equal((await removeTrailingSeat(database, "toledo", "host@example.com")).removed, true);
  await setInvitedName(database, 1, "Luna Revised", "host@example.com");
  const member = database.db.prepare("SELECT invited_name, name_key, name FROM invite_seats WHERE id=1").get() as Record<string, unknown>;
  assert.deepEqual({ ...member }, { invited_name: "Luna Revised", name_key: "luna revised", name: "Luna Revised" });
  await setSeatName(database, 3, "Guest", "host@example.com");
  assert.equal((await removeTrailingSeat(database, "toledo", "host@example.com")).blocked, "Seat 3 has activity. Review or retire this seat first.");
  assert.equal((await retireSeat(database, 3, "host@example.com")).retired, true);
  const retired = database.db.prepare("SELECT status, slot FROM invite_seats WHERE id=3").get() as Record<string, unknown>;
  assert.deepEqual({ ...retired }, { status: "retired", slot: null });
  database.close();
});

test("host seat functions refuse a thirteenth seat, refuse retiring a seated seat, and archive instead of removing the last member", async () => {
  const database = setup();
  for (let slot = 4; slot <= 12; slot += 1) database.db.prepare("INSERT INTO invite_seats (household_id,kind,slot,status,created_at,updated_at) VALUES ('toledo','plus_one',?,'active',?,?)").run(slot, now, now);
  await assert.rejects(() => addSeat(database, "toledo", "host@example.com"), /maximum seats/);
  database.db.exec(`INSERT INTO seating_tables (id,name,kind,capacity,sort_order,created_at,updated_at) VALUES (1,'One','round',12,1,'${now}','${now}'); INSERT INTO seat_assignments (table_id,position,seat_id,created_at,updated_at) VALUES (1,1,2,'${now}','${now}')`);
  assert.equal((await retireSeat(database, 2, "host@example.com")).blocked, "Seat is assigned to a table. Review the seating plan first.");
  database.db.exec("DELETE FROM seat_assignments; UPDATE invite_seats SET status='retired', slot=NULL WHERE kind='member' AND id <> 1");
  assert.equal((await retireSeat(database, 1, "host@example.com")).archived, true);
  assert.equal(database.db.prepare("SELECT status FROM households WHERE id='toledo'").get()?.status, "archived");
  database.close();
});

test("host naming functions clearly refuse invalid seat-kind and blank-member updates", async () => {
  const database = setup();
  assert.deepEqual(await setInvitedName(database, 3, "Fictional Guest", "host@example.com"), { blocked: "Only member seats have an invited name." });
  assert.deepEqual(await setSeatName(database, 1, "   ", "host@example.com"), { blocked: "Member seat names cannot be blank." });
  assert.deepEqual({ ...database.db.prepare("SELECT invited_name, name FROM invite_seats WHERE id=3").get() }, { invited_name: null, name: null });
  assert.equal(database.db.prepare("SELECT name FROM invite_seats WHERE id=1").get()?.name, "Luna Toledo");
  database.close();
});

test("D1 free-tier errors are found through prefixes and causes", () => {
  const read = "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
  const write = "Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
  assert.equal(isD1LimitError(new Error(`D1_ERROR: ${read}`)), true);
  assert.equal(isD1LimitError(new Error("outer", { cause: new Error(`D1_ERROR: ${write}`) })), true);
  assert.equal(isD1LimitError(new Error("nope")), false);
});

test("find, submit, and song action functions map D1 limits and generic failures to guest-safe messages", async () => {
  const daily = new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.");
  const generic = new Error("database exploded");
  const rsvpStore = (error: Error): RsvpStore => ({ findInvite: async () => { throw error; }, findInviteByTicketCode: async () => { throw error; }, submit: async () => { throw error; } });
  const songStore = (error: Error): SongStore => ({ add: async () => { throw error; } });
  const token = await signRsvpToken("TOLEDO", Date.now() + 60_000, "secret");
  const submit = { token, name: "Luna Toledo", attending: false, seats: [], email: "luna@example.com" };
  for (const run of [
    () => runFindAction(rsvpStore(daily), "Luna Toledo", "secret"),
    () => runSubmitAction(rsvpStore(daily), submit, "secret"),
    () => runSongAction(songStore(daily), { name: "Luna", song: "Song" }),
  ]) await assert.rejects(run, (error: unknown) => error instanceof GuestActionFailure && error.message === "We're busy right now, try again in a bit.");
  for (const run of [
    () => runFindAction(rsvpStore(generic), "Luna Toledo", "secret"),
    () => runSubmitAction(rsvpStore(generic), submit, "secret"),
    () => runSongAction(songStore(generic), { name: "Luna", song: "Song" }),
  ]) await assert.rejects(run, (error: unknown) => error instanceof GuestActionFailure && error.message === "Something went wrong. Please try again.");
});

test("D1 store and summary statements use indexes instead of table scans", async () => {
  const database = setup();
  await createD1RsvpStore(database).findInvite("Luna Toledo");
  await createD1SongStore(database).add({ name: "Luna Toledo", song: "A song" });
  await getHouseholdSummary(database);
  await getUnnamedPlusOneCount(database);
  await getPlusOneStates(database);
  const tableScan = /\bSCAN (?:households|invite_seats|responses|response_seats|songs|seat_assignments|reminders)(?:$|\s+(?!USING\b))/i;
  for (const statement of database.statements) {
    if (!/^\s*(select|with)/i.test(statement.sql)) continue;
    const plan = database.db.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...(statement.values as never[])) as Array<{ detail?: string }>;
    assert.equal(plan.some((entry) => tableScan.test(entry.detail ?? "")), false, `${statement.sql}\n${plan.map((entry) => entry.detail).join("\n")}`);
  }
  database.close();
});
