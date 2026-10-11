import type { APIRoute } from "astro";
import { SITE_INDEXABLE } from "@/consts.ts";

export const GET: APIRoute = ({ site }) => {
  const lines = ["User-agent: *", "Allow: /"];

  if (SITE_INDEXABLE && site) {
    lines.push("", `Sitemap: ${new URL("sitemap-index.xml", site).href}`);
  }

  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
