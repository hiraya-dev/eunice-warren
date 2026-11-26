import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import type { D1Database } from "../db/types.ts";
import { normalizeGuestName } from "../rsvp/store.ts";

export interface SongInput { name: string; song: string; artist?: string; dedication?: string; spotifyTrackId?: string; coverUrl?: string }
export interface SongStore { add(input: SongInput): Promise<void> }

export class SongCapError extends Error {
  readonly kind: "song-total-cap" | "song-name-cap";
  constructor(kind: "song-total-cap" | "song-name-cap") {
    super(kind);
    this.name = "SongCapError";
    this.kind = kind;
  }
}

export class SongRateLimitError extends Error {
  constructor() { super("song-rate-limit"); this.name = "SongRateLimitError"; }
}

export const createD1SongStore = (database: D1Database): SongStore => {
  const db = getDb(database);
  return { async add(input) {
    const nameKey = normalizeGuestName(input.name);
    const result = await db.run(sql`insert into songs (name, name_key, song, artist, dedication, spotify_track_id, cover_url, created_at)
      select ${input.name}, ${nameKey}, ${input.song}, ${input.artist ?? null}, ${input.dedication ?? null}, ${input.spotifyTrackId ?? null}, ${input.coverUrl ?? null}, ${new Date().toISOString()}
      where (select count(*) from songs) < 500 and (select count(*) from songs where name_key = ${nameKey}) < 20`);
    if (Number((result as { changes?: number; meta?: { changes?: number } }).changes ?? (result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0) return;
    const [total, byName] = await Promise.all([
      db.all(sql`select count(*) as count from songs`),
      db.all(sql`select count(*) as count from songs where name_key = ${nameKey}`),
    ]);
    const totalCount = Number((total[0] as { count?: number } | undefined)?.count ?? 0);
    const nameCount = Number((byName[0] as { count?: number } | undefined)?.count ?? 0);
    if (totalCount >= 500) throw new SongCapError("song-total-cap");
    if (nameCount >= 20) throw new SongCapError("song-name-cap");
    throw new Error("song insert did not change any rows");
  } };
};

const fakeEntries: SongInput[] = [];
export const createFakeSongStore = (): SongStore => {
  return { async add(input) {
    if (input.song === "TEST TOTAL CAP") throw new SongCapError("song-total-cap");
    if (input.song === "TEST NAME CAP") throw new SongCapError("song-name-cap");
    if (input.song === "TEST RATE LIMIT") throw new SongRateLimitError();
    if (fakeEntries.length >= 500) throw new SongCapError("song-total-cap");
    if (fakeEntries.filter((entry) => normalizeGuestName(entry.name) === normalizeGuestName(input.name)).length >= 20) throw new SongCapError("song-name-cap");
    fakeEntries.push(input);
  } };
};
