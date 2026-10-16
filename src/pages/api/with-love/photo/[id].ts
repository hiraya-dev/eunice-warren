import { env } from "cloudflare:workers";
import { getLoveStore } from "@/lib/with-love/store";

export const prerender = false;

export async function GET({ params, request }: { params: { id?: string }; request: Request }) {
  const id = params.id ?? "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return new Response("Not found", { status: 404 });
  try {
    const cache = (globalThis as typeof globalThis & { caches?: { default: Cache } }).caches?.default;
    const cacheKey = new Request(request.url, request);
    const cached = await cache?.match(cacheKey);
    if (cached) return cached;
    const photo = await getLoveStore(env as unknown as Record<string, unknown>).getPhoto(`notes/${id}.jpg`);
    if (!photo) return new Response("Not found", { status: 404 });
    const response = new Response(photo.buffer as ArrayBuffer, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
    if (cache) await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
