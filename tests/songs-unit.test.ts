import assert from "node:assert/strict";
import test from "node:test";
import { songInput } from "../src/lib/songs/input.ts";
import { createD1SongStore, createFakeSongStore, SongGuestError } from "../src/lib/songs/store.ts";
import { fakeFixtures } from "../src/lib/rsvp/store.ts";
import { SqliteD1 } from "./helpers/d1-sqlite.ts";

const base = { name: "Ana Reyes", song: "Dancing Queen", turnstileToken: "token" };
const validId = "A".repeat(22);
const validCover = "https://i.scdn.co/image/abc";

test("song input accepts valid Spotify fields", () => {
  assert.equal(songInput.safeParse({ ...base, spotifyTrackId: validId, coverUrl: validCover }).success, true);
});

test("song input accepts neither Spotify field", () => {
  assert.equal(songInput.safeParse(base).success, true);
});

test("song input rejects a 21-character Spotify ID", () => {
  assert.equal(songInput.safeParse({ ...base, spotifyTrackId: "A".repeat(21) }).success, false);
});

test("song input rejects a Spotify ID containing a hyphen", () => {
  assert.equal(songInput.safeParse({ ...base, spotifyTrackId: `${"A".repeat(10)}-${"A".repeat(11)}` }).success, false);
});

test("song input rejects a cover URL from another host", () => {
  assert.equal(songInput.safeParse({ ...base, coverUrl: "https://example.com/x.jpg" }).success, false);
});

test("song input rejects an insecure Spotify cover URL", () => {
  assert.equal(songInput.safeParse({ ...base, coverUrl: "http://i.scdn.co/image/abc" }).success, false);
});

test("song input rejects a cover URL over 300 characters", () => {
  assert.equal(songInput.safeParse({ ...base, coverUrl: `https://i.scdn.co/${"a".repeat(300)}` }).success, false);
});

test("D1 song store persists Spotify fields and NULL when absent", async () => {
  const database = new SqliteD1();
  database.applyMigration();
  database.db.prepare("INSERT INTO households (id,label,display_name,ticket_code,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("songs-test", "songs-test", "Songs Test", "SONGTEST", "2026-11-20", "2026-11-20");
  database.db.prepare("INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("songs-test", "member", 1, "active", "Ana Reyes", "ana reyes", "reyes", "Ana Reyes", "2026-11-20", "2026-11-20");
  const store = createD1SongStore(database);
  await store.add({ ...base, spotifyTrackId: validId, coverUrl: validCover });
  await store.add({ ...base, name: " ana   reyes " });
  const rows = database.db.prepare("SELECT spotify_track_id, cover_url FROM songs ORDER BY id").all() as Array<{ spotify_track_id: string | null; cover_url: string | null }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { spotify_track_id: validId, cover_url: validCover },
    { spotify_track_id: null, cover_url: null },
  ]);
  database.close();
});

const addHousehold = (database: SqliteD1, id: string, status = "active") => {
  database.db.prepare("INSERT INTO households (id,label,display_name,ticket_code,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, id, id, id, status, "2026-11-20", "2026-11-20");
};

const addSeat = (database: SqliteD1, householdId: string, kind: string, status: string, invitedName: string | null, name: string | null) => {
  const slot = Number(database.db.prepare("SELECT count(*) AS count FROM invite_seats WHERE household_id=?").get(householdId)?.count ?? 0) + 1;
  database.db.prepare("INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(householdId, kind, status === "active" ? slot : null, status, invitedName, invitedName ? "x" : null, invitedName ? "x" : null, name, "2026-11-20", "2026-11-20");
};

test("D1 song store accepts active invited, RSVP, and named plus-one seats only", async () => {
  const database = new SqliteD1(); database.applyMigration();
  addHousehold(database, "active");
  addSeat(database, "active", "member", "active", "Sofía Cruz", "Sofía Cruz");
  addSeat(database, "active", "plus_one", "active", null, "Jonas Ong");
  addHousehold(database, "retired"); addSeat(database, "retired", "member", "retired", "Retired Guest", "Retired Guest");
  addHousehold(database, "archived", "archived"); addSeat(database, "archived", "member", "active", "Archived Guest", "Archived Guest");
  const store = createD1SongStore(database);
  await store.add({ name: "sofia  cruz", song: "Accepted" });
  await store.add({ name: "Jonas Ong", song: "Plus one" });
  for (const name of ["Unknown Guest", "Retired Guest", "Archived Guest"])
    await assert.rejects(() => store.add({ name, song: "Rejected" }), SongGuestError);
  assert.equal(database.db.prepare("SELECT count(*) AS count FROM songs").get()?.count, 2);
  database.close();
});

test("fake song store rejects unknown names and accepts a fixture member", async () => {
  const store = createFakeSongStore();
  await store.add({ name: fakeFixtures[0]!.members[0]!, song: "Fixture song" });
  await assert.rejects(() => store.add({ name: "Not on the list", song: "Rejected" }), SongGuestError);
});

test("D1 song caps ignore removed rows", async () => {
  const database = new SqliteD1(); database.applyMigration(); addHousehold(database, "caps");
  addSeat(database, "caps", "member", "active", "Cap Guest", "Cap Guest");
  const now = "2026-11-20T00:00:00Z";
  for (let i = 0; i < 500; i++) database.db.prepare("INSERT INTO songs (name,name_key,song,created_at,removed_at) VALUES (?,?,?,?,?)").run(`Other Guest ${i}`, `other guest ${i}`, `Song ${i}`, now, i === 0 ? now : null);
  const store = createD1SongStore(database);
  await store.add({ name: "Cap Guest", song: "After total removal" });
  database.close();
  const names = new SqliteD1(); names.applyMigration(); addHousehold(names, "name-caps");
  addSeat(names, "name-caps", "member", "active", "Cap Guest", "Cap Guest");
  for (let i = 0; i < 20; i++) names.db.prepare("INSERT INTO songs (name,name_key,song,created_at,removed_at) VALUES (?,?,?,?,?)").run("Cap Guest", "cap guest", `Name song ${i}`, now, i === 0 ? now : null);
  await createD1SongStore(names).add({ name: "Cap Guest", song: "After name removal" });
  names.close();
});
