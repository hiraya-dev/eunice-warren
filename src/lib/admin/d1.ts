import {
  getHouseholdSummary,
  getPlusOneStates,
  getUnnamedPlusOneCount,
} from "../db/summary.ts";
import type { D1Database, D1PreparedStatement } from "../db/types";
import { StaleHouseholdError } from "./store.ts";
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
  AdminHostActor,
  AdminSongRequests,
  AdminStore,
  NewHouseholdInput,
  SaveHouseholdInput,
  SaveRsvpInput,
} from "./store";
import { SLIPPER_SIZES } from "../rsvp/slippers.ts";
import { songKey } from "./presentation.ts";
import { normalizeGuestName } from "../rsvp/store.ts";
import { MAX_SEATS } from "../rsvp/limits.ts";
import { duplicateNameKey } from "./names.ts";

const TICKET_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomTicket(used: Set<string>) {
  let ticket = "";
  do {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    ticket = [...bytes]
      .map((byte) => TICKET_ALPHABET[byte % TICKET_ALPHABET.length])
      .join("");
  } while (used.has(ticket));
  return ticket;
}

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
      updated_at: string;
    }>(
      `SELECT h.id,h.label,h.display_name,h.notes,h.updated_at,count(s.id) seat_count FROM households h JOIN invite_seats s ON s.household_id=h.id AND s.status='active' WHERE h.status='active' GROUP BY h.id ORDER BY h.display_name`,
    );
  }
  async function getGuestList(): Promise<AdminGuestList> {
    const summary = await getHouseholdSummary(database);
    const unnamedPlusOnes = await getUnnamedPlusOneCount(database);
    const hs = await households();
    const seats = await query<Record<string, unknown>>(
      `SELECT s.*, h.id household_id, EXISTS (SELECT 1 FROM response_seats rs WHERE rs.seat_id=s.id) OR EXISTS (SELECT 1 FROM seat_assignments sa WHERE sa.seat_id=s.id) has_activity FROM invite_seats s JOIN households h ON h.id=s.household_id AND h.status='active' WHERE s.status='active' ORDER BY s.household_id,s.slot`,
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
        id: Number(s.id),
        updatedAt: s.updated_at ? String(s.updated_at) : undefined,
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
        namedInResponseId: s.named_in_response_id ? Number(s.named_in_response_id) : null,
        hasActivity: Boolean(s.has_activity),
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
        updatedAt: household.updated_at,
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
    updated_at: string;
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
    named_in_response_id: number | null;
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
      `SELECT h.id,h.label,h.display_name,h.updated_at,count(s.id) seat_count FROM households h JOIN invite_seats s ON s.household_id=h.id AND s.status='active' WHERE h.status='active'${where} GROUP BY h.id`,
      ...(householdId ? [householdId] : []),
    );
    const seats = await query<RawSeat>(
      `SELECT s.id,s.household_id,s.slot,s.kind,s.invited_name,s.name,s.named_by,s.named_by_kind,s.named_at,s.named_in_response_id FROM invite_seats s JOIN households h ON h.id=s.household_id AND h.status='active' WHERE s.status='active'${householdId ? " AND h.id = ?" : ""} ORDER BY s.household_id,s.slot`,
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
        updatedAt: household.updated_at,
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
      updatedAt: (household as RawHousehold & { updated_at?: string }).updated_at,
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
    const rows = await query<{ size: string | null; count: number }>(
      `WITH latest AS (SELECT r.* FROM responses r WHERE NOT EXISTS (SELECT 1 FROM responses newer WHERE newer.household_id=r.household_id AND (newer.submitted_at>r.submitted_at OR (newer.submitted_at=r.submitted_at AND newer.id>r.id)))) SELECT rs.slipper_size size, count(*) count FROM response_seats rs JOIN latest r ON r.id=rs.response_id JOIN invite_seats s ON s.id=rs.seat_id AND s.status='active' JOIN households h ON h.id=s.household_id AND h.status='active' WHERE r.attending=1 AND rs.attending=1 GROUP BY rs.slipper_size`,
    );
    const counts = new Map(
      rows.map((row) => [row.size ?? "", Number(row.count)]),
    );
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
      return best && best.count > 0 ? best.size : null;
    };
    const womenTotal = women.reduce((sum, row) => sum + row.count, 0);
    const menTotal = men.reduce((sum, row) => sum + row.count, 0);
    return {
      women,
      men,
      womenTotal,
      menTotal,
      pairs: womenTotal + menTotal,
      missing: rows
        .filter(
          (row) => !row.size || !SLIPPER_SIZES.includes(row.size as never),
        )
        .reduce((sum, row) => sum + Number(row.count), 0),
      mostCommonWomen: common(women),
      mostCommonMen: common(men),
    };
  }
  async function getSongRequests(): Promise<AdminSongRequests> {
    const source = await query<{
      id: number;
      song: string;
      artist: string | null;
      name: string;
      dedication: string | null;
      spotify_track_id: string | null;
      created_at: string;
    }>(
      `SELECT id,song,artist,name,dedication,spotify_track_id,created_at FROM songs ORDER BY created_at DESC,id DESC`,
    );
    const counts = new Map<string, number>();
    for (const row of source) {
      const key = songKey(row.song, row.artist);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const chronological = [...source].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
    );
    const numbers = new Map(
      chronological.map((row, index) => [row.id, index + 1]),
    );
    return {
      rows: source.map((row) => ({
        id: Number(row.id),
        no: numbers.get(row.id) ?? 0,
        song: row.song,
        artist: row.artist,
        name: row.name,
        dedication: row.dedication,
        spotifyTrackId: row.spotify_track_id,
        createdAt: row.created_at,
        requestCount: counts.get(songKey(row.song, row.artist)) ?? 1,
      })),
      requests: source.length,
      songs: counts.size,
    };
  }
  async function getNavCounts(): Promise<AdminNavCounts> {
    const allowedSizes = SLIPPER_SIZES.map((size) => `'${size}'`).join(",");
    const [row] = await query<{
      households: number;
      slipper_pairs: number;
      song_requests: number;
      rsvp_replies: number;
    }>(
      `WITH latest AS (SELECT r.* FROM responses r WHERE NOT EXISTS (SELECT 1 FROM responses newer WHERE newer.household_id=r.household_id AND (newer.submitted_at>r.submitted_at OR (newer.submitted_at=r.submitted_at AND newer.id>r.id)))) SELECT (SELECT count(DISTINCT h.id) FROM households h JOIN invite_seats s ON s.household_id=h.id AND s.status='active' WHERE h.status='active') households, (SELECT count(*) FROM response_seats rs JOIN latest r ON r.id=rs.response_id JOIN invite_seats s ON s.id=rs.seat_id JOIN households h ON h.id=s.household_id WHERE h.status='active' AND s.status='active' AND r.attending=1 AND rs.attending=1 AND rs.slipper_size IN (${allowedSizes})) slipper_pairs, (SELECT count(*) FROM songs) song_requests, (SELECT count(DISTINCT r.household_id) FROM responses r JOIN households h ON h.id=r.household_id AND h.status='active' WHERE EXISTS (SELECT 1 FROM invite_seats s WHERE s.household_id=h.id AND s.status='active')) rsvp_replies`,
    );
    return {
      households: Number(row?.households ?? 0),
      rsvpReplies: Number(row?.rsvp_replies ?? 0),
      slipperPairs: Number(row?.slipper_pairs ?? 0),
      songRequests: Number(row?.song_requests ?? 0),
    };
  }
  const validationError = (message: string) => ({
    ok: false as const,
    message,
  });
  async function saveRsvp(input: SaveRsvpInput, actor: AdminHostActor) {
    const household = await database
      .prepare(
        `SELECT id,updated_at FROM households WHERE id=? AND status='active'`,
      )
      .bind(input.id)
      .first<{ id: string; updated_at: string }>();
    if (!household) throw new StaleHouseholdError();
    const currentSeats = (
      await database
        .prepare(
          `SELECT id,kind,name,invited_name FROM invite_seats WHERE household_id=? AND status='active' ORDER BY slot`,
        )
        .bind(input.id)
        .all<{
          id: number;
          kind: "member" | "plus_one";
          name: string | null;
          invited_name: string | null;
        }>()
    ).results;
    const postedIds = input.seats.map((seat) => seat.seatId).sort((a, b) => a - b);
    const activeIds = currentSeats.map((seat) => seat.id).sort((a, b) => a - b);
    if (
      postedIds.length !== activeIds.length ||
      postedIds.some((id, index) => id !== activeIds[index])
    )
      throw new StaleHouseholdError();
    if (input.updatedAt !== household.updated_at) throw new StaleHouseholdError();
    const latest = await database
      .prepare(
        `SELECT respondent_name,email,(SELECT max(id) FROM responses WHERE household_id=?) AS max_id FROM responses WHERE household_id=? ORDER BY submitted_at DESC,id DESC LIMIT 1`,
      )
      .bind(input.id, input.id)
      .first<{ respondent_name: string; email: string; max_id: number | null }>();
    const now = new Date().toISOString();
    // Two saves in the same millisecond share submitted_at, and history breaks
    // that tie by id, so the new id must sort after every earlier one.
    const responseId = Math.max(
      Date.now() * 1000 + Math.floor(Math.random() * 1000),
      Number(latest?.max_id ?? 0) + 1,
    );
    const response = database
      .prepare(
        `INSERT INTO responses (id,household_id,submitted_at,respondent_name,attending,guest_count,email,note,source,edited_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        responseId,
        input.id,
        now,
        latest?.respondent_name || actor.firstName,
        input.attending ? 1 : 0,
        input.attending ? input.seats.filter((seat) => seat.attending).length : 0,
        latest?.email ?? "",
        input.note?.trim() || null,
        "host",
        actor.email,
      );
    const seats = database
      .prepare(
        `INSERT INTO response_seats (response_id,seat_id,kind,name,attending,slipper_size) VALUES ${currentSeats.map(() => "(?,?,?,?,?,?)").join(",")}`,
      )
      .bind(
        ...currentSeats.flatMap((current) => {
          const posted = input.seats.find((seat) => seat.seatId === current.id)!;
          const attending = input.attending && posted.attending;
          return [
            responseId,
            current.id,
            current.kind,
            posted.name,
            attending ? 1 : 0,
            attending ? posted.slipperSize ?? null : null,
          ];
        }),
      );
    const statements: D1PreparedStatement[] = [
      database
        .prepare(
          `UPDATE households SET updated_at=CASE WHEN updated_at=? THEN ? ELSE NULL END,updated_by=? WHERE id=? AND status='active'`,
        )
        .bind(input.updatedAt, now, actor.email, input.id),
      response,
      seats,
    ];
    for (const current of currentSeats) {
      const posted = input.seats.find((seat) => seat.seatId === current.id)!;
      const clean = posted.name.trim();
      if (!clean || clean === (posted.shownName ?? current.name ?? "")) continue;
      // Only the current name changes: name_key/surname_key follow the invited
      // name, which guest lookup uses, and a host rename never touches it.
      statements.push(
        database
          .prepare(
            `UPDATE invite_seats SET name=?,named_by_kind='host',named_by=?,named_at=?,named_in_response_id=?,updated_at=?,updated_by=? WHERE id=? AND household_id=? AND status='active'`,
          )
          .bind(
            clean,
            actor.email,
            now,
            responseId,
            now,
            actor.email,
            current.id,
            input.id,
          ),
      );
    }
    try {
      await database.batch(statements);
    } catch (error) {
      if (
        String(error).toLowerCase().includes("not null constraint") &&
        String(error).toLowerCase().includes("updated_at")
      )
        throw new StaleHouseholdError();
      throw error;
    }
    return { ok: true as const };
  }
  async function saveHousehold(input: SaveHouseholdInput, actor: string) {
    const displayName = input.displayName.trim();
    const label = input.label?.trim();
    if (label !== undefined && (!label || label.length > 80))
      return validationError(
        "Host label is required and must be 80 characters or fewer.",
      );
    if (label !== undefined) {
      const duplicateLabel = await database
        .prepare(
          `SELECT id FROM households WHERE status='active' AND lower(label)=lower(?) AND id<>?`,
        )
        .bind(label, input.id)
        .first();
      if (duplicateLabel) return validationError("Host ID is already in use.");
    }
    if (!displayName || displayName.length > 40)
      return validationError(
        "Invitation name is required and must be 40 characters or fewer.",
      );
    if (
      !Number.isInteger(input.seatCount) ||
      input.seatCount < 1 ||
      input.seatCount > MAX_SEATS
    )
      return validationError("Seats must be between 1 and 12.");
    const current = await database
      .prepare(
        `SELECT updated_at FROM households WHERE id=? AND status='active'`,
      )
      .bind(input.id)
      .first<{ updated_at: string }>();
    if (!current) return validationError("Household not found.");
    const currentSeats = (
      await database
        .prepare(
          `SELECT id,slot,kind,invited_name,name FROM invite_seats WHERE household_id=? AND status='active' ORDER BY slot`,
        )
        .bind(input.id)
        .all<{
          id: number;
          slot: number;
          kind: "member" | "plus_one";
          invited_name: string | null;
          name: string | null;
        }>()
    ).results;
    const byId = new Map(currentSeats.map((seat) => [seat.id, seat]));
    const retiredIds = new Set(
      input.seats
        .filter((seat) => seat.retire && seat.id)
        .map((seat) => seat.id!),
    );
    const removedIds = new Set(input.removeSeatIds ?? []);
    for (const removedId of removedIds) {
      const removed = byId.get(removedId);
      if (!removed || removed.kind !== "plus_one" || removed.name) {
        return validationError(
          "Only an unnamed open seat with no activity can be removed.",
        );
      }
      const activity = await database
        .prepare(
          `SELECT EXISTS (SELECT 1 FROM response_seats WHERE seat_id=?) OR EXISTS (SELECT 1 FROM seat_assignments WHERE seat_id=?) AS active`,
        )
        .bind(removedId, removedId)
        .first<{ active: number }>();
      if (activity?.active)
        return validationError(
          "Only an unnamed open seat with no activity can be removed.",
        );
    }
    const resultingMembers = currentSeats.filter(
      (seat) => seat.kind === "member" && !retiredIds.has(seat.id),
    );
    if (resultingMembers.length < 1)
      return validationError(
        "A household needs at least one member. Archive the household instead.",
      );
    if (input.seatCount < resultingMembers.length)
      return validationError(
        "Seats cannot be fewer than the active member count.",
      );
    for (const seat of input.seats) {
      if (!seat.id || seat.retire) continue;
      const currentSeat = byId.get(seat.id);
      if (!currentSeat)
        return validationError("Household changed. Reload to see the latest.");
      if (currentSeat.kind === "member" && !seat.name.trim())
        return validationError("Member seat names cannot be blank.");
    }
    const activeAfterRetire = currentSeats.filter(
      (seat) => !retiredIds.has(seat.id) && !removedIds.has(seat.id),
    );
    const duplicateCandidates = input.seats
      .filter(
        (seat) => !seat.retire && seat.kind !== "plus_one" && seat.name.trim(),
      )
      .map((seat) => ({ id: seat.id, key: duplicateNameKey(seat.name) }));
    const draftKeys = new Set<string>();
    for (const candidate of duplicateCandidates) {
      if (draftKeys.has(candidate.key))
        return validationError(
          `The name “${candidate.key}” is already in this draft.`,
        );
      draftKeys.add(candidate.key);
    }
    if (duplicateCandidates.length) {
      const existing = (
        await database
          .prepare(
            `SELECT s.id,s.household_id,s.name,s.invited_name,h.display_name FROM invite_seats s JOIN households h ON h.id=s.household_id WHERE h.status='active' AND s.status='active' AND (s.name IS NOT NULL OR s.invited_name IS NOT NULL)`,
          )
          .all<{
            id: number;
            household_id: string;
            name: string | null;
            invited_name: string | null;
            display_name: string;
          }>()
      ).results;
      const confirmed = new Set(
        (input.confirmedNames ?? []).map(duplicateNameKey),
      );
      for (const candidate of duplicateCandidates) {
        const match = existing.find(
          (seat) =>
            seat.household_id !== input.id &&
            [seat.name, seat.invited_name].some(
              (value) => value && duplicateNameKey(value) === candidate.key,
            ),
        );
        if (match && !confirmed.has(candidate.key))
          return validationError(
            `${candidate.key} is already invited with ${match.display_name}.`,
          );
      }
    }
    const target = input.seatCount;
    if (target < activeAfterRetire.length) {
      const trailing = activeAfterRetire.at(-1)!;
      if (trailing.name)
        return validationError(
          `Seat ${trailing.slot} has activity. Review or retire this seat first.`,
        );
      const activity = await database
        .prepare(
          `SELECT EXISTS (SELECT 1 FROM response_seats WHERE seat_id=?) OR EXISTS (SELECT 1 FROM seat_assignments WHERE seat_id=?) AS active`,
        )
        .bind(trailing.id, trailing.id)
        .first<{ active: number }>();
      if (activity?.active)
        return validationError(
          `Seat ${trailing.slot} has activity. Review or retire this seat first.`,
        );
    }
    const now = new Date().toISOString();
    const token = input.updatedAt ?? "";
    // This must remain the first statement. SQLite rolls back the whole D1 batch when
    // a stale token sets the NOT NULL updated_at column to NULL.
    const statements: D1PreparedStatement[] = [
      database
        .prepare(
          `UPDATE households SET updated_at=CASE WHEN updated_at=? THEN ? ELSE NULL END,updated_by=? WHERE id=? AND status='active'`,
        )
        .bind(token, now, actor, input.id),
    ];
    statements.push(
      label === undefined
        ? database
            .prepare(`UPDATE households SET display_name=?,notes=? WHERE id=?`)
            .bind(displayName, input.notes?.trim() || null, input.id)
        : database
            .prepare(
              `UPDATE households SET label=?,display_name=?,notes=? WHERE id=?`,
            )
            .bind(label, displayName, input.notes?.trim() || null, input.id),
    );
    for (const seat of input.seats) {
      if (!seat.id) continue;
      const currentSeat = byId.get(seat.id);
      if (!currentSeat) continue;
      if (seat.retire) {
        const assigned = await database
          .prepare(`SELECT id FROM seat_assignments WHERE seat_id=? LIMIT 1`)
          .bind(seat.id)
          .first();
        if (assigned)
          return validationError(
            "Seat is assigned to a table. Review the seating plan first.",
          );
        statements.push(
          database
            .prepare(
              `UPDATE invite_seats SET status='retired',slot=NULL,retired_at=?,retired_by=?,updated_at=?,updated_by=? WHERE id=? AND household_id=? AND status='active'`,
            )
            .bind(now, actor, now, actor, seat.id, input.id),
        );
        continue;
      }
      const clean = seat.name.trim();
      const invited =
        currentSeat.kind === "member"
          ? seat.invitedName?.trim() || currentSeat.invited_name || clean
          : null;
      const invitedChanged =
        currentSeat.kind === "member" && invited !== currentSeat.invited_name;
      const nextName =
        invitedChanged && clean === (currentSeat.invited_name ?? "")
          ? invited
          : clean || null;
      const nameChanged = nextName !== currentSeat.name;
      if (nameChanged && invitedChanged) {
        const key = normalizeGuestName(invited!);
        statements.push(
          database
            .prepare(
              `UPDATE invite_seats SET name=?,invited_name=?,name_key=?,surname_key=?,named_by_kind='host',named_by=?,named_at=?,updated_at=?,updated_by=? WHERE id=? AND household_id=? AND status='active'`,
            )
            .bind(
              nextName,
              invited,
              key,
              key.split(" ").at(-1) || null,
              actor,
              now,
              now,
              actor,
              seat.id,
              input.id,
            ),
        );
      } else if (nameChanged) {
        statements.push(
          database
            .prepare(
              `UPDATE invite_seats SET name=?,named_by_kind='host',named_by=?,named_at=?,updated_at=?,updated_by=? WHERE id=? AND household_id=? AND status='active'`,
            )
            .bind(nextName, actor, now, now, actor, seat.id, input.id),
        );
      } else if (invitedChanged) {
        const key = normalizeGuestName(invited!);
        statements.push(
          database
            .prepare(
              `UPDATE invite_seats SET invited_name=?,name_key=?,surname_key=?,updated_at=?,updated_by=? WHERE id=? AND household_id=? AND status='active'`,
            )
            .bind(
              invited,
              key,
              key.split(" ").at(-1) || null,
              now,
              actor,
              seat.id,
              input.id,
            ),
        );
      }
    }
    const currentSlots = new Set(activeAfterRetire.map((seat) => seat.slot));
    for (const removedId of removedIds)
      statements.push(
        database
          .prepare(
            `DELETE FROM invite_seats WHERE id=? AND household_id=? AND status='active'`,
          )
          .bind(removedId, input.id),
      );
    if (target < activeAfterRetire.length) {
      const removals = activeAfterRetire.slice(target).reverse();
      for (const seat of removals)
        statements.push(
          database
            .prepare(
              `DELETE FROM invite_seats WHERE id=? AND household_id=? AND status='active' AND name IS NULL AND NOT EXISTS (SELECT 1 FROM response_seats WHERE seat_id=?) AND NOT EXISTS (SELECT 1 FROM seat_assignments WHERE seat_id=?)`,
            )
            .bind(seat.id, input.id, seat.id, seat.id),
        );
    }
    const pendingPlusOnes = input.seats.filter(
      (seat) => !seat.id && !seat.retire,
    );
    for (let count = activeAfterRetire.length; count < target; count += 1) {
      let slot = 1;
      while (currentSlots.has(slot)) slot += 1;
      currentSlots.add(slot);
      const pending = pendingPlusOnes[count - activeAfterRetire.length];
      const name = pending?.name.trim() || null;
      const kind = pending?.kind ?? "plus_one";
      const key = kind === "member" && name ? normalizeGuestName(name) : null;
      statements.push(
        database
          .prepare(
            `INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,named_by_kind,named_by,named_at,created_at,updated_at,updated_by) VALUES (?, ?, ?,'active',?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            input.id,
            kind,
            slot,
            kind === "member" ? name : null,
            key,
            key ? key.split(" ").at(-1) : null,
            name,
            name ? "host" : null,
            name ? actor : null,
            name ? now : null,
            now,
            now,
            actor,
          ),
      );
    }
    try {
      await database.batch(statements);
    } catch (error) {
      if (
        String(error).toLowerCase().includes("not null constraint") &&
        String(error).toLowerCase().includes("updated_at")
      )
        throw new StaleHouseholdError();
      throw error;
    }
    return { ok: true as const };
  }
  async function addHousehold(input: NewHouseholdInput, actor: string) {
    const label = input.label.trim();
    const displayName = input.displayName.trim();
    const names = input.seats.map((seat) => seat.name.trim());
    const seatCount = input.seatCount ?? names.length;
    if (!label || label.length > 80)
      throw new Error(
        "Host label is required and must be 80 characters or fewer.",
      );
    const duplicateLabel = await database
      .prepare(
        `SELECT id FROM households WHERE status='active' AND lower(label)=lower(?)`,
      )
      .bind(label)
      .first();
    if (duplicateLabel) throw new Error("Host ID is already in use.");
    if (!displayName || displayName.length > 40)
      throw new Error(
        "Invitation name is required and must be 40 characters or fewer.",
      );
    if (!names.length || names.some((name) => !name))
      throw new Error("At least one member name is required.");
    if (
      !Number.isInteger(seatCount) ||
      seatCount < names.length ||
      seatCount > MAX_SEATS
    )
      throw new Error("Seats must be between the member count and 12.");
    const normalizedNames = names.map(duplicateNameKey);
    if (new Set(normalizedNames).size !== normalizedNames.length)
      throw new Error("A guest name can only be added once.");
    const existing = (
      await database
        .prepare(
          `SELECT s.name,s.invited_name,h.display_name FROM invite_seats s JOIN households h ON h.id=s.household_id WHERE h.status='active' AND s.status='active'`,
        )
        .all<{
          name: string | null;
          invited_name: string | null;
          display_name: string;
        }>()
    ).results;
    const confirmed = new Set(
      (input.confirmedNames ?? []).map(duplicateNameKey),
    );
    for (const name of names) {
      const key = duplicateNameKey(name);
      const match = existing.find((seat) =>
        [seat.name, seat.invited_name].some(
          (value) => value && duplicateNameKey(value) === key,
        ),
      );
      if (match && !confirmed.has(key))
        throw new Error(
          `${name} is already invited with ${match.display_name}.`,
        );
    }
    const base =
      input.label
        .trim()
        .toLocaleLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "household";
    let id = base;
    let n = 2;
    while (
      await database
        .prepare(`SELECT id FROM households WHERE id=?`)
        .bind(id)
        .first()
    )
      id = `${base}-${n++}`;
    const existingTickets = await database
      .prepare(`SELECT ticket_code FROM households`)
      .all<{ ticket_code: string }>();
    const used = new Set(existingTickets.results.map((row) => row.ticket_code));
    const ticket = randomTicket(used);
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      database
        .prepare(
          `INSERT INTO households (id,label,display_name,ticket_code,status,notes,created_at,updated_at,updated_by) VALUES (?,?,?,?,'active',?,?,?,?)`,
        )
        .bind(
          id,
          label,
          displayName,
          ticket,
          input.notes?.trim() || null,
          now,
          now,
          actor,
        ),
    ];
    for (let index = 0; index < seatCount; index += 1) {
      const clean = names[index] ?? null;
      const key = clean ? normalizeGuestName(clean) : null;
      statements.push(
        database
          .prepare(
            `INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at,updated_by) VALUES (?, ?, ?,'active',?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            clean ? "member" : "plus_one",
            index + 1,
            clean,
            key,
            key ? key.split(" ").at(-1) : null,
            clean,
            now,
            now,
            actor,
          ),
      );
    }
    await database.batch(statements);
    return { id };
  }
  async function archiveHousehold(
    id: string,
    actor: string,
    updatedAt?: string,
  ) {
    const current = await database
      .prepare(
        `SELECT updated_at FROM households WHERE id=? AND status='active'`,
      )
      .bind(id)
      .first<{ updated_at: string }>();
    if (!current) return;
    const now = new Date().toISOString();
    const statements = [
      database
        .prepare(
          `UPDATE households SET updated_at=CASE WHEN updated_at=? THEN ? ELSE NULL END,updated_by=? WHERE id=? AND status='active'`,
        )
        .bind(updatedAt ?? current.updated_at, now, actor, id),
      database
        .prepare(
          `UPDATE households SET status='archived',archived_at=?,archived_by=? WHERE id=? AND status='active'`,
        )
        .bind(now, actor, id),
    ];
    try {
      await database.batch(statements);
    } catch (error) {
      if (
        String(error).toLowerCase().includes("not null constraint") &&
        String(error).toLowerCase().includes("updated_at")
      )
        throw new StaleHouseholdError();
      throw error;
    }
  }
  return {
    getOverview,
    getGuestList,
    getRsvpList,
    getRsvpDetail,
    getSlipperOrder,
    getSongRequests,
    getNavCounts,
    saveHousehold,
    saveRsvp,
    addHousehold,
    archiveHousehold,
  };
}
