/**
 * Accounts and sessions.
 *
 * SECURITY POSTURE
 *
 * 1. PASSWORDS use `scrypt` (memory-hard) with a per-password random salt, via
 *    Node's built-in crypto — no dependency, nothing to keep patched. The stored
 *    string is self-describing (`scrypt$N$r$p$salt$hash`) so the cost parameters
 *    can be raised later and old hashes still verify and can be rehashed on
 *    next sign-in.
 *
 * 2. SESSIONS are server-side and stored hashed. The cookie carries a random
 *    32-byte token; only its SHA-256 hash is persisted. A database leak does not
 *    yield live sessions, and suspending an account or revoking one session takes
 *    effect immediately — which a stateless JWT cannot do without a revocation
 *    list that amounts to the same table anyway.
 *
 * 3. COMPARISONS are timing-safe, so a wrong password and a wrong token both take
 *    the same time to reject regardless of how much of the value matched.
 *
 * 4. ROLES are `contributor` (default), `editor`, `admin`. Promotion is an
 *    explicit administrative act, exposed only as a CLI command — never as an
 *    API route, so there is no privilege-escalation surface to secure.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './client.ts';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

/** scrypt cost parameters. Raising these stays backward compatible. */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 200;

/** Sessions last 30 days, then the user signs in again. */
const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE = 'ozituma_session';

/*
 * `owner` outranks `admin`, and every check that asks for an admin has to admit the
 * owner. That is easy to get wrong by accident, so the comparisons live in the two
 * helpers below and callers ask those rather than comparing role names themselves.
 *
 * The four learn roles were added to the DATABASE enum by migration 0029 and were missing here,
 * which is a mismatch with consequences rather than a tidiness problem: a `linguist` could be
 * stored, sign in, and then fail every TypeScript check that reads `account.role`, and — because
 * `isReviewer` knows only editor, admin and owner — could not reach the review queue they exist to
 * work in. The type now matches the enum.
 *
 * `learner` is here because the enum has it, NOT because a learner is staff. `isReviewer` and
 * `isLearnStaff` both return false for it, which is the point.
 */
export type AccountRole =
  | 'learner'
  | 'contributor'
  | 'linguist'
  | 'native_reviewer'
  | 'content_editor'
  | 'editor'
  | 'admin'
  | 'owner';

/**
 * May moderate the DICTIONARY: an editor, an admin, or the owner.
 *
 * Deliberately NOT widened to the learn roles. A linguist reviews Igbo curriculum; giving them the
 * dictionary's contribution queue as a side effect would hand out access nobody asked for, in a
 * helper whose whole purpose is to be the one place that decides. The learn side has its own check
 * below.
 */
export function isReviewer(role: AccountRole): boolean {
  return role === 'editor' || role === 'admin' || role === 'owner';
}

/**
 * May work the LEARN content queue: anybody §5.3 gives a hand in the lifecycle.
 *
 * §5.3 splits the work across three roles — a linguist approves the language, a native reviewer
 * approves the audio and naturalness, a content editor publishes — so all three must be able to
 * REACH the queue. Which transitions each may actually perform is a separate question, and
 * `ALLOWED` in `packages/core/src/review-workflow.ts` is where it is answered; this only decides who
 * gets through the door.
 *
 * A `contributor` is included because a contributor authors and resubmits content, and the queue is
 * where they see their own work sent back with a reason.
 */
export function isLearnStaff(role: AccountRole): boolean {
  return (
    role === 'contributor' ||
    role === 'linguist' ||
    role === 'native_reviewer' ||
    role === 'content_editor' ||
    role === 'editor' ||
    role === 'admin' ||
    role === 'owner'
  );
}

/** May administer the site: an admin, or the owner. */
export function isAdmin(role: AccountRole): boolean {
  return role === 'admin' || role === 'owner';
}

export interface Account {
  id: number;
  uuid: string;
  email: string;
  displayName: string | null;
  role: AccountRole;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export class AccountError extends Error {
  /** Set explicitly: without it every subclass reports its name as "Error". */
  override readonly name = 'AccountError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (N > 1 << 20 || r > 32 || p > 16) return false; // refuse absurd cost params

  const expected = Buffer.from(hashB64!, 'base64');
  let derived: Buffer;
  try {
    derived = await scrypt(password, Buffer.from(saltB64!, 'base64'), expected.length, {
      N,
      r,
      p,
    });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Password policy.
 *
 * Length is the only rule that reliably correlates with strength, so that is
 * what is enforced. Composition rules (a digit, a symbol, mixed case) push
 * people towards predictable substitutions and are deliberately not applied.
 * The email is rejected as a password because it is public.
 */
export function assertPasswordAcceptable(password: string, email?: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(
      'weak_password',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AccountError(
      'weak_password',
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`
    );
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    throw new AccountError('weak_password', 'Password must not be your email address.');
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function normalise(row: Record<string, unknown>): Account {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    email: String(row.email),
    displayName: (row.display_name as string | null) ?? null,
    role: String(row.role) as AccountRole,
    status: String(row.status),
    emailVerified: Boolean(row.email_verified),
    createdAt: String(row.created_at),
    lastLoginAt: (row.last_login_at as string | null) ?? null,
  };
}

/**
 * Account columns, as a single line.
 *
 * Kept on one line deliberately: this string gets split and re-joined to build
 * table-aliased variants (see `aliasedAccountColumns`), and a multi-line list
 * splits in the middle of a column name and silently emits an unaliased column.
 */
const ACCOUNT_COLUMNS =
  'id, uuid, email, display_name, role, status, email_verified, created_at, last_login_at';

/** The same columns qualified with a table alias, e.g. `a.id, a.uuid, …`. */
function aliasedAccountColumns(alias: string): string {
  return ACCOUNT_COLUMNS.split(', ')
    .map((column) => `${alias}.${column}`)
    .join(', ');
}

export async function getAccountByEmail(db: Db, email: string): Promise<Account | null> {
  const row = await db.one<Record<string, unknown>>(
    `select ${ACCOUNT_COLUMNS} from account where lower(email) = lower($1)`,
    [email.trim()]
  );
  return row ? normalise(row) : null;
}

export async function getAccountById(db: Db, id: number): Promise<Account | null> {
  const row = await db.one<Record<string, unknown>>(
    `select ${ACCOUNT_COLUMNS} from account where id = $1`,
    [id]
  );
  return row ? normalise(row) : null;
}

/** Every account, for the `role.ts` administration CLI. */
export async function listAccounts(db: Db): Promise<Account[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select ${ACCOUNT_COLUMNS} from account
      order by case role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end,
               lower(email)`
  );
  return rows.map(normalise);
}

export interface RegisterAccountInput {
  email: string;
  password: string;
  displayName?: string | null;
}

export async function registerAccount(
  db: Db,
  input: RegisterAccountInput
): Promise<Account> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AccountError('invalid_email', 'That does not look like an email address.');
  }
  assertPasswordAcceptable(input.password, email);

  const existing = await getAccountByEmail(db, email);
  if (existing) {
    throw new AccountError('email_taken', 'An account with that email already exists.');
  }

  const passwordHash = await hashPassword(input.password);
  const row = await db.one<Record<string, unknown>>(
    `insert into account (email, display_name, password_hash, role)
     values ($1, $2, $3, 'contributor')
     returning ${ACCOUNT_COLUMNS}`,
    [email, input.displayName?.trim() || null, passwordHash]
  );
  if (!row) throw new AccountError('internal', 'Could not create that account.');
  return normalise(row);
}

/**
 * Verify credentials and, on success, record the sign-in.
 *
 * Returns null for a wrong password AND for an unknown email, with the same
 * shape and comparable timing, so the endpoint cannot be used to enumerate
 * which addresses have accounts.
 */
export async function authenticateAccount(
  db: Db,
  email: string,
  password: string
): Promise<Account | null> {
  const row = await db.one<Record<string, unknown>>(
    `select ${ACCOUNT_COLUMNS}, password_hash from account where lower(email) = lower($1)`,
    [email.trim()]
  );

  if (!row || !row.password_hash) {
    // Burn comparable time so a missing account is not detectably faster.
    await verifyPassword(password, await dummyHash());
    return null;
  }

  const ok = await verifyPassword(password, String(row.password_hash));
  if (!ok) return null;
  if (row.status !== 'active') return null;

  await db.query(`update account set last_login_at = now() where id = $1`, [row.id]);
  return normalise(row);
}

/** A real scrypt hash of a random value, used only to equalise timing. */
let cachedDummyHash: string | null = null;
async function dummyHash(): Promise<string> {
  cachedDummyHash ??= await hashPassword(randomBytes(24).toString('hex'));
  return cachedDummyHash;
}

export interface CreateSessionResult {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: Db,
  accountId: number,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {}
): Promise<CreateSessionResult> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.query(
    `insert into auth_session (account_id, token_hash, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [
      accountId,
      hashSessionToken(token),
      meta.userAgent?.slice(0, 300) ?? null,
      // inet columns reject junk; a malformed header should not fail sign-in.
      normaliseIp(meta.ipAddress),
      expiresAt,
    ]
  );

  return { token, expiresAt };
}

export function normaliseIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.split(',')[0]!.trim();
  // Accept only something that looks like IPv4/IPv6; the column is `inet`.
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(candidate)) return null;
  return candidate;
}

export interface SessionAccount {
  account: Account;
  sessionId: number;
  expiresAt: string;
}

/** Resolve a cookie token to its account. Returns null if invalid or expired. */
export async function resolveSession(db: Db, token: string): Promise<SessionAccount | null> {
  if (!token || token.length < 20) return null;

  const row = await db.one<Record<string, unknown>>(
    `select s.id as session_id, s.expires_at, ${aliasedAccountColumns('a')}
       from auth_session s
       join account a on a.id = s.account_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()`,
    [hashSessionToken(token)]
  );

  if (!row) return null;
  if (row.status !== 'active') return null;

  // Best-effort activity timestamp; never block a request on it.
  void db
    .query(`update auth_session set last_seen_at = now() where id = $1`, [row.session_id])
    .catch(() => undefined);

  return {
    account: normalise(row),
    sessionId: Number(row.session_id),
    expiresAt: String(row.expires_at),
  };
}

export async function revokeSession(db: Db, token: string): Promise<boolean> {
  const result = await db.query(
    `update auth_session set revoked_at = now()
      where token_hash = $1 and revoked_at is null`,
    [hashSessionToken(token)]
  );
  return result.rowCount > 0;
}

/** Sign out everywhere — used when a password changes. */
export async function revokeAllSessions(db: Db, accountId: number): Promise<number> {
  const result = await db.query(
    `update auth_session set revoked_at = now()
      where account_id = $1 and revoked_at is null`,
    [accountId]
  );
  return result.rowCount;
}

/** Housekeeping: delete sessions that expired long ago. */
export async function pruneExpiredSessions(db: Db): Promise<number> {
  const result = await db.query(
    `delete from auth_session where expires_at < now() - interval '7 days'`
  );
  return result.rowCount;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export function canReview(account: { role: AccountRole }): boolean {
  return isReviewer(account.role);
}

/**
 * Promote or demote an account. Deliberately not exposed over HTTP: privilege
 * escalation should require shell access to the database, not a request.
 */
export async function setAccountRole(
  db: Db,
  email: string,
  role: AccountRole
): Promise<Account | null> {
  const row = await db.one<Record<string, unknown>>(
    `update account set role = $2, updated_at = now()
      where lower(email) = lower($1)
      returning ${ACCOUNT_COLUMNS}`,
    [email.trim(), role]
  );
  return row ? normalise(row) : null;
}

// ---------------------------------------------------------------------------
// Cookie policy
// ---------------------------------------------------------------------------

/**
 * Session cookie attributes, in one place so they cannot drift between the
 * routes that set and clear them.
 *
 * `httpOnly` keeps the token away from JavaScript (so an XSS cannot exfiltrate
 * it) and `SameSite=Lax` blocks cross-site POSTs carrying the cookie (CSRF)
 * while still allowing normal navigation.
 *
 * `Secure` is derived from the configured site URL rather than NODE_ENV. Basing
 * it on NODE_ENV alone means `next start` on localhost — a production build
 * served over plain HTTP for testing — sets a Secure cookie the browser then
 * refuses to store, so sign-in silently appears to work and does nothing. If
 * OZITUMA_SITE_URL is unset we fall back to NODE_ENV, which is the safe default.
 *
 * WHY THERE IS A COOKIE DOMAIN AT ALL
 *
 * Without one the cookie is HOST-ONLY: a session created on ozituma.com is not sent to
 * learn.ozituma.com, so a learner who signs in on the dictionary arrives at the courses signed out
 * and has to sign in again. Setting the domain to `.ozituma.com` makes one cookie valid for both,
 * which is what §6.2 means by "a shared auth cookie domain (.ozituma.com)" and is the mechanism by
 * which one account works across the dictionary and the courses.
 *
 * WHY IT IS CONFIGURATION AND NOT A CONSTANT
 *
 * A leading-dot domain is correct in production and WRONG in every other environment. On
 * `localhost` a `.ozituma.com` cookie is simply never sent; on a host-only dev setup such as
 * `learn.localhost` the browser treats the two names as unrelated registrable domains, so the
 * cookie still does not cross. Worse, a browser silently discards a cookie whose domain does not
 * match the request — so a wrong value here looks exactly like a broken sign-in and nothing logs.
 *
 * So the default is no domain, which behaves identically to before this option existed, and a
 * deployment opts in by setting the variable. Absent configuration cannot break sign-in.
 */
export function sessionCookieOptions(maxAgeSeconds?: number) {
  const siteUrl = process.env.OZITUMA_SITE_URL ?? '';
  const secure = siteUrl.length > 0 ? siteUrl.startsWith('https://') : process.env.NODE_ENV === 'production';

  /**
   * The parent domain the session should be shared with, e.g. `.ozituma.com`.
   *
   * Validated rather than passed through. A value with a scheme, a path or a port is a
   * configuration mistake that produces a cookie no browser will store, and a sign-in that looks
   * broken for no visible reason — so a malformed value is ignored and the safe host-only default
   * is used instead. Leading dot is normalised, since browsers treat `ozituma.com` and
   * `.ozituma.com` identically but the intent is clearer with it.
   *
   * Note the hard limit this cannot cross: a cookie may only be shared within ONE registrable
   * domain. ozikoro.com and ozituma.com are different registrable domains, so no cookie setting
   * can span them — that pairing needs SSO, not a cookie.
   */
  const domain = normaliseCookieDomain(process.env.OZITUMA_AUTH_COOKIE_DOMAIN);

  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    ...(domain ? { domain } : {}),
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}

/**
 * Accept `.ozituma.com` or `ozituma.com`; reject anything that is not a bare domain.
 *
 * Exported so it can be tested directly — the failure mode it guards against is invisible in a
 * browser, so a unit test is the only place it can be caught cheaply.
 */
export function normaliseCookieDomain(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;

  // A scheme, a slash or a port all mean this is a URL rather than a domain.
  if (/[:/]/.test(value)) return null;

  const bare = value.startsWith('.') ? value.slice(1) : value;

  // One label means "localhost" or a mistake; neither is a domain worth sharing across.
  if (!bare.includes('.')) return null;
  // A domain label is letters, digits and hyphens. Anything else is a typo.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(bare)) return null;

  return `.${bare}`;
}

/** Seconds a new session should be valid for, matching createSession. */
export function sessionMaxAgeSeconds(): number {
  return SESSION_TTL_DAYS * 24 * 60 * 60;
}
