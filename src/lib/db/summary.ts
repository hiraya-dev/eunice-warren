import { sql } from "drizzle-orm";
import { getDb } from "./client.ts";
import type { D1Database } from "./types.ts";

export interface HouseholdSummary {
  offered: number;
  attending: number;
  slipperOrder: number;
  slipperMissing: number;
  seated: number;
  pencilled: number;
  flagged: number;
  unnamedPlusOnes: number;
  latestReplyAt: string | null;
}

export async function getHouseholdSummary(database: D1Database): Promise<HouseholdSummary> {
  const db = getDb(database);
  // Drizzle cannot express the correlated newest-response CTE and its several
  // indexed dashboard aggregates as one SQLite query.
  const [row] = await db.all(sql`WITH active_seats AS (
      SELECT s.* FROM invite_seats s
      JOIN households h ON h.id = s.household_id AND h.status = 'active'
      WHERE s.status = 'active'
    ), latest_responses AS (
      SELECT r.* FROM responses r
      WHERE NOT EXISTS (
        SELECT 1 FROM responses newer
        WHERE newer.household_id = r.household_id
          AND (newer.submitted_at > r.submitted_at OR (newer.submitted_at = r.submitted_at AND newer.id > r.id))
      )
    ), latest_seats AS (
      SELECT rs.*, lr.household_id, lr.attending AS household_attending
      FROM response_seats rs JOIN latest_responses lr ON lr.id = rs.response_id
    )
    SELECT
      (SELECT count(*) FROM active_seats) AS offered,
      (SELECT count(*) FROM latest_seats rs JOIN active_seats s ON s.id = rs.seat_id WHERE rs.household_attending = 1 AND rs.attending = 1) AS attending,
      (SELECT count(*) FROM latest_seats rs JOIN active_seats s ON s.id = rs.seat_id WHERE rs.household_attending = 1 AND rs.attending = 1 AND rs.slipper_size IS NOT NULL) AS slipper_order,
      (SELECT count(*) FROM latest_seats rs JOIN active_seats s ON s.id = rs.seat_id WHERE rs.household_attending = 1 AND rs.attending = 1 AND rs.slipper_size IS NULL) AS slipper_missing,
      (SELECT count(*) FROM seat_assignments a JOIN active_seats s ON s.id = a.seat_id JOIN latest_seats rs ON rs.seat_id = s.id WHERE rs.household_attending = 1 AND rs.attending = 1) AS seated,
      (SELECT count(*) FROM seat_assignments a JOIN active_seats s ON s.id = a.seat_id LEFT JOIN latest_seats rs ON rs.seat_id = s.id WHERE rs.id IS NULL) AS pencilled,
      (SELECT count(*) FROM seat_assignments a JOIN active_seats s ON s.id = a.seat_id JOIN latest_seats rs ON rs.seat_id = s.id WHERE rs.household_attending = 1 AND rs.attending = 0) AS flagged,
      (SELECT count(*) FROM active_seats s LEFT JOIN latest_responses lr ON lr.household_id = s.household_id LEFT JOIN latest_seats rs ON rs.seat_id = s.id WHERE s.kind = 'plus_one' AND s.name IS NULL AND (lr.id IS NULL OR (lr.attending = 1 AND (rs.id IS NULL OR rs.attending = 1)))) AS unnamed_plus_ones,
      (SELECT submitted_at FROM responses ORDER BY submitted_at DESC, id DESC LIMIT 1) AS latest_reply_at`);
  const value = row as Record<string, unknown> | undefined;
  return {
    offered: Number(value?.offered ?? 0),
    attending: Number(value?.attending ?? 0),
    slipperOrder: Number(value?.slipper_order ?? 0),
    slipperMissing: Number(value?.slipper_missing ?? 0),
    seated: Number(value?.seated ?? 0),
    pencilled: Number(value?.pencilled ?? 0),
    flagged: Number(value?.flagged ?? 0),
    unnamedPlusOnes: Number(value?.unnamed_plus_ones ?? 0),
    latestReplyAt: value?.latest_reply_at ? String(value.latest_reply_at) : null,
  };
}

export interface PlusOneState {
  seatId: number;
  state: "open" | "named" | "freed";
  name: string | null;
  namedBy: string | null;
  namedByKind: "guest" | "host" | null;
  namedAt: string | null;
}

export async function getUnnamedPlusOneCount(database: D1Database): Promise<number> {
  const db = getDb(database);
  // This focused count lets D1 start at the (kind, name) index and probe only
  // the newest response for each unnamed plus-one, instead of materialising the
  // rest of the dashboard summary.
  const rows = await db.all(sql`SELECT count(*) AS count
    FROM invite_seats s
    JOIN households h ON h.id = s.household_id AND h.status = 'active'
    WHERE s.kind = 'plus_one' AND s.name IS NULL AND s.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM responses r
        WHERE r.household_id = s.household_id
          AND r.id = (
            SELECT newest.id FROM responses newest
            WHERE newest.household_id = s.household_id
            ORDER BY newest.submitted_at DESC, newest.id DESC LIMIT 1
          )
          AND (
            r.attending = 0 OR EXISTS (
              SELECT 1 FROM response_seats rs
              WHERE rs.response_id = r.id AND rs.seat_id = s.id AND rs.attending = 0
            )
          )
      )`);
  return Number((rows[0] as { count?: number } | undefined)?.count ?? 0);
}

export async function getPlusOneStates(database: D1Database, householdId?: string): Promise<PlusOneState[]> {
  const db = getDb(database);
  // The newest-response anti-join is intentionally SQL so SQLite can use the
  // household/submitted-at index for each plus-one state.
  const rows = await db.all(sql`SELECT s.id AS seat_id, s.name, s.named_by, s.named_by_kind, s.named_at,
      CASE WHEN latest.attending = 1 AND latest_seat.attending = 0 THEN 'freed'
           WHEN s.name IS NULL THEN 'open' ELSE 'named' END AS state
    FROM invite_seats s
    JOIN households h ON h.id = s.household_id AND h.status = 'active'
    LEFT JOIN (SELECT r.* FROM responses r WHERE NOT EXISTS (SELECT 1 FROM responses newer WHERE newer.household_id = r.household_id AND (newer.submitted_at > r.submitted_at OR (newer.submitted_at = r.submitted_at AND newer.id > r.id)))) latest ON latest.household_id = s.household_id
    LEFT JOIN response_seats latest_seat ON latest_seat.response_id = latest.id AND latest_seat.seat_id = s.id
    WHERE s.status = 'active' AND s.kind = 'plus_one' ${householdId ? sql`AND s.household_id = ${householdId}` : sql``}
    ORDER BY s.household_id, s.slot`);
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    seatId: Number(row.seat_id),
    state: String(row.state) as PlusOneState["state"],
    name: row.name ? String(row.name) : null,
    namedBy: row.named_by ? String(row.named_by) : null,
    namedByKind: row.named_by_kind === "guest" || row.named_by_kind === "host" ? row.named_by_kind : null,
    namedAt: row.named_at ? String(row.named_at) : null,
  }));
}
