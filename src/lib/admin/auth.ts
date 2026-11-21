import type { D1Database } from "../db/types";

export interface AdminHost {
  email: string;
  firstName: string;
  sample: boolean;
}
export interface AccessClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  [key: string]: unknown;
}
export interface AuthDependencies {
  fetchJwks?: (url: string) => Promise<Record<string, JsonWebKey>>;
  now?: () => number;
}

type Env = Record<string, unknown>;
const SAMPLE_HOST: AdminHost = {
  email: "host@example.invalid",
  firstName: "Eunice",
  sample: true,
};
let jwksCache:
  { expires: number; keys: Record<string, JsonWebKey> } | undefined;
const leeway = 60;

function text(env: Env, key: string) {
  return typeof env[key] === "string" ? String(env[key]).trim() : "";
}
export function parseAdminHosts(raw: string): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const result: Record<string, string> = {};
    for (const [email, firstName] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof firstName !== "string" || !firstName.trim() || !email.trim())
        return null;
      result[email.toLowerCase()] = firstName.trim();
    }
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
}
function decode(value: string): unknown {
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      ),
    ),
  );
}
function bytes(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}

export async function verifyAccessJwt(
  token: string,
  env: Env,
  dependencies: AuthDependencies = {},
): Promise<AccessClaims | null> {
  const domain = text(env, "ACCESS_TEAM_DOMAIN");
  const allowedAud = text(env, "ACCESS_AUD")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!domain || !allowedAud.length) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decode(parts[0]) as { alg?: string; kid?: string };
    const claims = decode(parts[1]) as AccessClaims;
    if (header.alg !== "RS256" || !header.kid) return null;
    const now = (dependencies.now ?? (() => Date.now() / 1000))();
    const fetchJwks =
      dependencies.fetchJwks ??
      (async (url: string) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error("jwks");
        const body = (await response.json()) as {
          keys?: Array<JsonWebKey & { kid?: string }>;
        };
        return Object.fromEntries(
          (body.keys ?? [])
            .filter((key) => key.kid)
            .map((key) => [key.kid!, key]),
        );
      });
    const url = `https://${domain}/cdn-cgi/access/certs`;
    let keys =
      jwksCache && jwksCache.expires > now ? jwksCache.keys : undefined;
    if (!keys) {
      keys = await fetchJwks(url);
      jwksCache = { keys, expires: now + 300 };
    }
    let jwk = keys[header.kid];
    if (!jwk) {
      keys = await fetchJwks(url);
      jwksCache = { keys, expires: now + 300 };
      jwk = keys[header.kid];
    }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        bytes(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      ))
    )
      return null;
    if (claims.iss !== `https://${domain}`) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!allowedAud.some((aud) => audiences.includes(aud))) return null;
    if (typeof claims.exp !== "number" || claims.exp <= now - leeway)
      return null;
    if (typeof claims.nbf === "number" && claims.nbf > now + leeway)
      return null;
    if (typeof claims.iat === "number" && claims.iat > now + leeway)
      return null;
    if (typeof claims.email !== "string" || !claims.email.trim()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function authenticateAdmin(
  request: Request,
  env: Env,
  dependencies: AuthDependencies = {},
): Promise<{ host?: AdminHost; reason?: "not-host" | "forbidden" }> {
  const store = text(env, "RSVP_STORE");
  const token = request.headers.get("Cf-Access-Jwt-Assertion")?.trim();
  const domain = text(env, "ACCESS_TEAM_DOMAIN");
  const aud = text(env, "ACCESS_AUD");
  const hosts = parseAdminHosts(text(env, "ADMIN_HOSTS"));
  if (store === "fake" && (!domain || !aud || !hosts))
    return { host: SAMPLE_HOST };
  if (!domain || !aud || !hosts || !token) return { reason: "forbidden" };
  const claims = await verifyAccessJwt(token, env, dependencies);
  if (!claims) return { reason: "forbidden" };
  const email = claims.email!.trim().toLowerCase();
  const firstName = hosts[email];
  return firstName
    ? { host: { email, firstName, sample: false } }
    : { reason: "not-host" };
}

export function adminRejectResponse(reason: "not-host" | "forbidden"): {
  status: 403;
  body: string;
} {
  return {
    status: 403,
    body:
      reason === "not-host"
        ? "This email can't sign in. Ask Warren or Eunice to add you."
        : "Hosts only.",
  };
}

export function resetJwksCacheForTests() {
  jwksCache = undefined;
}
export type AdminD1Env = Env & { DB?: D1Database };
