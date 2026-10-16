export const RSVP_EVENT = {
  start: "2027-01-14T15:00:00+08:00",
  end: "2027-01-14T23:00:00+08:00",
  dateLabel: "14.01.27",
  vowsLabel: "15:00",
  dressLabel: "ISLAND",
  location: "White Beach, Boracay",
} as const;

const SEAT_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
];

export const seatWord = (value: number) =>
  SEAT_WORDS[Math.max(0, Math.min(12, Math.round(value)))] ?? "Twelve";
export const ticketNames = (matchedName: string, companionName?: string) =>
  companionName?.trim()
    ? `${matchedName.split(" ")[0]} & ${companionName.trim()}`
    : matchedName;
export const ticketReference = (inviteId: string) => inviteId.toUpperCase();
export const ticketFilename = (inviteId: string) =>
  `eunice-warren-ticket-${inviteId}.png`;

const icsDate = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

export const calendarIcs = () =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Eunice & Warren//Wedding//EN",
    "BEGIN:VEVENT",
    "UID:eunice-warren-wedding-20270114@eunice-warren",
    `DTSTAMP:${icsDate(RSVP_EVENT.start)}`,
    `DTSTART:${icsDate(RSVP_EVENT.start)}`,
    `DTEND:${icsDate(RSVP_EVENT.end)}`,
    "SUMMARY:Eunice & Warren's wedding",
    `LOCATION:${RSVP_EVENT.location}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
