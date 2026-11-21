const manila = "Asia/Manila";
const RSVP_DEADLINE = "2026-12-12T23:59:59+08:00";
const RSVP_DEADLINE_LABEL = "December 12";
export function manilaParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: manila,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hour12: false,
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
        text: `${days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`} to RSVP deadline · Dec 12`,
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
export function memberLine(names: string[]) {
  if (!names.length) return "";
  const words = names.map((name) => name.trim().split(/\s+/));
  const twoWordSurname =
    words[0].length > 2 ? words[0].slice(-2).join(" ") : "";
  const last =
    twoWordSurname &&
    words.every((name) => name.slice(-2).join(" ") === twoWordSurname)
      ? twoWordSurname
      : words[0].at(-1);
  const surnameWords = last?.split(" ").length ?? 0;
  if (
    last &&
    words.every((name) => name.slice(-surnameWords).join(" ") === last)
  ) {
    const firsts = words.map((name) => name.slice(0, -surnameWords).join(" "));
    return `${firsts.slice(0, -1).join(", ")}${firsts.length > 1 ? ` & ${firsts.at(-1)}` : firsts[0]} ${last}`;
  }
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`
    : names[0];
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
