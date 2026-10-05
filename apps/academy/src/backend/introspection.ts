/**
 * The Ozikoro family's session introspection endpoints.
 *
 * WHY THESE EXIST
 *
 * `academy.ozikoro.com`, `shop.ozikoro.com` and `ozikoro.com` are all under one registrable domain,
 * so one cookie scoped to `.ozikoro.com` can carry a session to all three. What that cookie needs in
 * order to be *useful* to the other two is a way to ask "who is this?" without reimplementing the
 * token scheme, the hashing and the account lookup — and without every app needing a connection to
 * the shared database.
 *
 * So this is the contract. `GET /api/session` answers with the account behind the cookie, or 401.
 *
 * DESIGNED FOR SERVER-TO-SERVER CALLS, NOT FOR THE BROWSER
 *
 * The session cookie is HttpOnly, so no page script can read it — that is the point of HttpOnly and
 * it is not worked around here. A sibling app reads the cookie from its own incoming request on its
 * own server and forwards it, by cookie or as a bearer token, to this endpoint. That keeps the token
 * out of JavaScript entirely and means there is no CORS surface to get wrong.
 *
 * This endpoint is deliberately NOT given an `Access-Control-Allow-Origin`. Opening it to browser
 * callers would mean answering cross-origin requests with credentials, and the safe version of that
 * is a server-side call, which needs no CORS at all.
 */
import { one } from "./db.ts";
import { SESSION_COOKIE, hashSessionToken } from "./session.ts";
import { readCookie } from "./cookies.ts";
import { isReachable } from "./db.ts";

export interface IntrospectedAccount {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
}

/**
 * Pull the session token out of a request.
 *
 * The cookie is the normal path. The `Authorization: Bearer` form exists so a sibling app's server
 * can pass the token it received without having to synthesise a `Cookie` header, which is awkward in
 * most HTTP clients.
 */
function sessionToken(request: Request): string | undefined {
  const fromCookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (fromCookie) return fromCookie;

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token === "" ? undefined : token;
  }
  return undefined;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // An answer about who is signed in must never be cached — by a browser, a proxy or the edge.
  "cache-control": "no-store",
} as const;

/** The account behind the request's session, or null. */
export async function introspectAccount(request: Request): Promise<IntrospectedAccount | null> {
  const token = sessionToken(request);
  if (!token || token.length < 20) return null;

  const row = await one<Record<string, unknown>>(
    `select a.id, a.email, a.display_name, a.role
       from auth_session s
       join account a on a.id = s.account_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and a.status = 'active'`,
    [hashSessionToken(token)]
  );

  if (!row) return null;
  return {
    id: Number(row.id),
    email: String(row.email),
    displayName: (row.display_name as string | null) ?? null,
    role: String(row.role),
  };
}

/** `GET /api/session` — 200 with the account, or 401 with `account: null`. */
export async function handleSessionRequest(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: "GET, HEAD" },
    });
  }

  try {
    const account = await introspectAccount(request);
    return new Response(JSON.stringify({ account }), {
      // 401 rather than 200-with-null, so a sibling app can branch on the status without parsing,
      // and so an unauthenticated call is legible in an access log.
      status: account ? 200 : 401,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error("academy: session introspection failed", error);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: JSON_HEADERS });
  }
}

/**
 * `GET /api/health` — does the app answer, and can it reach the database.
 *
 * The compose healthcheck asks `/`, which proves the process is up but says nothing about the
 * database. This says both, and is what the Caddyfile already exempts from caching for the other
 * sites on this host, so the same probe works everywhere.
 *
 * It reports the database as a boolean and never its error text: an unauthenticated endpoint that
 * quotes a connection string or a driver message is a way to map the inside of the host.
 */
export async function handleHealthRequest(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: "GET, HEAD" },
    });
  }

  const database = await isReachable();
  return new Response(JSON.stringify({ ok: true, database, service: "ozikoro-academy" }), {
    status: database ? 200 : 503,
    headers: JSON_HEADERS,
  });
}
