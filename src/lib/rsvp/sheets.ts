import type { RsvpStore, RsvpSubmission } from "./store.ts";
import { normalizeGuestName } from "./store.ts";
import { parseGuestRows } from "./logic.ts";

type ServiceAccount = { client_email?: string; private_key?: string };
export type SheetsConfig = { keyJson: string; sheetId: string };
let cachedGuests:
  { expiresAt: number; parsed: ReturnType<typeof parseGuestRows> } | undefined;
let cachedAccessToken: { value: string; expiresAt: number } | undefined;

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
      return { invite: matches[0], matchedName };
    },
    async submit(submission: RsvpSubmission) {
      const values = [
        [
          new Date().toISOString(),
          submission.inviteId,
          submission.name,
          submission.attending ? "yes" : "no",
          submission.attending ? submission.guests : 0,
          submission.email,
          submission.companionName ?? "",
          submission.note ?? "",
        ],
      ];
      await sheetsFetch(
        config,
        "values/Responses!A:H:append?valueInputOption=RAW&insertDataOption=OVERWRITE",
        { method: "POST", body: JSON.stringify({ values }) },
      );
    },
  };
};
