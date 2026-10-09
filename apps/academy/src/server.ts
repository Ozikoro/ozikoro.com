import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleHealthRequest, handleSessionRequest } from "./backend/introspection";
import { comingSoon, comingSoonPage, robotsTxt } from "./backend/coming-soon";

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
 * THE API ENDPOINTS ARE ANSWERED HERE, BEFORE THE PAGE ROUTER SEES THE REQUEST.
 *
 * `/api/session` and `/api/health` are not pages, and this build of TanStack Start exposes no
 * server-route helper — `createServerFileRoute` is not exported by `@tanstack/react-start@1.168`
 * and `createFileRoute` takes no `handlers`. The server entry is the one seam that is mine, it runs
 * before the router, and routing two paths by hand is smaller than the machinery an alternative
 * would add.
 *
 * The two paths are exact matches and are checked with `===` on `pathname`, so nothing else is
 * intercepted: a page route that happened to start with `/api/` would be unaffected unless it were
 * one of these two names.
 */
const API_ROUTES: Record<string, (request: Request) => Promise<Response>> = {
  "/api/session": handleSessionRequest,
  "/api/health": handleHealthRequest,
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const api = API_ROUTES[new URL(request.url).pathname];
    if (api) {
      try {
        return await api(request);
      } catch (error) {
        // An API caller is not a browser and must not be handed the HTML error page the SSR path
        // falls back to — a sibling app parsing that as JSON is a worse failure than the one that
        // caused it.
        console.error("academy: api route failed", error);
        return new Response(JSON.stringify({ error: "internal" }), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
    }

    try {
      const pathname = new URL(request.url).pathname;

      // Answered in BOTH states, because the static file that used to serve it has been removed —
      // it was shadowing the gate's own response. See `robotsTxt`.
      if (pathname === "/robots.txt") return robotsTxt();

      // THE LAUNCH GATE, BEFORE ANYTHING ELSE THAT IS PUBLIC.
      //
      // It sits here rather than in a route so that no Academy page renders and no route loader or
      // server function runs while it is closed. `/api/health` and `/api/session` are matched above
      // and are therefore still answered — the healthcheck because gating it would mark a healthy
      // container unhealthy, and the session endpoint because it returns 401 to anyone without a
      // cookie and is what the shop and archive call to join the shared sign-in.
      if (comingSoon()) return comingSoonPage();

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
