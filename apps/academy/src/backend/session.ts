/**
 * Sessions, against the shared `auth_session` table.
 *
 * A COPY OF THE RELEVANT PARTS OF `packages/db/src/accounts.ts`, for the same build reason as
 * `./passwords.ts`. The mechanics are reproduced exactly because a session row written here must be
 * resolvable there and vice versa:
 *
 *   - a 32-byte random token, base64url encoded, which is what the cookie carries
 *   - only its SHA-256 hex digest is stored, in `auth_session.token_hash`
 *   - a 30-day expiry, `revoked_at` for revocation, `last_seen_at` updated best-effort
 *
 * THE ONE THING THE ACADEMY CANNOT SHARE IS THE COOKIE, AND THAT IS A BROWSER RULE RATHER THAN A
 * CHOICE. `packages/db` records the same limit in `sessionCookieOptions`: a cookie may only be
 * shared within one registrable domain, and `ozikoro.com` and `ozituma.com` are different
 * registrable domains. So an Academy visitor signs in with the same email and password as on the
 * dictionary — the account is genuinely shared — but the session is the Academy's own, scoped to
 * `.ozikoro.com`, which is what makes it survive between `academy.ozikoro.com` and a future
 * `ozikoro.com` sign-in. Sharing one session across both would need SSO, not a cookie.
 */
import { createHash, randomBytes } from "node:crypto";
import { one, query } from "./db.ts";

/** Sessions last 30 days, matching the canonical implementation. */
const SESSION_TTL_DAYS = 30;

/**
 * THE FAMILY SESSION COOKIE.
 *
 * One name, scoped to `.ozikoro.com`, shared by `academy.ozikoro.com`, `shop.ozikoro.com` and
 * `ozikoro.com` — a cookie can span those three because they are one registrable domain.
 *
 * It is NOT `ozituma_session`. That name belongs to the dictionary, which is on a different
 * registrable domain and therefore cannot share a cookie with these three at all; reusing its name
 * here would suggest a shared session that the browser will never allow. The two sites share an
 * ACCOUNT (the same `account` table, so one email and password works on both) and that is a
 * different thing from sharing a session.
 *
 * Renaming it was free at the time it was done: no real account had an Academy session yet, so
 * nothing was signed out by the change.
 */
export const SESSION_COOKIE = "ozikoro_session";

export interface SessionAccount {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
}

/** SHA-256 hex of the cookie token. The raw token is never stored. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The columns every account read needs, on one line for the same reason the canonical module keeps
 * it on one line: a wrapped list splits mid-column-name and silently emits an unaliased column.
 */
const ACCOUNT_COLUMNS =
  "a.id, a.email, a.display_name, a.role, a.status";

function toSessionAccount(row: Record<string, unknown>): SessionAccount {
  return {
    id: Number(row.id),
    email: String(row.email),
    displayName: (row.display_name as string | null) ?? null,
    role: String(row.role),
    status: String(row.status),
  };
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  accountId: number,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {}
): Promise<CreatedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `insert into auth_session (account_id, token_hash, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [
      accountId,
      hashSessionToken(token),
      meta.userAgent?.slice(0, 300) ?? null,
      // `inet` rejects junk, and a malformed header must not fail a sign-in.
      normaliseIp(meta.ipAddress),
      expiresAt,
    ]
  );

  return { token, expiresAt };
}

export function normaliseIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.split(",")[0]!.trim();
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(candidate)) return null;
  return candidate;
}

/** Resolve a cookie token to its account, or null when invalid, expired or revoked. */
export async function resolveSession(token: string | undefined | null): Promise<SessionAccount | null> {
  if (!token || token.length < 20) return null;

  const row = await one<Record<string, unknown>>(
    `select s.id as session_id, ${ACCOUNT_COLUMNS}
       from auth_session s
       join account a on a.id = s.account_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()`,
    [hashSessionToken(token)]
  );

  if (!row) return null;
  // A suspended account must not keep a working session; the canonical implementation does this
  // check after the lookup rather than in the query so a suspended account is not distinguishable
  // from an expired session by timing.
  if (row.status !== "active") return null;

  void query(`update auth_session set last_seen_at = now() where id = $1`, [row.session_id]).catch(
    () => undefined
  );

  return toSessionAccount(row);
}

/**
 * Close every session on the account EXCEPT the one named by `keepToken`.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `revokeAllSessions`
 *
 * `writePassword` in the canonical `packages/db/src/passwords.ts` closes every session when a password is
 * replaced, **because the reason a password is being replaced is usually that somebody else has it** — and a
 * change that leaves their session alive has not changed anything that matters. The one session that must
 * survive is the one doing the changing: signing somebody out of the page where they just succeeded reads as
 * a failure rather than as a precaution. A caller with no keeper to name (`keepToken` absent) closes them
 * all, which is the safe direction.
 */
export async function revokeOtherSessions(
  accountId: number,
  keepToken: string | null | undefined,
  /**
   * The statement runner, defaulted to the real one so no caller has to pass it.
   *
   * It is a parameter for the same reason `PasswordStore` in `./passwords.ts` is: **the refusal that matters
   * in `changeOwnPassword` has to be provable without a Postgres server**, and the refusal is only half
   * proved if the revocation it guards reaches for a connection the test cannot give it. `./db.ts`
   * satisfies this shape structurally.
   */
  store: { query(sql: string, params?: unknown[]): Promise<{ rowCount: number }> } = { query }
): Promise<number> {
  const result = await store.query(
    `update auth_session set revoked_at = now()
      where account_id = $1 and revoked_at is null and token_hash <> $2`,
    // No keeper: no stored digest can equal the empty string, so this closes every open session.
    [accountId, keepToken ? hashSessionToken(keepToken) : '']
  );
  return result.rowCount;
}

export async function revokeSession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const result = await query(
    `update auth_session set revoked_at = now()
      where token_hash = $1 and revoked_at is null`,
    [hashSessionToken(token)]
  );
  return result.rowCount > 0;
}

export function sessionMaxAgeSeconds(): number {
  return SESSION_TTL_DAYS * 24 * 60 * 60;
}

/**
 * Cookie attributes.
 *
 * `secure` follows the site URL rather than NODE_ENV, because the failure it prevents — a session
 * cookie sent over plain HTTP — is decided by the scheme actually in use.
 *
 * The domain default is `.ozikoro.com` so the session survives to the archive's own sign-in when
 * that exists. It is validated rather than passed through: a value carrying a scheme, a path or a
 * port produces a cookie no browser will store, and a sign-in that appears broken for no visible
 * reason. This mirrors `normaliseCookieDomain` in `packages/db`.
 */
export function sessionCookieOptions(maxAgeSeconds?: number) {
  const siteUrl = process.env.ACADEMY_SITE_URL ?? "";
  const secure = siteUrl.length > 0 ? siteUrl.startsWith("https://") : process.env.NODE_ENV === "production";
  const domain = normaliseCookieDomain(process.env.OZIKORO_AUTH_COOKIE_DOMAIN);

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    ...(domain ? { domain } : {}),
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}

export function normaliseCookieDomain(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  if (/[:/]/.test(value)) return null;

  const bare = value.startsWith(".") ? value.slice(1) : value;
  if (!bare.includes(".")) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(bare)) return null;

  return `.${bare}`;
}
