/**
 * Who may touch the Spotify connection, and the request checks that guard the endpoints.
 *
 * The connection belongs to the organisation, not to the administrator who happened to make
 * it, so there is exactly one rule and it is written once here: an administrator or the owner.
 * An editor is a contributor who can review, and this is not theirs.
 *
 * The role check is the FIRST thing every endpoint does. Nothing reads a parameter, writes a
 * row or calls Spotify before it has passed.
 */
import { getDb } from '@ozituma/db/client';
import { can, capabilitiesFor, safeRedirectPath,
} from '@ozikoro/platform';
import { redirect } from 'next/navigation';
import { getCurrentAccount, type CurrentAccount } from './session';
import { isAdmin } from '@ozituma/db/accounts';

export type GuardResult =
  | { ok: true; account: CurrentAccount }
  | { ok: false; response: Response };

/**
 * A 303 to a relative path, which is how every form endpoint in this repo answers.
 *
 * The separator is chosen from the path rather than assumed. A caller that returns an editor to the
 * record they were editing passes `/admin/rights/?item=3368`, and appending a second `?` produced
 * `/admin/rights/?item=3368?saved=...` — which a browser reads as one long `item` value, so the
 * record was not selected and the notice never appeared. It looked like the save had failed when it
 * had worked.
 */
export function redirectTo(path: string, params: Record<string, string> = {}): Response {
  const target = safeRedirectPath(path);
  const search = new URLSearchParams(params).toString();
  const separator = target.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 303,
    headers: { Location: search.length > 0 ? `${target}${separator}${search}` : target },
  });
}

/** A small JSON error, for the endpoints that answer a machine rather than a form. */
export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * The signed-in administrator, or a refusal to act on.
 *
 * Signed out and signed in as somebody who is not an administrator are different refusals and
 * get different answers: the first is sent to sign in, because that is a thing they can fix,
 * and the second is told plainly that this is not their area.
 */
export async function requireAdministrator(
  options: { returnTo?: string } = {}
): Promise<GuardResult> {
  const current = await getCurrentAccount();
  if (!current) {
    return {
      ok: false,
      response: redirectTo('/signin', {
        error: 'Sign in to reach the Spotify settings.',
        ...(options.returnTo ? { next: options.returnTo } : {}),
      }),
    };
  }
  if (!isAdmin(current.account.role)) {
    return {
      ok: false,
      response: redirectTo('/admin/spotify', {
        error: 'Only an administrator or the owner can change the Spotify connection.',
      }),
    };
  }
  return { ok: true, account: current };
}

/**
 * Whether a state-changing request came from this site.
 *
 * This is defence in depth, not the primary CSRF defence. The primary one is the session
 * cookie's `SameSite=Lax`, which already stops a cross-site POST from carrying the session at
 * all; and on the callback the primary one is the single-use, account-bound OAuth state. This
 * check catches the case those two do not: a browser that does not enforce SameSite, or a
 * future change that relaxes it.
 *
 * A missing `Origin` is allowed rather than refused. Some legitimate clients omit it, and the
 * header being absent is not evidence of a cross-site request — refusing on absence would
 * break real administrators to defend against a case the cookie already covers.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  const host = request.headers.get('host');
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * A capability check, enforced on the server.
 *
 * The plan is explicit: "Enforce permissions server-side. Never rely on hidden buttons as
 * authorisation." So a page or route that needs a permission calls this and gets a refusal it
 * cannot ignore — the UI hiding a link is presentation, and this is the rule.
 *
 * `requireAdministrator` above stays for the Spotify screens, which are the owner's and are gated
 * on the platform role. Everything on the archive side goes through capabilities, because
 * "may publish a sourced history" and "may administer the site" are different questions and
 * conflating them is how an editor ends up with the keys to the user table.
 */
export async function requireCapability(
  capability: string,
  options: { returnTo?: string } = {}
): Promise<{ ok: true; account: CurrentAccount; capabilities: Set<string> } | { ok: false; response: Response }> {
  const current = await getCurrentAccount();
  if (!current) {
    return {
      ok: false,
      response: redirectTo('/signin', {
        error: 'Sign in first.',
        ...(options.returnTo ? { next: options.returnTo } : {}),
      }),
    };
  }

  const db = await getDb();
  const capabilities = await capabilitiesFor(db, current.account.id);
  if (!capabilities.has(capability)) {
    return {
      ok: false,
      response: redirectTo(options.returnTo ?? '/contribute', {
        error: `That needs the “${capability.replace(/_/g, ' ')}” permission, which this account does not have.`,
      }),
    };
  }

  return { ok: true, account: current, capabilities };
}

/** Whether an account holds a capability, for deciding what a page should offer. */
export async function hasCapability(accountId: number, capability: string): Promise<boolean> {
  const db = await getDb();
  return can(db, accountId, capability);
}

/**
 * The capability check for a PAGE, which must render or redirect — never return a Response.
 *
 * A page component's return type is JSX, so returning `requireCapability`'s `Response` makes Next's
 * generated validator reject the route: the page compiles and the type checker refuses it. Route
 * handlers answer with statuses; pages answer with a redirect or a page. Same rule, two shapes.
 *
 * `redirect()` throws, so this either returns a signed-in account with the capability or does not
 * return at all — which is what makes `requireCapability` safe to use from a page.
 */
export async function requireCapabilityOrRedirect(
  capability: string,
  returnTo: string
): Promise<{ account: CurrentAccount; capabilities: Set<string> }> {
  const current = await getCurrentAccount();
  if (!current) {
    redirect(`/signin?error=${encodeURIComponent('Sign in first.')}&next=${encodeURIComponent(returnTo)}`);
  }

  const db = await getDb();
  const capabilities = await capabilitiesFor(db, current.account.id);
  if (!capabilities.has(capability)) {
    redirect(`/?error=${encodeURIComponent(`That needs the “${capability.replace(/_/g, ' ')}” permission.`)}`);
  }

  return { account: current, capabilities };
}

/**
 * A signed-in account, and nothing more.
 *
 * This exists because the claim path has to work for people who hold no role at all. The eleven
 * authors whose bylines are in the archive are not editors, moderators or administrators — requiring
 * any capability to claim your own writing would lock out every one of them, which would make the
 * claim path decorative. So this checks that somebody is signed in and stops there.
 *
 * Route handlers answer with a redirect; see `requireCapabilityOrRedirect` for the page-shaped
 * equivalent.
 */
export async function requireUser(
  options: { returnTo: string }
): Promise<{ ok: true; account: CurrentAccount } | { ok: false; response: Response }> {
  const current = await getCurrentAccount();
  if (!current) {
    return {
      ok: false,
      response: redirectTo(`/signin/`, {
        error: 'Sign in first.',
        next: options.returnTo,
      }),
    };
  }
  return { ok: true, account: current };
}
