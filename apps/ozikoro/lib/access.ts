/**
 * WHO MAY DO WHAT TO THE ARCHIVE — ONE PROHIBITION, ASKED OF THE DATABASE.
 *
 * ── THE RULE, IN THE OWNER'S WORDS ──────────────────────────────────────────────────────────────────
 *
 *   "an editor can approve every content, write any content, unpublish any content, and delete any content.
 *    the only thing an editor can not do is to delete trash, but can recover or do anything, except deleting
 *    trash. every content deleted will have to go to trash, unless permanently deleted from trash."
 *
 * Read that as a permission system and it is stated the unusual way round: **the default is YES, and exactly
 * one act is withheld.** An editor approves, writes, unpublishes, deletes and recovers anything in this
 * archive; an editor may not DESTROY something for good. Admin and owner may do that as well, and are
 * otherwise unchanged — the admin is not narrowed by this rule.
 *
 * ── SO THE GUARD IS NAMED FOR THE PROHIBITION, NOT FOR A ROLE ────────────────────────────────────────
 *
 * The capability is **`purge_trash`**, and only `admin` and `owner` hold it (migration 0055). A route that
 * destroys something calls `requireCapability('purge_trash')`; it does not ask whether the caller is an
 * editor. **That distinction is the whole safety property of the shape**:
 *
 *   * a route that asks "may this caller purge?" and FORGETS to ask refuses nobody — it fails CLOSED, for the
 *     one act in the archive with no undo;
 *   * a route that asks "is this caller an editor?" fails OPEN the day the roles change, and the next route
 *     somebody adds is a route that has to remember to ask at all.
 *
 * The check is made in the WRITE as well as at the door: `purgeArticle` and `purgeMedia` in
 * `packages/ozikoro/src/trash.ts` both call their own `requirePurge`, so a script, a job or a future endpoint
 * is refused by the same rule. **The rule lives in the write path, not in the UI** — the plan's own sentence,
 * and the reason `editorial.ts` holds its own validation.
 *
 * The rule itself lives in `ozikoro_role_capability` and is answered by `ozikoro_capabilities(account_id)`
 * (migration 0043). This file's job is to ASK, and to refuse in the right shape; a paragraph here that
 * restated the grants would be a second copy, and a second copy drifts. **It has drifted twice today**: the
 * comment this one replaces said *"there is exactly one rule and it is written once here: an administrator or
 * the owner. An editor is a contributor who can review, and this is not theirs"* — and by the time that was
 * read, an editor held six capabilities, was admitted to the back office, and had been given the audio queue.
 *
 * ── WHERE THE LINE ACTUALLY IS, WRITTEN OUT SO IT IS NOT GUESSED AT ──────────────────────────────────
 *
 *     editing a record — its words, its facets, its entities, its sources, a media
 *     record's description, an entity, the design, the corpus                          edit_entity, and
 *                                                                                      whatever the screen asks
 *     approving a record, unpublishing it, retiring it                                 edit_entity + publish
 *     deleting a record (to the trash) and restoring it from it                        edit_entity
 *     DESTROYING a record for good                                                    purge_trash   ← the only
 *                                                                                                    withheld act
 *
 * `purge_trash` is granted to `admin` and `owner` and to nobody else. Every other capability in the
 * vocabulary — including `manage_users`, `manage_roles`, `manage_design`, `view_audit`, `manage_media_rights`
 * and `export_data` — is held by `editor`, because the owner's rule is "everything except one thing" and
 * writing that as a list of allowances would be a list that is wrong the moment a capability is added.
 * Migration 0055 grants the editor every capability the table holds **minus `purge_trash`**, read out of the
 * table rather than restated, which is what makes that true by construction.
 *
 * ── AND THE REFUSAL STAYS A REFUSAL ────────────────────────────────────────────────────────────────
 *
 * The role check is the FIRST thing every endpoint does. Nothing reads a parameter, writes a row or returns a
 * record before it. Signed out and signed in are different refusals and get different answers: the first is
 * sent to sign in, because that is a thing they can fix, and the second is told plainly that this is not
 * theirs. The query string is built by `redirectTo` and never by hand — see its note for the recorded fault
 * where a second `?` produced `/admin/rights/?item=3368?saved=…`, which a browser reads as one long value.
 */
import { getDb } from '@ozituma/db/client';
import { can, capabilitiesFor, sameOrigin, safeRedirectPath,
} from '@ozikoro/platform';

/*
 * Re-exported so the route files keep importing their guards from one place.
 *
 * The IMPLEMENTATION lives in `@ozikoro/platform` — moved there in round 49 because this file imports
 * `next/navigation`, which does not resolve in a plain `node --test`, so a guard defined here could
 * not be tested. Re-exporting keeps `@/lib/access` as the single import site for route-level guards
 * while the logic itself sits where the tests are.
 */
export { sameOrigin };
import { redirect } from 'next/navigation';
import { getCurrentAccount, type CurrentAccount } from './session';
import { isAdmin, type AccountRole } from '@ozituma/db/accounts';

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
 *
 * ⚠️ **AND THE QUERY GOES BEFORE THE FRAGMENT, WHICH IS A SECOND VERSION OF THE SAME FAULT.** A form
 * that returns a reader to a section of a page — `/library/#saved`, which is where the dashboard's
 * *Saved histories* module points — used to produce `/library/#saved?saved=Saved+to+your+library.`
 * **A fragment is never sent to the server**, so the browser reads `?saved=…` as part of the anchor, the
 * page's `searchParams` never sees it, and the notice the reader earned by pressing the button silently
 * disappears. *It looked exactly like the save had failed*, which is the same confusion the paragraph
 * above was written to end — one level further down.
 */
export function redirectTo(path: string, params: Record<string, string> = {}): Response {
  const target = safeRedirectPath(path);
  const search = new URLSearchParams(params).toString();
  if (search.length === 0) {
    return new Response(null, { status: 303, headers: { Location: target } });
  }
  // `/a/b/?x=1#frag` -> base `/a/b/?x=1`, fragment `#frag`; the query is appended to the base.
  const hashAt = target.indexOf('#');
  const base = hashAt === -1 ? target : target.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : target.slice(hashAt);
  const separator = base.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 303,
    headers: { Location: `${base}${separator}${search}${fragment}` },
  });
}

/** A small JSON error, for the endpoints that answer a machine rather than a form. */
export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * The form body, or null when the request did not carry one.
 *
 * WHY THIS EXISTS AT ALL
 *
 * `request.formData()` **throws a `TypeError` when the request has no body and no content type** —
 * measured, not assumed — and an uncaught throw out of a route handler is a 500. So a bare
 * `curl -X POST` to this app's state-changing endpoints answered "Internal Server Error" instead of
 * the refusal they should give, which reads as a broken server when nothing is broken.
 *
 * Calling this AFTER the capability check means an anonymous request never reaches it: the guard
 * answers first with a redirect to sign in, which is the right refusal for a person. This is for the
 * authenticated-but-malformed case, where a form genuinely did not arrive and 415 is the honest answer.
 */
export async function formBody(request: Request): Promise<FormData | null> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\b|^application\/x-www-form-urlencoded\b/i.test(type)) return null;
  try {
    return await request.formData();
  } catch {
    // A declared form type with an unparseable body is still a malformed request rather than a fault.
    return null;
  }
}

/**
 * The signed-in administrator, or a refusal to act on.
 *
 * Signed out and signed in as somebody who is not an administrator are different refusals and
 * get different answers: the first is sent to sign in, because that is a thing they can fix,
 * and the second is told plainly that this is not their area.
 *
 * WHAT THIS GUARD IS FOR, AND WHAT IT IS NOT FOR
 *
 * It is for **the Spotify connection** — the organisation's account, whose tokens are the owner's, and whose
 * own screen nothing else answers for. **It is NOT the rule that decides who may edit the archive**, and it
 * never was: `app/admin/layout.tsx` admits an editor through `mayEnterBackOffice`, and every write path is
 * gated on a capability. A future agent who reads "an administrator or the owner" here and concludes that
 * `/admin/*` is admin-only would be reviving a mistake this comment exists to prevent.
 *
 * **The archive's rule is one prohibition, and it is not in this function.** An editor approves any content,
 * writes any content, unpublishes any content, deletes any content to the trash and recovers any of it;
 * an editor may not DESTROY something for good, which is `purge_trash` and is held by `admin` and `owner`
 * alone. Everything else — media, photographs, videos, documents, users, claims, rights, audit, design,
 * pronunciation, audio — is the editor's too, because the owner's rule is "everything except deleting trash".
 * See this file's header for the whole of it.
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
 * The administrator check for a PAGE, the page-shaped twin of `requireAdministrator`.
 *
 * WHY A PAGE NEEDS ITS OWN CHECK WHEN THE LAYOUT ALREADY HAS ONE
 *
 * `app/admin/layout.tsx` guards the whole area. **That guard does not stop a page beneath it from
 * rendering.** React renders a layout and its children CONCURRENTLY, so an admin page's queries run and its
 * markup is produced before the layout's `redirect()` throws — and the streamed response then carries it.
 * Measured on the running site: `GET /admin/archive` without a session answered **307 with a 32 KB body
 * containing the editorial queue's real rows**, and `/admin/rights` and `/admin/media` did the same with
 * their item references. **A redirect status is not a guarantee that the body is empty, and a crawler or a
 * script reads the body.**
 *
 * The users page already had this rule written down — *"a page that relied on the layout would hand the
 * whole account list to anyone who could open the editorial queue"* — and the measured pages above are what
 * happens without it. A page whose own first statement is a guard renders nothing to leak.
 */
export async function requireAdministratorOrRedirect(returnTo: string): Promise<{ account: CurrentAccount }> {
  const current = await getCurrentAccount();
  if (!current) {
    redirect(`/signin?error=${encodeURIComponent('Sign in first.')}&next=${encodeURIComponent(returnTo)}`);
  }
  if (!isAdmin(current.account.role)) {
    redirect(`/?error=${encodeURIComponent('Only an administrator or the owner can open that screen.')}`);
  }
  return { account: current };
}

/**
 * Who may open the back office at all.
 *
 * The rule lives here, in one function, because it is now asked in two places: the admin LAYOUT, which tells
 * a signed-in person without a role that this is not their door, and each admin PAGE, which must decide
 * before it renders. **Two copies of a five-term permission test drift**, and the drift would be a page that
 * opens for somebody the layout would have turned away.
 *
 * The dictionary's administrator holds every capability, so they come in as before; an Ozikoro editor, expert
 * reviewer, moderator or audio reviewer also comes in, because the editorial queues are theirs. `review_audio`
 * is named explicitly: an editor granted access to the audio files holds exactly that capability and no other,
 * so without it the audio queue would be unreachable by the only account meant to work it.
 */
export function mayEnterBackOffice(role: AccountRole, capabilities: Set<string>): boolean {
  return (
    isAdmin(role) ||
    capabilities.has('edit_entity') ||
    capabilities.has('moderate') ||
    capabilities.has('expert_review') ||
    capabilities.has('review_audio')
  );
}

/**
 * The back-office admission check for a PAGE, which must render or redirect.
 *
 * Same reasoning as `requireAdministratorOrRedirect`, and the same measurement behind it: a page beneath the
 * guarded layout renders concurrently with it, so the layout's redirect does not keep the page's own output
 * out of the streamed body.
 */
export async function requireBackOfficeOrRedirect(
  returnTo: string
): Promise<{ account: CurrentAccount; capabilities: Set<string> }> {
  const current = await getCurrentAccount();
  if (!current) {
    redirect(`/signin?error=${encodeURIComponent('Sign in first.')}&next=${encodeURIComponent(returnTo)}`);
  }

  const db = await getDb();
  const capabilities = await capabilitiesFor(db, current.account.id);
  if (!mayEnterBackOffice(current.account.role, capabilities)) {
    redirect(`/?error=${encodeURIComponent('That area is for editors, reviewers, moderators and administrators.')}`);
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
