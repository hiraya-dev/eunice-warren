import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { env } from "cloudflare:workers";
import {
  isRsvpActionClosed,
  isWithinRateLimit,
} from "@/lib/rsvp/logic";
import type { RateLimiter, RsvpAction } from "@/lib/rsvp/logic";
import type { RsvpStore } from "@/lib/rsvp/store";
import { createFakeRsvpStore } from "@/lib/rsvp/store";
import { createD1RsvpStore } from "@/lib/rsvp/d1";
import { createD1SongStore, createFakeSongStore } from "@/lib/songs/store";
import { GuestActionFailure, runFindAction, runGreetAction, runSongAction, runSubmitAction, selectStore } from "@/lib/guest-actions";
import type { D1Database } from "@/lib/db/types";
import { rsvpSubmitInput } from "@/lib/rsvp/input";
import { songInput } from "@/lib/songs/input";
import { scheduleRsvpNotification } from "@/lib/rsvp/notify";
import { logRsvpFindTiming, rsvpFindOutcome } from "@/lib/rsvp/timing";
import type { D1QueryCounter } from "@/lib/rsvp/d1";
import type { RsvpFindOutcome } from "@/lib/rsvp/timing";

const TEST_SECRET = "local-rsvp-token-secret";
const stripControls = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
const envRecord = env as unknown as Record<string, unknown>;
const storeName =
  typeof envRecord.RSVP_STORE === "string" ? envRecord.RSVP_STORE : "d1";
let selectedStore: RsvpStore | undefined;
const getStore = (queryCounter?: D1QueryCounter) => {
  if (storeName !== "fake") return createD1RsvpStore(envRecord.DB as D1Database, queryCounter);
  if (!selectedStore) selectedStore = createFakeRsvpStore();
  return selectedStore;
};
let selectedSongStore: ReturnType<typeof createD1SongStore> | ReturnType<typeof createFakeSongStore> | undefined;
const getSongStore = () => selectedSongStore ??= selectStore(storeName, createFakeSongStore, () => createD1SongStore(envRecord.DB as D1Database));
const tokenSecret =
  typeof envRecord.RSVP_TOKEN_SECRET === "string" && envRecord.RSVP_TOKEN_SECRET
    ? envRecord.RSVP_TOKEN_SECRET
    : storeName === "fake"
      ? TEST_SECRET
      : "";
const closed = (action: RsvpAction) => {
  if (isRsvpActionClosed(action))
    throw new ActionError({
      code: "GONE",
      message: "RSVPs closed on December 12.",
    });
};
const fail = (message = "Something went wrong. Please try again.") => {
  throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message });
};

async function verifyTurnstile(token: string) {
  if (storeName === "fake") return true;
  const secret =
    typeof envRecord.TURNSTILE_SECRET_KEY === "string"
      ? envRecord.TURNSTILE_SECRET_KEY
      : "";
  if (!secret) return false;
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body:
        "secret=" +
        encodeURIComponent(secret) +
        "&response=" +
        encodeURIComponent(token),
    },
  );
  if (!response.ok) return false;
  return Boolean(((await response.json()) as { success?: boolean }).success);
}

async function guard(
  inputToken: string,
  context: { request: Request },
  applyRateLimit = false,
  limiterName = "RSVP_LOOKUP_LIMITER",
  rateLimitMessage = "Too many tries. Wait a minute and try again.",
  timing?: { turnstileMs: number; rateLimitMs: number },
) {
  let verified = false;
  let withinLimit = true;
  try {
    const turnstileStarted = performance.now();
    try {
      verified = await verifyTurnstile(inputToken);
    } finally {
      if (timing) timing.turnstileMs = performance.now() - turnstileStarted;
    }
    const rateLimitStarted = performance.now();
    try {
      if (verified && applyRateLimit)
        withinLimit = await isWithinRateLimit(
          envRecord[limiterName] as RateLimiter | undefined,
          context.request.headers.get("CF-Connecting-IP") ?? "unknown",
        );
    } finally {
      if (timing) timing.rateLimitMs = applyRateLimit ? performance.now() - rateLimitStarted : 0;
    }
  } catch {
    // Never surface a platform error message to guests.
    fail();
  }
  if (!verified)
    throw new ActionError({ code: "FORBIDDEN", message: "Please try again." });
  if (!withinLimit)
    throw new ActionError({
      code: "TOO_MANY_REQUESTS",
      message: rateLimitMessage,
    });
}

const findInput = z.object({
  name: z.string().trim().min(1).max(120),
  turnstileToken: z.string().max(4096),
});
export const server = {
  rsvp: {
    find: defineAction({
      input: findInput,
      handler: async (input, context) => {
        const started = performance.now();
        const timing = { turnstileMs: 0, rateLimitMs: 0, storeMs: 0, signMs: 0, totalMs: 0, queries: 0, outcome: "error" as RsvpFindOutcome };
        const queryCounter: D1QueryCounter = { count: 0 };
        let result: Awaited<ReturnType<typeof runFindAction>> | undefined;
        let caught: unknown;
        try {
          closed("find");
          await guard(input.turnstileToken, context, true, "RSVP_LOOKUP_LIMITER", "Too many tries. Wait a minute and try again.", timing);
          if (!tokenSecret) fail("Something went wrong. Please try again.");
          result = await runFindAction(getStore(queryCounter), input.name, tokenSecret, Date.now(), timing);
          return result;
        } catch (error) {
          caught = error;
          if (error instanceof ActionError) throw error;
          if (error instanceof GuestActionFailure) throw new ActionError({ code: error.code, message: error.message });
          fail();
        } finally {
          timing.queries = queryCounter.count;
          timing.outcome = rsvpFindOutcome(result, caught);
          timing.totalMs = performance.now() - started;
          logRsvpFindTiming(timing);
        }
      },
    }),
    greet: defineAction({
      input: findInput,
      handler: async (input, context) => {
        const started = performance.now();
        const timing = { turnstileMs: 0, rateLimitMs: 0, storeMs: 0, signMs: 0, totalMs: 0, queries: 0, outcome: "error" as RsvpFindOutcome, path: "greet" as const };
        const queryCounter: D1QueryCounter = { count: 0 };
        let result: Awaited<ReturnType<typeof runGreetAction>> | undefined;
        let caught: unknown;
        try {
          closed("greet");
          await guard(input.turnstileToken, context, true, "RSVP_LOOKUP_LIMITER", "Too many tries. Wait a minute and try again.", timing);
          result = await runGreetAction(getStore(queryCounter), input.name, timing);
          return result;
        } catch (error) {
          caught = error;
          if (error instanceof ActionError) throw error;
          if (error instanceof GuestActionFailure) throw new ActionError({ code: error.code, message: error.message });
          fail();
        } finally {
          timing.queries = queryCounter.count;
          timing.outcome = rsvpFindOutcome(result, caught);
          timing.totalMs = performance.now() - started;
          logRsvpFindTiming(timing);
        }
      },
    }),
    submit: defineAction({
      input: rsvpSubmitInput,
      handler: async (input, context) => {
        closed("submit");
        await guard(input.turnstileToken, context, true, "RSVP_SUBMIT_LIMITER");
        try {
          return await runSubmitAction(getStore(), input, tokenSecret, (data) => {
            const locals = context.locals as typeof context.locals & {
              cfContext?: { waitUntil(promise: Promise<unknown>): void };
            };
            const waitUntil = locals.cfContext?.waitUntil
              ? locals.cfContext.waitUntil.bind(locals.cfContext)
              : undefined;
            scheduleRsvpNotification(data, envRecord, waitUntil);
          });
        } catch (error) {
          if (error instanceof ActionError) throw error;
          if (error instanceof GuestActionFailure) throw new ActionError({ code: error.code, message: error.message });
          fail();
        }
      },
    }),
  },
  songs: {
    submit: defineAction({
    input: songInput,
    handler: async (input, context) => {
        await guard(input.turnstileToken, context, true, "SONG_LIMITER", "Easy on the requests. Try again in a minute.");
      const clean = { name: stripControls(input.name).trim(), song: stripControls(input.song).trim(), artist: input.artist ? stripControls(input.artist).trim() : undefined, dedication: input.dedication ? stripControls(input.dedication).trim() : undefined, spotifyTrackId: input.spotifyTrackId, coverUrl: input.coverUrl };
      if (!clean.name || !clean.song) throw new ActionError({ code: "BAD_REQUEST", message: "Please add your name and song." });
      try { return await runSongAction(getSongStore(), clean); }
      catch (error) {
        if (error instanceof GuestActionFailure) throw new ActionError({ code: error.code, message: error.message });
        fail();
      }
    },
    }),
  },
};
