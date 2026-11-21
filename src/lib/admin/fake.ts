import type {
  AdminGuestList,
  AdminHousehold,
  AdminOverview,
  AdminRsvpDetail,
  AdminRsvpList,
  AdminRsvpRow,
  AdminRsvpVersion,
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
    displayName: "The Ramos Family",
    notes: null,
    seats: [
      seat(1, "Bea Ramos", "Paolo Ramos", "member", {
        namedBy: "Liza",
        namedByKind: "guest",
        namedAt: "2026-11-14T13:00:00+08:00",
      }),
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
const fakeReplyMeta: Record<
  string,
  {
    email: string;
    respondentName: string;
    submittedAt: string;
    note: string | null;
    versions?: number;
    hostEdit?: boolean;
  }
> = {
  "hh-dela-cruz": {
    email: "maria@example.com",
    respondentName: "Maria Dela Cruz",
    submittedAt: "2026-11-15T13:00:00+08:00",
    note: "Beach transfer",
  },
  "hh-villanueva": {
    email: "ana@example.com",
    respondentName: "Ana Villanueva",
    submittedAt: "2026-11-17T13:00:00+08:00",
    note: "Three seats confirmed",
  },
  "hh-lim": {
    email: "kat@example.com",
    respondentName: "Kat Lim",
    submittedAt: "2026-11-18T13:00:00+08:00",
    note: null,
    versions: 2,
    hostEdit: true,
  },
  "hh-pena": {
    email: "sofia@example.com",
    respondentName: "Sofía Peña",
    submittedAt: "2026-11-16T13:00:00+08:00",
    note: "Sadly we cannot make it",
  },
  "hh-tan": {
    email: "liza@example.com",
    respondentName: "Liza Ramos",
    submittedAt: "2026-11-14T13:00:00+08:00",
    note: null,
    versions: 2,
  },
};
const fakeHistory = (row: AdminHousehold): AdminRsvpVersion[] => {
  const meta = fakeReplyMeta[row.id];
  if (!meta) return [];
  const attending = row.rsvp.state === "coming";
  const coming = row.rsvp.state === "coming" ? row.rsvp.coming : 0;
  const sizes: Record<string, string | null> = {
    "hh-dela-cruz": "W 7",
    "hh-villanueva": null,
    "hh-lim": "W 8",
    "hh-pena": null,
    "hh-tan": null,
  };
  const seats = row.seats.map((s, i) => ({
    seatId: s.slot,
    name: s.name ?? "",
    attending:
      attending &&
      (row.id === "hh-villanueva"
        ? i < 3
        : row.id === "hh-tan"
          ? i === 0
          : true),
    slipperSize: s.kind === "member" ? (sizes[row.id] ?? null) : null,
  }));
  const latest: AdminRsvpVersion = {
    id: meta.versions ? 20 : 10,
    submittedAt: meta.submittedAt,
    attending,
    coming,
    source: meta.hostEdit ? "host" : "guest",
    editedBy: meta.hostEdit ? "host@example.com" : null,
    note: meta.note,
    seats,
  };
  if (!meta.versions) return [latest];
  return [
    latest,
    {
      ...latest,
      id: 19,
      submittedAt: "2026-11-13T13:00:00+08:00",
      source: "guest",
      editedBy: null,
      seats: seats.map((s, i) =>
        row.id === "hh-tan" && i === 0
          ? { ...s, name: "Paolo Ramos" }
          : row.id === "hh-lim" && i === 1
            ? { ...s, name: row.seats[i]?.invitedName ?? s.name }
            : s,
      ),
    },
  ];
};
const makeFakeRsvpRow = (row: AdminHousehold): AdminRsvpRow => {
  const meta = fakeReplyMeta[row.id];
  const history = fakeHistory(row);
  const current = history[0];
  const seatChanges = row.seats
    .filter(
      (s) =>
        (s.name && s.invitedName && s.name !== s.invitedName) ||
        (s.kind === "plus_one" && s.name && !s.invitedName),
    )
    .map((s) => ({ from: s.invitedName, to: s.name! }));
  const seats = row.seats.map((s, i) => ({
    ...s,
    coming: Boolean(
      current?.attending &&
      (current.seats[i]?.attending ?? s.kind === "member"),
    ),
    slipperSize: current?.seats[i]?.slipperSize ?? null,
  }));
  return {
    id: row.id,
    label: row.label,
    displayName: row.displayName,
    state:
      row.rsvp.state === "coming"
        ? "attending"
        : row.rsvp.state === "declined"
          ? "declined"
          : "waiting",
    email: meta?.email ?? null,
    respondentName: meta?.respondentName ?? null,
    submittedAt: meta?.submittedAt ?? null,
    note: meta?.note ?? null,
    versionCount: meta ? history.length : null,
    seatCount: row.seatCount,
    comingNames: seats.filter((s) => s.coming && s.name).map((s) => s.name!),
    notComingNames:
      row.rsvp.state === "coming"
        ? seats.filter((s) => !s.coming && s.name).map((s) => s.name!)
        : [],
    seatChanges,
    slippers: seats
      .filter((s) => s.coming && s.name)
      .map((s) => ({
        firstName: s.name!.split(/\s+/)[0]!,
        size: s.slipperSize,
      })),
    seatChange: seatChanges.length > 0,
    seats,
  };
};
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
    async getRsvpList(): Promise<AdminRsvpList> {
      const rows = fakeAdminFixtures
        .map(makeFakeRsvpRow)
        .sort(
          (a, b) =>
            (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "") ||
            a.displayName.localeCompare(b.displayName),
        );
      const replied = rows.filter((r) => r.state !== "waiting");
      return {
        totals: {
          all: replied.length,
          attending: rows.filter((r) => r.state === "attending").length,
          declined: rows.filter((r) => r.state === "declined").length,
          seatChanges: replied.filter((r) => r.seatChange).length,
          waiting: rows.filter((r) => r.state === "waiting").length,
        },
        rows,
      };
    },
    async getRsvpDetail(householdId: string): Promise<AdminRsvpDetail | null> {
      const row = fakeAdminFixtures.find(
        (fixture) => fixture.id === householdId,
      );
      if (!row) return null;
      const view = makeFakeRsvpRow(row);
      return {
        ...view,
        email: view.email,
        respondentName: view.respondentName,
        submittedAt: view.submittedAt,
        versionCount: view.versionCount ?? 0,
        history: fakeHistory(row),
      };
    },
  };
}
