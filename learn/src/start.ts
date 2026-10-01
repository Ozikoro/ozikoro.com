import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
});

/**
 * Stop browsers caching the HTML.
 *
 * THE BUG THIS FIXES
 *
 * Pages were served with NO `Cache-Control` at all. With no instruction a browser applies
 * HEURISTIC caching — it guesses a freshness lifetime from the response and may reuse it without
 * asking. The symptom was a site that showed a stale page, then appeared to "refresh" once you
 * clicked something, which reads as the app being broken rather than cached.
 *
 * `no-cache` does not mean "do not cache". It means "revalidate before using", and the ETag still
 * turns an unchanged page into a cheap 304. The alternative, `no-store`, would re-download the HTML
 * on every navigation.
 *
 * Hashed assets are the opposite case and stay at `max-age=31536000, immutable` in `public/_headers`:
 * their filename changes when their contents do, so they can never be stale.
 *
 * `CDN-Cache-Control: no-store` additionally keeps Cloudflare from holding one visitor's HTML and
 * serving it to everyone else — the same bug, one layer further out.
 */
const htmlCacheMiddleware = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  const response = result.response;

  if (request.method !== "GET") return result;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return result;

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache, must-revalidate");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return { ...result, response: new Response(response.body, { status: response.status, statusText: response.statusText, headers }) };
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  // Order matters: each middleware wraps the next, so the cache policy sits outermost and sees the
  // final response — including one produced by the error handler.
  requestMiddleware: [htmlCacheMiddleware, errorMiddleware, csrfMiddleware],
}));
