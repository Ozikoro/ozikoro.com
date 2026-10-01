/**
 * One account, two sites.
 *
 * THE PROBLEM THIS SOLVES
 *
 * ozituma.com and learn.ozituma.com are two applications with two databases:
 *
 *   ozituma.com        Next.js on EC2, PostgreSQL, its own scrypt auth and `ozituma_session` cookie
 *   learn.ozituma.com  TanStack Start on Cloudflare Workers, Supabase (Postgres + Supabase Auth)
 *
 * The owner's requirement is that they are ONE account: registering on the dictionary registers you
 * for the courses, either login works, and the data is shared.
 *
 * THE APPROACH, AND WHAT IT DELIBERATELY IS NOT
 *
 * This MIRRORS: when ozituma.com creates an account, it also creates the same person in Supabase.
 * Both systems keep working exactly as they do now; nothing about the dictionary's login changes.
 *
 * The alternatives were worse here:
 *
 *   - Making Supabase the only auth means rewriting the login on a live production dictionary, and
 *     its `account` table is the one the contributor and review system is built on.
 *   - A shared JWT means handing Supabase's signing secret to the other application, so a compromise
 *     of either becomes a compromise of both.
 *
 * A mirror has one real cost: two records that can drift. That is handled by making this IDEMPOTENT
 * and re-runnable — `backfill` repairs any account that did not get mirrored, and it is safe to run
 * as often as you like.
 *
 * THE DICTIONARY IS AUTHORITATIVE
 *
 * Every function here fails SOFT. If Supabase is unreachable, registration on ozituma.com still
 * succeeds and the log records the miss for the next backfill. A learner must never be unable to
 * create a dictionary account because a second system is down — the courses are the addition, not
 * the product.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export interface MirrorResult {
  ok: boolean;
  /** The Supabase user id, when it worked. */
  id?: string;
  /** `already_exists` is a success, not a failure — it means the mirror already ran. */
  reason?: 'not_configured' | 'already_exists' | 'failed';
}

export function mirrorConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

/**
 * Create the same person in Supabase.
 *
 * WHY THE PASSWORD IS PASSED THROUGH
 *
 * At registration the plain password is in hand, and this is the only moment it ever will be — the
 * dictionary stores a scrypt hash, not the password. Passing it here means the learner can sign in
 * on learn.ozituma.com immediately with the credentials they just chose, which is the whole point of
 * "one account".
 *
 * It is sent over HTTPS to Supabase's own admin API, which is where a password belongs. It is never
 * logged, never stored by this function, and never placed in the mirror record.
 */
export async function mirrorAccount(input: {
  email: string;
  password: string;
  displayName?: string | null;
}): Promise<MirrorResult> {
  if (!mirrorConfigured()) return { ok: false, reason: 'not_configured' };

  const email = input.email.trim().toLowerCase();

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: input.password,
        // Confirmed on the dictionary's side already — it is the same person and the same address,
        // and making them confirm twice for one account is exactly the friction this avoids.
        email_confirm: true,
        user_metadata: input.displayName ? { full_name: input.displayName } : {},
      }),
    });

    if (response.ok) {
      const body = (await response.json()) as { id?: string };
      return { ok: true, id: body.id };
    }

    const text = await response.text().catch(() => '');

    /*
     * A duplicate is the normal case on a re-run, not an error. Supabase returns 422 with
     * `email_exists`; treating it as failure would make every backfill look broken.
     */
    if (response.status === 422 || /already|exists|registered/i.test(text)) {
      return { ok: false, reason: 'already_exists' };
    }

    console.error('[mirror] failed', { email, status: response.status, body: text.slice(0, 200) });
    return { ok: false, reason: 'failed' };
  } catch (error) {
    // Unreachable Supabase must not fail a dictionary registration.
    console.error('[mirror] unreachable', {
      email,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Mirror every existing dictionary account that is not yet in Supabase.
 *
 * WHY BACKFILL CANNOT COPY PASSWORDS
 *
 * The dictionary stores a scrypt hash. It cannot be reversed, and it is not Supabase's format — so
 * there is no way to give an existing account its password on the other side. Instead each missing
 * account is created with a RANDOM password nobody knows, and Supabase sends a password-reset email
 * so the person sets one when they first visit the courses.
 *
 * That is a real cost and it is stated rather than hidden: existing accounts get "check your email
 * to set a password for the courses", not a silent login. `sendReset: false` creates the accounts
 * without mailing anyone, for a dry run.
 */
export async function backfillAccounts(
  emails: readonly { email: string; displayName?: string | null }[],
  options: { sendReset?: boolean } = {}
): Promise<{ created: number; existed: number; failed: number }> {
  if (!mirrorConfigured()) return { created: 0, existed: 0, failed: 0 };

  let created = 0;
  let existed = 0;
  let failed = 0;

  for (const person of emails) {
    // A random password, 32 bytes of it. Nobody knows it, including this process after the call
    // returns — which is correct, because the only legitimate way in is the reset email.
    const random = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    const result = await mirrorAccount({
      email: person.email,
      password: `Rk-${random}`,
      displayName: person.displayName,
    });

    if (result.ok) {
      created += 1;
      if (options.sendReset !== false) {
        await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
          method: 'POST',
          headers: { apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: person.email.trim().toLowerCase() }),
        }).catch(() => undefined);
      }
    } else if (result.reason === 'already_exists') {
      existed += 1;
    } else {
      failed += 1;
    }
  }

  return { created, existed, failed };
}
