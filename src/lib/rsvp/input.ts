import { z } from "astro/zod";
import { MAX_SEATS } from "./limits.ts";

export const rsvpSubmitInput = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  attending: z.boolean(),
  seats: z.array(z.object({
    seatId: z.number().int(),
    shownName: z.string().nullable().optional(),
    name: z.string().max(120),
    attending: z.boolean(),
    slipperSize: z.string().optional(),
  })).min(1).max(MAX_SEATS),
  email: z.email().max(254),
  note: z.string().max(1000).optional(),
  turnstileToken: z.string().max(4096),
});
