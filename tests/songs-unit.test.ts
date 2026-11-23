import assert from "node:assert/strict";
import test from "node:test";
import { songInput } from "../src/lib/songs/input.ts";
import { createD1SongStore } from "../src/lib/songs/store.ts";
import { SqliteD1 } from "./helpers/d1-sqlite.ts";

const base = { name: "Test Guest", song: "Dancing Queen", turnstileToken: "token" };
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
  const store = createD1SongStore(database);
  await store.add({ ...base, spotifyTrackId: validId, coverUrl: validCover });
  await store.add({ ...base, name: "Other Guest" });
  const rows = database.db.prepare("SELECT spotify_track_id, cover_url FROM songs ORDER BY id").all() as Array<{ spotify_track_id: string | null; cover_url: string | null }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { spotify_track_id: validId, cover_url: validCover },
    { spotify_track_id: null, cover_url: null },
  ]);
  database.close();
});
