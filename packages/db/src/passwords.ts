/**
 * Changing a password, and recovering an account when it is forgotten.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * `accounts.ts` is about identity: who you are, whether the password you typed
 * matches, and whether the session in your cookie is still live. This file is
 * about the password as a secret that has to be replaced — and replacing a secret
 * is where the mistakes live. Keeping the two apart means every path that writes
 * `account.password_hash` is in one place, and there is exactly one of them.
 *
 * THE THREE WAYS A PASSWORD CHANGES
 *
 *   self      the account holder types the current password and a new one
 *   recovery  they follow a single-use link sent to the account's address
 *   admin     an administrator sets one, without knowing the old one
 *
 * All three end in the same private function, so all three revoke the sessions
 * that already exist and all three write the same audit row. A password change
 * that leaves somebody else's session alive is not a password change: if the
 * reason you are changing it is that someone else has it, the session they
 * opened with it is the thing you most need to close.
 *
 * WHAT A RECOVERY LINK IS
 *
 * A random 32-byte token, stored only as a SHA-256 hash, valid for one hour, and
 * usable once. Asking for a new one voids the old, so an earlier email becomes
 * harmless the moment a later one is sent. The reply to "I have forgotten my
 * password" is identical whether or not the address has an account, because the
 * alternative is a form that tells anyone who types an address into it whether
 * that person has an account here.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './client.ts';
import {
  AccountError,
  assertPasswordAcceptable,
  getAccountByEmail,
  getAccountById,
  hashPassword,
  normaliseIp,
  revokeAllSessions,
  verifyPassword,
  type Account,
} from './accounts.ts';

/** A recovery link is good for an hour. Long enough to find the email, short enough to matter. */
export const RESET_TTL_MINUTES = 60;

export type PasswordChangeRoute = 'self' | 'recovery' | 'admin';

export interface RequestMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * A requested link, held in memory only long enough to be emailed or read out.
 *
 * The token is returned exactly once and never stored, so this object must not be
 * written to a log or a page that outlives the request that created it.
 */
export interface PasswordResetLink {
  token: string;
  expiresAt: Date;
  /** The account the link is for, so the caller can address the email. */
  account: Account;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The one place a password is written.
 *
 * Every caller has already established that the change is legitimate; what this
 * function adds is that the change actually happened everywhere it had to — the
 * hash, the timestamp, the audit row, and the closing of live sessions.
 */
async function writePassword(
  db: Db,
  accountId: number,
  newPassword: string,
  route: PasswordChangeRoute,
  meta: RequestMeta = {},
  actorId: number | null = null,
  /** The session the change was made from, kept alive so the person is not signed out of it. */
  keepSessionToken?: string | null
): Promise<Account> {
  const account = await getAccountById(db, accountId);
  if (!account) throw new AccountError('no_account', 'That account no longer exists.');

  assertPasswordAcceptable(newPassword, account.email);
  const passwordHash = await hashPassword(newPassword);

  await db.query(
    `update account set password_hash = $2, password_changed_at = now(), updated_at = now()
      where id = $1`,
    [accountId, passwordHash]
  );

  await db.query(
    `insert into password_change (account_id, changed_by, actor_id, ip_address)
     values ($1, $2, $3, $4)`,
    [accountId, route, actorId, normaliseIp(meta.ipAddress)]
  );

  /*
   * Any link that has not been used is now pointless — the password it would let
   * someone set has already been replaced — so close them all rather than leaving
   * a live key in an inbox. Same reasoning for sessions, except the one doing the
   * changing, if it was the account holder changing their own password.
   */
  await db.query(
    `update password_reset set used_at = now() where account_id = $1 and used_at is null`,
    [accountId]
  );

  if (keepSessionToken) {
    await db.query(
      `update auth_session set revoked_at = now()
        where account_id = $1 and revoked_at is null and token_hash <> $2`,
      [accountId, hashToken(keepSessionToken)]
    );
  } else {
    await revokeAllSessions(db, accountId);
  }

  const updated = await getAccountById(db, accountId);
  return updated ?? account;
}

/**
 * Change your own password.
 *
 * Requires the current password, even though the caller is already signed in and
 * already knows the account: a stolen or left-open session must not be enough to
 * lock the real owner out of their own account.
 */
export async function changeOwnPassword(
  db: Db,
  accountId: number,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta & { keepSessionToken?: string | null } = {}
): Promise<Account> {
  const row = await db.one<Record<string, unknown>>(
    `select password_hash from account where id = $1`,
    [accountId]
  );
  const stored = row?.password_hash ? String(row.password_hash) : null;
  if (!stored) {
    throw new AccountError(
      'no_password',
      'This account has no password. Ask an administrator to set one.'
    );
  }

  const ok = await verifyPassword(currentPassword, stored);
  if (!ok) throw new AccountError('wrong_password', 'That is not your current password.');

  if (currentPassword === newPassword) {
    throw new AccountError('same_password', 'The new password has to be a different one.');
  }

  return writePassword(db, accountId, newPassword, 'self', meta, null, meta.keepSessionToken);
}

/** An administrator setting a password for someone else, without knowing the old one. */
export async function setPasswordAsAdmin(
  db: Db,
  accountId: number,
  newPassword: string,
  actorId: number,
  meta: RequestMeta = {}
): Promise<Account> {
  if (accountId === actorId) {
    // Otherwise this is a way to change your own password without proving the old
    // one, which is precisely what `changeOwnPassword` refuses to allow.
    throw new AccountError(
      'self_admin',
      'Use your own password form to change your own password.'
    );
  }
  return writePassword(db, accountId, newPassword, 'admin', meta, actorId);
}

/** A random password for an administrator to hand over, when email is not an option. */
export function generatePassword(): string {
  // 24 base64url characters; readable over a phone line and long enough to satisfy
  // the policy on any account.
  return randomBytes(18).toString('base64url');
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Start a recovery.
 *
 * Returns null when no account holds that address — the caller must show the
 * same reply either way. When there is an account, any earlier open link is
 * closed first, so only the newest email in the inbox can be used.
 */
export async function requestPasswordReset(
  db: Db,
  email: string,
  meta: RequestMeta = {}
): Promise<PasswordResetLink | null> {
  const account = await getAccountByEmail(db, email);
  if (!account) return null;
  // A suspended account cannot sign in, so a link would be a dead end. Refusing
  // here keeps the flow honest without telling the requester why.
  if (account.status !== 'active') return null;

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

  await db.query(
    `update password_reset set used_at = now() where account_id = $1 and used_at is null`,
    [account.id]
  );
  await db.query(
    `insert into password_reset (account_id, token_hash, requested_ip, requested_agent, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [account.id, hashToken(token), normaliseIp(meta.ipAddress), meta.userAgent?.slice(0, 300) ?? null, expiresAt]
  );

  return { token, expiresAt, account };
}

/** Record how a link reached the person, once we know. Nothing depends on it working. */
export async function markResetDelivered(
  db: Db,
  token: string,
  deliveredBy: 'email' | 'hand'
): Promise<void> {
  await db.query(
    `update password_reset set delivered_by = $2 where token_hash = $1`,
    [hashToken(token), deliveredBy]
  );
}

export interface ResetLookup {
  accountId: number;
  email: string;
  expiresAt: Date;
}

/** Is this link still usable? Used to decide whether to draw the form or refuse. */
export async function checkResetToken(db: Db, token: string): Promise<ResetLookup | null> {
  if (!token || token.length < 20) return null;
  const row = await db.one<Record<string, unknown>>(
    `select r.account_id, r.expires_at, a.email
       from password_reset r
       join account a on a.id = r.account_id
      where r.token_hash = $1
        and r.used_at is null
        and r.expires_at > now()
        and a.status = 'active'`,
    [hashToken(token)]
  );
  if (!row) return null;
  return {
    accountId: Number(row.account_id),
    email: String(row.email),
    expiresAt: new Date(String(row.expires_at)),
  };
}

/**
 * Finish a recovery: set the password the person chose and burn the link.
 *
 * The password is checked BEFORE the link is spent, and that order is the point:
 * somebody who types something too short, or mistypes the confirmation, has to be
 * able to try again with the same link. The link is then marked used before the
 * write, so a failure between the two leaves a spent link rather than a
 * replayable one — which is the safe direction to fail in.
 */
export async function resetPasswordWithToken(
  db: Db,
  token: string,
  newPassword: string,
  meta: RequestMeta = {}
): Promise<Account> {
  const found = await checkResetToken(db, token);
  if (!found) {
    throw new AccountError(
      'bad_token',
      'That link has expired or has already been used. Ask for a new one.'
    );
  }

  // A refusal from the policy must not cost them the link.
  assertPasswordAcceptable(newPassword, found.email);

  await db.query(`update password_reset set used_at = now() where token_hash = $1`, [
    hashToken(token),
  ]);

  return writePassword(db, found.accountId, newPassword, 'recovery', meta);
}

// ---------------------------------------------------------------------------
// What an administrator can see
// ---------------------------------------------------------------------------

export interface OpenResetRequest {
  id: number;
  email: string;
  createdAt: string;
  expiresAt: string;
  requestedIp: string | null;
  deliveredBy: string | null;
}

/**
 * Recovery links that are still open, most recent first.
 *
 * This exists because email may not be configured yet, and a person who cannot
 * get in must not be stuck behind that. The administrator can see that the
 * request happened and, when mail is off, is shown the link itself to pass on.
 * The token is NOT in this list: it is unrecoverable by design, so an
 * administrator who needs to hand one over does it from the request form, which
 * has the token in hand. This tells them a request is waiting.
 */
export async function listOpenResetRequests(db: Db): Promise<OpenResetRequest[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select r.id, a.email, r.created_at, r.expires_at, r.requested_ip::text as requested_ip, r.delivered_by
       from password_reset r
       join account a on a.id = r.account_id
      where r.used_at is null and r.expires_at > now()
      order by r.created_at desc
      limit 100`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    email: String(row.email),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    requestedIp: (row.requested_ip as string | null) ?? null,
    deliveredBy: (row.delivered_by as string | null) ?? null,
  }));
}

/** What changed, and how, for the account page and for an administrator looking at one. */
export interface PasswordChangeRecord {
  changedAt: string;
  changedBy: PasswordChangeRoute;
}

export async function listPasswordChanges(
  db: Db,
  accountId: number,
  limit = 10
): Promise<PasswordChangeRecord[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select changed_at, changed_by from password_change
      where account_id = $1 order by changed_at desc limit $2`,
    [accountId, limit]
  );
  return rows.map((row) => ({
    changedAt: String(row.changed_at),
    changedBy: String(row.changed_by) as PasswordChangeRoute,
  }));
}

/** Housekeeping: drop spent and expired links older than a week. */
export async function prunePasswordResets(db: Db): Promise<number> {
  const result = await db.query(
    `delete from password_reset
      where expires_at < now() - interval '7 days'
         or (used_at is not null and used_at < now() - interval '7 days')`
  );
  return result.rowCount;
}
