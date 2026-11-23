import { isWithinRateLimit } from "../rsvp/logic.ts";
import type { RateLimiter } from "../rsvp/logic.ts";
import { searchSpotifyTracks, validSongSearchQuery } from "./spotify.ts";

export interface SongSearchEnvironment {
  SONG_SEARCH_LIMITER?: RateLimiter;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  RSVP_STORE?: string;
}

const empty = (status = 200) =>
  Response.json({ results: [] }, { status, headers: { "cache-control": "no-store" } });

export async function handleSongSearch(
  request: Request,
  environment: SongSearchEnvironment,
  requestFetch: typeof fetch = fetch,
) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!validSongSearchQuery(query)) return empty(400);
  try {
    if (!(await isWithinRateLimit(environment.SONG_SEARCH_LIMITER, request.headers.get("cf-connecting-ip") ?? "unknown"))) return empty(429);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const results = await searchSpotifyTracks(query, {
        clientId: environment.SPOTIFY_CLIENT_ID,
        clientSecret: environment.SPOTIFY_CLIENT_SECRET,
        storeName: environment.RSVP_STORE,
        requestFetch,
        signal: controller.signal,
      });
      return Response.json({ results }, { headers: { "cache-control": "no-store" } });
    } finally { clearTimeout(timeout); }
  } catch {
    return empty();
  }
}
