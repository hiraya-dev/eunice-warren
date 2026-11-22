import type { Invite, RsvpSeat } from "./store.ts";
import { normalizeGuestName } from "./store.ts";
import { SLIPPER_SIZES } from "./slippers.ts";
import { MAX_SEATS } from "./limits.ts";

export const RSVP_DEADLINE = "2026-12-12T23:59:59+08:00";
export const RSVP_DEADLINE_TIME = new Date(RSVP_DEADLINE).getTime();

const damerauLevenshteinDistance = (a: string, b: string) => {
  const matrix = Array.from({ length: a.length + 1 }, (_, row) =>
    Array.from({ length: b.length + 1 }, (_, column) =>
      row === 0 ? column : column === 0 ? row : 0,
    ),
  );
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      if (
        row > 1 &&
        column > 1 &&
        a[row - 1] === b[column - 2] &&
        a[row - 2] === b[column - 1]
      ) {
        matrix[row][column] = Math.min(
          matrix[row][column],
          matrix[row - 2][column - 2] + 1,
        );
      }
    }
  }
  return matrix[a.length][b.length];
};

/** Returns a name only when one distinct, safe near match exists. */
export function findNearGuestName(
  query: string,
  invites: Invite[],
  duplicateIds: string[] = [],
  duplicateNames: string[] = [],
) {
  const wanted = normalizeGuestName(query).split(" ");
  if (wanted.length < 2) return null;
  const duplicateIdSet = new Set(duplicateIds);
  const duplicateNameSet = new Set(duplicateNames);
  const matches = new Map<string, string>();
  for (const invite of invites) {
    if (invite.id && duplicateIdSet.has(invite.id)) continue;
    for (const member of invite.members) {
      const normalized = normalizeGuestName(member);
      if (duplicateNameSet.has(normalized)) continue;
      const tokens = normalized.split(" ");
      if (wanted.at(-1) !== tokens.at(-1) || wanted.length > tokens.length) continue;
      const firstMatches = wanted[0] === tokens[0] ||
        (tokens[0].length >= 5 && damerauLevenshteinDistance(wanted[0], tokens[0]) === 1);
      if (!firstMatches) continue;
      const middleCount = tokens.length - 2;
      if (wanted.length > 2 &&
        wanted.slice(1, -1).join(" ") !== tokens.slice(1, 1 + middleCount).join(" ")) continue;
      matches.set(normalized, member);
    }
  }
  return matches.size === 1 ? matches.values().next().value ?? null : null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};
const fromBase64Url = (value: string) => {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export const isRsvpClosed = (now = Date.now()) => now > RSVP_DEADLINE_TIME;

export interface SubmissionProblem {
  seatId?: number;
  field: "answer" | "seats" | "name" | "slipperSize" | "note";
  message: string;
}

/** Cloudflare's Workers rate-limit binding takes an options object, not a bare key. */
export type RateLimiter = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
};

export async function isWithinRateLimit(
  limiter: RateLimiter | undefined,
  key: string,
) {
  if (!limiter?.limit) return true;
  return (await limiter.limit({ key })).success;
}

export async function signRsvpToken(
  inviteId: string,
  expiresAt: number,
  secret: string,
) {
  const message = inviteId + "." + expiresAt;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return (
    toBase64Url(encoder.encode(message)) +
    "." +
    toBase64Url(new Uint8Array(signature))
  );
}

export async function verifyRsvpToken(
  token: string,
  secret: string,
  now = Date.now(),
) {
  const [encodedMessage, encodedSignature] = token.split(".");
  if (!encodedMessage || !encodedSignature) return null;
  try {
    const message = decoder.decode(fromBase64Url(encodedMessage));
    const [inviteId, expiryText] = message.split(".");
    const expiresAt = Number(expiryText);
    if (!inviteId || !Number.isFinite(expiresAt) || now >= expiresAt)
      return null;
    const expected = await signRsvpToken(inviteId, expiresAt, secret);
    const expectedBytes = fromBase64Url(expected.split(".")[1]);
    const actualBytes = fromBase64Url(encodedSignature);
    if (expectedBytes.length !== actualBytes.length) return null;
    let different = 0;
    for (let index = 0; index < expectedBytes.length; index += 1)
      different |= expectedBytes[index] ^ actualBytes[index];
    return different === 0 ? { inviteId, expiresAt } : null;
  } catch {
    return null;
  }
}

export function parseGuestRows(rows: unknown[][]): {
  invites: Invite[];
  duplicateIds: string[];
  duplicateNames: string[];
} {
  const invites: Invite[] = [];
  const ids = new Set<string>();
  const names = new Map<string, string>();
  const duplicateIds = new Set<string>();
  const duplicateNames = new Set<string>();
  for (const row of rows) {
    const [id, household, membersValue, seatsValue] = row.map((value) =>
      String(value ?? "").trim(),
    );
    if (!id) continue;
    const members = membersValue
      .split(",")
      .map((member) => member.trim())
      .filter(Boolean);
    const invite = {
      id,
      householdName: household,
      ticketCode: id,
      members,
      seats: Number.parseInt(seatsValue, 10) || 2,
    };
    if (ids.has(id)) duplicateIds.add(id);
    ids.add(id);
    for (const member of members) {
      const normalized = normalizeGuestName(member);
      if (names.has(normalized)) duplicateNames.add(normalized);
      names.set(normalized, id);
    }
    invites.push(invite);
  }
  return {
    invites,
    duplicateIds: [...duplicateIds],
    duplicateNames: [...duplicateNames],
  };
}

export function validateSubmissionProblems(input: {
  attending: boolean | null;
  seats: RsvpSeat[];
  invite: Invite;
  note?: string | null;
  requireMemberNames?: boolean;
}): SubmissionProblem[] {
  const problems: SubmissionProblem[] = [];
  if (input.attending === null) {
    problems.push({ field: "answer", message: "Choose Yes or No." });
    return problems;
  }
  if (input.seats.length !== input.invite.seats || input.seats.length < 1 || input.seats.length > MAX_SEATS) {
    return [{ field: "seats", message: "The invite changed. Reload and try again." }];
  }
  const expectedSeats = input.invite.seatList ?? input.invite.members.map((member, index) => ({ seatId: index + 1, kind: "member" as const, invitedName: member, name: member }));
  const expectedById = new Map(expectedSeats.map((seat) => [seat.seatId, seat]));
  const seatIds = input.seats.map((seat, index) => seat.seatId ?? index + 1);
  if (new Set(seatIds).size !== input.seats.length) return [{ field: "seats", message: "The invite changed. Reload and try again." }];
  let attendingCount = 0;
  const attendingNames = new Map<string, string>();
  for (const [index, seat] of input.seats.entries()) {
    const expected = expectedById.get(seatIds[index]);
    if (!expected) return [{ field: "seats", message: "The invite changed. Reload and try again." }];
    if (seat.name !== seat.name.trim())
      problems.push({ seatId: seatIds[index], field: "name", message: "Remove spaces before or after the name." });
    if (seat.name.length > 120) problems.push({ seatId: seatIds[index], field: "name", message: "Keep names under 120 characters." });
    if (input.requireMemberNames && expected.kind === "member" && !seat.name.trim()) {
      problems.push({ seatId: seatIds[index], field: "name", message: "Add a name, or untick the seat." });
    }
    if (seat.attending) {
      if (!input.attending || !seat.name.trim()) {
        problems.push({ seatId: seatIds[index], field: "name", message: "Add a name to tick this seat." });
        continue;
      }
      const normalizedName = normalizeGuestName(seat.name);
      const previousName = attendingNames.get(normalizedName);
      if (previousName) problems.push({ seatId: seatIds[index], field: "name", message: `${seat.name} is on two seats. Change one of them.` });
      attendingNames.set(normalizedName, seat.name);
      if (!seat.slipperSize || !SLIPPER_SIZES.includes(seat.slipperSize as (typeof SLIPPER_SIZES)[number])) {
        problems.push({ seatId: seatIds[index], field: "slipperSize", message: `Pick a slipper size for ${seat.name.trim().split(/\s+/)[0]}.` });
      }
      attendingCount += 1;
    } else {
      if (seat.slipperSize) problems.push({ seatId: seatIds[index], field: "slipperSize", message: "Clear the slipper size for a seat that is not coming." });
    }
  }
  if (input.attending && attendingCount === 0) problems.push({ field: "seats", message: "Tick at least one guest, or choose No." });
  if (input.note && input.note.length > 1000) problems.push({ field: "note", message: "Keep the note under 1,000 characters." });
  return problems;
}

export function validateSubmission(input: {
  attending: boolean;
  seats: RsvpSeat[];
  invite: Invite;
}) {
  return validateSubmissionProblems(input).length === 0;
}

export const submissionProblems = validateSubmissionProblems;
