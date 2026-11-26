import { and, desc, eq, exists, inArray, sql, aliasedTable } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { inviteSeats, households, responseSeats, responses, seatAssignments } from "../db/schema.ts";
import type { D1Database, D1PreparedStatement } from "../db/types.ts";
import { lookupInvite } from "./lookup.ts";
import type { Invite, InviteLookup, PreviousRsvp, RsvpStore, RsvpSubmission } from "./store.ts";
import { normalizeGuestName } from "./store.ts";
import { MAX_SEATS } from "./limits.ts";

export class InviteChangedError extends Error {
  constructor() {
    super("invite changed");
    this.name = "InviteChangedError";
  }
}

const toInvite = (household: typeof households.$inferSelect, seats: (typeof inviteSeats.$inferSelect)[]): Invite => ({
  householdName: household.displayName,
  ticketCode: household.ticketCode,
  seatList: seats.filter((seat) => seat.status === "active").sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).map((seat) => ({ seatId: seat.id, kind: seat.kind, invitedName: seat.invitedName, name: seat.name })),
  members: seats.filter((seat) => seat.status === "active" && seat.kind === "member").sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).map((seat) => seat.invitedName!).filter(Boolean),
  seats: seats.filter((seat) => seat.status === "active").length,
});

const previousFor = async (db: ReturnType<typeof getDb>, householdId: string, seats: (typeof inviteSeats.$inferSelect)[]): Promise<PreviousRsvp | null> => {
  const latest = db.select({ id: responses.id })
    .from(responses)
    .where(eq(responses.householdId, householdId))
    .orderBy(desc(responses.submittedAt), desc(responses.id))
    .limit(1);
  const rows = await db.select({ response: responses, seat: responseSeats })
    .from(responses)
    .leftJoin(responseSeats, eq(responseSeats.responseId, responses.id))
    .where(and(eq(responses.householdId, householdId), inArray(responses.id, latest)));
  const latestRow = rows[0];
  if (!latestRow) return null;
  const saved = rows.flatMap(({ seat }) => seat ? [seat] : []);
  const latestResponse = latestRow.response;
  const bySeat = new Map(saved.filter((seat) => seat.seatId !== null).map((seat) => [seat.seatId!, seat]));
  return {
    attending: Boolean(latestResponse.attending),
    seats: seats.filter((seat) => seat.status === "active").sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).map((seat) => {
      const savedSeat = bySeat.get(seat.id);
      return {
        seatId: seat.id,
        original: seat.invitedName,
        shownName: seat.name,
        name: seat.name ?? "",
        attending: latestResponse.attending
          ? (savedSeat ? Boolean(savedSeat.attending) : seat.kind === "member")
          : seat.kind === "member",
        slipperSize: savedSeat?.slipperSize ?? undefined,
      };
    }),
  };
};

const groupedInvites = (rows: Array<{ household: typeof households.$inferSelect; seat: typeof inviteSeats.$inferSelect }>): Invite[] => {
  const byHousehold = new Map<string, { household: typeof households.$inferSelect; seats: (typeof inviteSeats.$inferSelect)[] }>();
  for (const row of rows) {
    const entry = byHousehold.get(row.household.id) ?? { household: row.household, seats: [] };
    entry.seats.push(row.seat);
    byHousehold.set(row.household.id, entry);
  }
  return [...byHousehold.values()].map(({ household, seats }) => toInvite(household, seats));
};

export interface D1QueryCounter { count: number }

const countQueries = (database: D1Database, counter: D1QueryCounter): D1Database => {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped: D1PreparedStatement = {
    bind: (...values) => wrap(statement.bind(...values)),
    first: async (column) => { counter.count += 1; return statement.first(column); },
    raw: async () => { counter.count += 1; return statement.raw(); },
    all: async <T = Record<string, unknown>>() => { counter.count += 1; return statement.all<T>(); },
    run: async () => { counter.count += 1; return statement.run(); },
    };
    originals.set(wrapped, statement);
    return wrapped;
  };
  return {
    prepare: (query) => wrap(database.prepare(query)),
    batch: async (statements) => { counter.count += 1; return database.batch(statements.map((statement) => originals.get(statement) ?? statement) as unknown as typeof statements); },
  };
};

export const createD1RsvpStore = (database: D1Database, queryCounter?: D1QueryCounter): RsvpStore => {
  const db = getDb(queryCounter ? countQueries(database, queryCounter) : database);
  const findInviteByTicketCode = async (ticketCode: string, name: string): Promise<InviteLookup> => {
    const household = (await db.select().from(households).where(and(eq(households.ticketCode, ticketCode), eq(households.status, "active"))).limit(1))[0];
    if (!household) return null;
    const activeSeats = await db.select().from(inviteSeats).where(and(eq(inviteSeats.householdId, household.id), eq(inviteSeats.status, "active"))).orderBy(inviteSeats.slot);
    const invite = toInvite(household, activeSeats);
    const match = lookupInvite(name, [invite]);
    if (!match || !match.invite) return match;
    return { invite, householdId: household.id, matchedName: match.matchedName, previous: await previousFor(db, household.id, activeSeats) };
  };
  return {
    async findInvite(name, options): Promise<InviteLookup> {
      const key = normalizeGuestName(name);
      const matchedSeat = aliasedTable(inviteSeats, "matched_seat");
      const exactRows = await db.select({ household: households, seat: inviteSeats }).from(inviteSeats)
        .innerJoin(households, eq(inviteSeats.householdId, households.id))
        .where(and(eq(households.status, "active"), eq(inviteSeats.status, "active"), exists(
          db.select({ id: matchedSeat.id }).from(matchedSeat).where(and(
            eq(matchedSeat.householdId, households.id),
            eq(matchedSeat.status, "active"),
            eq(matchedSeat.nameKey, key),
          )),
        )));
      let candidates = groupedInvites(exactRows);
      let matchedRows = exactRows;
      let result = lookupInvite(name, candidates);
      if (!result || !result.invite) {
        const surname = key.split(" ").at(-1) ?? key;
        const matchedSeat = aliasedTable(inviteSeats, "matched_surname_seat");
        const nearRows = await db.select({ household: households, seat: inviteSeats }).from(inviteSeats)
          .innerJoin(households, eq(inviteSeats.householdId, households.id))
          .where(and(eq(households.status, "active"), eq(inviteSeats.status, "active"), exists(
            db.select({ id: matchedSeat.id }).from(matchedSeat).where(and(
              eq(matchedSeat.householdId, households.id),
              eq(matchedSeat.status, "active"),
              eq(matchedSeat.surnameKey, surname),
            )),
          )));
        matchedRows = nearRows;
        candidates = groupedInvites(nearRows);
        result = lookupInvite(name, candidates);
      }
      if (!result || !result.invite) return result;
      const matchedRow = matchedRows.find((row) => row.household.ticketCode === result.invite?.ticketCode);
      if (!matchedRow || !result.invite) return null;
      const activeRows = matchedRows.filter((row) => row.household.id === matchedRow.household.id);
      const activeSeats = activeRows.map(({ seat }) => seat);
      const invite = toInvite(matchedRow.household, activeSeats);
      return { invite, householdId: matchedRow.household.id, matchedName: result.matchedName, previous: options?.includePrevious === false ? null : await previousFor(db, matchedRow.household.id, activeSeats) };
    },
    findInviteByTicketCode,
    async submit(submission: RsvpSubmission) {
      const household = await db.select({ id: households.id }).from(households).where(and(eq(households.id, submission.inviteId), eq(households.status, "active"))).limit(1);
      if (!household[0]) throw new InviteChangedError();
      const active = await db.select().from(inviteSeats)
        .where(and(eq(inviteSeats.householdId, submission.inviteId), eq(inviteSeats.status, "active")))
        .orderBy(inviteSeats.slot);
      if (active.length < 1 || active.length > MAX_SEATS || active.length !== submission.seats.length) throw new InviteChangedError();
      const byId = new Map(active.map((seat) => [seat.id, seat]));
      if (submission.seats.some((seat) => typeof seat.seatId !== "number" || !byId.has(seat.seatId))) throw new InviteChangedError();
      const previousNote = (await db.select({ note: responses.note })
        .from(responses)
        .where(and(eq(responses.householdId, submission.inviteId), sql`trim(${responses.note}) <> ''`))
        .orderBy(desc(responses.submittedAt), desc(responses.id))
        .limit(1))[0]?.note;
      const now = new Date().toISOString();
      const responseId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      const response = db.insert(responses).values({ id: responseId, householdId: submission.inviteId, submittedAt: now, respondentName: submission.name, attending: submission.attending, guestCount: submission.guests, email: submission.email, note: submission.note?.trim() ? submission.note : previousNote ?? null, source: "guest", editedBy: null });
      const seatRows = db.insert(responseSeats).values(submission.seats.map((seat) => ({ responseId, seatId: seat.seatId!, kind: byId.get(seat.seatId!)!.kind, name: seat.name, attending: seat.attending, slipperSize: seat.slipperSize ?? null })));
      const updates = submission.seats.flatMap((seat) => {
        const current = byId.get(seat.seatId!)!;
        const shownName = seat.shownName ?? current.name ?? "";
        if (!seat.name.trim() || seat.name === shownName) return [];
        return [db.update(inviteSeats).set({ name: seat.name, namedByKind: "guest", namedBy: submission.name, namedAt: now, namedInResponseId: responseId, updatedAt: now, updatedBy: null }).where(eq(inviteSeats.id, current.id))];
      });
      const householdTouch = db.update(households).set({ updatedAt: now }).where(eq(households.id, submission.inviteId));
      await db.batch([response, seatRows, householdTouch, ...updates] as [typeof response, typeof seatRows, typeof householdTouch, ...typeof updates]);
    },
  };
};

const actorValues = (actor: string, now = new Date().toISOString()) => ({ updatedAt: now, updatedBy: actor });

export async function addSeat(database: D1Database, householdId: string, actor: string) {
  const db = getDb(database);
  const active = await db.select().from(inviteSeats).where(and(eq(inviteSeats.householdId, householdId), eq(inviteSeats.status, "active"))).orderBy(inviteSeats.slot);
  if (active.length >= MAX_SEATS) throw new Error("maximum seats");
  const used = new Set(active.map((seat) => seat.slot));
  const slot = Array.from({ length: MAX_SEATS }, (_, index) => index + 1).find((candidate) => !used.has(candidate))!;
  const now = new Date().toISOString();
  await db.insert(inviteSeats).values({ householdId, kind: "plus_one", slot, status: "active", ...actorValues(actor, now), createdAt: now });
  return slot;
}

export async function removeTrailingSeat(database: D1Database, householdId: string, actor: string) {
  const db = getDb(database);
  const active = await db.select().from(inviteSeats).where(and(eq(inviteSeats.householdId, householdId), eq(inviteSeats.status, "active"))).orderBy(desc(inviteSeats.slot));
  const trailing = active[0];
  if (!trailing) return { removed: false as const };
  const responded = await db.select({ id: responseSeats.id }).from(responseSeats).where(eq(responseSeats.seatId, trailing.id)).limit(1);
  const assigned = await db.select({ id: seatAssignments.id }).from(seatAssignments).where(eq(seatAssignments.seatId, trailing.id)).limit(1);
  if (trailing.name || responded[0] || assigned[0]) return { blocked: `Seat ${trailing.slot} has activity. Review or retire this seat first.` };
  if (trailing.kind === "member" && active.filter((seat) => seat.kind === "member").length <= 1) {
    const now = new Date().toISOString();
    await db.update(households).set({ status: "archived", archivedAt: now, archivedBy: actor, ...actorValues(actor, now) }).where(eq(households.id, householdId));
    return { archived: true as const };
  }
  await db.delete(inviteSeats).where(eq(inviteSeats.id, trailing.id));
  return { removed: true as const };
}

export async function retireSeat(database: D1Database, seatId: number, actor: string) {
  const db = getDb(database);
  const seat = (await db.select().from(inviteSeats).where(eq(inviteSeats.id, seatId)).limit(1))[0];
  if (!seat) throw new Error("seat not found");
  const assigned = await db.select({ id: seatAssignments.id }).from(seatAssignments).where(eq(seatAssignments.seatId, seatId)).limit(1);
  if (assigned[0]) return { blocked: "Seat is assigned to a table. Review the seating plan first." };
  const now = new Date().toISOString();
  if (seat.kind === "member") {
    const members = await db.select({ id: inviteSeats.id }).from(inviteSeats).where(and(eq(inviteSeats.householdId, seat.householdId), eq(inviteSeats.status, "active"), eq(inviteSeats.kind, "member")));
    if (members.length <= 1) {
      await db.update(households).set({ status: "archived", archivedAt: now, archivedBy: actor, ...actorValues(actor, now) }).where(eq(households.id, seat.householdId));
      return { archived: true as const };
    }
  }
  await db.update(inviteSeats).set({ status: "retired", slot: null, retiredAt: now, retiredBy: actor, ...actorValues(actor, now) }).where(eq(inviteSeats.id, seatId));
  return { retired: true as const };
}

export async function setInvitedName(database: D1Database, seatId: number, invitedName: string, actor: string) {
  const db = getDb(database);
  const current = (await db.select().from(inviteSeats).where(eq(inviteSeats.id, seatId)).limit(1))[0];
  if (!current) throw new Error("seat not found");
  if (current.kind !== "member") return { blocked: "Only member seats have an invited name." };
  const old = current.invitedName;
  const clean = invitedName.trim();
  const key = normalizeGuestName(clean);
  const now = new Date().toISOString();
  await db.update(inviteSeats).set({ invitedName: clean, nameKey: key, surnameKey: key.split(" ").at(-1), name: current.name === old ? clean : current.name, ...actorValues(actor, now) }).where(eq(inviteSeats.id, seatId));
  return { updated: true as const };
}

export async function setSeatName(database: D1Database, seatId: number, name: string, actor: string) {
  const db = getDb(database);
  const current = (await db.select({ kind: inviteSeats.kind }).from(inviteSeats).where(eq(inviteSeats.id, seatId)).limit(1))[0];
  if (!current) throw new Error("seat not found");
  const clean = name.trim();
  if (current.kind === "member" && !clean) return { blocked: "Member seat names cannot be blank." };
  const now = new Date().toISOString();
  await db.update(inviteSeats).set({ name: clean || null, namedByKind: "host", namedBy: actor, namedAt: now, ...actorValues(actor, now) }).where(eq(inviteSeats.id, seatId));
  return { updated: true as const };
}
