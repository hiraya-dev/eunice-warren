import { env } from "cloudflare:workers";
import { buildSongCsv } from "@/lib/admin/csv";
import { selectAdminStore } from "@/lib/admin/store";
export const prerender = false;
export async function GET() {
  return buildSongCsv(
    selectAdminStore(
      (env as Record<string, unknown>).RSVP_STORE,
      (env as Record<string, unknown>).DB as never,
    ),
  );
}
