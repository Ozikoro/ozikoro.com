/**
 * The shared Ozikoro password scheme.
 *
 * THIS IS A COPY OF `packages/db/src/accounts.ts`, AND IT MUST NOT DRIFT. It is here rather than
 * imported because the Academy has its own build and its own lockfile — see the header of `./db.ts`
 * for the full reasoning. The consequence worth stating plainly: if the canonical implementation
 * changes its cost parameters or its stored format, this file must change with it, or an account
 * registered on one Ozikoro site stops working on the other.
 *
 * `passwords.test.ts` cross-checks this implementation against the canonical one in both
 * directions, so drift is caught by a test rather than by a reader.
 *
 * ⚠️ **AND IT CARRIES ONE THING `packages/db/src/accounts.ts` DOES NOT: `changeOwnPassword`, at the end of
 * this file.** The archive has had a change-password since two commits before this one and the Academy had
 * none — *"a third surface on the shared `account` table with no way to change a password"*, which is the
 * fault the owner reported, one site along. It is a COPY for the build reason recorded in `./db.ts`, and
 * the long note above it says what I would change instead and why the change is not this file's to make.
 * **Until then the two implementations must agree, and the semantics are the canonical ones exactly.**
 *
 * What is reproduced exactly, because an existing `account` row depends on each of them:
 *
 *   - the stored format `scrypt$N$r$p$saltBase64$hashBase64`
 *   - the cost parameters N=16384, r=8, p=1, and a 64-byte derived key
 *   - a 16-byte per-password random salt
 *   - the length-only policy, and the 10-character minimum
 *
 * The canonical comment explains the posture, and it applies here unchanged: scrypt is memory-hard
 * and comes from Node's own crypto, so there is no dependency to keep patched; the stored string is
 * self-describing, so cost parameters can be raised later while old hashes still verify and are
 * rehashed on next sign-in; and comparisons are timing-safe, so a wrong password takes the same time
 * to reject regardless of how much of it matched.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { one, query } from "./db.ts";
import { normaliseIp, revokeOtherSessions } from "./session.ts";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

/** scrypt cost parameters. These must match `packages/db`. */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 200;

export class AccountError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  // Refuse absurd cost parameters rather than spending unbounded memory on an attacker's row.
  if (N > 1 << 20 || r > 32 || p > 16) return false;

  const expected = Buffer.from(hashB64!, "base64");
  let derived: Buffer;
  try {
    derived = await scrypt(password, Buffer.from(saltB64!, "base64"), expected.length, { N, r, p });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Password policy — length only.
 *
 * Composition rules (a digit, a symbol, mixed case) push people towards predictable substitutions
 * and are deliberately not applied. The email is rejected as a password because it is public.
 */
export function assertPasswordAcceptable(password: string, email?: string): void {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(
      "weak_password",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AccountError("weak_password", `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    throw new AccountError("weak_password", "Password must not be your email address.");
  }
}

// ---------------------------------------------------------------------------
// Changing the password of the account you are already signed in as
// ---------------------------------------------------------------------------

/**
 * ── WHAT THIS IS, AND THE BUILD BOUNDARY THAT MADE IT A COPY RATHER THAN AN IMPORT ───────────────────
 *
 * This is the Academy's own `changeOwnPassword`, and **it is here because the Academy cannot import the
 * canonical one.** The canonical implementation is `packages/db/src/passwords.ts`, and the whole point of
 * that file is that *"every path that writes `account.password_hash` is in one place, and there is exactly
 * one of them"* — a rule this copy does not by itself keep.
 *
 * **THE BOUNDARY, MEASURED RATHER THAN ASSUMED.** `apps/academy` is deliberately NOT an npm workspace
 * member: it has its own lockfile and its own Docker build context (`../apps/academy`), precisely so its
 * dependency graph cannot collide with the two Next.js apps'. Importing `@ozituma/db/passwords` would
 * require the Academy's build context to be the repository root, and would put it back inside the shared
 * `npm ci`. **So the import is not slow or awkward; it is impossible in the container that is built from
 * this directory.**
 *
 * **WHAT I WOULD CHANGE INSTEAD, AND WHY I DID NOT.** The right fix is to stop copying the scheme at all.
 * There are two ways, and both need a decision that is not this file's to make:
 *
 *   1. **Extract the password-and-session code into a package with no database driver and no framework** —
 *      the hash, the verify, the policy and this orchestration take a minimal `execute(sql, params)` rather
 *      than a `Db` — and have `packages/db`, `apps/ozikoro` and `apps/academy` all consume it. Then there is
 *      one implementation and the drift question disappears. It is the change I would make.
 *   2. **Promote `apps/academy` to a workspace member** and delete `./passwords.ts` and `./session.ts` in
 *      favour of `@ozituma/db/*`, which is what `./db.ts` already names as the destination.
 *
 * **I did neither, because both move the Academy inside the shared install, and the compose file that would
 * carry that change is the one this repository has explicitly been told not to deploy** — the host runs the
 * Academy from an `image:` and has no `apps/academy` directory, so `docker/` must not travel
 * (`scripts/deploy-to-host.sh` line 78, and `AGENTS.md`'s "it is a choice, not a fix"). **So the copy stays,
 * and the honest thing is to say so here, keep it one-for-one with the canonical file, and make the refusal
 * provable rather than trusted.**
 *
 * ── THE SEMANTICS ARE THE CANONICAL ONES, DELIBERATELY, LINE FOR LINE ────────────────────────────────
 *
 *   - the current password is REQUIRED and is verified against the stored hash before anything is written;
 *   - a wrong current password is `AccountError('wrong_password')` and **nothing is written**;
 *   - the new password goes through the same `assertPasswordAcceptable` — ten characters, the email
 *     refused — so the policy is not re-implemented;
 *   - the same `hashPassword` (scrypt, per-password salt) writes it, so a hash written here verifies under
 *     `packages/db` and vice versa;
 *   - the change is audited in the shared `password_change` table with `changed_by = 'self'`;
 *   - every open recovery link is voided;
 *   - every OTHER session is revoked, and the one making the change survives.
 *
 * **AND A FORM THAT SWAPPED THE PASSWORD WITHOUT THE CURRENT ONE WOULD TURN A BORROWED SESSION INTO A
 * PERMANENT TAKEOVER** — anyone at an unlocked machine, or holding a copied cookie, could set a new
 * password and lock the real owner out. That is why the current password is a parameter of this function
 * rather than something the caller may skip, and why there is no branch here that writes without it.
 */

/**
 * The two statements this module needs, so the refusal can be proved without a Postgres server.
 *
 * `./db.ts` satisfies this structurally — `one` returns a row or `null`, `query` returns a row count — so
 * the default below is the real one and no caller has to pass anything. It exists because **the fault this
 * function has to prove is the one it refuses**, and a refusal that cannot be exercised without a live
 * database is a refusal nobody has tested.
 */
export interface PasswordStore {
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

export interface ChangePasswordMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
  /** The session making the change. It survives; every other open session is closed. */
  keepSessionToken?: string | null;
}

export async function changeOwnPassword(
  accountId: number,
  currentPassword: string,
  newPassword: string,
  meta: ChangePasswordMeta = {},
  store: PasswordStore = { one, query }
): Promise<void> {
  /*
   * THE STORED HASH AND THE ADDRESS, READ TOGETHER. The address is here because
   * `assertPasswordAcceptable` refuses a password equal to the account's own email, and reading it in the
   * same statement means the policy cannot be applied against a different account than the one being
   * changed.
   */
  const row = await store.one<{ password_hash: string | null; email: string }>(
    `select password_hash, email from account where id = $1`,
    [accountId]
  );
  if (!row) throw new AccountError("no_account", "That account no longer exists.");

  const stored = row.password_hash ? String(row.password_hash) : null;
  if (!stored) {
    throw new AccountError(
      "no_password",
      "This account has no password. Ask an administrator to set one."
    );
  }

  /*
   * ── THE REFUSAL, AND IT COMES BEFORE EVERY WRITE ────────────────────────────────────────────────
   *
   * `verifyPassword` is timing-safe, so a wrong password takes the same time to reject however much of it
   * matched. Nothing above this line has written anything, and nothing below it runs.
   */
  const ok = await verifyPassword(currentPassword, stored);
  if (!ok) throw new AccountError("wrong_password", "That is not your current password.");

  if (currentPassword === newPassword) {
    throw new AccountError("same_password", "The new password has to be a different one.");
  }

  assertPasswordAcceptable(newPassword, row.email);
  const passwordHash = await hashPassword(newPassword);

  await store.query(
    `update account set password_hash = $2, password_changed_at = now(), updated_at = now()
      where id = $1`,
    [accountId, passwordHash]
  );

  await store.query(
    `insert into password_change (account_id, changed_by, actor_id, ip_address)
     values ($1, 'self', null, $2)`,
    [accountId, normaliseIp(meta.ipAddress)]
  );

  // A link that is still open would let somebody set a password that has just been replaced.
  await store.query(
    `update password_reset set used_at = now() where account_id = $1 and used_at is null`,
    [accountId]
  );

  await revokeOtherSessions(accountId, meta.keepSessionToken, store);
}
