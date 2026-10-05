/**
 * POST /api/admin/access — making an agreement, withdrawing one, and placing a record in a tier.
 *
 * ── THE GUARD, AND WHY IT IS ASKED BY NAME ────────────────────────────────────────────────────────
 *
 * Every action here needs `grant_institutional_access`, which the `owner` role holds and no other role does.
 * **The route asks for the capability rather than testing for a role or an address**, which is the rule
 * `lib/access.ts` states: a forgotten capability test fails CLOSED, and a test written as "is this an
 * administrator?" fails OPEN the day the roles change. The write path asks again — `grantInstitutionalAccess`,
 * `revokeInstitutionalAccess` and `setArticleAccessTier` each call `ozikoro_has_capability` — so a script or a
 * future endpoint cannot reach the table by not being this route.
 *
 * ── WHY THE ERRORS ARE MESSAGES AND NOT STATUS CODES ──────────────────────────────────────────────
 *
 * Every one of these refusals is something a person can act on: an address that is not an account, terms that
 * were not recorded, a second agreement while one is in force, a withdrawal with no reason. So they redirect
 * back to the screen with the sentence the write path produced, which is the shape `/api/admin/rights` uses
 * for the same reason.
 */
import { getDb } from '@ozituma/db/client';
import {
  ACCESS_TIERS,
  MemberError,
  grantInstitutionalAccess,
  revokeInstitutionalAccess,
  setArticleAccessTier,
  type AccessTier,
} from '@ozikoro/platform';
import { formBody, jsonError, redirectTo, requireCapability, sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACK_TO = '/admin/access/';

/**
 * The record an operator named, as a row.
 *
 * THREE WAYS TO NAME IT, AND THE REFERENCE IS FIRST. `OZ-H-0000` is the string the archive prints beside a
 * record and the one a person has in front of them; the address is what a reader holds; the id is what the
 * screen itself links with. **All three are matched against the row rather than parsed into one**, because a
 * slug may contain digits and a reference may not.
 */
async function findRecord(
  db: Awaited<ReturnType<typeof getDb>>,
  input: string
): Promise<{ id: number; reference: string; slug: string } | null> {
  const raw = input.trim().replace(/^\/+|\/+$/g, '');
  if (raw === '') return null;

  const reference = /^OZ-H-(\d+)$/i.exec(raw);
  if (reference) {
    const row = await db.one<{ id: number; slug: string }>(
      `select id, slug from ozikoro_article where id = $1`,
      [Number(reference[1])]
    );
    return row ? { id: Number(row.id), reference: `OZ-H-${String(row.id).padStart(4, '0')}`, slug: row.slug } : null;
  }

  const asId = /^\d+$/.test(raw) ? Number(raw) : null;
  const row = await db.one<{ id: number; slug: string }>(
    `select id, slug from ozikoro_article where slug = $1 or ($2::bigint is not null and id = $2::bigint) limit 1`,
    [raw, asId]
  );
  return row ? { id: Number(row.id), reference: `OZ-H-${String(row.id).padStart(4, '0')}`, slug: row.slug } : null;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const form = await formBody(request);
  if (!form) {
    return redirectTo(BACK_TO, {
      error: 'That request did not carry a form, so nothing was changed. Reload the screen and try again.',
    });
  }

  const guard = await requireCapability('grant_institutional_access', { returnTo: BACK_TO });
  if (!guard.ok) return guard.response;

  const actorId = guard.account.account.id;
  const db = await getDb();
  const text = (name: string, max = 2000) => String(form.get(name) ?? '').trim().slice(0, max);

  try {
    const action = text('action', 20);

    if (action === 'grant') {
      const grant = await grantInstitutionalAccess(db, {
        email: text('email', 320),
        holder: text('holder', 200),
        instrument: text('instrument', 300) || null,
        terms: text('terms', 2000),
        actorId,
      });
      return redirectTo(BACK_TO, {
        saved:
          `An agreement with ${grant.holder} is recorded for ${grant.email}. That account can now read ` +
          `records held by agreement, and the grant is in the audit trail.`,
      });
    }

    if (action === 'revoke') {
      const id = Number(text('id', 20));
      const revoked = await revokeInstitutionalAccess(db, { id, reason: text('reason', 500), actorId });
      return redirectTo(BACK_TO, {
        saved:
          `Access for ${revoked.email} is withdrawn, and the agreement is kept rather than erased. ` +
          `They will be told the agreement was withdrawn, with the reason you recorded.`,
      });
    }

    if (action === 'mark') {
      const named = text('record', 300);
      const tier = text('tier', 20) as AccessTier;
      if (!ACCESS_TIERS.includes(tier)) {
        return redirectTo(BACK_TO, { error: `“${tier}” is not one of the two tiers of reading.` });
      }
      const record = await findRecord(db, named);
      if (!record) {
        return redirectTo(BACK_TO, {
          error: `No record answers to “${named}”. Name it by its reference (OZ-H-0000), its address, or its id.`,
        });
      }
      await setArticleAccessTier(db, { articleId: record.id, tier, reason: text('reason', 500), actorId });
      return redirectTo(BACK_TO, {
        saved:
          tier === 'by_agreement'
            ? `${record.reference} is now held by agreement. Its address serves the refusal screen to anyone ` +
              `without an agreement, with a 403 rather than a 404.`
            : `${record.reference} is open to read again. The decision is in the audit trail.`,
      });
    }

    return redirectTo(BACK_TO, { error: 'That action is not one this screen offers.' });
  } catch (error) {
    if (error instanceof MemberError) return redirectTo(BACK_TO, { error: error.message });
    console.error('[admin/access]', String(error).slice(0, 300));
    return redirectTo(BACK_TO, { error: 'That could not be recorded. Nothing was changed.' });
  }
}
