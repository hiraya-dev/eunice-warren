import type {
  AdminGuestList,
  AdminHousehold,
  AdminNavCounts,
  AdminOverview,
  AdminRsvpDetail,
  AdminRsvpList,
  AdminRsvpRow,
  AdminRsvpSeat,
  AdminRsvpVersion,
  AdminSlipperOrder,
  AdminSongRequests,
  AdminStore,
} from "./store";
import { SLIPPER_SIZES } from "../rsvp/slippers.ts";
import { songKey } from "./presentation.ts";

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
        namedBy: "Maria Dela Cruz",
        namedByKind: "guest",
        namedAt: "2026-11-15T13:00:00+08:00",
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
    seats: [
      seat(1, "Antonio Santos", "Antonio Santos"),
      seat(2, "Grace Santos", "Grace Santos"),
      seat(3, "Nico Santos", "Nico Santos"),
      seat(4, "Mara Santos", "Mara Santos"),
      seat(5, "Luis Santos", "Luis Santos"),
    ],
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
    rsvp: { state: "coming", coming: 1 },
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
    seats: [
      seat(1, "Rico Villanueva", "Rico Villanueva"),
      seat(2, "Joy Villanueva", "Joy Villanueva"),
      seat(3, "Pia Villanueva", "Pia Villanueva"),
      seat(4, "Lolo Ben Villanueva", "Lolo Ben Villanueva"),
      seat(5, "Lola Cora Villanueva", "Lola Cora Villanueva"),
    ],
    seatCount: 5,
    rsvp: { state: "coming", coming: 3 },
  },
  {
    id: "hh-merly-ben",
    label: "MB-06",
    displayName: "Tita Merly & Tito Ben",
    notes: null,
    seats: [
      seat(1, "Merly Reyes", "Merly Reyes"),
      seat(2, "Ben Reyes", "Ben Reyes"),
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
    id: "hh-ramos",
    label: "LR-08",
    displayName: "The Ramos Family",
    notes: null,
    seats: [
      seat(1, "Liza Ramos", "Liza Ramos"),
      seat(2, "Beatriz Ramos", "Paolo Ramos", "member", {
        namedBy: "eunice@example.com",
        namedByKind: "host",
        namedAt: "2026-11-21T10:30:00+08:00",
      }),
    ],
    seatCount: 2,
    rsvp: { state: "coming", coming: 2 },
  },
];
export const fakeAdminSongs = [
  {
    name: "Maria",
    song: "September",
    artist: "Earth, Wind & Fire",
    dedication: "For the dance floor",
    submittedAt: "2026-11-18T09:00:00+08:00",
  },
  {
    name: "Jose",
    song: "september!",
    artist: "earth wind fire",
    dedication: null,
    submittedAt: "2026-11-18T10:00:00+08:00",
  },
  {
    name: "Kat",
    song: "Buwan",
    artist: "Juan Karlos",
    dedication: null,
    submittedAt: "2026-11-17T09:00:00+08:00",
  },
  {
    name: "Anna",
    song: "Golden Hour",
    artist: null,
    dedication: "A song for everyone",
    submittedAt: "2026-11-16T09:00:00+08:00",
  },
  {
    name: "Miguel",
    song: "Bloom",
    artist: "The Paper Kites",
    dedication:
      "With love and joy for the happy couple and all the wonderful memories still to come at this beautiful celebration",
    submittedAt: "2026-11-15T09:00:00+08:00",
  },
  {
    name: "Mica",
    song: "Beyond",
    artist: null,
    dedication: "",
    submittedAt: "2026-11-14T09:00:00+08:00",
  },
  {
    name: "Paolo",
    song: "L-O-V-E",
    artist: "Nat King Cole",
    dedication: "",
    submittedAt: "2026-11-13T09:00:00+08:00",
  },
  {
    name: "Sofia",
    song: "Dreams",
    artist: "Fleetwood Mac",
    dedication: "Dance",
    submittedAt: "2026-11-12T09:00:00+08:00",
  },
];
export interface FakeAdminResponse {
  id: number;
  householdId: string;
  submittedAt: string;
  respondentName: string;
  attending: boolean;
  email: string;
  note: string | null;
  source: "guest" | "host";
  editedBy: string | null;
  seats: Array<{
    seatId: number;
    name: string;
    attending: boolean;
    slipperSize: string | null;
  }>;
}

export const fakeAdminResponses: FakeAdminResponse[] = [
  {
    id: 1,
    householdId: "hh-ramos",
    submittedAt: "2026-11-02T15:00:00+08:00",
    respondentName: "Liza Ramos",
    attending: true,
    email: "liza@example.com",
    note: null,
    source: "guest",
    editedBy: null,
    seats: [
      { seatId: 1, name: "Liza Ramos", attending: true, slipperSize: "W 8" },
      { seatId: 2, name: "Paolo Ramos", attending: true, slipperSize: "M 10" },
    ],
  },
  {
    id: 2,
    householdId: "hh-lim",
    submittedAt: "2026-11-10T13:00:00+08:00",
    respondentName: "Kat Lim",
    attending: true,
    email: "kat@example.com",
    note: null,
    source: "guest",
    editedBy: null,
    seats: [
      { seatId: 1, name: "Kat Lim", attending: true, slipperSize: "W 6" },
      { seatId: 2, name: "", attending: false, slipperSize: null },
    ],
  },
  {
    id: 3,
    householdId: "hh-dela-cruz",
    submittedAt: "2026-11-15T13:00:00+08:00",
    respondentName: "Maria Dela Cruz",
    attending: true,
    email: "maria@example.com",
    note: "Can't wait! Ana is bringing her ukulele.",
    source: "guest",
    editedBy: null,
    seats: [
      {
        seatId: 1,
        name: "Maria Dela Cruz",
        attending: true,
        slipperSize: "W 7",
      },
      {
        seatId: 2,
        name: "Jose Dela Cruz",
        attending: true,
        slipperSize: "M 9",
      },
      {
        seatId: 3,
        name: "Anna Dela Cruz",
        attending: true,
        slipperSize: "W 6",
      },
      {
        seatId: 4,
        name: "Miguel Dela Cruz",
        attending: true,
        slipperSize: "M 5",
      },
    ],
  },
  {
    id: 4,
    householdId: "hh-pena",
    submittedAt: "2026-11-16T13:00:00+08:00",
    respondentName: "Sofía Peña",
    attending: false,
    email: "sofia@example.com",
    note: "So sorry, I'm in Madrid that week. Sending all my love.",
    source: "guest",
    editedBy: null,
    seats: [
      { seatId: 1, name: "Sofía Peña", attending: false, slipperSize: null },
    ],
  },
  {
    id: 5,
    householdId: "hh-villanueva",
    submittedAt: "2026-11-17T13:00:00+08:00",
    respondentName: "Rico Villanueva",
    attending: true,
    email: "rico@example.com",
    note: null,
    source: "guest",
    editedBy: null,
    seats: [
      {
        seatId: 1,
        name: "Rico Villanueva",
        attending: true,
        slipperSize: "M 10",
      },
      {
        seatId: 2,
        name: "Joy Villanueva",
        attending: true,
        slipperSize: "W 7",
      },
      {
        seatId: 3,
        name: "Pia Villanueva",
        attending: true,
        slipperSize: "W 5",
      },
      {
        seatId: 4,
        name: "Lolo Ben Villanueva",
        attending: false,
        slipperSize: null,
      },
      {
        seatId: 5,
        name: "Lola Cora Villanueva",
        attending: false,
        slipperSize: null,
      },
    ],
  },
  {
    id: 6,
    householdId: "hh-lim",
    submittedAt: "2026-11-18T13:00:00+08:00",
    respondentName: "Kat Lim",
    attending: true,
    email: "kat@example.com",
    note: null,
    source: "guest",
    editedBy: null,
    seats: [
      { seatId: 1, name: "Kat Lim", attending: true, slipperSize: "W 6" },
      { seatId: 2, name: "Jonas Ong", attending: true, slipperSize: "M 11" },
    ],
  },
  {
    id: 7,
    householdId: "hh-mendoza",
    submittedAt: "2026-11-19T12:00:00+08:00",
    respondentName: "Carlo Mendoza",
    attending: true,
    email: "carlo@example.com",
    note: null,
    source: "guest",
    editedBy: null,
    seats: [],
  },
  {
    id: 8,
    householdId: "hh-ramos",
    submittedAt: "2026-11-20T18:00:00+08:00",
    respondentName: "Liza Ramos",
    attending: true,
    email: "liza@example.com",
    note: "Paolo has a work trip that week, so my sister Bea is coming in his place.",
    source: "guest",
    editedBy: null,
    seats: [
      { seatId: 1, name: "Liza Ramos", attending: true, slipperSize: "W 8" },
      { seatId: 2, name: "Bea Ramos", attending: true, slipperSize: "W 7" },
    ],
  },
  {
    id: 9,
    householdId: "hh-ramos",
    submittedAt: "2026-11-21T10:30:00+08:00",
    respondentName: "Liza Ramos",
    attending: true,
    email: "liza@example.com",
    note: "Paolo has a work trip that week, so my sister Bea is coming in his place.",
    source: "host",
    editedBy: "eunice@example.com",
    seats: [
      { seatId: 1, name: "Liza Ramos", attending: true, slipperSize: "W 8" },
      { seatId: 2, name: "Beatriz Ramos", attending: true, slipperSize: "W 7" },
    ],
  },
];

const responseVersions = (householdId: string) =>
  fakeAdminResponses
    .filter((response) => response.householdId === householdId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id - a.id);

const makeFakeSeat = (
  seat: AdminHousehold["seats"][number],
  response: FakeAdminResponse | null,
): AdminRsvpSeat => {
  const saved = response?.seats.find((item) => item.seatId === seat.slot);
  const coming = Boolean(
    response?.attending && (saved?.attending ?? seat.kind === "member"),
  );
  const name = saved ? saved.name : seat.name;
  return {
    ...seat,
    seatId: seat.slot,
    name,
    coming,
    slipperSize: coming ? (saved?.slipperSize ?? null) : null,
    plusOneState:
      seat.kind === "plus_one"
        ? !name
          ? "open"
          : coming
            ? "named"
            : "freed"
        : undefined,
  };
};

const makeFakeRsvpRow = (row: AdminHousehold): AdminRsvpRow => {
  const versions = responseVersions(row.id);
  const current = versions[0] ?? null;
  const seatChanges = row.seats
    .filter(
      (s) =>
        (s.name && s.invitedName && s.name !== s.invitedName) ||
        (s.kind === "plus_one" && s.name && !s.invitedName),
    )
    .map((s) => ({ from: s.invitedName, to: s.name! }));
  const seats = row.seats.map((s) => makeFakeSeat(s, current));
  return {
    id: row.id,
    label: row.label,
    displayName: row.displayName,
    state: current ? (current.attending ? "attending" : "declined") : "waiting",
    email: current?.email ?? null,
    respondentName: current?.respondentName ?? null,
    submittedAt: current?.submittedAt ?? null,
    note: current?.note ?? null,
    versionCount: current ? versions.length : null,
    editedBy: current?.editedBy ?? null,
    seatCount: row.seatCount,
    comingNames: seats.filter((s) => s.coming && s.name).map((s) => s.name!),
    notComingNames: current?.attending
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

const fakeHistory = (row: AdminHousehold): AdminRsvpVersion[] =>
  responseVersions(row.id).map((response) => {
    const seats = row.seats.map((seat) => makeFakeSeat(seat, response));
    return {
      id: response.id,
      submittedAt: response.submittedAt,
      respondentName: response.respondentName,
      attending: response.attending,
      coming: seats.filter((seat) => seat.coming).length,
      source: response.source,
      editedBy: response.editedBy,
      note: response.note,
      seats: seats.map((seat) => ({
        seatId: seat.slot,
        name: seat.name ?? "",
        attending: seat.coming,
        slipperSize: seat.coming ? seat.slipperSize : null,
      })),
    };
  });

export const fakeAdminReplies = fakeAdminFixtures
  .map((household) => ({
    household,
    response: responseVersions(household.id)[0],
  }))
  .filter(
    (
      item,
    ): item is {
      household: AdminHousehold;
      response: FakeAdminResponse;
    } => Boolean(item.response),
  )
  .sort(
    (a, b) =>
      b.response.submittedAt.localeCompare(a.response.submittedAt) ||
      b.response.id - a.response.id,
  )
  .slice(0, 4)
  .map(({ household, response }) => ({
    displayName: household.displayName,
    attending: response.attending,
    coming: household.seats.filter(
      (seat) => makeFakeSeat(seat, response).coming,
    ).length,
    seatCount: household.seatCount,
    submittedAt: response.submittedAt,
    namedPlusOnes: household.seats
      .filter((seat) => seat.kind === "plus_one" && seat.namedBy)
      .map((seat) => ({ name: seat.name!, namedBy: seat.namedBy })),
  }));
export function createFakeAdminStore(): AdminStore {
  async function getSlipperOrder(): Promise<AdminSlipperOrder> {
    const counts = new Map<string, number>();
    let missing = 0;
    // Sizes come from each household's newest reply, as in the D1 store.
    for (const row of fakeAdminFixtures.map(makeFakeRsvpRow))
      if (row.state === "attending")
        for (const current of row.seats.filter((seat) => seat.coming)) {
          const size = current.slipperSize;
          if (!size || !SLIPPER_SIZES.includes(size as never)) missing += 1;
          else counts.set(size, (counts.get(size) ?? 0) + 1);
        }
    const women = SLIPPER_SIZES.filter((size) => size.startsWith("W ")).map(
      (size) => ({ size, count: counts.get(size) ?? 0 }),
    );
    const men = SLIPPER_SIZES.filter((size) => size.startsWith("M ")).map(
      (size) => ({ size, count: counts.get(size) ?? 0 }),
    );
    const common = (items: Array<{ size: string; count: number }>) => {
      const best = items.reduce<{ size: string; count: number } | null>(
        (value, item) => (!value || item.count > value.count ? item : value),
        null,
      );
      return best && best.count ? best.size : null;
    };
    const womenTotal = women.reduce((sum, row) => sum + row.count, 0);
    const menTotal = men.reduce((sum, row) => sum + row.count, 0);
    return {
      women,
      men,
      womenTotal,
      menTotal,
      pairs: womenTotal + menTotal,
      missing,
      mostCommonWomen: common(women),
      mostCommonMen: common(men),
    };
  }
  async function getSongRequests(): Promise<AdminSongRequests> {
    const source = fakeAdminSongs.map((row, index) => ({
      id: index + 1,
      song: row.song,
      artist: row.artist,
      name: row.name,
      dedication: row.dedication,
      createdAt: row.submittedAt,
    }));
    const counts = new Map<string, number>();
    for (const row of source) {
      const key = songKey(row.song, row.artist);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const chronological = [...source].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
    );
    const numbers = new Map(
      chronological.map((row, index) => [row.id, index + 1]),
    );
    return {
      // Newest first, like the D1 store (created_at desc, id desc).
      rows: [...chronological].reverse().map((row) => ({
        ...row,
        no: numbers.get(row.id) ?? 0,
        requestCount: counts.get(songKey(row.song, row.artist)) ?? 1,
      })),
      requests: source.length,
      songs: counts.size,
    };
  }
  async function getNavCounts(): Promise<AdminNavCounts> {
    const slippers = await getSlipperOrder();
    return {
      households: fakeAdminFixtures.length,
      rsvpReplies: fakeAdminFixtures
        .map(makeFakeRsvpRow)
        .filter((row) => row.state !== "waiting").length,
      slipperPairs: slippers.pairs,
      songRequests: fakeAdminSongs.length,
    };
  }
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
        rows: fakeAdminFixtures.map((row) => ({
          ...row,
          seats: row.seats.map(({ attending: _attending, ...seat }) => seat),
        })),
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
    getSlipperOrder,
    getSongRequests,
    getNavCounts,
  };
}
