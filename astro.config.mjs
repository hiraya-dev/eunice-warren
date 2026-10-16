// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import { defineConfig, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";
import cloudflare from "@astrojs/cloudflare";
import { SITE_INDEXABLE, SITE_URL } from "./src/consts.ts";
import { isNoindexRoute } from "./src/utils/seo.ts";

/** @type {import("astro").AstroIntegration} */
const cloudflareHeaders = {
  name: "cloudflare-headers",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      const target = new URL("./dist/client/_headers", import.meta.url);
      let current = "";
      for (const candidate of [target, new URL("_headers", dir)]) {
        try {
          current = await readFile(candidate, "utf8");
          break;
        } catch {
          // The adapter and this integration can run in either order.
        }
      }
      if (!SITE_INDEXABLE && !current.includes("X-Robots-Tag:")) {
        const suffix = current && !current.endsWith("\n") ? "\n" : "";
        await writeFile(
          target,
          current + suffix + "/*\n  X-Robots-Tag: noindex, nofollow\n",
        );
      } else if (
        current &&
        target.toString() !== new URL("_headers", dir).toString()
      ) {
        await writeFile(target, current);
      }
    },
  },
};

export default defineConfig({
  site: SITE_URL,
  integrations: [
    sitemap({
      filter: (page) =>
        SITE_INDEXABLE && !isNoindexRoute(new URL(page).pathname),
    }),
    cloudflareHeaders,
  ],
  adapter: cloudflare({ imageService: "compile" }),
  output: "static",
  session: false,
  fonts: [
    {
      name: "PP Neue Montreal",
      cssVariable: "--font-neue-montreal",
      provider: fontProviders.local(),
      fallbacks: ["Arial", "sans-serif"],
      options: {
        variants: [
          {
            weight: 400,
            style: "normal",
            src: ["./src/assets/fonts/PPNeueMontreal-Regular.woff2"],
          },
          {
            weight: 500,
            style: "normal",
            src: ["./src/assets/fonts/PPNeueMontreal-Medium.woff2"],
          },
        ],
      },
    },
    {
      name: "PP Editorial New",
      cssVariable: "--font-editorial-new",
      provider: fontProviders.local(),
      fallbacks: ["Georgia", "serif"],
      options: {
        variants: [
          {
            weight: 200,
            style: "normal",
            src: ["./src/assets/fonts/PPEditorialNew-Ultralight.woff2"],
          },
          {
            weight: 200,
            style: "italic",
            src: ["./src/assets/fonts/PPEditorialNew-UltralightItalic.woff2"],
          },
          {
            weight: 400,
            style: "normal",
            src: ["./src/assets/fonts/PPEditorialNew-Regular.woff2"],
          },
          {
            weight: 400,
            style: "italic",
            src: ["./src/assets/fonts/PPEditorialNew-Italic.woff2"],
          },
        ],
      },
    },
    {
      name: "PP Fraktion Mono",
      cssVariable: "--font-fraktion-mono",
      provider: fontProviders.local(),
      fallbacks: ["ui-monospace", "monospace"],
      options: {
        variants: [
          {
            weight: 400,
            style: "normal",
            src: ["./src/assets/fonts/PPFraktionMono-Regular.woff2"],
          },
        ],
      },
    },
  ],
  vite: { build: { cssTarget: "safari15.4" } },
});
