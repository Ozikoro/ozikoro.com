/**
 * POST /api/account/keys — issue a key from the dashboard.
 * POST /api/account/keys/revoke — revoke one.
 *
 * Form posts with 303 redirects, like every other form on this site: the
 * dashboard works without JavaScript, and a refresh after submitting cannot
 * re-issue a key.
 *
 * THE ONE TIME THE SECRET IS SHOWN
 *
 * The new key is passed back in the redirect as a query parameter, which is the
 * only moment it exists in a form anyone can read. Two consequences, both taken
 * deliberately:
 *
 *   - the response is `Cache-Control: no-store`, so the key is not written into a
 *     shared cache or a browser's back-forward cache;
 *   - the page that renders it says plainly that it will not be shown again,
 *     because the database only ever holds its hash.
 *
 * A secret in a URL is normally a mistake. Here the alternative is a POST-render
 * page whose refresh re-submits the form, and the key is a fresh credential shown
 * once to the person who just created it on their own authenticated session,
 * rather than a link anyone shares.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { issueKeyForAccount, revokeKeyForAccount } from '@ozituma/db/account-keys';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_KEYS_PER_ACCOUNT = 10;

function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  const search = new URLSearchParams(params).toString();
  const location = search.length > 0 ? `${path}?${search}` : path;
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current) return redirectTo('/signin', { error: 'Sign in to manage API keys.' });

  const form = await request.formData();
  const action = String(form.get('action') ?? 'create');
  const db = await getDb();

  if (action === 'revoke') {
    const keyId = Number(form.get('keyId') ?? 0);
    if (!Number.isInteger(keyId) || keyId <= 0) {
      return redirectTo('/account', { keys: 'invalid' });
    }
    const revoked = await revokeKeyForAccount(db, current.account, keyId);
    return redirectTo('/account', { keys: revoked ? 'revoked' : 'notfound' });
  }

  const existing = await db.one<{ n: number }>(
    `select count(*)::int as n from api_key k
       join developer d on d.id = k.developer_id
      where d.account_id = $1 and k.revoked_at is null`,
    [current.account.id]
  );
  if (Number(existing?.n ?? 0) >= MAX_KEYS_PER_ACCOUNT) {
    return redirectTo('/account', { keys: 'limit' });
  }

  const name = String(form.get('name') ?? '').trim().slice(0, 60);
  const expiresRaw = String(form.get('expires') ?? '');
  const expiresInDays = expiresRaw === '' ? null : Number(expiresRaw);
  if (expiresInDays !== null && ![30, 90, 365].includes(expiresInDays)) {
    return redirectTo('/account', { keys: 'invalid' });
  }

  const { apiKey, keyPrefix } = await issueKeyForAccount(db, current.account, {
    name,
    expiresInDays,
  });
  return redirectTo('/account', { issued: apiKey, prefix: keyPrefix });
}
