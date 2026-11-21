import { env } from "cloudflare:workers";
import { selectAdminStore } from "@/lib/admin/store";
import { rsvpCsv } from "@/lib/admin/csv";
export const prerender = false;
export async function GET() {
  try {
    const list = await selectAdminStore(
      (env as Record<string, unknown>).RSVP_STORE,
      (env as Record<string, unknown>).DB as never,
    ).getRsvpList();
    const { body, date } = rsvpCsv(list);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rsvps-${date}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Couldn’t load RSVP data", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  }
}
