import type {
  AdminGuestList,
  AdminHousehold,
  AdminOverview,
  AdminStore,
} from "./store";

const seat = (
  slot: number,
  name: string | null,
  invitedName: string | null,
  kind: "member" | "plus_one" = "member",
  extra: Record<string, unknown> = {},
) => ({
  slot,
  kind,
  name,
  invitedName,
  namedBy: null,
  namedByKind: null,
  namedAt: null,
  ...extra,
});
export const fakeAdminFixtures: AdminHousehold[] = [
  {
    id: "hh-dela-cruz",
    label: "DC-01",
    displayName: "The Dela Cruz Family",
    notes: "Beach transfer",
    seats: [
      seat(1, "Maria Dela Cruz", "Maria Dela Cruz"),
      seat(2, "Jose Dela Cruz", "Jose Dela Cruz"),
      seat(3, "Anna Dela Cruz", "Ana Dela Cruz", "member", {
        namedBy: "Maria",
        namedByKind: "guest",
        namedAt: "2026-11-12T09:00:00+08:00",
      }),
      seat(4, "Miguel Dela Cruz", "Miguel Dela Cruz"),
    ],
    seatCount: 4,
    rsvp: { state: "coming", coming: 4 },
  },
  {
    id: "hh-santos",
    label: "SA-02",
    displayName: "The Santos Family",
    notes: null,
    seats: [1, 2, 3, 4, 5].map((slot) =>
      seat(slot, `Santos Guest ${slot}`, `Santos Guest ${slot}`),
    ),
    seatCount: 5,
    rsvp: { state: "waiting" },
  },
  {
    id: "hh-mendoza",
    label: "CM-03",
    displayName: "Carlo Mendoza",
    notes: null,
    seats: [
      seat(1, "Carlo Mendoza", "Carlo Mendoza"),
      seat(2, null, null, "plus_one", { state: "open" }),
    ],
    seatCount: 2,
    rsvp: { state: "waiting" },
  },
  {
    id: "hh-pena",
    label: "SP-04",
    displayName: "Sofía Peña",
    notes: null,
    seats: [seat(1, "Sofía Peña", "Sofía Peña")],
    seatCount: 1,
    rsvp: { state: "declined" },
  },
  {
    id: "hh-villanueva",
    label: "VF-05",
    displayName: "The Villanueva Family",
    notes: "Three seats confirmed",
    seats: [1, 2, 3, 4, 5].map((slot) =>
      seat(slot, `Villanueva Guest ${slot}`, `Villanueva Guest ${slot}`),
    ),
    seatCount: 5,
    rsvp: { state: "coming", coming: 3 },
  },
  {
    id: "hh-reyes",
    label: "PR-06",
    displayName: "Paolo Reyes",
    notes: null,
    seats: [
      seat(1, "Paolo Reyes", "Paolo Reyes"),
      seat(2, null, null, "plus_one", { state: "open" }),
    ],
    seatCount: 2,
    rsvp: { state: "waiting" },
  },
  {
    id: "hh-lim",
    label: "KL-07",
    displayName: "Kat Lim",
    notes: null,
    seats: [
      seat(1, "Kat Lim", "Kat Lim"),
      seat(2, "Jonas Ong", null, "plus_one", {
        state: "named",
        namedBy: "Kat",
        namedByKind: "guest",
        namedAt: "2026-11-18T13:00:00+08:00",
      }),
    ],
    seatCount: 2,
    rsvp: { state: "coming", coming: 2 },
  },
  {
    id: "hh-tan",
    label: "MT-08",
    displayName: "Mica Tan",
    notes: null,
    seats: [
      seat(1, "Mica Tan", "Mica Tan"),
      seat(2, null, null, "plus_one", { state: "freed" }),
    ],
    seatCount: 2,
    rsvp: { state: "coming", coming: 1 },
  },
];
export const fakeAdminSongs = [
  { song: "Bloom", submittedAt: "2026-11-18T09:00:00+08:00" },
  { song: "Beyond", submittedAt: "2026-11-17T09:00:00+08:00" },
];
export const fakeAdminReplies = [
  {
    displayName: "Kat Lim",
    attending: true,
    coming: 2,
    seatCount: 2,
    submittedAt: "2026-11-18T13:00:00+08:00",
    namedPlusOnes: [{ name: "Jonas Ong", namedBy: "Kat" }],
  },
  {
    displayName: "The Villanueva Family",
    attending: true,
    coming: 3,
    seatCount: 5,
    submittedAt: "2026-11-17T13:00:00+08:00",
    namedPlusOnes: [],
  },
  {
    displayName: "Sofía Peña",
    attending: false,
    coming: 0,
    seatCount: 1,
    submittedAt: "2026-11-16T13:00:00+08:00",
    namedPlusOnes: [],
  },
  {
    displayName: "The Dela Cruz Family",
    attending: true,
    coming: 4,
    seatCount: 4,
    submittedAt: "2026-11-15T13:00:00+08:00",
    namedPlusOnes: [],
  },
];
export function createFakeAdminStore(): AdminStore {
  return {
    async getGuestList(): Promise<AdminGuestList> {
      return {
        totals: {
          households: fakeAdminFixtures.length,
          seatsOffered: fakeAdminFixtures.reduce(
            (sum, row) => sum + row.seatCount,
            0,
          ),
          // Seats, not households, and never a declined household's seat,
          // matching getUnnamedPlusOneCount on D1.
          unnamedPlusOnes: fakeAdminFixtures
            .filter((row) => row.rsvp.state !== "declined")
            .flatMap((row) => row.seats)
            .filter((s) => s.kind === "plus_one" && s.state === "open").length,
        },
        rows: fakeAdminFixtures,
      };
    },
    async getOverview(): Promise<AdminOverview> {
      const attending = fakeAdminFixtures.filter(
        (row) => row.rsvp.state === "coming",
      ).length;
      const declined = fakeAdminFixtures.filter(
        (row) => row.rsvp.state === "declined",
      ).length;
      const waiting = fakeAdminFixtures.filter(
        (row) => row.rsvp.state === "waiting",
      );
      return {
        seatsOffered: fakeAdminFixtures.reduce(
          (sum, row) => sum + row.seatCount,
          0,
        ),
        guestsComing: fakeAdminFixtures.reduce(
          (sum, row) =>
            sum + (row.rsvp.state === "coming" ? row.rsvp.coming : 0),
          0,
        ),
        households: {
          invited: fakeAdminFixtures.length,
          attending,
          declined,
          waiting: waiting.length,
        },
        repliedPercent: Math.round(
          ((fakeAdminFixtures.length - waiting.length) /
            fakeAdminFixtures.length) *
            100,
        ),
        songCount: fakeAdminSongs.length,
        latestReplies: fakeAdminReplies,
        waiting: {
          total: waiting.length,
          households: waiting.slice(0, 3).map((row) => ({
            displayName: row.displayName,
            seatCount: row.seatCount,
          })),
        },
      };
    },
  };
}
