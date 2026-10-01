/**
 * POST /api/learn-bridge/account
 *
 * Creates an Ozituma dictionary account for somebody who registered on learn.ozituma.com.
 *
 * WHY THIS EXISTS
 *
 * The two sites have separate databases and separate auth:
 *
 *   ozituma.com        PostgreSQL, its own scrypt hashing, `ozituma_session` cookies
 *   learn.ozituma.com  Supabase, Supabase Auth
 *
 * The owner's requirement is one account across both. `packages/db/src/supabase-mirror.ts` covers
 * the direction that starts on the dictionary — a new ozituma.com account is mirrored into Supabase
 * with the same password, because the plain password is in hand at that moment.
 *
 * This is the direction that starts on the courses. The app has the plain password during
 * `supabase.auth.signUp`, so it hands it here and the dictionary gets an account with the SAME
 * credentials. That symmetry is what makes "either login works" true for new people, rather than
 * sending them to a password reset.
 *
 * WHY THE PASSWORD COMES OVER THE WIRE
 *
 * It has to: the dictionary needs it to hash, and there is no way to derive one system's hash from
 * the other's. It travels server-to-server over HTTPS and is never logged. Note this is a real
 * trade — the courses service briefly holds a plaintext credential — and it is the reason this
 * endpoint does nothing else and refuses anything it cannot fully validate.
 *
 * WHY IT IS IDEMPOTENT
 *
 * `email_taken` is treated as SUCCESS. A learner who signs up twice, or a retried request, must not
 * see an error for an account that already exists — that would be a confusing failure for a correct
 * outcome. The endpoint reports which happened so the caller can log it without showing it.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { registerAccount, AccountError } from '@ozituma/db/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Only the courses service may call this.
 *
 * A shared secret rather than a session, because the caller is another server with no user. If it is
 * not configured the endpoint refuses EVERY request — an unauthenticated account-creation endpoint
 * on a public dictionary would let anyone make accounts with any password they like.
 */
function sharedSecret(): string | null {
  return process.env.LEARN_BRIDGE_SECRET ?? null;
}

const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

function allowed(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = sharedSecret();
  if (!secret) {
    // Fail closed. This endpoint creates accounts; it must never run unauthenticated.
    return NextResponse.json(
      { error: { code: 'bridge_disabled', message: 'Account bridging is not configured.' } },
      { status: 503 }
    );
  }

  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
  if (!allowed(ip)) {
    return NextResponse.json({ error: { code: 'rate_limited' } }, { status: 429 });
  }

  // Constant-time-ish comparison. Not a timing oracle worth chasing for a shared secret over TLS,
  // but `===` on secrets is the habit that produces real ones elsewhere.
  const offered = request.headers.get('x-learn-bridge') ?? '';
  if (offered.length !== secret.length || offered !== secret) {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }

  let body: { email?: unknown; password?: unknown; displayName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: 'invalid_json' } }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.slice(0, 120) : null;

  if (!email || !password) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'email and password are required.' } },
      { status: 400 }
    );
  }

  const db = await getDb();

  try {
    const account = await registerAccount(db, { email, password, displayName });
    return NextResponse.json({ ok: true, created: true, uuid: account.uuid });
  } catch (error) {
    if (error instanceof AccountError && error.code === 'email_taken') {
      // Already here — which is the desired end state, so it is a success with a different label.
      return NextResponse.json({ ok: true, created: false, reason: 'already_exists' });
    }

    if (error instanceof AccountError) {
      // `invalid_email` and a weak password are the learner's to fix; anything else is ours.
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.code === 'invalid_email' ? 400 : 422 }
      );
    }

    console.error('[learn-bridge]', error);
    return NextResponse.json({ ok: false, error: { code: 'failed' } }, { status: 500 });
  }
}
