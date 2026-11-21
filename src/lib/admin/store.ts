import type { D1Database } from "../db/types";
import { createD1AdminStore } from "./d1.ts";
import { createFakeAdminStore } from "./fake.ts";

export interface AdminSeat {
  slot: number;
  kind: "member" | "plus_one";
  invitedName: string | null;
  name: string | null;
  namedBy: string | null;
  namedByKind: "guest" | "host" | null;
  namedAt: string | null;
  state?: "open" | "named" | "freed";
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
}
export interface AdminStore {
  getOverview(): Promise<AdminOverview>;
  getGuestList(): Promise<AdminGuestList>;
  getRsvpList(): Promise<AdminRsvpList>;
  getRsvpDetail(householdId: string): Promise<AdminRsvpDetail | null>;
}
export function selectAdminStore(
  storeName: unknown,
  database: D1Database | undefined,
): AdminStore {
  return storeName === "fake"
    ? createFakeAdminStore()
    : createD1AdminStore(database as D1Database);
}
