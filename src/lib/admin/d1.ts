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
  AdminRsvpDetail,
  AdminRsvpList,
  AdminRsvpRow,
  AdminRsvpSeat,
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
  type RawHousehold = {
    id: string;
    label: string;
    display_name: string;
    seat_count: number;
  };
  type RawSeat = {
    id: number;
    household_id: string;
    slot: number;
    kind: string;
    invited_name: string | null;
    name: string | null;
    named_by: string | null;
    named_by_kind: string | null;
    named_at: string | null;
  };
  type RawResponse = {
    id: number;
    household_id: string;
    submitted_at: string;
    respondent_name: string;
    attending: number;
    email: string;
    note: string | null;
    source: string;
    edited_by: string | null;
  };
  type RawResponseSeat = {
    response_id: number;
    seat_id: number | null;
    name: string;
    attending: number;
    slipper_size: string | null;
  };
  async function rsvpData(householdId?: string) {
    const where = householdId ? " AND h.id = ?" : "";
    const hs = await query<RawHousehold>(
      `SELECT h.id,h.label,h.display_name,count(s.id) seat_count FROM households h JOIN invite_seats s ON s.household_id=h.id AND s.status='active' WHERE h.status='active'${where} GROUP BY h.id`,
      ...(householdId ? [householdId] : []),
    );
    const seats = await query<RawSeat>(
      `SELECT s.id,s.household_id,s.slot,s.kind,s.invited_name,s.name,s.named_by,s.named_by_kind,s.named_at FROM invite_seats s JOIN households h ON h.id=s.household_id AND h.status='active' WHERE s.status='active'${householdId ? " AND h.id = ?" : ""} ORDER BY s.household_id,s.slot`,
      ...(householdId ? [householdId] : []),
    );
    const responses = await query<RawResponse>(
      `SELECT r.* FROM responses r JOIN households h ON h.id=r.household_id AND h.status='active'${householdId ? " WHERE r.household_id = ?" : ""} ORDER BY r.household_id,r.submitted_at DESC,r.id DESC`,
      ...(householdId ? [householdId] : []),
    );
    const responseSeats = await query<RawResponseSeat>(
      `SELECT rs.response_id,rs.seat_id,rs.name,rs.attending,rs.slipper_size FROM response_seats rs JOIN responses r ON r.id=rs.response_id${householdId ? " WHERE r.household_id = ?" : ""}`,
      ...(householdId ? [householdId] : []),
    );
    return { hs, seats, responses, responseSeats };
  }
  const makeSeat = (
    seat: RawSeat,
    response: RawResponse | null,
    byResponse: Map<string, RawResponseSeat>,
  ): AdminRsvpSeat => {
    const saved = response
      ? byResponse.get(`${response.id}:${seat.id}`)
      : undefined;
    const householdAttending = Boolean(response?.attending);
    const coming = householdAttending
      ? saved
        ? Boolean(saved.attending)
        : seat.kind === "member"
      : false;
    const name = saved?.name ?? seat.name;
    return {
      slot: Number(seat.slot),
      kind: seat.kind as "member" | "plus_one",
      invitedName: seat.invited_name,
      name,
      namedBy: seat.named_by,
      namedByKind:
        seat.named_by_kind === "guest" || seat.named_by_kind === "host"
          ? seat.named_by_kind
          : null,
      namedAt: seat.named_at,
      coming,
      slipperSize: coming ? (saved?.slipper_size ?? null) : null,
      plusOneState:
        seat.kind === "plus_one"
          ? !name
            ? "open"
            : coming
              ? "named"
              : "freed"
          : undefined,
      seatId: Number(seat.id),
    };
  };
  const makeRow = (
    household: RawHousehold,
    seats: RawSeat[],
    responses: RawResponse[],
    responseSeats: RawResponseSeat[],
  ): AdminRsvpRow => {
    const versions = responses
      .filter((r) => r.household_id === household.id)
      .sort(
        (a, b) => b.submitted_at.localeCompare(a.submitted_at) || b.id - a.id,
      );
    const latest = versions[0] ?? null;
    const byResponse = new Map(
      responseSeats.map((rs) => [`${rs.response_id}:${rs.seat_id}`, rs]),
    );
    const rowSeats = seats
      .filter((s) => s.household_id === household.id)
      .map((s) => makeSeat(s, latest, byResponse));
    const changes = rowSeats
      .filter(
        (s) =>
          (s.name && s.invitedName && s.name !== s.invitedName) ||
          (s.kind === "plus_one" && s.name && !s.invitedName),
      )
      .map((s) => ({ from: s.invitedName, to: s.name! }));
    return {
      id: household.id,
      label: household.label,
      displayName: household.display_name,
      state: latest ? (latest.attending ? "attending" : "declined") : "waiting",
      email: latest?.email ?? null,
      respondentName: latest?.respondent_name ?? null,
      submittedAt: latest?.submitted_at ?? null,
      note: latest?.note ?? null,
      versionCount: latest ? versions.length : null,
      editedBy: latest?.edited_by ?? null,
      seatCount: Number(household.seat_count),
      comingNames: rowSeats
        .filter((s) => s.coming && s.name)
        .map((s) => s.name!),
      notComingNames: latest?.attending
        ? rowSeats.filter((s) => !s.coming && s.name).map((s) => s.name!)
        : [],
      seatChanges: changes,
      slippers: rowSeats
        .filter((s) => s.coming && s.name)
        .map((s) => ({
          firstName: s.name!.trim().split(/\s+/)[0]!,
          size: s.slipperSize,
        })),
      seatChange: changes.length > 0,
      seats: rowSeats,
    };
  };
  function makeDetail(
    household: RawHousehold,
    seats: RawSeat[],
    responses: RawResponse[],
    responseSeats: RawResponseSeat[],
  ): AdminRsvpDetail | null {
    const row = makeRow(household, seats, responses, responseSeats);
    if (row.state === "waiting")
      return {
        id: row.id,
        label: row.label,
        displayName: row.displayName,
        email: null,
        respondentName: null,
        seatCount: row.seatCount,
        submittedAt: null,
        versionCount: 0,
        note: null,
        seats: row.seats,
        history: [],
      };
    const versions = responses
      .filter((r) => r.household_id === household.id)
      .sort(
        (a, b) => b.submitted_at.localeCompare(a.submitted_at) || b.id - a.id,
      );
    const byResponse = new Map(
      responseSeats.map((rs) => [`${rs.response_id}:${rs.seat_id}`, rs]),
    );
    return {
      id: row.id,
      label: row.label,
      displayName: row.displayName,
      email: row.email,
      respondentName: row.respondentName ?? null,
      seatCount: row.seatCount,
      submittedAt: row.submittedAt,
      versionCount: versions.length,
      note: row.note,
      seats: row.seats,
      history: versions.map((r) => ({
        id: r.id,
        submittedAt: r.submitted_at,
        respondentName: r.respondent_name,
        attending: Boolean(r.attending),
        coming: seats.filter((s) => {
          const rs = byResponse.get(`${r.id}:${s.id}`);
          return (
            Boolean(r.attending) &&
            Boolean(rs?.attending ?? s.kind === "member")
          );
        }).length,
        source: r.source === "host" ? "host" : "guest",
        editedBy: r.edited_by,
        note: r.note,
        seats: seats
          .filter((s) => s.household_id === household.id)
          .map((s) => {
            const rs = byResponse.get(`${r.id}:${s.id}`);
            return {
              seatId: Number(s.id),
              name: rs?.name ?? s.name ?? "",
              attending:
                Boolean(r.attending) &&
                Boolean(rs?.attending ?? s.kind === "member"),
              slipperSize: rs?.slipper_size ?? null,
            };
          }),
      })),
    };
  }
  async function getRsvpList(): Promise<AdminRsvpList> {
    const data = await rsvpData();
    const rows = data.hs
      .map((h) => makeRow(h, data.seats, data.responses, data.responseSeats))
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
  }
  async function getRsvpDetail(
    householdId: string,
  ): Promise<AdminRsvpDetail | null> {
    const data = await rsvpData(householdId);
    if (!data.hs[0]) return null;
    return makeDetail(
      data.hs[0],
      data.seats,
      data.responses,
      data.responseSeats,
    );
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
    const [row] = await query<{ households: number; slipper_pairs: number; song_requests: number; rsvp_replies: number }>(`WITH latest AS (SELECT r.* FROM responses r WHERE NOT EXISTS (SELECT 1 FROM responses newer WHERE newer.household_id=r.household_id AND (newer.submitted_at>r.submitted_at OR (newer.submitted_at=r.submitted_at AND newer.id>r.id)))) SELECT (SELECT count(DISTINCT h.id) FROM households h JOIN invite_seats s ON s.household_id=h.id AND s.status='active' WHERE h.status='active') households, (SELECT count(*) FROM response_seats rs JOIN latest r ON r.id=rs.response_id JOIN invite_seats s ON s.id=rs.seat_id JOIN households h ON h.id=s.household_id WHERE h.status='active' AND s.status='active' AND r.attending=1 AND rs.attending=1 AND rs.slipper_size IN (${allowedSizes})) slipper_pairs, (SELECT count(*) FROM songs) song_requests, (SELECT count(DISTINCT r.household_id) FROM responses r JOIN households h ON h.id=r.household_id AND h.status='active' WHERE EXISTS (SELECT 1 FROM invite_seats s WHERE s.household_id=h.id AND s.status='active')) rsvp_replies`);
    return { households: Number(row?.households ?? 0), rsvpReplies: Number(row?.rsvp_replies ?? 0), slipperPairs: Number(row?.slipper_pairs ?? 0), songRequests: Number(row?.song_requests ?? 0) };
  }
  return {
    getOverview,
    getGuestList,
    getRsvpList,
    getRsvpDetail,
    getSlipperOrder,
    getSongRequests,
    getNavCounts,
  };
}
