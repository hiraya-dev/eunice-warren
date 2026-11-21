import { env } from "cloudflare:workers";
import { selectAdminStore } from "@/lib/admin/store";
import { rsvpCsvResponse } from "@/lib/admin/csv";
export const prerender = false;
export async function GET() {
  return rsvpCsvResponse(() =>
    selectAdminStore(
      (env as Record<string, unknown>).RSVP_STORE,
      (env as Record<string, unknown>).DB as never,
    ),
  );
}
