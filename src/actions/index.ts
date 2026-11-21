import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { env } from "cloudflare:workers";
import {
  isRsvpClosed,
  isWithinRateLimit,
} from "@/lib/rsvp/logic";
import type { RateLimiter } from "@/lib/rsvp/logic";
import type { RsvpStore } from "@/lib/rsvp/store";
import { createFakeRsvpStore } from "@/lib/rsvp/store";
import { createD1RsvpStore } from "@/lib/rsvp/d1";
import { createD1SongStore, createFakeSongStore } from "@/lib/songs/store";
import { GuestActionFailure, runFindAction, runSongAction, runSubmitAction, selectStore } from "@/lib/guest-actions";
import type { D1Database } from "@/lib/db/types";
import { getLoveStore } from "@/lib/with-love/store";
import { isJpeg, isTodayInManila, isWithinLength, stripControls } from "@/lib/with-love/validation";

const TEST_SECRET = "local-rsvp-token-secret";
const envRecord = env as unknown as Record<string, unknown>;
const storeName =
  typeof envRecord.RSVP_STORE === "string" ? envRecord.RSVP_STORE : "d1";
let selectedStore: RsvpStore | undefined;
const getStore = () => {
  if (!selectedStore)
    selectedStore = selectStore(storeName, createFakeRsvpStore, () => createD1RsvpStore(envRecord.DB as D1Database));
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
const closed = () => {
  if (isRsvpClosed())
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
) {
  let verified = false;
  let withinLimit = true;
  try {
    verified = await verifyTurnstile(inputToken);
    if (verified && applyRateLimit)
      withinLimit = await isWithinRateLimit(
        envRecord[limiterName] as RateLimiter | undefined,
        context.request.headers.get("CF-Connecting-IP") ?? "unknown",
      );
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
const submitInput = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  attending: z.boolean(),
  seats: z.array(z.object({
    seatId: z.number().int(),
    shownName: z.string().nullable().optional(),
    name: z.string().max(120),
    attending: z.boolean(),
    slipperSize: z.string().optional(),
  })),
  email: z.string().email().max(254),
  note: z.string().max(1000).optional(),
  turnstileToken: z.string().max(4096),
});
const songInput = z.object({
  name: z.string().trim().min(1).max(120), song: z.string().trim().min(1).max(120), artist: z.string().trim().max(120).optional(), dedication: z.string().trim().max(500).optional(), turnstileToken: z.string().max(4096),
});
const loveSubmitInput = z.object({
  photo: z.custom<File>((value) => typeof File !== "undefined" && value instanceof File),
  message: z.string(),
  name: z.string(),
  city: z.string().optional(),
  turnstileToken: z.string().max(4096),
});

const loveFail = (message = "Something went wrong. Please try again.") => {
  throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message });
};

export const server = {
  rsvp: {
    find: defineAction({
      input: findInput,
      handler: async (input, context) => {
        closed();
        await guard(input.turnstileToken, context, true);
        try {
          if (!tokenSecret) fail("Something went wrong. Please try again.");
          return await runFindAction(getStore(), input.name, tokenSecret);
        } catch (error) {
          if (error instanceof ActionError) throw error;
          if (error instanceof GuestActionFailure) throw new ActionError({ code: error.code, message: error.message });
          fail();
        }
      },
    }),
    submit: defineAction({
      input: submitInput,
      handler: async (input, context) => {
        closed();
        await guard(input.turnstileToken, context, true, "RSVP_SUBMIT_LIMITER");
        try {
          return await runSubmitAction(getStore(), input, tokenSecret);
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
      const clean = { name: stripControls(input.name).trim(), song: stripControls(input.song).trim(), artist: input.artist ? stripControls(input.artist).trim() : undefined, dedication: input.dedication ? stripControls(input.dedication).trim() : undefined };
      if (!clean.name || !clean.song) throw new ActionError({ code: "BAD_REQUEST", message: "Please add your name and song." });
      try { return await runSongAction(getSongStore(), clean); }
      catch (error) {
        if (error instanceof GuestActionFailure) throw new ActionError({ code: error.code, message: error.message });
        fail();
      }
    },
    }),
  },
  withLove: {
      submit: defineAction({
        accept: "form",
        input: loveSubmitInput,
        handler: async (input, context) => {
          const store = getLoveStore(envRecord);
          try {
            await guardLove(input.turnstileToken, context);
            const name = stripControls(input.name);
            const message = stripControls(input.message);
            const city = stripControls(input.city ?? "");
            if (!isWithinLength(message, 140)) loveFail("Please write a note (up to 140 characters).");
            if (!isWithinLength(name, 60)) loveFail("Please add your name.");
            if (city.length > 60) loveFail("Please shorten the city name.");
            if (input.photo.size > 2 * 1024 * 1024) loveFail("That photo is too large. Try another one.");
            const bytes = new Uint8Array(await input.photo.arrayBuffer());
            if (!isJpeg(bytes)) loveFail("That file doesn't look like a photo. Try another one.");
            if (storeName === "fake" && name.toLocaleLowerCase() === "error test") throw new Error("fictional upload failure");
            const notes = await store.listNotes();
            if (notes.length >= 2000)
              throw new ActionError({ code: "CONFLICT", message: "The stack is full. Thank you for all the love!" });
            if (notes.filter((note) => isTodayInManila(note.submittedAt)).length >= 300)
              throw new ActionError({ code: "CONFLICT", message: "The stack is full for today. Come back tomorrow!" });
            const id = crypto.randomUUID();
            await store.addNote({
              id,
              submittedAt: new Date().toISOString(),
              name,
              city,
              message,
              photoKey: `notes/${id}.jpg`,
            }, bytes);
            return { note: { id, name, city, message, photoUrl: `/api/with-love/photo/${id}` } };
          } catch (error) {
            if (error instanceof ActionError) throw error;
            loveFail();
          }
        },
      }),
    },
};

async function guardLove(inputToken: string, context: { request: Request }) {
  let verified = false;
  try {
    verified = await verifyTurnstile(inputToken);
    if (verified && !(await isWithinRateLimit(
      envRecord.WITH_LOVE_LIMITER as RateLimiter | undefined,
      context.request.headers.get("CF-Connecting-IP") ?? "unknown",
    ))) {
      throw new ActionError({ code: "TOO_MANY_REQUESTS", message: "You've pinned a lot! Take a breather and try again in a minute." });
    }
  } catch (error) {
    if (error instanceof ActionError) throw error;
    loveFail();
  }
  if (!verified) throw new ActionError({ code: "FORBIDDEN", message: "Please try again." });
}
