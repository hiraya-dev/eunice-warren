import {
  getHouseholdSummary,
  getPlusOneStates,
  getUnnamedPlusOneCount,
} from "../db/summary.ts";
import type { D1Database } from "../db/types";
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

export function createD1AdminStore(database: D1Database): AdminStore {
  const query = async <T>(sql: string, ...values: unknown[]) =>
    (
      await database
        .prepare(sql)
        .bind(...values)
        .all<T>()
    ).results;
  const latest = `(SELECT r.* FROM responses r WHERE NOT EXISTS (SELECT 1 FROM responses newer WHERE newer.household_id=r.household_id AND (newer.submitted_at>r.submitted_at OR (newer.submitted_at=r.submitted_at AND newer.id>r.id))))`;
  async function households() {
    return query<{
      id: string;
      label: string;
      display_name: string;
      notes: string | null;
      seat_count: number;
    }>(
      `SELECT h.id,h.label,h.display_name,h.notes,count(s.id) seat_count FROM households h JOIN invite_seats s ON s.household_id=h.id AND s.status='active' WHERE h.status='active' GROUP BY h.id ORDER BY h.display_name`,
    );
  }
  async function getGuestList(): Promise<AdminGuestList> {
    const summary = await getHouseholdSummary(database);
    const unnamedPlusOnes = await getUnnamedPlusOneCount(database);
    const hs = await households();
    const seats = await query<Record<string, unknown>>(
      `SELECT s.*, h.id household_id FROM invite_seats s JOIN households h ON h.id=s.household_id AND h.status='active' WHERE s.status='active' ORDER BY s.household_id,s.slot`,
    );
    const responses = await query<Record<string, unknown>>(
      `SELECT r.household_id,r.attending,r.id response_id FROM ${latest} r`,
    );
    const responseSeats = await query<Record<string, unknown>>(
      `SELECT rs.response_id,rs.seat_id,rs.attending FROM response_seats rs`,
    );
    const plusStates = new Map(
      (await getPlusOneStates(database)).map((state) => [state.seatId, state]),
    );
    const responseByHousehold = new Map(
      responses.map((row) => [String(row.household_id), row]),
    );
    const responseSeatById = new Map(
      responseSeats.map((row) => [`${row.response_id}:${row.seat_id}`, row]),
    );
    const rows = hs.map((household) => {
      const response = responseByHousehold.get(household.id);
      const sourceSeats = seats.filter(
        (s) => String(s.household_id) === household.id,
      );
      const householdSeats = sourceSeats.map((s) => ({
        slot: Number(s.slot),
        kind: s.kind as "member" | "plus_one",
        invitedName: s.invited_name ? String(s.invited_name) : null,
        name: s.name ? String(s.name) : null,
        namedBy: s.named_by ? String(s.named_by) : null,
        namedByKind:
          s.named_by_kind === "guest" || s.named_by_kind === "host"
            ? s.named_by_kind
            : null,
        namedAt: s.named_at ? String(s.named_at) : null,
        ...(s.kind === "plus_one"
          ? { state: plusStates.get(Number(s.id))?.state ?? "open" }
          : {}),
      }));
      const coming = response
        ? sourceSeats.filter(
            (s) =>
              Boolean(response.attending) &&
              Boolean(
                responseSeatById.get(`${response.response_id}:${s.id}`)
                  ?.attending ?? s.kind === "member",
              ),
          ).length
        : 0;
      return {
        id: household.id,
        label: household.label,
        displayName: household.display_name,
        notes: household.notes,
        seats: householdSeats,
        seatCount: Number(household.seat_count),
        rsvp: response
          ? response.attending
            ? { state: "coming", coming }
            : { state: "declined" }
          : { state: "waiting" },
      } as AdminHousehold;
    });
    return {
      totals: {
        households: hs.length,
        seatsOffered: summary.offered,
        unnamedPlusOnes,
      },
      rows,
    };
  }
  async function getOverview(): Promise<AdminOverview> {
    const summary = await getHouseholdSummary(database);
    const hs = await households();
    const states = await query<{ household_id: string; attending: number }>(
      `SELECT r.household_id,r.attending FROM ${latest} r JOIN households h ON h.id=r.household_id AND h.status='active'`,
    );
    const state = new Map(
      states.map((r) => [r.household_id, Boolean(r.attending)]),
    );
    const invited = hs.length;
    const attending = [...state.values()].filter(Boolean).length;
    const declined = [...state.values()].filter((value) => !value).length;
    const waiting = invited - state.size;
    const replies = await query<Record<string, unknown>>(
      `SELECT r.id,r.household_id,r.attending,r.submitted_at,h.display_name,count(s.id) seat_count FROM ${latest} r JOIN households h ON h.id=r.household_id JOIN invite_seats s ON s.household_id=h.id AND s.status='active' WHERE h.status='active' GROUP BY r.id ORDER BY r.submitted_at DESC,r.id DESC LIMIT 4`,
    );
    const named = await query<Record<string, unknown>>(
      `SELECT s.named_in_response_id response_id,s.name,s.named_by FROM invite_seats s WHERE s.kind='plus_one' AND s.named_in_response_id IS NOT NULL`,
    );
    const namedByResponse = new Map<
      string,
      Array<{ name: string; namedBy: string | null }>
    >();
    for (const row of named) {
      const list = namedByResponse.get(String(row.response_id)) ?? [];
      list.push({
        name: String(row.name),
        namedBy: row.named_by ? String(row.named_by) : null,
      });
      namedByResponse.set(String(row.response_id), list);
    }
    const comingCounts = await query<{ response_id: number; coming: number }>(
      `SELECT rs.response_id,count(*) coming FROM response_seats rs WHERE rs.attending=1 GROUP BY rs.response_id`,
    );
    const countMap = new Map(
      comingCounts.map((r) => [r.response_id, r.coming]),
    );
    const songRows = await query<{ count: number }>(
      `SELECT count(*) count FROM songs`,
    );
    return {
      seatsOffered: summary.offered,
      guestsComing: summary.attending,
      households: { invited, attending, declined, waiting },
      repliedPercent: invited ? Math.round((state.size / invited) * 100) : 0,
      songCount: Number(songRows[0]?.count ?? 0),
      latestReplies: replies.map((r) => ({
        displayName: String(r.display_name),
        attending: Boolean(r.attending),
        coming: Number(countMap.get(Number(r.id)) ?? 0),
        seatCount: Number(r.seat_count),
        submittedAt: String(r.submitted_at),
        namedPlusOnes: namedByResponse.get(String(r.id)) ?? [],
      })),
      waiting: {
        total: waiting,
        households: hs
          .filter((h) => !state.has(h.id))
          .slice(0, 3)
          .map((h) => ({
            displayName: h.display_name,
            seatCount: Number(h.seat_count),
          })),
      },
    };
  }
  async function getSlipperOrder(): Promise<AdminSlipperOrder> {
    const rows = await query<{ size: string | null; count: number }>(`WITH latest AS (SELECT r.* FROM responses r WHERE NOT EXISTS (SELECT 1 FROM responses newer WHERE newer.household_id=r.household_id AND (newer.submitted_at>r.submitted_at OR (newer.submitted_at=r.submitted_at AND newer.id>r.id)))) SELECT rs.slipper_size size, count(*) count FROM response_seats rs JOIN latest r ON r.id=rs.response_id JOIN invite_seats s ON s.id=rs.seat_id AND s.status='active' JOIN households h ON h.id=s.household_id AND h.status='active' WHERE r.attending=1 AND rs.attending=1 GROUP BY rs.slipper_size`);
    const counts = new Map(rows.map((row) => [row.size ?? "", Number(row.count)]));
    const women = SLIPPER_SIZES.filter((size) => size.startsWith("W ")).map((size) => ({ size, count: counts.get(size) ?? 0 }));
    const men = SLIPPER_SIZES.filter((size) => size.startsWith("M ")).map((size) => ({ size, count: counts.get(size) ?? 0 }));
    const common = (items: Array<{ size: string; count: number }>) => { const best = items.reduce<{ size: string; count: number } | null>((value, item) => !value || item.count > value.count ? item : value, null); return best && best.count > 0 ? best.size : null; };
    const womenTotal = women.reduce((sum, row) => sum + row.count, 0);
    const menTotal = men.reduce((sum, row) => sum + row.count, 0);
    return { women, men, womenTotal, menTotal, pairs: womenTotal + menTotal, missing: rows.filter((row) => !row.size || !SLIPPER_SIZES.includes(row.size as never)).reduce((sum, row) => sum + Number(row.count), 0), mostCommonWomen: common(women), mostCommonMen: common(men) };
  }
  async function getSongRequests(): Promise<AdminSongRequests> {
    const source = await query<{ id: number; song: string; artist: string | null; name: string; dedication: string | null; created_at: string }>(`SELECT id,song,artist,name,dedication,created_at FROM songs ORDER BY created_at DESC,id DESC`);
    const counts = new Map<string, number>();
    for (const row of source) { const key = songKey(row.song, row.artist); counts.set(key, (counts.get(key) ?? 0) + 1); }
    const chronological = [...source].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
    const numbers = new Map(chronological.map((row, index) => [row.id, index + 1]));
    return { rows: source.map((row) => ({ id: Number(row.id), no: numbers.get(row.id) ?? 0, song: row.song, artist: row.artist, name: row.name, dedication: row.dedication, createdAt: row.created_at, requestCount: counts.get(songKey(row.song, row.artist)) ?? 1 })), requests: source.length, songs: counts.size };
  }
  async function getNavCounts(): Promise<AdminNavCounts> {
    const allowedSizes = SLIPPER_SIZES.map((size) => `'${size}'`).join(",");
    const [row] = await query<{ households: number; slipper_pairs: number; song_requests: number }>(`WITH latest AS (SELECT r.* FROM responses r WHERE NOT EXISTS (SELECT 1 FROM responses newer WHERE newer.household_id=r.household_id AND (newer.submitted_at>r.submitted_at OR (newer.submitted_at=r.submitted_at AND newer.id>r.id)))) SELECT (SELECT count(DISTINCT h.id) FROM households h JOIN invite_seats s ON s.household_id=h.id AND s.status='active' WHERE h.status='active') households, (SELECT count(*) FROM response_seats rs JOIN latest r ON r.id=rs.response_id JOIN invite_seats s ON s.id=rs.seat_id JOIN households h ON h.id=s.household_id WHERE h.status='active' AND s.status='active' AND r.attending=1 AND rs.attending=1 AND rs.slipper_size IN (${allowedSizes})) slipper_pairs, (SELECT count(*) FROM songs) song_requests`);
    return { households: Number(row?.households ?? 0), slipperPairs: Number(row?.slipper_pairs ?? 0), songRequests: Number(row?.song_requests ?? 0) };
  }
  return { getOverview, getGuestList, getSlipperOrder, getSongRequests, getNavCounts };
}
