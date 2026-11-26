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

const hero = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/hero" }),
  schema: z.object({
    hidden: z.boolean().default(false),
    coupleAlt: z.string(),
    note: z.string(),
    dateFull: z.string(),
    dateShort: z.string(),
    titleFirst: z.string(),
    titleSecond: z.string(),
    subtitle: z.string(),
    rsvp: z.string(),
    weekend: z.string(),
    weekendAria: z.string(),
    musicLabel: z.string(),
    musicMute: z.string(),
    musicPlay: z.string(),
  }),
});

const invitation = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/invitation" }),
  schema: z.object({
    hidden: z.boolean().default(false),
    title: z.string(),
    facts: z.array(z.object({ label: z.string(), value: z.string(), detail: z.string(), link: z.string() })),
    calendarPrevious: z.object({ day: z.string(), label: z.string() }),
    calendarCurrent: z.object({ day: z.string(), label: z.string() }),
    calendarNext: z.object({ day: z.string(), label: z.string() }),
    calendarSrOnly: z.string(),
    welcomeParagraphs: z.array(z.string()),
  }),
});

const wedding = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/wedding" }),
  schema: z.object({
    hidden: z.boolean().default(false),
    titleFirst: z.string(),
    titleSecond: z.string(),
    scheduleAria: z.string(), mapText: z.string(),
    schedule: z.array(z.object({
      number: z.string(), title: z.string(), italic: z.string().optional(), time: z.string(), location: z.string(), mapLabel: z.string(), alt: z.string(), caption: z.string(),
    })),
    footer: z.string(),
    calendar: z.string(),
  }),
});

const attire = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/attire" }),
  schema: z.object({
    hidden: z.boolean().default(false),
    eyebrow: z.string(), titleBefore: z.string(), titleEm: z.string(), accentBefore: z.string(), accentAfter: z.string(), intro: z.string(), coloursLabel: z.string(), titlePrefix: z.string(), colourSeparator: z.string(),
    colours: z.array(z.object({ name: z.string(), key: z.string() })), suggestions: z.string(),
    looks: z.array(z.object({ id: z.string(), label: z.string(), heading: z.string(), lead: z.string(), rest: z.string(), items: z.array(z.object({ caption: z.string(), colour: z.string(), alt: z.string() })) })),
    previous: z.string(), next: z.string(), noteTitle: z.string(), notes: z.array(z.object({ label: z.string(), crossed: z.boolean(), items: z.array(z.string()) })), postmarkAlt: z.string(), noteSentence: z.string(),
  }),
});

const stay = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/stay" }),
  schema: z.object({
    hidden: z.boolean().default(false), titleFirst: z.string(), titleSecond: z.string(), description: z.string(), directionsTitle: z.string(),
    compass: z.object({ north: z.string(), south: z.string(), east: z.string(), west: z.string(), whiteBeach: z.string(), bearing: z.string() }),
    steps: z.array(z.object({ number: z.string(), title: z.string(), body: z.string(), detail: z.string() })),
  }),
});

export const collections = { entourage, explore, faq, hero, invitation, wedding, attire, stay };
