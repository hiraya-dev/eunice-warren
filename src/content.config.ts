import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const entourage = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/entourage" }),
  schema: z.object({
    groups: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        italic: z.string().optional(),
        rows: z.array(
          z.object({
            roles: z.array(
              z.object({
                label: z.string(),
                names: z.array(z.string()),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
});

export const collections = { entourage };
