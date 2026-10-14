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

const explore = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/explore" }),
  schema: ({ image }) =>
    z.object({
      order: z.number(),
      title: z.string(),
      tag: z.string(),
      body: z.string(),
      image: image(),
      alt: z.string(),
      sticker: z.enum(["sun", "shell", "fish", "boat"]),
      tilt: z.number(),
      offset: z.enum(["none", "space-5", "space-6"]),
    }),
});

const faq = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/faq" }),
  schema: z.object({
    order: z.number(),
    question: z.string(),
    answer: z.string(),
  }),
});

export const collections = { entourage, explore, faq };
