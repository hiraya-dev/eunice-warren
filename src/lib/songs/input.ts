import { z } from "astro/zod";

export const songInput = z.object({
  name: z.string().trim().min(1).max(120),
  song: z.string().trim().min(1).max(120),
  artist: z.string().trim().max(120).optional(),
  dedication: z.string().trim().max(500).optional(),
  spotifyTrackId: z.string().regex(/^[A-Za-z0-9]{22}$/).optional(),
  coverUrl: z.string().url().refine((value) => value.startsWith("https://i.scdn.co/") && value.length <= 300).optional(),
  turnstileToken: z.string().max(4096),
});
