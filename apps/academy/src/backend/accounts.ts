/**
 * Registration and sign-in, against the shared `account` table.
 *
 * A COPY OF `registerAccount` AND `authenticateAccount` from `packages/db/src/accounts.ts`, for the
 * build reason recorded in `./db.ts`. The semantics are reproduced exactly, because each of them is
 * load-bearing for an account that both this site and the dictionary read:
 *
 *   - the email is trimmed and lower-cased before storage and before lookup
 *   - the role is `contributor`, the default the dictionary assigns
 *   - `last_login_at` is recorded on every successful sign-in
 *   - a non-`active` account cannot sign in, even with the right password
 *   - a wrong password and an unknown email both take the same time to reject
 *
 * THE ONE DELIBERATE OMISSION: the canonical `registerAccount` mirrors a new account into a second
 * system so the same person could sign in at the retired `learn.ozituma.com`. That mirror, its
 * Supabase project and its caller were deleted on 2026-10-04, so there is nothing to mirror to and
 * a `mirrorAccount` call here would be dead code reaching for a project that no longer exists.
 */
import { randomBytes } from "node:crypto";
import { one, query } from "./db.ts";
import { AccountError, assertPasswordAcceptable, hashPassword, verifyPassword } from "./passwords.ts";

export const DEFAULT_ROLE = "contributor";

export interface Account {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
}

const ACCOUNT_COLUMNS = "id, email, display_name, role, status";

function toAccount(row: Record<string, unknown>): Account {
  return {
    id: Number(row.id),
    email: String(row.email),
    displayName: (row.display_name as string | null) ?? null,
    role: String(row.role),
    status: String(row.status),
  };
}

export async function registerAccount(input: {
  email: string;
  password: string;
  displayName?: string | null;
}): Promise<Account> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AccountError("invalid_email", "That does not look like an email address.");
  }
  assertPasswordAcceptable(input.password, email);

  const existing = await one<Record<string, unknown>>(
    `select id from account where lower(email) = lower($1)`,
    [email]
  );
  if (existing) {
    throw new AccountError("email_taken", "An account with that email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const row = await one<Record<string, unknown>>(
    `insert into account (email, display_name, password_hash, role)
     values ($1, $2, $3, $4)
     returning ${ACCOUNT_COLUMNS}`,
    [email, input.displayName?.trim() || null, passwordHash, DEFAULT_ROLE]
  );
  if (!row) throw new AccountError("internal", "Could not create that account.");

  return toAccount(row);
}

/**
 * Verify credentials.
 *
 * Returns null for a wrong password AND for an unknown email, in comparable time, so this cannot be
 * used to enumerate which addresses have accounts.
 */
export async function authenticateAccount(email: string, password: string): Promise<Account | null> {
  const row = await one<Record<string, unknown>>(
    `select ${ACCOUNT_COLUMNS}, password_hash from account where lower(email) = lower($1)`,
    [email.trim()]
  );

  if (!row || !row.password_hash) {
    // Burn comparable time so a missing account is not detectably faster to reject.
    await verifyPassword(password, await dummyHash());
    return null;
  }

  const ok = await verifyPassword(password, String(row.password_hash));
  if (!ok) return null;
  if (row.status !== "active") return null;

  await query(`update account set last_login_at = now() where id = $1`, [row.id]);
  return toAccount(row);
}

/**
 * A real scrypt hash of a random value, used only to equalise timing. Cached for the process
 * lifetime so the equalisation does not itself become a cost an attacker can measure.
 */
let cachedDummyHash: string | null = null;
async function dummyHash(): Promise<string> {
  cachedDummyHash ??= await hashPassword(randomBytes(24).toString("hex"));
  return cachedDummyHash;
}
