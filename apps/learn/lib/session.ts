/**
 * Session access for the Next.js server.
 *
 * Wraps the database session layer so route handlers and server components read
 * the session the same way, and so the "who is this and may they review" check
 * exists in exactly one place.
 */
import { cookies } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import {
  canReview,
  isLearnStaff,
  resolveSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  sessionMaxAgeSeconds,
  type Account,
} from '@ozituma/db/accounts';

export interface CurrentAccount {
  account: Account;
  /** May moderate the DICTIONARY. Editor, admin or owner. */
  canReview: boolean;
  /**
   * May work the LEARN content queue: contributor, linguist, native_reviewer, content_editor,
   * editor, admin or owner.
   *
   * Separate from `canReview` on purpose. A linguist must reach the curriculum queue — §5.3 makes
   * them the first of the two approvals — but that is not a reason to hand them the dictionary's
   * contribution queue as well, and a single boolean could not express the difference.
   */
  canReviewLearn: boolean;
}

/**
 * The signed-in account, or null.
 *
 * Reads the session cookie and resolves it server-side. Called on every
 * request that needs identity; the lookup is a single indexed join, and
 * `resolveSession` returns null for expired or revoked rows, so a logged-out
 * user cannot resurrect a session by replaying a cookie.
 */
export async function getCurrentAccount(): Promise<CurrentAccount | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const session = await resolveSession(db, token);
  if (!session) return null;

  return {
    account: session.account,
    canReview: canReview(session.account),
    canReviewLearn: isLearnStaff(session.account.role),
  };
}

/** Cookie options for setting a session, and for clearing it. */
export function sessionCookie(maxAgeSeconds?: number) {
  return {
    name: SESSION_COOKIE,
    options: sessionCookieOptions(maxAgeSeconds),
  };
}

export { sessionMaxAgeSeconds };
export type { Account };
