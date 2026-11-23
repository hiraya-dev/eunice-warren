import { csv, manilaDateTime, manilaParts } from "./presentation.ts";
import type { AdminRsvpList, AdminStore } from "./store.ts";
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
        "Spotify link",
      ],
      ...data.rows.map((row) => [
        row.no,
        row.song,
        row.artist ?? "",
        row.name,
        row.dedication ?? "",
        manilaDateTime(row.createdAt),
        row.requestCount,
        row.spotifyTrackId ? `https://open.spotify.com/track/${row.spotifyTrackId}` : "",
      ]),
    ];
    return new Response(csv(rows), {
      headers: headers(`song-requests-${filenameDate(now)}.csv`),
    });
  } catch {
    return error("Couldn't load the song requests");
  }
}


const formula = /^[=+\-@\t\r]/;
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = formula.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function rsvpCsv(list: AdminRsvpList, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const manilaTime = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(new Date(value))
          .replace(", ", " ")
      : "";
  const lines = [
    "household_label,household,reply,email,sent_at_manila,versions,edited_by,slot,kind,invited_as,name,coming,slipper_size,note",
  ];
  for (const row of list.rows)
    for (const seat of row.seats)
      lines.push(
        [
          row.label,
          row.displayName,
          row.state === "attending"
            ? "yes"
            : row.state === "declined"
              ? "no"
              : "waiting",
          row.email,
          manilaTime(row.submittedAt),
          row.versionCount,
          row.editedBy,
          seat.slot,
          seat.kind,
          seat.invitedName,
          seat.name,
          row.state === "waiting" ? "" : seat.coming ? "yes" : "no",
          seat.slipperSize,
          row.note,
        ]
          .map(csvCell)
          .join(","),
      );
  return { body: `${lines.join("\r\n")}\r\n`, date };
}

export async function rsvpCsvResponse(
  storeLoader: () => AdminStore,
  now = new Date(),
) {
  try {
    const { body, date } = rsvpCsv(await storeLoader().getRsvpList(), now);
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
