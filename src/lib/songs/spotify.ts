import { fakeSongSearch, type SongSuggestion } from "./fake.ts";

type FetchLike = typeof fetch;
type Token = { value: string; expiresAt: number };
let cachedToken: Token | undefined;
export const validSongSearchQuery = (query: string) => query.length >= 2 && query.length <= 100;

const mapTrack = (track: any): SongSuggestion => {
  const images = Array.isArray(track.album?.images) ? track.album.images.filter((image: any) => image?.url) : [];
  const sorted = [...images].sort((a: any, b: any) => (a.width ?? Number.MAX_SAFE_INTEGER) - (b.width ?? Number.MAX_SAFE_INTEGER));
  const preferred = images.filter((image: any) => Number(image.width) >= 64).sort((a: any, b: any) => a.width - b.width)[0] ?? sorted[0];
  return {
    id: String(track.id), title: String(track.name),
    artist: (track.artists ?? []).map((artist: any) => String(artist.name)).join(", "),
    album: String(track.album?.name ?? ""), cover: preferred?.url ? String(preferred.url) : null,
  };
};

async function token(clientId: string, clientSecret: string, requestFetch: FetchLike, signal?: AbortSignal) {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const response = await requestFetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal,
  });
  if (!response.ok) throw new Error("spotify token error");
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("spotify token missing");
  cachedToken = { value: data.access_token, expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 3600) * 1000 - 60_000) };
  return data.access_token;
}

export function clearSpotifyToken() { cachedToken = undefined; }

export async function searchSpotifyTracks(query: string, options: { clientId?: string; clientSecret?: string; requestFetch?: FetchLike; storeName?: string; signal?: AbortSignal } = {}): Promise<SongSuggestion[]> {
  if (options.storeName === "fake") return fakeSongSearch(query);
  if (!options.clientId || !options.clientSecret) return [];
  const requestFetch = options.requestFetch ?? fetch;
  const request = async (accessToken: string) => requestFetch(`https://api.spotify.com/v1/search?type=track&limit=5&market=PH&q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: options.signal });
  try {
    let accessToken = await token(options.clientId, options.clientSecret, requestFetch, options.signal);
    let response = await request(accessToken);
    if (response.status === 401) { clearSpotifyToken(); accessToken = await token(options.clientId, options.clientSecret, requestFetch, options.signal); response = await request(accessToken); }
    if (!response.ok) return [];
    const data = await response.json() as { tracks?: { items?: unknown[] } };
    return (data.tracks?.items ?? []).slice(0, 5).map(mapTrack);
  } catch { return []; }
}
