import { env } from "cloudflare:workers";
import { handleSongSearch } from "@/lib/songs/search";
import type { RateLimiter } from "@/lib/rsvp/logic";

export const prerender = false;
export async function GET({ request }: { request: Request }) {
  const envRecord = env as unknown as Record<string, unknown>;
  return handleSongSearch(request, {
    SONG_SEARCH_LIMITER: envRecord.SONG_SEARCH_LIMITER as RateLimiter | undefined,
    SPOTIFY_CLIENT_ID: typeof envRecord.SPOTIFY_CLIENT_ID === "string" ? envRecord.SPOTIFY_CLIENT_ID : undefined,
    SPOTIFY_CLIENT_SECRET: typeof envRecord.SPOTIFY_CLIENT_SECRET === "string" ? envRecord.SPOTIFY_CLIENT_SECRET : undefined,
    RSVP_STORE: typeof envRecord.RSVP_STORE === "string" ? envRecord.RSVP_STORE : undefined,
  });
}
