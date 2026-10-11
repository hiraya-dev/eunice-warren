// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { SITE_URL } from "./src/consts.ts";
import { isNoindexRoute } from "./src/utils/seo.ts";

export default defineConfig({
  site: SITE_URL,
  integrations: [
    sitemap({
      filter: (page) => !isNoindexRoute(new URL(page).pathname),
    }),
  ],
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
