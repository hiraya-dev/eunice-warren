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
export interface AdminStore {
  getOverview(): Promise<AdminOverview>;
  getGuestList(): Promise<AdminGuestList>;
}
export function selectAdminStore(
  storeName: unknown,
  database: D1Database | undefined,
): AdminStore {
  return storeName === "fake"
    ? createFakeAdminStore()
    : createD1AdminStore(database as D1Database);
}
