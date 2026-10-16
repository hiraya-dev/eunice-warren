import { ActionError, defineAction } from "astro:actions";
import { z } from "astro/zod";
import { env } from "cloudflare:workers";
import {
  isRsvpClosed,
  signRsvpToken,
  validateSubmission,
  verifyRsvpToken,
} from "@/lib/rsvp/logic";
import type { RsvpStore } from "@/lib/rsvp/store";
import { createFakeRsvpStore } from "@/lib/rsvp/store";
import { createSheetsRsvpStore } from "@/lib/rsvp/sheets";

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
  if (!(await verifyTurnstile(inputToken)))
    throw new ActionError({ code: "FORBIDDEN", message: "Please try again." });
  if (applyRateLimit) {
    const limiter = envRecord.RSVP_LOOKUP_LIMITER as
      { limit?: (key: string) => Promise<{ success: boolean }> } | undefined;
    if (limiter?.limit) {
      const result = await limiter.limit(
        context.request.headers.get("CF-Connecting-IP") ?? "unknown",
      );
      if (!result.success)
        throw new ActionError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many tries — wait a minute and try again.",
        });
    }
  }
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
};
