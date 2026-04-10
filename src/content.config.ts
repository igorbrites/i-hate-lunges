import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const memes = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/data/memes" }),
  schema: z.object({
    image: z.string(),
    caption: z.object({
      en: z.string(),
      pt: z.string(),
    }),
    source: z.url().optional(),
    subreddit: z.string().optional(),
    redditId: z.string().optional(),
    author: z.string().optional(),
    date: z.coerce.date(),
  }),
});

export const collections = { memes };
