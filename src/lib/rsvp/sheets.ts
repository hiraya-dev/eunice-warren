import type { Invite, PreviousRsvp, RsvpSeat, RsvpStore, RsvpSubmission } from "./store.ts";
import { normalizeGuestName } from "./store.ts";
import { parseGuestRows } from "./logic.ts";

type ServiceAccount = { client_email?: string; private_key?: string };
export type SheetsConfig = { keyJson: string; sheetId: string };
let cachedGuests:
  { expiresAt: number; parsed: ReturnType<typeof parseGuestRows> } | undefined;
let cachedAccessToken: { value: string; expiresAt: number } | undefined;
let cachedResponses:
  { expiresAt: number; rows: unknown[][] } | undefined;

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};
const json64 = (value: unknown) =>
  base64Url(new TextEncoder().encode(JSON.stringify(value)));

async function accessToken(config: SheetsConfig) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000)
    return cachedAccessToken.value;
  const account = JSON.parse(config.keyJson) as ServiceAccount;
  if (!account.client_email || !account.private_key)
    throw new Error("Google service-account credentials are incomplete");
  const header = json64({ alg: "RS256", typ: "JWT" });
  const claim = json64({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const pem = account.private_key.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  const keyBytes = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(header + "." + claim),
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" +
      encodeURIComponent(
        header + "." + claim + "." + base64Url(new Uint8Array(signature)),
      ),
  });
  if (!response.ok) throw new Error("Google access token request failed");
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token)
    throw new Error("Google access token response was invalid");
  cachedAccessToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

export async function sheetsFetch(
  config: SheetsConfig,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" +
      config.sheetId +
      "/" +
      path,
    {
      ...init,
      headers: {
        authorization: "Bearer " + (await accessToken(config)),
        "content-type": "application/json",
        ...init?.headers,
      },
    },
  );
  if (!response.ok) throw new Error("Google Sheets request failed");
  return response;
}

export const configFromEnv = (env: Record<string, unknown>): SheetsConfig => {
  const keyJson =
    typeof env.GOOGLE_SERVICE_ACCOUNT_JSON === "string"
      ? env.GOOGLE_SERVICE_ACCOUNT_JSON
      : "";
  const sheetId =
    typeof env.GOOGLE_SHEET_ID === "string" ? env.GOOGLE_SHEET_ID : "";
  if (!keyJson || !sheetId)
    throw new Error("Google Sheets configuration is missing");
  return { keyJson, sheetId };
};

export const buildResponseRow = (submission: RsvpSubmission) => {
  const attendingSeats = submission.attending
    ? submission.seats.filter((seat) => seat.attending)
    : [];
  const leadIndex = submission.seats.findIndex(
    (seat) => seat.original && normalizeGuestName(seat.original) === normalizeGuestName(submission.name),
  );
  const companions = attendingSeats
    .filter((seat) => submission.seats.indexOf(seat) !== leadIndex)
    .map((seat) => seat.name)
    .join("; ");
  const changes = submission.seats
    .filter((seat) => {
      if (seat.original === null && !seat.attending) return false;
      const original = seat.original ?? "";
      return normalizeGuestName(original) !== normalizeGuestName(seat.name);
    })
    .map((seat) => `${seat.original ?? "(plus-one)"} → ${seat.name}`)
    .join("; ");
  return [
    new Date().toISOString(),
    submission.inviteId,
    submission.name,
    submission.attending ? "yes" : "no",
    submission.attending ? submission.guests : 0,
    submission.email,
    companions,
    submission.note ?? "",
    attendingSeats.map((seat) => seat.name).join("; "),
    changes,
  ];
};

export const parsePreviousResponseRow = (
  row: unknown[],
  invite: Invite,
): { submittedAt: string; previous: PreviousRsvp } | null => {
  if (!row[1] || String(row[1]) !== invite.id) return null;
  const attending = String(row[3] ?? "").toLowerCase() === "yes";
  const guests = Number.parseInt(String(row[4] ?? "0"), 10) || 0;
  const attendees = String(row[8] ?? "")
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean);
  const seats: RsvpSeat[] = [
    ...invite.members.map((original): RsvpSeat => ({ original, name: original, attending: false })),
    ...Array.from({ length: Math.max(0, invite.seats - invite.members.length) }, (): RsvpSeat => ({ original: null, name: "", attending: false })),
  ];
  const changes = String(row[9] ?? "")
    .split(";")
    .map((change) => change.trim())
    .filter(Boolean);
  const openChanges: string[] = [];
  for (const change of changes) {
    const arrow = change.indexOf(" → ");
    if (arrow < 0) continue;
    const original = change.slice(0, arrow);
    const name = change.slice(arrow + 3);
    if (original === "(plus-one)") openChanges.push(name);
    else {
      const seat = seats.find((item) => item.original && normalizeGuestName(item.original) === normalizeGuestName(original));
      if (seat) seat.name = name;
    }
  }
  seats.filter((seat) => seat.original === null).forEach((seat, index) => { seat.name = openChanges[index] ?? ""; });
  if (row.length >= 9) {
    for (const name of attendees) {
      const seat = seats.find((item) => item.original && normalizeGuestName(item.original) === normalizeGuestName(name));
      if (seat) seat.name = name;
    }
    seats.forEach((seat) => { seat.attending = attending && attendees.some((name) => normalizeGuestName(name) === normalizeGuestName(seat.name)); });
  } else {
    seats.forEach((seat, index) => { seat.attending = attending && index < guests; });
  }
  return {
    submittedAt: String(row[0] ?? ""),
    previous: {
      attending,
      seats,
    },
  };
};

export const createSheetsRsvpStore = (
  env: Record<string, unknown>,
): RsvpStore => {
  const config = configFromEnv(env);
  return {
    async findInvite(name) {
      if (!cachedGuests || cachedGuests.expiresAt <= Date.now()) {
        const response = await sheetsFetch(config, "values/Guests!A2:D");
        const data = (await response.json()) as { values?: unknown[][] };
        cachedGuests = {
          expiresAt: Date.now() + 60_000,
          parsed: parseGuestRows(data.values ?? []),
        };
      }
      const wanted = normalizeGuestName(name);
      const matches = cachedGuests.parsed.invites.filter((invite) =>
        invite.members.some((member) => normalizeGuestName(member) === wanted),
      );
      const duplicateIds = new Set(cachedGuests.parsed.duplicateIds);
      const duplicateNames = new Set(cachedGuests.parsed.duplicateNames);
      if (
        matches.length !== 1 ||
        duplicateIds.has(matches[0]?.id ?? "") ||
        duplicateNames.has(wanted)
      ) {
        if (matches.length > 0)
          console.warn(
            "RSVP invite lookup rejected for duplicate invite data",
            matches.map((invite) => invite.id).join(","),
          );
        return null;
      }
      const matchedName = matches[0].members.find(
        (member) => normalizeGuestName(member) === wanted,
      )!;
      const invite = matches[0];
      if (!cachedResponses || cachedResponses.expiresAt <= Date.now()) {
        const response = await sheetsFetch(config, "values/Responses!A2:J");
        const data = (await response.json()) as { values?: unknown[][] };
        cachedResponses = { expiresAt: Date.now() + 60_000, rows: data.values ?? [] };
      }
      const previous = cachedResponses.rows
        .map((row) => parsePreviousResponseRow(row, invite))
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0]?.previous ?? null;
      return { invite, matchedName, previous };
    },
    async submit(submission: RsvpSubmission) {
      const values = [buildResponseRow(submission)];
      await sheetsFetch(
        config,
        "values/Responses!A:J:append?valueInputOption=RAW&insertDataOption=OVERWRITE",
        { method: "POST", body: JSON.stringify({ values }) },
      );
    },
  };
};
