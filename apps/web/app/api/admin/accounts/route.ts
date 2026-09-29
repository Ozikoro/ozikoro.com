/**
 * POST /api/admin/accounts · /api/admin/content
 *
 * The writing half of the admin dashboard. Everything here requires an administrator,
 * and the two things an administrator cannot do are checked in the database layer
 * rather than here — see `packages/db/src/admin.ts` for why.
 *
 * Errors come back as a redirect with the message in the query string rather than as
 * JSON, because these are plain HTML forms and the person needs to read the reason on
 * the page they were already looking at.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { isAdmin } from '@ozituma/db/accounts';
import {
  AdminError,
  createAccountAsAdmin,
  deleteAccountAsAdmin,
  removeContent,
  searchContent,
  updateAccountAsAdmin,
  type AccountRole,
  type ContentKind,
} from '@ozituma/db/admin';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  // Relative, for the reason the auth routes give: behind the proxy `request.url` is
  // the container's own address, so an absolute Location sends people to 0.0.0.0:3000.
  const search = new URLSearchParams(params).toString();
  return new NextResponse(null, { status: 303, headers: { Location: search ? `${path}?${search}` : path } });
}

function value(form: FormData, name: string, max = 400): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

export async function POST(request: Request): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current) return redirectTo('/signin', { error: 'Sign in first.' });
  if (!isAdmin(current.account.role)) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Only an administrator may do that.' } },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const action = value(form, 'action', 40);
  const db = await getDb();
  const actorRole = current.account.role as AccountRole;
  const backTo = value(form, 'back', 200) || '/admin';

  try {
    switch (action) {
      case 'account.create': {
        const created = await createAccountAsAdmin(db, {
          email: value(form, 'email', 200),
          password: String(form.get('password') ?? ''),
          role: value(form, 'role', 20) as AccountRole,
          displayName: value(form, 'displayName', 80) || null,
        });
        return redirectTo(backTo, {
          done: `Created the account for ${created.email}. Send them the password you set — they can change it from their own page.`,
        });
      }

      case 'account.update': {
        const role = value(form, 'role', 20);
        const status = value(form, 'status', 20);
        const updated = await updateAccountAsAdmin(db, {
          accountId: Number(form.get('accountId')),
          actorId: current.account.id,
          actorRole,
          role: role ? (role as AccountRole) : undefined,
          status: status === 'suspended' || status === 'active' ? status : undefined,
        });
        return redirectTo(backTo, {
          done: `${updated.email} is now ${updated.role}, ${updated.status}.`,
        });
      }

      case 'account.delete': {
        const removed = await deleteAccountAsAdmin(db, {
          accountId: Number(form.get('accountId')),
          actorId: current.account.id,
          actorRole,
        });
        return redirectTo(backTo, { done: `Deleted the account for ${removed.email}.` });
      }

      case 'content.remove': {
        const kind = value(form, 'kind', 20) as ContentKind;
        const mode = value(form, 'mode', 10) === 'delete' ? 'delete' : 'hide';
        const report = await removeContent(db, {
          kind,
          id: Number(form.get('id')),
          mode,
        });
        return redirectTo(backTo, {
          done:
            mode === 'delete'
              ? `Deleted ${kind} “${report.title}”. Removed with it: ${report.removed.join('; ')}.`
              : `Hid ${kind} “${report.title}”. It can be published again from here.`,
        });
      }

      case 'content.search': {
        const query = value(form, 'query', 100);
        return redirectTo(backTo, { q: query });
      }

      default:
        return redirectTo(backTo, { error: 'Unknown action.' });
    }
  } catch (error) {
    if (error instanceof AdminError) return redirectTo(backTo, { error: error.message });
    const message = error instanceof Error ? error.message : String(error);
    if (/weak_password/.test(message)) return redirectTo(backTo, { error: message });
    console.error('[admin]', error);
    return redirectTo(backTo, { error: 'That did not work. Nothing was changed.' });
  }
}

/** GET /api/admin/content?q= — the search the admin page uses without leaving the page. */
export async function GET(request: Request): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current || !isAdmin(current.account.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query.length < 2) return NextResponse.json({ results: [] });
  const db = await getDb();
  return NextResponse.json({ results: await searchContent(db, query) });
}
