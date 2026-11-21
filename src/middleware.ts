import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { adminRejectResponse, authenticateAdmin } from "@/lib/admin/auth";

const headers = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "same-origin",
};
export const onRequest = defineMiddleware(async (context, next) => {
  if (!(
    context.url.pathname === "/admin" ||
    context.url.pathname.startsWith("/admin/")
  ))
    return next();
  const result = await authenticateAdmin(
    context.request,
    env as Record<string, unknown>,
  );
  if (!result.host) {
    const rejection = adminRejectResponse(result.reason ?? "forbidden");
    return new Response(rejection.body, {
      status: rejection.status,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  context.locals.adminHost = result.host;
  const response = await next();
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
});
