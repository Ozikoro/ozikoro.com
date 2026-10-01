import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * Stop browsers caching the HTML.
 *
 * THE BUG THIS FIXES
 *
 * The page responses carried no `Cache-Control` at all. With no instruction, browsers apply
 * HEURISTIC caching: they may reuse a response for a fraction of its age without asking the server.
 * The result was a site that served a stale page until you clicked something, then appeared to
 * "refresh" itself — which reads as the app being broken rather than cached.
 *
 * Hashed assets (`/assets/*-AbC123.js`) are the opposite case and are already correct at
 * `max-age=31536000, immutable`, because their filename changes when their content does. The HTML
 * keeps the same URL forever, so it must always be revalidated.
 *
 * `no-cache` does NOT mean "do not cache" — it means "revalidate before using". The ETag still lets
 * an unchanged page come back as a 304, so this costs one conditional request, not a re-download.
 */
function applyHtmlCachePolicy(request: Request, response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  if (request.method !== "GET") return response;

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache, must-revalidate");
  // Cloudflare should not hold the HTML at the edge either, or one visitor's stale copy is served
  // to everyone. `Set-Cookie` responses are already uncacheable, but this makes it explicit.
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Vary", "Accept-Encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return applyHtmlCachePolicy(request, normalized);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  },
};
