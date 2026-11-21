import { csv, manilaDateTime, manilaParts } from "./presentation.ts";
import type { AdminStore } from "./store.ts";
import { SLIPPER_SIZES } from "../rsvp/slippers.ts";

const filenameDate = (now: Date) => {
  const { year, month, day } = manilaParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const headers = (filename: string) => ({
  "Content-Type": "text/csv; charset=utf-8",
  "Content-Disposition": `attachment; filename="${filename}"`,
  "Cache-Control": "private, no-store",
});
const error = (message: string) =>
  new Response(message, {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });

export async function buildSlipperCsv(store: AdminStore, now = new Date()) {
  try {
    const data = await store.getSlipperOrder();
    const counts = new Map(
      [...data.women, ...data.men].map((row) => [row.size, row.count]),
    );
    const rows: unknown[][] = [
      ["Size", "Pairs"],
      ...SLIPPER_SIZES.map((size) => [size, counts.get(size) ?? 0]),
      ["Women's total", data.womenTotal],
      ["Men's total", data.menTotal],
      ["Total pairs", data.pairs],
    ];
    if (data.missing > 0) rows.push(["No size yet", data.missing]);
    return new Response(csv(rows), {
      headers: headers(`slipper-order-${filenameDate(now)}.csv`),
    });
  } catch {
    return error("Couldn't load the slipper order");
  }
}

export async function buildSongCsv(store: AdminStore, now = new Date()) {
  try {
    const data = await store.getSongRequests();
    const rows: unknown[][] = [
      [
        "No.",
        "Song",
        "Artist",
        "Requested by",
        "Dedication",
        "Sent",
        "Times requested",
      ],
      ...data.rows.map((row) => [
        row.no,
        row.song,
        row.artist ?? "",
        row.name,
        row.dedication ?? "",
        manilaDateTime(row.createdAt),
        row.requestCount,
      ]),
    ];
    return new Response(csv(rows), {
      headers: headers(`song-requests-${filenameDate(now)}.csv`),
    });
  } catch {
    return error("Couldn't load the song requests");
  }
}
