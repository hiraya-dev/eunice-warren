import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeAdminStore } from "../src/lib/admin/fake.ts";
import { createD1AdminStore } from "../src/lib/admin/d1.ts";
import { buildSlipperCsv, buildSongCsv } from "../src/lib/admin/csv.ts";
import {
  copiedLabel,
  csv,
  djText,
  duplicateLabel,
  greeting,
  manilaDateTime,
  mostCommonCaption,
  pairsCaption,
  songKey,
  songsEyebrow,
} from "../src/lib/admin/presentation.ts";
import type { AdminStore } from "../src/lib/admin/store.ts";
import { SLIPPER_SIZES } from "../src/lib/rsvp/slippers.ts";
import { SqliteD1 } from "./helpers/d1-sqlite.ts";

test("song keys normalize accents, punctuation, case, and whitespace", () => {
  assert.equal(
    songKey("Beyoncé — Live", "The Band"),
    songKey("beyonce live", "the band"),
  );
  assert.equal(songKey("Song", null), songKey("Song", ""));
  assert.equal(songKey("Song", null), songKey("Song", undefined));
});

test("presentation helpers cover singular, plural, and empty branches", () => {
  assert.equal(mostCommonCaption(null, 0), "No sizes yet");
  assert.equal(mostCommonCaption("W 7", 1), "Most common · W 7 (1 pair)");
  assert.equal(mostCommonCaption("W 7", 2), "Most common · W 7 (2 pairs)");
  assert.equal(
    pairsCaption(0),
    "One per attending guest · grows as RSVPs come in",
  );
  assert.equal(
    pairsCaption(1),
    "One per attending guest · grows as RSVPs come in · 1 coming without a size yet",
  );
  assert.equal(songsEyebrow(1, 1), "For the DJ · 1 request, 1 song");
  assert.equal(songsEyebrow(2, 3), "For the DJ · 2 requests, 3 songs");
  assert.equal(duplicateLabel(1), "");
  assert.equal(duplicateLabel(2), "× 2 requests");
  assert.equal(copiedLabel(1), "Copied 1 song");
  assert.equal(copiedLabel(2), "Copied 2 songs");
  assert.equal(
    greeting(new Date("2026-11-21T16:05:00Z"), "Eunice"),
    "Good morning, Eunice",
  );
  assert.equal(manilaDateTime("2026-11-20T16:05:00Z"), "2026-11-21 00:05");
});

test("songs empty state has the dashboard marker and disabled actions", () => {
  const page = readFileSync("src/pages/admin/songs.astro", "utf8");
  assert.match(page, /data-admin-empty/);
  assert.match(page, /disabled={!view\.requests}/);
});

test("D1 admin stores count slipper branches and return all sizes", async () => {
  const database = new SqliteD1();
  database.applyMigration();
  const addHousehold = (id: string, status = "active") => {
    database.db
      .prepare(
        "INSERT INTO households (id,label,display_name,ticket_code,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(id, id, id, id, status, "2026-11-20", "2026-11-20");
  };
  const addSeat = (household: string, slot: number, status = "active") => {
    database.db
      .prepare(
        "INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        household,
        "member",
        status === "active" ? slot : null,
        status,
        `${household} ${slot}`,
        `${household} ${slot}`,
        household,
        `${household} ${slot}`,
        "2026-11-20",
        "2026-11-20",
      );
    return Number(
      database.db.prepare("SELECT last_insert_rowid() AS id").get()?.id,
    );
  };
  const addResponse = (
    household: string,
    submittedAt: string,
    attending: number,
    seats: Array<[number, number, string | null]>,
  ) => {
    database.db
      .prepare(
        "INSERT INTO responses (household_id,submitted_at,respondent_name,attending,guest_count,email) VALUES (?,?,?,?,?,?)",
      )
      .run(
        household,
        submittedAt,
        household,
        attending,
        seats.filter(([, isAttending]) => isAttending).length,
        `${household}@test.invalid`,
      );
    const responseId = Number(
      database.db.prepare("SELECT last_insert_rowid() AS id").get()?.id,
    );
    for (const [seatId, isAttending, size] of seats)
      database.db
        .prepare(
          "INSERT INTO response_seats (response_id,seat_id,kind,name,attending,slipper_size) VALUES (?,?,?,?,?,?)",
        )
        .run(responseId, seatId, "member", household, isAttending, size);
  };
  addHousehold("latest");
  const latestW = addSeat("latest", 1);
  const latestM = addSeat("latest", 2);
  addResponse("latest", "2026-11-19T00:00:00Z", 1, [
    [latestW, 1, "W 5"],
    [latestM, 1, "M 6"],
  ]);
  addResponse("latest", "2026-11-20T00:00:00Z", 1, [
    [latestW, 1, "W 7"],
    [latestM, 0, "M 6"],
  ]);
  addHousehold("tie");
  const tieSeat = addSeat("tie", 1);
  addResponse("tie", "2026-11-20T01:00:00Z", 1, [[tieSeat, 1, "W 5"]]);
  addResponse("tie", "2026-11-20T01:00:00Z", 1, [[tieSeat, 1, "W 5.5"]]);
  addHousehold("small");
  const smallSeat = addSeat("small", 1);
  addResponse("small", "2026-11-20T00:00:00Z", 1, [[smallSeat, 1, "W 5"]]);
  addHousehold("declined");
  const declinedSeat = addSeat("declined", 1);
  addResponse("declined", "2026-11-20T00:00:00Z", 0, [
    [declinedSeat, 1, "W 5"],
  ]);
  addHousehold("archived", "archived");
  const archivedSeat = addSeat("archived", 1);
  addResponse("archived", "2026-11-20T00:00:00Z", 1, [
    [archivedSeat, 1, "W 5"],
  ]);
  addHousehold("retired");
  const retiredSeat = addSeat("retired", 1, "retired");
  addResponse("retired", "2026-11-20T00:00:00Z", 1, [[retiredSeat, 1, "W 5"]]);
  addHousehold("missing");
  const nullSeat = addSeat("missing", 1);
  const unknownSeat = addSeat("missing", 2);
  addResponse("missing", "2026-11-20T00:00:00Z", 1, [
    [nullSeat, 1, null],
    [unknownSeat, 1, "W 15"],
  ]);
  const store = createD1AdminStore(database);
  const order = await store.getSlipperOrder();
  assert.equal(order.women.length + order.men.length, 28);
  assert.deepEqual(
    [...order.women, ...order.men].map((row) => row.size),
    [...SLIPPER_SIZES],
  );
  assert.equal(order.women.find((row) => row.size === "W 5.5")?.count, 1);
  assert.equal(order.women.find((row) => row.size === "W 5")?.count, 1);
  assert.equal(order.men.find((row) => row.size === "M 6")?.count, 0);
  assert.equal(order.missing, 2);
  assert.equal(
    order.women.find((row) => row.size === "W 15"),
    undefined,
  );
  assert.equal(order.mostCommonWomen, "W 5");
  assert.equal(order.mostCommonMen, null);
  assert.equal((await store.getNavCounts()).slipperPairs, order.pairs);
  database.close();
});

test("D1 song requests sort, number, duplicate-count, and distinguish missing artists", async () => {
  const database = new SqliteD1();
  database.applyMigration();
  const rows = [
    ["A", "Song", null, "2026-11-20T02:00:00Z"],
    ["B", "song", null, "2026-11-20T02:00:00Z"],
    ["C", "Song", "Artist", "2026-11-20T01:00:00Z"],
  ];
  for (const [name, song, artist, createdAt] of rows)
    database.db
      .prepare(
        "INSERT INTO songs (name,name_key,song,artist,created_at) VALUES (?,?,?,?,?)",
      )
      .run(name, String(name).toLowerCase(), song, artist, createdAt);
  const result = await createD1AdminStore(database).getSongRequests();
  assert.deepEqual(
    result.rows.map((row) => row.song),
    ["song", "Song", "Song"],
  );
  assert.deepEqual(
    result.rows.map((row) => row.no),
    [3, 2, 1],
  );
  assert.deepEqual(
    result.rows.map((row) => row.requestCount),
    [2, 2, 1],
  );
  assert.equal(result.requests, 3);
  assert.equal(result.songs, 2);
  database.close();
});

test("admin CSV builders set deterministic Manila headers and error responses", async () => {
  const now = new Date("2026-11-21T17:30:00Z");
  const store = createFakeAdminStore();
  const slipper = await buildSlipperCsv(store, now);
  const slipperText = await slipper.text();
  assert.equal(slipper.status, 200);
  assert.equal(slipper.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(
    slipper.headers.get("Content-Disposition") ?? "",
    /slipper-order-2026-11-22\.csv/,
  );
  assert.equal(slipper.headers.get("Cache-Control"), "private, no-store");
  assert.match(
    slipperText,
    /Women's total,\d+\r\nMen's total,\d+\r\nTotal pairs,\d+/,
  );
  assert.match(slipperText, /No size yet,/);
  assert.equal(slipperText.split("\r\n").length, 34);
  const songs = await buildSongCsv(store, now);
  const songText = await songs.text();
  assert.equal(songs.status, 200);
  assert.match(
    songs.headers.get("Content-Disposition") ?? "",
    /song-requests-2026-11-22\.csv/,
  );
  assert.match(
    songText,
    /No\.,Song,Artist,Requested by,Dedication,Sent,Times requested/,
  );
  assert.match(songText, /2026-11-18 09:00/);
  const failing = {
    ...store,
    getSlipperOrder: async () => {
      throw new Error("db");
    },
    getSongRequests: async () => {
      throw new Error("db");
    },
  } as AdminStore;
  const failedSlipper = await buildSlipperCsv(failing, now);
  const failedSongs = await buildSongCsv(failing, now);
  assert.equal(failedSlipper.status, 503);
  assert.equal(failedSlipper.headers.get("Cache-Control"), "private, no-store");
  assert.equal(failedSongs.status, 503);
  assert.equal(
    failedSongs.headers.get("Content-Type"),
    "text/plain; charset=utf-8",
  );
});

test("DJ text groups duplicates without leaking host-only fields", () => {
  const text = djText([
    {
      song: "Later",
      artist: null,
      requestCount: 1,
      createdAt: "2026-11-02T00:00:00Z",
    },
    {
      song: "September",
      artist: "Earth Wind & Fire",
      requestCount: 2,
      createdAt: "2026-11-03T00:00:00Z",
    },
    {
      song: "september!",
      artist: "earth wind fire",
      requestCount: 2,
      createdAt: "2026-11-01T00:00:00Z",
    },
  ]);
  assert.equal(
    text,
    "Warren & Eunice · song requests (2 songs, 3 requests)\n\n1. september! · earth wind fire (× 2)\n2. Later",
  );
  assert.doesNotMatch(text, /dedication|guest/i);
});

test("CSV protects formulas and emits BOM, quoting, and CRLF", () => {
  assert.equal(
    csv([["value", "a,b", 'say "hi"', "line\nnext", "=SUM(A1)"]]),
    '\uFEFFvalue,"a,b","say ""hi""","line\nnext",\'=SUM(A1)\r\n',
  );
  for (const prefix of ["=", "+", "-", "@", "\t", "\r"])
    assert.match(
      csv([[prefix + "x"]]),
      new RegExp(`'${prefix.replace(/[+\\-]/g, "\\$&")}`),
    );
});

test("fake admin store provides full slipper sizes, counts, songs, and nav counts", async () => {
  const store = createFakeAdminStore();
  const slippers = await store.getSlipperOrder();
  assert.equal(
    slippers.women.length + slippers.men.length,
    SLIPPER_SIZES.length,
  );
  assert.ok(slippers.women.some((row) => row.count === 0));
  assert.ok(
    slippers.womenTotal > 0 && slippers.menTotal > 0 && slippers.missing > 0,
  );
  assert.equal(
    (await store.getGuestList()).rows.some(
      (row) => "attending" in row.seats[0],
    ),
    false,
  );
  const songs = await store.getSongRequests();
  assert.equal(songs.requests, 8);
  assert.equal(songs.rows.filter((row) => row.requestCount === 2).length, 2);
  // Newest first, like D1: numbers run down from the newest request.
  assert.deepEqual(
    songs.rows.map((row) => row.no),
    [8, 7, 6, 5, 4, 3, 2, 1],
  );
  assert.deepEqual(await store.getNavCounts(), {
    households: 8,
    slipperPairs: slippers.pairs,
    songRequests: 8,
  });
});
