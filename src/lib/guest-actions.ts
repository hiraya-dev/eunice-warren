import { isD1LimitError } from "./db/errors.ts";
import { InviteChangedError } from "./rsvp/d1.ts";
import { signRsvpToken, validateSubmission, verifyRsvpToken } from "./rsvp/logic.ts";
import type { RsvpNotificationData } from "./rsvp/notify.ts";
import type { InviteLookup, RsvpSeat, RsvpStore } from "./rsvp/store.ts";
import { SongCapError, SongRateLimitError, type SongInput, type SongStore } from "./songs/store.ts";

export type GuestActionCode = "CONFLICT" | "INTERNAL_SERVER_ERROR" | "SERVICE_UNAVAILABLE" | "TOO_MANY_REQUESTS" | "UNAUTHORIZED";

export class GuestActionFailure extends Error {
  readonly code: GuestActionCode;
  constructor(code: GuestActionCode, message: string) {
    super(message);
    this.name = "GuestActionFailure";
    this.code = code;
  }
}

export const selectStore = <T>(mode: string, fake: () => T, d1: () => T): T => mode === "fake" ? fake() : d1();

const unavailable = "We're busy right now, try again in a bit.";
const generic = "Something went wrong. Please try again.";
const inviteChanged = "Your invite changed. Check the seats before sending.";

export interface FindActionTiming {
  storeMs: number;
  signMs: number;
}

const storeFailure = (error: unknown): never => {
  if (error instanceof GuestActionFailure) throw error;
  if (error instanceof InviteChangedError || String(error).includes("invite changed"))
    throw new GuestActionFailure("CONFLICT", inviteChanged);
  if (isD1LimitError(error)) throw new GuestActionFailure("SERVICE_UNAVAILABLE", unavailable);
  throw new GuestActionFailure("INTERNAL_SERVER_ERROR", generic);
};

export async function buildFindActionResponse(result: InviteLookup, tokenSecret: string, expiresAt: number, timing?: FindActionTiming) {
  if (!result) return { invite: null };
  if (!result.invite) return { invite: null, suggestion: result.suggestion };
  const signStarted = performance.now();
  let token: string;
  try {
    token = await signRsvpToken(result.invite.ticketCode, expiresAt, tokenSecret);
  } finally {
    if (timing) timing.signMs = performance.now() - signStarted;
  }
  return {
    invite: {
      householdName: result.invite.householdName,
      ticketCode: result.invite.ticketCode,
      seatList: result.invite.seatList,
      members: result.invite.members,
      seats: result.invite.seats,
    },
    matchedName: result.matchedName,
    previous: result.previous,
    token,
  };
}

export async function runFindAction(store: RsvpStore, name: string, tokenSecret: string, now = Date.now(), timing?: FindActionTiming) {
  try {
    const storeStarted = performance.now();
    let result: InviteLookup;
    try {
      result = await store.findInvite(name);
    } finally {
      if (timing) timing.storeMs = performance.now() - storeStarted;
    }
    return await buildFindActionResponse(result, tokenSecret, now + 2 * 60 * 60 * 1000, timing);
  } catch (error) {
    storeFailure(error);
  }
}

export interface SubmitActionInput {
  token: string;
  name: string;
  attending: boolean;
  seats: RsvpSeat[];
  email: string;
  note?: string;
}

export async function runSubmitAction(
  store: RsvpStore,
  input: SubmitActionInput,
  tokenSecret: string,
  onSuccess?: (data: RsvpNotificationData) => void,
) {
  const tokenData = await verifyRsvpToken(input.token, tokenSecret);
  if (!tokenData) throw new GuestActionFailure("UNAUTHORIZED", generic);
  try {
    const result = await (store.findInviteByTicketCode
      ? store.findInviteByTicketCode(tokenData.inviteId, input.name)
      : store.findInvite(input.name));
    const expectedSeatIds = ((result && result.invite?.seatList) ?? []).map((seat) => seat.seatId).sort((a, b) => a - b);
    const submittedSeatIds = input.seats.map((seat) => seat.seatId).filter((id): id is number => typeof id === "number").sort((a, b) => a - b);
    if (
      !result || !result.invite || result.invite.ticketCode !== tokenData.inviteId ||
      expectedSeatIds.length !== submittedSeatIds.length || expectedSeatIds.some((id, index) => submittedSeatIds[index] !== id) ||
      !validateSubmission({ attending: input.attending, seats: input.seats, invite: result.invite })
    ) throw new GuestActionFailure("CONFLICT", inviteChanged);
    const submission = {
      inviteId: result.householdId,
      name: result.matchedName,
      attending: input.attending,
      guests: input.attending ? input.seats.filter((seat) => seat.attending).length : 0,
      seats: input.seats,
      email: input.email,
      note: input.note,
    };
    await store.submit(submission);
    onSuccess?.({
      householdId: result.householdId,
      householdName: result.invite.householdName,
      respondentName: result.matchedName,
      isUpdate: result.previous !== null,
      submission,
    });
    return { ok: true as const };
  } catch (error) {
    storeFailure(error);
  }
}

export async function runSongAction(store: SongStore, input: SongInput) {
  try {
    await store.add(input);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof SongCapError && error.kind === "song-total-cap")
      throw new GuestActionFailure("CONFLICT", "Side A is full. Thank you for all the requests!");
    if (error instanceof SongCapError && error.kind === "song-name-cap")
      throw new GuestActionFailure("CONFLICT", "That's plenty from you. We'll make room on the dance floor!");
    if (error instanceof SongRateLimitError)
      throw new GuestActionFailure("TOO_MANY_REQUESTS", "Easy on the requests. Try again in a minute.");
    storeFailure(error);
  }
}
