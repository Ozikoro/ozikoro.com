/**
 * POST /api/admin/users — the two things an administrator may do to an account here.
 *
 *   { "action": "set-role",   "accountId": 199, "role": "editor", "note": "…" }   grant an archive role
 *   { "action": "clear-role", "accountId": 199, "role": "editor" }                revoke an archive role
 *   { "action": "set-status", "accountId": 199, "status": "suspended", "note": "…" } suspend or reactivate
 *
 * WHY ONE ENDPOINT AND NOT THREE
 *
 * The same reason `/api/admin/archive` is one: each of these is "an administrator filled in a form and pressed
 * a button", and three files would be three places for the capability check to be forgotten. **The checks are
 * the first thing that happens and nothing below them runs** — the plan's rule is that permissions are
 * enforced on the server and a hidden button is not authorisation.
 *
 * THE CAPABILITY AND THE RANK ARE TWO DIFFERENT REFUSALS AND BOTH ARE ANSWERS
 *
 * `manage_users` says whether this screen is yours at all. `ozikoro_role_may_grant` says whether this
 * particular grant is below your own rank — an administrator holds `manage_roles` and still may not mint
 * another administrator, which is the whole point of migration 0044. The second check is **called, not
 * reimplemented**: see `packages/ozikoro/src/roles.ts`, which asks the database for
 * `ozikoro_role_may_grant` and only formats its reason.
 *
 * WHAT THIS ROUTE DELIBERATELY DOES NOT DO
 *
 * It does not create accounts, it does not set a password, it does not impersonate anybody, and it does not
 * delete anything. Those are named here rather than merely absent, so that the next person to read this file
 * can see they were decisions:
 *
 *   - CREATING AN ACCOUNT needs a password or a reset mail. Both belong to the account layer
 *     (`@ozituma/db/accounts`, `scripts/create-account.ts`), where the validation and the mail template live.
 *     **A user table that could also mint accounts is the one screen where a mis-click mails a stranger a
 *     credential.** The archive has 1,057 records and one account; there is no bulk-signup need that would
 *     justify it.
 *   - IMPERSONATION would make every audit row written afterwards a lie, because the actor would be recorded
 *     as the person being impersonated. The brief forbids it; the audit trail is why.
 *   - DELETION is not reversible and would orphan attribution: `ozikoro_contributor.account_id` is
 *     `on delete set null`, so deleting an account silently uncredits everything that person wrote.
 *     Suspension is offered instead, and it is reversible.
 *   - NOBODY MAY SUSPEND OR DEMOTE THEMSELVES. An owner who demotes or suspends their own account can lock the
 *     whole archive out of its own administration and the recovery is a database console — the position this
 *     screen exists to keep the owner out of. The refusal is explicit below rather than left to the rank rule,
 *     because an owner outranks an owner and the rank rule would allow it.
 */
import { getDb, type Db } from '@ozituma/db/client';
import { revokeAllSessions } from '@ozituma/db/accounts';
import {
  MemberError,
  capabilitiesFor,
  getUserAccount,
  grantRole,
  isOzikoroRole,
  mayGrantRole,
  mayRevokeRole,
  revokeRole,
} from '@ozikoro/platform';
import { answerAction, memberErrorOutcome, readAction, type ActionInput } from '@/lib/narration-http';
import { sameOrigin } from '@/lib/access';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Back to the account's own page when one was named, so a form post lands where the change is visible. */
function backTo(data: Record<string, string>): string {
  const id = Number.parseInt(data.accountId ?? '', 10);
  return Number.isInteger(id) && id > 0 ? `/admin/users/${id}` : '/admin/users';
}

export async function POST(request: Request): Promise<Response> {
  const input = await readAction(request, '/admin/users');

  /*
   * Cross-site form posts are refused. The session cookie is `SameSite=Lax`, which already stops a browser
   * sending it on a cross-site POST, so this is defence in depth — the same line `/api/admin/archive` and the
   * Spotify endpoints carry, and for the same reason: a state-changing route that relies only on a cookie
   * attribute continuing to be set correctly has one protection where it could have two.
   */
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false,
      status: 403,
      payload: { error: 'cross_origin' },
      notice: 'That request did not come from this site.',
    });
  }

  /*
   * FIRST, ALWAYS. This is `guardNarration`'s shape but not its function: that one returns an actor id, and
   * this route needs the whole capability set, because "may open the user table" and "may change a role" are
   * different capabilities and the second must not be assumed from the first.
   *
   * Signed out and signed in without the capability are different answers, and a form caller needs a 303 while
   * a JSON caller needs a status — which is exactly what `answerAction` decides.
   */
  const current = await getCurrentAccount();
  if (!current) {
    return answerAction(input, {
      ok: false,
      status: 403,
      payload: { error: 'Not signed in.' },
      notice: 'Sign in first.',
    });
  }
  const db = await getDb();
  const capabilities = await capabilitiesFor(db, current.account.id);
  if (!capabilities.has('manage_users')) {
    return answerAction(input, {
      ok: false,
      status: 403,
      payload: { error: 'Needs the “manage_users” capability.', capability: 'manage_users' },
      notice: 'The user table needs the “manage users” permission, which this account does not have.',
    });
  }
  const actorId = current.account.id;

  const data = input.data;
  const action = (data.action ?? '').trim();
  const accountId = Number.parseInt(data.accountId ?? '', 10);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return answerAction(input, {
      ok: false,
      status: 400,
      payload: { error: 'An accountId is required.' },
      notice: 'Name the account.',
    });
  }
  const note = (data.note ?? '').trim().slice(0, 500) || null;
  const returnTo = backTo(data);
  const answered = { ...input, returnTo } satisfies ActionInput;

  try {
    const target = await getUserAccount(db, accountId);

    if (action === 'set-role' || action === 'clear-role') {
      const role = (data.role ?? '').trim();
      if (!isOzikoroRole(role)) {
        return answerAction(answered, {
          ok: false,
          status: 400,
          payload: { error: 'That is not a role on this site.' },
          notice: 'That is not a role on this site.',
        });
      }

      /*
       * Changing anybody's roles is a separate capability from being allowed into this screen, because
       * reading the user table and granting editorial standing are different acts. An account can hold
       * `manage_users` without `manage_roles` — the vocabulary allows it — and this is where the difference is
       * enforced rather than described.
       */
      if (!capabilities.has('manage_roles')) {
        return answerAction(answered, {
          ok: false,
          status: 403,
          payload: { error: 'Needs the “manage_roles” capability.', capability: 'manage_roles' },
          notice: 'Changing somebody’s roles needs the “manage roles” permission, which this account does not have.',
        });
      }

      // THE SELF-GUARD, before the rank rule, because an owner outranks an owner.
      if (accountId === actorId && action === 'clear-role') {
        return answerAction(answered, {
          ok: false,
          status: 409,
          payload: { error: 'You cannot take a role from your own account.', code: 'self' },
          notice:
            'You cannot take a role from your own account. An owner who demotes themselves can lock the ' +
            'archive out of its own administration, and this screen will not do it.',
        });
      }

      const verdict =
        action === 'set-role' ? await mayGrantRole(db, actorId, role) : await mayRevokeRole(db, actorId, role);
      if (!verdict.allowed) {
        return answerAction(answered, {
          ok: false,
          status: 403,
          payload: {
            error: verdict.reason,
            code: 'rank',
            actorRank: verdict.actorRank,
            targetRank: verdict.targetRank,
          },
          notice: verdict.reason,
        });
      }

      if (action === 'set-role') {
        /*
         * A grant that was already held is refused rather than written again.
         *
         * `grantRole` uses `on conflict do nothing`, so re-granting is harmless to the table — but it would
         * still write an audit row saying a role was granted when it never changed. That is the failure the
         * comment on `revokeRole` records for a role nobody held: **an audit log that records changes which did
         * not happen is worse than no audit log**, because the reader cannot tell which rows to trust.
         */
        const held = await db.one<{ n: number }>(
          `select count(*)::int as n from ozikoro_member_role where account_id = $1 and role = $2`,
          [accountId, role]
        );
        if (Number(held?.n ?? 0) > 0) {
          return answerAction(answered, {
            ok: false,
            status: 409,
            payload: { error: `That account already holds ${role}.`, code: 'already_held' },
            notice: `${target.displayName} already holds ${role}. Nothing was changed and nothing was recorded.`,
          });
        }

        await grantRole(db, { accountId, role, grantedBy: actorId, note });
        return answerAction(answered, {
          ok: true,
          notice: `Granted ${role} on Ozikoro to ${target.displayName}. It is recorded with you as the grantor.`,
          payload: { ok: true, accountId, role, action: 'grant_role', note },
        });
      }

      await revokeRole(db, { accountId, role, actorId, note });
      return answerAction(answered, {
        ok: true,
        notice: `Removed ${role} from ${target.displayName}. The removal is recorded.`,
        payload: { ok: true, accountId, role, action: 'revoke_role' },
      });
    }

    if (action === 'set-status') {
      const status = (data.status ?? '').trim();
      if (status !== 'active' && status !== 'suspended') {
        return answerAction(answered, {
          ok: false,
          status: 400,
          payload: { error: 'status must be “active” or “suspended”.', actions: ['active', 'suspended'] },
          notice: 'An account can be active or suspended, and nothing else from this screen.',
        });
      }

      /*
       * The self-guard again, and for a harder reason: suspension is enforced at sign-in and at session
       * resolution (`accounts.ts` returns null for any status that is not `active`), so an owner who suspends
       * themselves is signed out on the next request and cannot sign back in to undo it. **The archive would
       * need a database console to recover**, which is the one outcome this whole screen exists to avoid.
       */
      if (accountId === actorId) {
        return answerAction(answered, {
          ok: false,
          status: 409,
          payload: { error: 'You cannot change the status of your own account.', code: 'self' },
          notice:
            'You cannot suspend or reactivate your own account. Suspension is enforced when a session is ' +
            'resolved, so you would be signed out and unable to sign back in to undo it.',
        });
      }

      if (target.status === status) {
        return answerAction(answered, {
          ok: false,
          status: 409,
          payload: { error: `That account is already ${status}.`, code: 'no_change' },
          notice: `That account is already ${status}. Nothing was changed and nothing was recorded.`,
        });
      }

      await db.query(`update account set status = $2, updated_at = now() where id = $1`, [accountId, status]);

      /*
       * A suspension that left the person's live sessions working would not be a suspension: the status is
       * only consulted when a session is resolved, so an existing cookie would keep working. Every session is
       * therefore revoked as part of suspending, and the count is reported because "signed out of 2 sessions"
       * is a different sentence from "suspended" and the truth matters here.
       */
      let revoked = 0;
      if (status === 'suspended') revoked = await revokeAllSessions(db, accountId);

      await recordStatusChange(db, {
        accountId,
        actorId,
        before: target.status,
        after: status,
        note,
        revokedSessions: revoked,
      });

      return answerAction(answered, {
        ok: true,
        notice:
          status === 'suspended'
            ? `${target.displayName} is suspended and signed out of ${revoked} session${revoked === 1 ? '' : 's'}. ` +
              'They cannot sign in again until this is reversed.'
            : `${target.displayName} may sign in again.`,
        payload: { ok: true, accountId, status, action: 'set_account_status', revokedSessions: revoked, note },
      });
    }

    return answerAction(answered, {
      ok: false,
      status: 400,
      payload: {
        error: 'action must be “set-role”, “clear-role” or “set-status”.',
        actions: ['set-role', 'clear-role', 'set-status'],
      },
      notice: 'That action is not one this screen offers.',
    });
  } catch (error) {
    if (error instanceof MemberError) return answerAction(answered, memberErrorOutcome(error));
    console.error('[admin/users]', String(error).slice(0, 300));
    return answerAction(answered, {
      ok: false,
      status: 500,
      payload: { error: 'That could not be saved. Nothing was changed.' },
      notice: 'That could not be saved. Nothing was changed.',
    });
  }
}

/**
 * The audit row for a status change.
 *
 * Written here rather than by calling `setMemberStatus` in `members.ts`, because that function changes the
 * MEMBERSHIP's workflow state and this changes the ACCOUNT's ability to sign in. They are different facts, and
 * writing one while claiming the other would put a false sentence in the audit log — the failure mode the
 * comment on `revokeRole` records for a role that was never granted.
 *
 * The entity type and id are the convention the member functions already use: `ozikoro_member` with the
 * ACCOUNT id. A reader of this table should not have to know which module wrote a row.
 */
async function recordStatusChange(
  db: Db,
  input: { accountId: number; actorId: number; before: string; after: string; note: string | null; revokedSessions: number }
): Promise<void> {
  /*
   * Recording history must never be the reason an action fails. The change has already been made by the time
   * this runs, so a throw here would report a failure that did not happen and invite a second attempt — and an
   * audit log that can veto a suspension would mean a suspended account staying signed in because of a logging
   * fault. So a fault is reported to the console and the action stands.
   */
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_member', $1, 'set_account_status', $2::jsonb, $3::jsonb, $4, $5)`,
      [
        input.accountId,
        JSON.stringify({ status: input.before }),
        JSON.stringify({ status: input.after, revokedSessions: input.revokedSessions }),
        input.actorId,
        input.note,
      ]
    );
  } catch (error) {
    console.error('[admin/users] could not record audit event:', String(error).slice(0, 160));
  }
}
