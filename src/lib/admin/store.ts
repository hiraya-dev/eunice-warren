import type { D1Database } from "../db/types";
import { createD1AdminStore } from "./d1.ts";
import { createFakeAdminStore } from "./fake.ts";

export interface AdminSeat {
  id?: number;
  updatedAt?: string;
  slot: number;
  kind: "member" | "plus_one";
  invitedName: string | null;
  name: string | null;
  namedBy: string | null;
  namedByKind: "guest" | "host" | null;
  namedAt: string | null;
  namedInResponseId?: number | null;
  state?: "open" | "named" | "freed";
  slipperSize?: string | null;
  attending?: boolean;
  status?: "active" | "retired";
  retiredAt?: string | null;
  retiredBy?: string | null;
  nameKey?: string | null;
  surnameKey?: string | null;
  hasActivity?: boolean;
}
export interface AdminHousehold {
  id: string;
  label: string;
  displayName: string;
  notes: string | null;
  seats: AdminSeat[];
  seatCount: number;
  rsvp:
    | { state: "coming"; coming: number }
    | { state: "declined" }
    | { state: "waiting" };
  updatedAt?: string;
  ticketCode?: string;
  archivedAt?: string | null;
  archivedBy?: string | null;
  assignedSeatIds?: number[];
}
export class StaleHouseholdError extends Error {
  constructor() {
    super(
      "This household changed since you opened it. Reload to see the latest.",
    );
    this.name = "StaleHouseholdError";
  }
}
export interface SaveHouseholdInput {
  id: string;
  label?: string;
  updatedAt?: string;
  displayName: string;
  notes: string | null;
  seatCount: number;
  seats: Array<{
    id?: number;
    kind?: "member" | "plus_one";
    name: string;
    invitedName?: string;
    retire?: boolean;
  }>;
  confirmedNames?: string[];
  removeSeatIds?: number[];
}
export interface NewHouseholdInput {
  label: string;
  displayName: string;
  notes: string | null;
  seats: Array<{ name: string }>;
  seatCount?: number;
  confirmedNames?: string[];
}
export interface AdminOverview {
  seatsOffered: number;
  guestsComing: number;
  households: {
    invited: number;
    attending: number;
    declined: number;
    waiting: number;
  };
  repliedPercent: number;
  songCount: number;
  latestReplies: Array<{
    displayName: string;
    attending: boolean;
    coming: number;
    seatCount: number;
    submittedAt: string;
    namedPlusOnes: Array<{ name: string; namedBy: string | null }>;
  }>;
  waiting: {
    total: number;
    households: Array<{ displayName: string; seatCount: number }>;
  };
}
export interface AdminGuestList {
  totals: { households: number; seatsOffered: number; unnamedPlusOnes: number };
  rows: AdminHousehold[];
}
export interface AdminRsvpSeat {
  seatId?: number;
  slot: number;
  kind: "member" | "plus_one";
  invitedName: string | null;
  name: string | null;
  namedBy: string | null;
  namedByKind: "guest" | "host" | null;
  namedAt: string | null;
  coming: boolean;
  slipperSize: string | null;
  plusOneState?: "open" | "named" | "freed";
}
export interface AdminRsvpVersion {
  id: number;
  submittedAt: string;
  respondentName?: string;
  attending: boolean;
  coming: number;
  source: "guest" | "host";
  editedBy?: string | null;
  note: string | null;
  seats: Array<{
    seatId: number;
    name: string;
    attending: boolean;
    slipperSize: string | null;
  }>;
}
export interface AdminRsvpRow {
  id: string;
  label: string;
  displayName: string;
  state: "attending" | "declined" | "waiting";
  email: string | null;
  respondentName: string | null;
  submittedAt: string | null;
  note: string | null;
  versionCount: number | null;
  editedBy?: string | null;
  seatCount: number;
  comingNames: string[];
  notComingNames: string[];
  seatChanges: Array<{ from: string | null; to: string }>;
  slippers: Array<{ firstName: string; size: string | null }>;
  seatChange: boolean;
  seats: AdminRsvpSeat[];
}
export interface AdminRsvpList {
  totals: {
    all: number;
    attending: number;
    declined: number;
    seatChanges: number;
    waiting: number;
  };
  rows: AdminRsvpRow[];
}
export interface AdminRsvpDetail {
  id: string;
  label: string;
  displayName: string;
  email: string | null;
  respondentName: string | null;
  seatCount: number;
  submittedAt: string | null;
  versionCount: number;
  note: string | null;
  seats: AdminRsvpSeat[];
  history: AdminRsvpVersion[];
  updatedAt?: string;
}
export interface AdminHostActor {
  email: string;
  firstName: string;
}
export interface SaveRsvpInput {
  id: string;
  updatedAt: string;
  attending: boolean;
  seats: Array<{
    seatId: number;
    shownName: string;
    name: string;
    attending: boolean;
    slipperSize?: string;
  }>;
  note: string | null;
}
export interface AdminSlipperOrder {
  women: Array<{ size: string; count: number }>;
  men: Array<{ size: string; count: number }>;
  womenTotal: number;
  menTotal: number;
  pairs: number;
  missing: number;
  mostCommonWomen: string | null;
  mostCommonMen: string | null;
}
export interface AdminSongRequest {
  id: number;
  no: number;
  song: string;
  artist: string | null;
  name: string;
  dedication: string | null;
  createdAt: string;
  requestCount: number;
}
export interface AdminSongRequests {
  rows: AdminSongRequest[];
  requests: number;
  songs: number;
}
export interface AdminNavCounts {
  households: number;
  /** Active households with any reply (attending + declined). */
  rsvpReplies: number;
  slipperPairs: number;
  songRequests: number;
}
export interface AdminStore {
  getOverview(): Promise<AdminOverview>;
  getGuestList(): Promise<AdminGuestList>;
  getRsvpList(): Promise<AdminRsvpList>;
  getRsvpDetail(householdId: string): Promise<AdminRsvpDetail | null>;
  getSlipperOrder(): Promise<AdminSlipperOrder>;
  getSongRequests(): Promise<AdminSongRequests>;
  getNavCounts(): Promise<AdminNavCounts>;
  saveHousehold(
    input: SaveHouseholdInput,
    actor: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
  saveRsvp(
    input: SaveRsvpInput,
    actor: AdminHostActor,
  ): Promise<{ ok: true }>;
  addHousehold(
    input: NewHouseholdInput,
    actor: string,
  ): Promise<{ id: string }>;
  archiveHousehold(
    id: string,
    actor: string,
    updatedAt?: string,
  ): Promise<void>;
}
export function selectAdminStore(
  storeName: unknown,
  database: D1Database | undefined,
): AdminStore {
  return storeName === "fake"
    ? createFakeAdminStore()
    : createD1AdminStore(database as D1Database);
}
