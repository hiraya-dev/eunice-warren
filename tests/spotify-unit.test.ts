import assert from "node:assert/strict";
import test from "node:test";
import { fakeSongSearch, fakeSongSuggestions } from "../src/lib/songs/fake.ts";
import { clearSpotifyToken, searchSpotifyTracks, validSongSearchQuery } from "../src/lib/songs/spotify.ts";
import { handleSongSearch } from "../src/lib/songs/search.ts";

const searchRequest = (query: string) => new Request(`https://example.test/api/songs/search?q=${encodeURIComponent(query)}`);

const response = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

test("fake suggestions are local, filtered, capped, and include sample tracks", async () => {
  let calls = 0;
  const results = await searchSpotifyTracks("danc", { storeName: "fake", requestFetch: async () => { calls += 1; return response({}); } });
  assert.equal(calls, 0);
  assert.equal(results.length, 2);
  assert.ok(fakeSongSuggestions.some((song) => song.artist.includes(", ")));
  assert.deepEqual(fakeSongSearch("DANCING").map((song) => song.title), ["Dancing Queen", "Dancing in the Moonlight"]);
});

test("song search query validation enforces the route bounds", () => {
  assert.equal(validSongSearchQuery("d"), false);
  assert.equal(validSongSearchQuery("a".repeat(101)), false);
  assert.equal(validSongSearchQuery("da"), true);
});

test("song search route rejects queries outside its bounds", async () => {
  const one = await handleSongSearch(searchRequest("d"), {});
  const long = await handleSongSearch(searchRequest("a".repeat(101)), {});
  assert.equal(one.status, 400);
  assert.deepEqual(await one.json(), { results: [] });
  assert.equal(long.status, 400);
  assert.deepEqual(await long.json(), { results: [] });
  assert.equal(one.headers.get("cache-control"), "no-store");
  assert.equal(long.headers.get("cache-control"), "no-store");
});

test("song search route returns 429 when its limiter rejects", async () => {
  let calls = 0;
  const result = await handleSongSearch(searchRequest("danc"), {
    SONG_SEARCH_LIMITER: { limit: async () => { calls += 1; return { success: false }; } },
  }, async () => { throw new Error("fetch should not run"); });
  assert.equal(calls, 1);
  assert.equal(result.status, 429);
  assert.deepEqual(await result.json(), { results: [] });
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("song search route handles missing secrets without fetching", async () => {
  let calls = 0;
  const result = await handleSongSearch(searchRequest("danc"), {}, async () => { calls += 1; throw new Error("fetch should not run"); });
  assert.equal(calls, 0);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { results: [] });
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("song search route uses canned fake results without fetching", async () => {
  let calls = 0;
  const result = await handleSongSearch(searchRequest("danc"), { RSVP_STORE: "fake" }, async () => { calls += 1; throw new Error("fetch should not run"); });
  assert.equal(calls, 0);
  assert.equal(result.status, 200);
  assert.equal((await result.json() as { results: unknown[] }).results.length, 2);
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("Spotify search returns empty without secrets and never fetches", async () => {
  let calls = 0;
  assert.deepEqual(await searchSpotifyTracks("danc", { requestFetch: async () => { calls += 1; throw new Error("fetch should not run"); } }), []);
  assert.equal(calls, 0);
});

test("Spotify token is cached and tracks are mapped and capped", async () => {
  clearSpotifyToken();
  let tokens = 0;
  let searches = 0;
  const requestFetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/api/token")) { tokens += 1; return response({ access_token: "token", expires_in: 3600 }); }
    searches += 1;
    return response({ tracks: { items: Array.from({ length: 6 }, (_, index) => ({ id: `id-${index}`, name: "Title", artists: [{ name: "A" }, { name: "B" }], album: { name: "Album", images: [{ url: "small", width: 32 }, { url: "right", width: 64 }, { url: "large", width: 300 }] } })) } });
  };
  const first = await searchSpotifyTracks("title", { clientId: "id", clientSecret: "secret", requestFetch });
  const second = await searchSpotifyTracks("title", { clientId: "id", clientSecret: "secret", requestFetch });
  assert.equal(tokens, 1); assert.equal(searches, 2); assert.equal(first.length, 5); assert.deepEqual(first[0], { id: "id-0", title: "Title", artist: "A, B", album: "Album", cover: "right" }); assert.equal(second.length, 5);
});

test("Spotify retries once after a 401 and returns empty on errors", async () => {
  clearSpotifyToken(); let calls = 0;
  const requestFetch = async (url: string | URL | Request) => String(url).includes("/api/token") ? response({ access_token: `token-${calls++}`, expires_in: 3600 }) : response({}, { status: calls === 1 ? 401 : 500 });
  assert.deepEqual(await searchSpotifyTracks("title", { clientId: "id", clientSecret: "secret", requestFetch }), []);
});
