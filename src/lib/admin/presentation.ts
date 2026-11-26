import { displaySurname, duplicateNameKey } from "./names.ts";

const manila = "Asia/Manila";
const RSVP_DEADLINE = "2026-12-14T23:59:59+08:00";
const RSVP_DEADLINE_LABEL = "December 14";
export function manilaParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: manila,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(
    parts
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
}
export function greeting(now = new Date(), firstName = "") {
  const hour = manilaParts(now).hour;
  return `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${firstName}`;
}
export function dateLine(now = new Date()) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: manila,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(now) + " · Manila time"
  );
}
export function deadlineStamp(now = new Date()) {
  const current = manilaParts(now);
  const deadline = manilaParts(new Date(RSVP_DEADLINE));
  const today = Date.UTC(current.year, current.month - 1, current.day);
  const target = Date.UTC(deadline.year, deadline.month - 1, deadline.day);
  const days = Math.ceil((target - today) / 86400000);
  return days < 0
    ? { closed: true, text: `Closed · ${RSVP_DEADLINE_LABEL} · 11:59 PM` }
    : {
        closed: false,
        text: `${days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`} to RSVP deadline · Dec 14`,
      };
}
export function relativeTime(value: string, now = new Date()) {
  const then = new Date(value).getTime();
  const diff = Math.max(0, now.getTime() - then);
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours || 1}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: manila,
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
export function songKey(song: string, artist: string | null | undefined) {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  return `${normalize(song)}\u0000${artist?.trim() ? normalize(artist) : ""}`;
}
export function spotifyTrackUrl(trackId: string | null | undefined) {
  return trackId ? `https://open.spotify.com/track/${trackId}` : null;
}
export function mostCommonCaption(size: string | null, count: number) {
  return size
    ? `Most common · ${size} (${count} ${count === 1 ? "pair" : "pairs"})`
    : "No sizes yet";
}
export function pairsCaption(missing: number) {
  return `One per attending guest · grows as RSVPs come in${missing > 0 ? ` · ${missing} coming without a size yet` : ""}`;
}
export function songsEyebrow(requests: number, songs: number) {
  return `For the DJ · ${requests} ${requests === 1 ? "request" : "requests"}, ${songs} ${songs === 1 ? "song" : "songs"}`;
}
export function copiedLabel(songs: number) {
  return `Copied ${songs} song${songs === 1 ? "" : "s"}`;
}
export function duplicateLabel(requestCount: number) {
  return requestCount > 1 ? `× ${requestCount} requests` : "";
}
export function djText(
  rows: Array<{
    song: string;
    artist: string | null;
    requestCount: number;
    createdAt: string;
  }>,
) {
  const groups = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = songKey(row.song, row.artist);
    const current = groups.get(key);
    if (
      !current ||
      new Date(row.createdAt).getTime() < new Date(current.createdAt).getTime()
    )
      groups.set(key, row);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      b.requestCount - a.requestCount ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return [
    `Warren & Eunice · song requests (${ordered.length} ${ordered.length === 1 ? "song" : "songs"}, ${rows.length} ${rows.length === 1 ? "request" : "requests"})`,
    "",
    ...ordered.map(
      (row, index) =>
        `${index + 1}. ${row.song}${row.artist?.trim() ? ` · ${row.artist}` : ""}${row.requestCount > 1 ? ` (× ${row.requestCount})` : ""}`,
    ),
  ].join("\n");
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function csv(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
export function manilaDateTime(value: string) {
  const parts = manilaParts(new Date(value));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute ?? 0).padStart(2, "0")}`;
}
export function memberLine(names: string[]) {
  if (!names.length) return "";
  const groups = new Map<string, { surname: string; given: string[] }>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name.includes(" ")) {
      const key = duplicateNameKey(name);
      const group = groups.get(key) ?? { surname: "", given: [] };
      group.given.push(name);
      groups.set(key, group);
      continue;
    }
    const surname = displaySurname(name);
    const key = duplicateNameKey(surname);
    const group = groups.get(key) ?? { surname, given: [] };
    group.given.push(
      surname ? name.slice(0, name.length - surname.length).trim() : name,
    );
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ surname, given }) => {
      if (!surname || given.some((value) => !value)) return given.join(" & ");
      const lead =
        given.length > 1
          ? `${given.slice(0, -1).join(", ")} & ${given.at(-1)}`
          : given[0];
      return `${lead} ${surname}`;
    })
    .join(", ");
}

export interface PlusOnePresentation {
  state: "open" | "named" | "freed";
  name: string | null;
  namedBy: string | null;
  namedByKind: "guest" | "host" | null;
}

export function plusOneChipText(
  seat: PlusOnePresentation,
  hosts: Record<string, string> = {},
) {
  if (seat.state === "open") return "+1 · no name yet";
  if (seat.state === "freed") return "coming alone, seat freed";
  const namedBy =
    seat.namedByKind === "host" && seat.namedBy
      ? (hosts[seat.namedBy.toLowerCase()] ?? seat.namedBy)
      : (seat.namedBy ?? "a host");
  return `${seat.name ?? "Unnamed guest"} · +1, named by ${namedBy}`;
}

export function renameNote(
  name: string,
  invitedName: string,
  namedBy: string | null,
  namedAt: string | null,
  hosts: Record<string, string> = {},
) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  const editor =
    namedBy && hosts[namedBy.toLowerCase()]
      ? hosts[namedBy.toLowerCase()]
      : (namedBy ?? "a host");
  const date = namedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: manila,
        month: "short",
        day: "numeric",
      }).format(new Date(namedAt))
    : "unknown date";
  return `${first} invited as ${invitedName}, renamed by ${editor} · ${date}`;
}

export function adminTimestamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: manila,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function replyCountText(count: number) {
  return count === 1 ? "once" : count === 2 ? "twice" : `${count} times`;
}

export function rowSlippersText(row: {
  state: string;
  slippers: Array<{ firstName: string; size: string | null }>;
}) {
  if (row.state === "declined") return "None";
  return row.slippers
    .map((seat) => `${seat.firstName} ${seat.size ?? "—"}`)
    .join(" · ");
}

export function seatSubline(
  seat: {
    kind: "member" | "plus_one";
    invitedName: string | null;
    name: string | null;
    namedBy: string | null;
    namedByKind: "guest" | "host" | null;
    state?: "open" | "named" | "freed";
  },
  hosts: Record<string, string> = {},
) {
  if (seat.kind === "plus_one") {
    if (seat.state === "open" || !seat.name) return "+1 · no name yet";
    if (seat.state === "freed") return "coming alone, seat freed";
    const by =
      seat.namedByKind === "host" && seat.namedBy
        ? (hosts[seat.namedBy.toLowerCase()] ?? seat.namedBy)
        : (seat.namedBy ?? "a host");
    return `+1, named by ${by}`;
  }
  return seat.name !== seat.invitedName
    ? `Invited as ${seat.invitedName} · renamed`
    : `Invited as ${seat.invitedName} · lead`;
}

export function adminHistoryHeading(version: {
  submittedAt: string;
  attending: boolean;
  coming: number;
}) {
  return `${adminTimestamp(version.submittedAt)} · ${version.attending ? `Yes, ${version.coming} coming` : "No"}`;
}

export function rsvpChangeSummary(
  current: {
    attending: boolean;
    source?: "guest" | "host";
    editedBy?: string | null;
    respondentName?: string;
    note?: string | null;
    seats: Array<{
      seatId: number;
      name: string;
      attending: boolean;
      slipperSize: string | null;
      namedBy?: string | null;
      namedByKind?: "guest" | "host" | null;
    }>;
  },
  previous?: {
    attending: boolean;
    seats: Array<{
      seatId: number;
      name: string;
      attending: boolean;
      slipperSize: string | null;
    }>;
  },
  hosts: Record<string, string> = {},
) {
  if (!previous)
    return current.seats
      .filter((seat) => seat.attending && seat.name)
      .map((seat) => seat.name);
  const changes: string[] = [];
  if (current.attending !== previous.attending)
    changes.push(
      current.attending
        ? "Changed from decline to attending"
        : "Changed from attending to decline",
    );
  current.seats.forEach((seat) => {
    const before = previous.seats.find(
      (candidate) => candidate.seatId === seat.seatId,
    );
    if (!before) return;
    if (seat.name !== before.name && seat.name) {
      const by =
        current.source === "host" && current.editedBy
          ? (hosts[current.editedBy.toLowerCase()] ?? current.editedBy)
          : current.source === "guest" && current.respondentName
            ? current.respondentName
            : seat.namedByKind === "host" && seat.namedBy
              ? (hosts[seat.namedBy.toLowerCase()] ??
                seat.namedBy.split("@")[0])
              : seat.namedByKind === "guest"
                ? (seat.namedBy ?? "guest")
                : null;
      changes.push(
        `${before.name || "(plus-one)"} → ${seat.name}${by ? `, renamed by ${by}` : ""}`,
      );
    }
    if (seat.attending !== before.attending)
      changes.push(
        `${seat.name || "(plus-one)"} ${seat.attending ? "started" : "stopped"} coming`,
      );
    if (seat.slipperSize !== before.slipperSize)
      changes.push(
        `${seat.name || "(plus-one)"} ${before.slipperSize ?? "—"} → ${seat.slipperSize ?? "—"}`,
      );
  });
  return changes;
}

export function rsvpHistoryBody(
  current: Parameters<typeof rsvpChangeSummary>[0],
  previous?: Parameters<typeof rsvpChangeSummary>[1],
  hosts: Record<string, string> = {},
) {
  const summary = rsvpChangeSummary(current, previous, hosts);
  if (summary.length) return summary.join(previous ? ". " : ", ");
  if (!previous && !current.attending) return "Not coming";
  if (current.note) return `“${current.note}”`;
  return current.attending ? "No changes" : "Not coming";
}
