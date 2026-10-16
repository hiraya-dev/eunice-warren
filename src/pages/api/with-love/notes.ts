import { env } from "cloudflare:workers";
import { getLoveStore, sortVisibleNotes } from "@/lib/with-love/store";

export const prerender = false;

export async function GET() {
  try {
    const notes = sortVisibleNotes(await getLoveStore(env as unknown as Record<string, unknown>).listNotes());
    return Response.json({ notes: notes.map((note) => ({
      id: note.id,
      name: note.name,
      city: note.city,
      message: note.message,
      photoUrl: `/api/with-love/photo/${encodeURIComponent(note.id)}`,
    })) }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    return Response.json({ notes: [] }, { status: 200, headers: { "Cache-Control": "public, max-age=60" } });
  }
}
