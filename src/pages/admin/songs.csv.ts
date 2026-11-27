import { env } from "cloudflare:workers";
import { buildSongCsv } from "@/lib/admin/csv";
import { selectAdminStore } from "@/lib/admin/store";
import { parseFakeRemovedSongIds } from "@/lib/admin/song-cookie";
export const prerender = false;
export async function GET({ request }: { request: Request }) {
  const storeName = (env as Record<string, unknown>).RSVP_STORE;
  return buildSongCsv(
    selectAdminStore(
      storeName,
      (env as Record<string, unknown>).DB as never,
      { removedSongIds: storeName === "fake" ? parseFakeRemovedSongIds(request.headers.get("cookie")) : undefined },
    ),
  );
}
