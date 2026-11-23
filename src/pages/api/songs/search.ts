import { env } from "cloudflare:workers";
import { isWithinRateLimit } from "@/lib/rsvp/logic";
import type { RateLimiter } from "@/lib/rsvp/logic";
import { searchSpotifyTracks, validSongSearchQuery } from "@/lib/songs/spotify";

export const prerender = false;
const empty = (status = 200) => Response.json({ results: [] }, { status, headers: { "cache-control": "no-store" } });

export async function GET({ request }: { request: Request }) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!validSongSearchQuery(query)) return empty(400);
  try {
    const envRecord = env as unknown as Record<string, unknown>;
    if (!(await isWithinRateLimit(envRecord.SONG_SEARCH_LIMITER as RateLimiter | undefined, request.headers.get("cf-connecting-ip") ?? "unknown"))) return empty(429);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const results = await searchSpotifyTracks(query, {
        clientId: typeof envRecord.SPOTIFY_CLIENT_ID === "string" ? envRecord.SPOTIFY_CLIENT_ID : undefined,
        clientSecret: typeof envRecord.SPOTIFY_CLIENT_SECRET === "string" ? envRecord.SPOTIFY_CLIENT_SECRET : undefined,
        storeName: typeof envRecord.RSVP_STORE === "string" ? envRecord.RSVP_STORE : undefined,
        signal: controller.signal,
      });
      return Response.json({ results }, { headers: { "cache-control": "no-store" } });
    } finally { clearTimeout(timeout); }
  } catch { return empty(); }
}
