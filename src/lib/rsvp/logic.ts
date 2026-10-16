export const RSVP_DEADLINE = "2026-12-31T23:59:59+08:00";
export const RSVP_DEADLINE_TIME = new Date(RSVP_DEADLINE).getTime();

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
      members,
      seats: Number.parseInt(seatsValue, 10) || 2,
    };
    if (ids.has(id)) duplicateIds.add(id);
    ids.add(id);
    for (const member of members) {
      const normalized = normalize(member);
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

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();

export function validateSubmission(input: {
  attending: boolean;
  guests: number;
  seats: number;
  companionName?: string;
}) {
  if (
    !Number.isInteger(input.guests) ||
    (input.attending && (input.guests < 1 || input.guests > input.seats)) ||
    (!input.attending && input.guests !== 0)
  )
    return false;
  return !input.companionName || (input.attending && input.guests >= 2);
}
import type { Invite } from "./store.ts";
