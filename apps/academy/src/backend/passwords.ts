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
