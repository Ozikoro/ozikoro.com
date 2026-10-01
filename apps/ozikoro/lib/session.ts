/**
 * Session access for the Ozikoro server.
 *
 * This is deliberately the same shape as `apps/web/lib/session.ts`, and deliberately not a
 * copy of the auth logic: the accounts, the password hashing and the session table all live
 * in `@ozituma/db/accounts` and are shared. Only the cookie plumbing is per app, because that
 * is the only part that is genuinely app-specific.
 *
 * WHY THERE IS A SESSION AT ALL ON OZIKORO.COM
 *
 * ozikoro.com and ozituma.com are different registrable domains, and no cookie setting can
 * span two of them — that is a browser rule, not a configuration choice. So an administrator
 * signed in on the dictionary arrives here signed out. The account is the same row in the
 * same database and the password is the same; only the session is separate.
 *
 * That is a real limitation and it is stated rather than hidden: proper single sign-on across
 * the two domains is a separate piece of work (see docs/learn/ACCOUNTS.md, which reaches the
 * same conclusion about the pairing).
 */
import { cookies } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import {
  SESSION_COOKIE,
  canReview,
  resolveSession,
  sessionCookieOptions,
  sessionMaxAgeSeconds,
  type Account,
} from '@ozituma/db/accounts';

export interface CurrentAccount {
  account: Account;
  canReview: boolean;
}

/** The signed-in account, or null. Reads the cookie and resolves it server-side. */
export async function getCurrentAccount(): Promise<CurrentAccount | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const session = await resolveSession(db, token);
  if (!session) return null;

  return { account: session.account, canReview: canReview(session.account) };
}

/**
 * Cookie options for setting a session, and for clearing it.
 *
 * `secure` is derived from OZITUMA_SITE_URL's scheme inside `sessionCookieOptions`, not from
 * NODE_ENV, for the reason written up there: a production build served over plain HTTP sets a
 * Secure cookie the browser silently refuses, so sign-in appears to work and does nothing.
 */
export function sessionCookie(maxAgeSeconds?: number) {
  return {
    name: SESSION_COOKIE,
    options: sessionCookieOptions(maxAgeSeconds),
  };
}

export { sessionMaxAgeSeconds };
export type { Account };
