import type {
  AdminGuestList,
  AdminHousehold,
  AdminNavCounts,
  AdminOverview,
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
      seat(1, "Maria Dela Cruz", "Maria Dela Cruz", "member", {
        slipperSize: "W 7",
        attending: true,
      }),
      seat(2, "Jose Dela Cruz", "Jose Dela Cruz", "member", {
        slipperSize: "M 9.5",
        attending: true,
      }),
      seat(3, "Anna Dela Cruz", "Ana Dela Cruz", "member", {
        slipperSize: "W 7.5",
        namedBy: "Maria",
        namedByKind: "guest",
        namedAt: "2026-11-12T09:00:00+08:00",
        attending: true,
      }),
      seat(4, "Miguel Dela Cruz", "Miguel Dela Cruz", "member", {
        slipperSize: "M 10",
        attending: true,
      }),
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
    seats: [
      seat(1, "Sofía Peña", "Sofía Peña", "member", {
        slipperSize: "W 5",
        attending: false,
      }),
    ],
    seatCount: 1,
    rsvp: { state: "declined" },
  },
  {
    id: "hh-villanueva",
    label: "VF-05",
    displayName: "The Villanueva Family",
    notes: "Three seats confirmed",
    seats: [1, 2, 3, 4, 5].map((slot) =>
      seat(
        slot,
        `Villanueva Guest ${slot}`,
        `Villanueva Guest ${slot}`,
        "member",
        {
          slipperSize: ["W 7", "M 9", null, "W 8", "M 10"][slot - 1],
          attending: slot <= 3,
        },
      ),
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
      seat(1, "Kat Lim", "Kat Lim", "member", {
        slipperSize: "W 7",
        attending: true,
      }),
      seat(2, "Jonas Ong", null, "plus_one", {
        state: "named",
        namedBy: "Kat",
        namedByKind: "guest",
        namedAt: "2026-11-18T13:00:00+08:00",
        slipperSize: "M 9",
        attending: true,
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
      seat(1, "Mica Tan", "Mica Tan", "member", {
        slipperSize: "W 8.5",
        attending: true,
      }),
      seat(2, null, null, "plus_one", { state: "freed", attending: false }),
    ],
    seatCount: 2,
    rsvp: { state: "coming", coming: 1 },
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
  async function getSlipperOrder(): Promise<AdminSlipperOrder> {
    const counts = new Map<string, number>();
    let missing = 0;
    for (const household of fakeAdminFixtures)
      if (household.rsvp.state === "coming")
        for (const current of household.seats.filter(
          (seat) => seat.attending === true,
        )) {
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
      rows: source.map((row) => ({
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
    getSlipperOrder,
    getSongRequests,
    getNavCounts,
  };
}
