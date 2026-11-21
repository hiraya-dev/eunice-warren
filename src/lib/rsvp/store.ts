import { MAX_SEATS } from "./limits.ts";
import { lookupInvite } from "./lookup.ts";

export interface InviteSeat { seatId: number; kind: "member" | "plus_one"; invitedName: string | null; name: string | null }
export interface Invite { id?: string; householdName: string; ticketCode: string; seatList?: InviteSeat[]; members: string[]; seats: number }
export interface FakeInvite extends Invite { id: string; label: string }
export interface RsvpSeat { seatId?: number; original?: string | null; shownName?: string | null; name: string; attending: boolean; slipperSize?: string }
export interface PreviousRsvp { attending: boolean; seats: RsvpSeat[] }
export interface RsvpSubmission { inviteId: string; name: string; attending: boolean; guests: number; seats: RsvpSeat[]; email: string; note?: string }
export type InviteLookup = { invite: Invite; householdId: string; matchedName: string; previous: PreviousRsvp | null } | { invite: null; suggestion?: string } | null;
export interface RsvpStore { findInvite(name: string): Promise<InviteLookup>; findInviteByTicketCode?(ticketCode: string, name: string): Promise<InviteLookup>; submit(submission: RsvpSubmission): Promise<void> }

export const normalizeGuestName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u0009\u00a0\s]+/g, " ").trim().toLocaleLowerCase();
const makeInvite = (id: string, label: string, displayName: string, ticketCode: string, names: string[], total: number): FakeInvite => ({ id, label, householdName: displayName, ticketCode, seatList: [...names.map((name, index) => ({ seatId: index + 1, kind: "member" as const, invitedName: name, name })), ...Array.from({ length: total - names.length }, (_, index) => ({ seatId: names.length + index + 1, kind: "plus_one" as const, invitedName: null, name: null }))], members: names, seats: total });

export const fakeFixtures: FakeInvite[] = [
  makeInvite("santos", "Santos_Manila", "The Santos Family", "SANTOS", ["Liza Santos"], 2),
  makeInvite("reyes", "Reyes_Lipa", "Ana Reyes", "REYESA", ["Ana Reyes"], 1),
  makeInvite("cruz", "Cruz_Batangas", "The Cruz Family", "CRUZAA", ["Mateo Cruz", "Sofía Cruz", "Remedios Cruz"], 4),
  makeInvite("garcia", "Garcia_Manila", "The Garcia Family", "GARCAA", ["Paolo Garcia", "Bea Garcia"], 3),
  // Second persisted fixture, owned by the declined-guest spec in rsvp-paths (L-022).
  makeInvite("lim", "Lim_Quezon", "The Lim Family", "LIMDEC", ["Nora Lim", "Theo Lim"], 3),
  makeInvite("toledo", "Toledo_Sabang", "The Toledo Family", "T2EDOS", ["Luna Toledo"], 2),
  makeInvite("teachaburanatapaporn", "Teachaburanatapaporn_Test", "The Teachaburanatapaporn Family", "TEACH1", ["Lea Teachaburanatapaporn"], 12),
  makeInvite("long-display", "Longdisplay_Test", "The Verylongteachaburanatapaporn Family!", "LONG40", ["Nia Longsample"], 1),
  makeInvite("seat-change-test", "Fixture_Conflict", "The Fixture Family", "SEATCH", ["Seat Change Test", "Pia Fixture"], 3),
];
const pause = (duration = 2) => new Promise<void>((resolve) => setTimeout(resolve, duration));
const previousByInvite = new Map<string, PreviousRsvp>();
const seatNames = new Map<string, Map<number, string>>();
let seatChangePending = false;

const fixtureInvite = (fixture: FakeInvite): FakeInvite => {
  if (fixture.id !== "seat-change-test" || !seatChangePending) return currentInvite(fixture);
  const changed = currentInvite(fixture);
  const kept = changed.seatList?.filter((seat) => seat.seatId !== 2) ?? [];
  return { ...changed, seatList: kept, members: ["Seat Change Test"], seats: kept.length };
};

const currentInvite = (fixture: FakeInvite): FakeInvite => ({
  ...fixture,
  seatList: fixture.seatList?.map((seat) => ({
    ...seat,
    name: seatNames.get(fixture.id)?.get(seat.seatId) ?? seat.name,
  })),
});

export const createFakeRsvpStore = (fixtureSource: FakeInvite[] = fakeFixtures): RsvpStore => {
  return {
    async findInvite(name) {
      await pause();
      if (normalizeGuestName(name) === "error test") throw new Error("fictional RSVP lookup failure");
      const fixtures = fixtureSource.map(fixtureInvite);
      const result = lookupInvite(name, fixtures);
      if (!result || !result.invite) return result;
      const householdId = result.invite.id!;
      if (householdId === "seat-change-test" && seatChangePending) seatChangePending = false;
      return { ...result, householdId, previous: previousByInvite.get(householdId) ?? null };
    },
    async findInviteByTicketCode(ticketCode, name) {
      const fixture = fixtureSource.find((item) => item.ticketCode === ticketCode);
      if (!fixture) return null;
      if (fixture.id === "seat-change-test") seatChangePending = true;
      const result = lookupInvite(name, [fixtureInvite(fixture)]);
      if (!result || !result.invite) return result;
      return { ...result, householdId: fixture.id, previous: previousByInvite.get(fixture.id) ?? null };
    },
    async submit(submission) {
      await pause();
      const fixture = fixtureSource.find((item) => item.id === submission.inviteId);
      if (!fixture) throw new Error("invite changed");
      const active = currentInvite(fixture).seatList ?? [];
      if (submission.seats.length !== active.length || submission.seats.some((seat) => !active.some((candidate) => candidate.seatId === seat.seatId))) throw new Error("invite changed");
      const normalizedNames = submission.seats.filter((seat) => seat.attending).map((seat) => normalizeGuestName(seat.name)).filter(Boolean);
      if (new Set(normalizedNames).size !== normalizedNames.length) throw new Error("duplicate guest names");
      const names = seatNames.get(fixture.id) ?? new Map<number, string>();
      for (const seat of submission.seats) {
        const current = active.find((candidate) => candidate.seatId === seat.seatId)!;
        const shown = seat.shownName ?? current.name ?? "";
        if (seat.name.trim() && seat.name !== shown) names.set(seat.seatId!, seat.name);
      }
      // Garcia (rsvp.spec) and Lim (rsvp-paths.spec) are the dedicated
      // returning-guest fixtures, one per spec. Keeping every fixture's writes
      // would leak state across parallel Playwright workers (L-022).
      if (fixture.id === "garcia" || fixture.id === "lim") {
        seatNames.set(fixture.id, names);
        previousByInvite.set(fixture.id, { attending: submission.attending, seats: submission.seats.map((item) => ({ ...item })) });
      }
    },
  };
};
export { MAX_SEATS };
