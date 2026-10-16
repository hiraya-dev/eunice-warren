import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { env } from "cloudflare:workers";
import {
  isRsvpClosed,
  isWithinRateLimit,
  signRsvpToken,
  validateSubmission,
  verifyRsvpToken,
} from "@/lib/rsvp/logic";
import type { RateLimiter } from "@/lib/rsvp/logic";
import type { RsvpStore } from "@/lib/rsvp/store";
import { createFakeRsvpStore } from "@/lib/rsvp/store";
import { createSheetsRsvpStore } from "@/lib/rsvp/sheets";
import { getLoveStore } from "@/lib/with-love/store";
import { isJpeg, isTodayInManila, isWithinLength, stripControls } from "@/lib/with-love/validation";

const TEST_SECRET = "local-rsvp-token-secret";
const envRecord = env as unknown as Record<string, unknown>;
const storeName =
  typeof envRecord.RSVP_STORE === "string" ? envRecord.RSVP_STORE : "sheets";
let selectedStore: RsvpStore | undefined;
const getStore = () => {
  if (!selectedStore)
    selectedStore =
      storeName === "fake"
        ? createFakeRsvpStore()
        : createSheetsRsvpStore(envRecord);
  return selectedStore;
};
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
      message: "RSVPs closed on December 31.",
    });
};
const fail = (message = "Something went wrong — please try again.") => {
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
) {
  let verified = false;
  let withinLimit = true;
  try {
    verified = await verifyTurnstile(inputToken);
    if (verified && applyRateLimit)
      withinLimit = await isWithinRateLimit(
        envRecord.RSVP_LOOKUP_LIMITER as RateLimiter | undefined,
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
      message: "Too many tries — wait a minute and try again.",
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
  guests: z.number().int(),
  email: z.string().email().max(254),
  companionName: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
  turnstileToken: z.string().max(4096),
});
const loveSubmitInput = z.object({
  photo: z.custom<File>((value) => typeof File !== "undefined" && value instanceof File),
  message: z.string(),
  name: z.string(),
  city: z.string().optional(),
  turnstileToken: z.string().max(4096),
});

const loveFail = (message = "Something went wrong — please try again.") => {
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
          const result = await getStore().findInvite(input.name);
          if (!result) return { invite: null };
          if (!tokenSecret) fail("Something went wrong — please try again.");
          const token = await signRsvpToken(
            result.invite.id,
            Date.now() + 2 * 60 * 60 * 1000,
            tokenSecret,
          );
          return {
            invite: {
              id: result.invite.id,
              householdName: result.invite.householdName,
              members: result.invite.members,
              seats: result.invite.seats,
            },
            matchedName: result.matchedName,
            token,
          };
        } catch (error) {
          if (error instanceof ActionError) throw error;
          fail();
        }
      },
    }),
    submit: defineAction({
      input: submitInput,
      handler: async (input, context) => {
        closed();
        await guard(input.turnstileToken, context);
        const tokenData = await verifyRsvpToken(input.token, tokenSecret);
        if (!tokenData)
          throw new ActionError({
            code: "UNAUTHORIZED",
            message: "Something went wrong — please try again.",
          });
        try {
          const result = await getStore().findInvite(input.name);
          if (
            !result ||
            result.invite.id !== tokenData.inviteId ||
            !validateSubmission({ ...input, seats: result.invite.seats })
          )
            throw new ActionError({
              code: "BAD_REQUEST",
              message: "Something went wrong — please try again.",
            });
          await getStore().submit({
            inviteId: result.invite.id,
            name: result.matchedName,
            attending: input.attending,
            guests: input.attending ? input.guests : 0,
            email: input.email,
            companionName: input.companionName,
            note: input.note,
          });
          return { ok: true };
        } catch (error) {
          if (error instanceof ActionError) throw error;
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
            if (input.photo.size > 2 * 1024 * 1024) loveFail("That photo is too large — try another one.");
            const bytes = new Uint8Array(await input.photo.arrayBuffer());
            if (!isJpeg(bytes)) loveFail("That file doesn't look like a photo — try another one.");
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
