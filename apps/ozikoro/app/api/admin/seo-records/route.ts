/**
 * POST /api/admin/seo-records — the title and meta description an editor writes for ONE record.
 *
 * ONE ENDPOINT, TWO ACTIONS:
 *
 *   action=save    store the title and description the form submitted (either may be blank)
 *   action=clear   remove the override, so the record's own title and standfirst are served again
 *
 * ── WHY `manage_design`, AND WHY THERE IS NO `manage_seo` ─────────────────────────────────────────
 *
 * The same capability `/api/admin/seo/` already asks for, and its own header gives the reasoning in full:
 * `manage_design` is the capability the owner's other site-wide, reader-visible settings are gated on,
 * migration 0055's rule — *"an editor can do everything except delete trash"* — already decided the site's own
 * face is an editor's to change, and a `manage_seo` would be a name held by exactly the accounts this one
 * admits. Migration 0058 therefore adds no capability, and this route asks for the existing one by name.
 *
 * **The guard here is not the only one.** `saveRecordSeo` and `clearRecordSeo` call `requireCapability`
 * themselves, in `@ozikoro/platform`, so the rule lives in the write path rather than in this file — the
 * archive's own doctrine, and the reason a script or a later route cannot bypass it by not asking. **A test
 * asserts the refusal**, because a guard that is only ever exercised through the happy path is a guard
 * nobody has seen work.
 *
 * ── WHAT A BLANK FIELD MEANS, STATED WHERE THE FORM POSTS ────────────────────────────────────────
 *
 * Blank means "use the record's own words". Both blank removes the override entirely, which is the same
 * state as never having written one — see migration 0058 for why "an override that says nothing" must not be
 * a third state. So there is no way, through this endpoint, to serve an empty `<title>`.
 *
 * ── AND WHY IT ANSWERS BOTH A FORM AND A CALLER ─────────────────────────────────────────────────
 *
 * `readAction`/`answerAction` are the shared shape the narration endpoints use: a browser form gets a 303
 * back to the screen with a notice, and a JSON caller gets a status and a body. Two endpoints per action
 * would be two places for the capability check to be forgotten.
 */
import { getDb } from '@ozituma/db/client';
import {
  MemberError,
  RECORD_SEO_CAPABILITY,
  clearRecordSeo,
  saveRecordSeo,
} from '@ozikoro/platform';
import { sameOrigin } from '@/lib/access';
import { answerAction, guardNarration, memberErrorOutcome, readAction } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RETURN = '/admin/seo-records/';

export async function POST(request: Request): Promise<Response> {
  const input = await readAction(request, DEFAULT_RETURN);

  /*
   * Defence in depth, exactly as `/api/admin/seo/` has it: the session cookie is `SameSite=Lax`, so this is
   * not the only barrier — it is the line that says a cross-site post is refused out loud.
   */
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false,
      status: 403,
      payload: { error: 'cross_origin' },
      notice: 'That request did not come from this site.',
    });
  }

  const guard = await guardNarration(input, RECORD_SEO_CAPABILITY);
  if (!guard.ok) return guard.response;

  const articleId = Number.parseInt(input.data.record ?? input.data.article_id ?? '', 10);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return answerAction(input, {
      ok: false,
      status: 400,
      payload: { error: 'no_record' },
      notice: 'No record was named, so there was nothing to write to.',
    });
  }

  const database = await getDb();

  try {
    if ((input.data.action ?? 'save').trim() === 'clear') {
      const result = await clearRecordSeo(database, {
        articleId,
        actorId: guard.actorId,
        note: input.data.note ?? null,
      });
      return answerAction(input, {
        ok: true,
        payload: { ok: true, cleared: result.cleared },
        notice: result.cleared
          ? 'The override was removed, so this record serves its own title and summary again. The removal is in the audit trail.'
          : 'That record had no override, so there was nothing to remove.',
      });
    }

    const result = await saveRecordSeo(database, {
      articleId,
      actorId: guard.actorId,
      title: input.data.seo_title ?? '',
      description: input.data.seo_description ?? '',
      note: input.data.note ?? null,
    });

    /*
     * THE NOTICE SAYS WHAT WAS ACTUALLY WRITTEN, not what was submitted. A field left blank and a field
     * cleared are the same act, and an editor who is told "saved" without being told that the title is now
     * the record's own would have to reload the page to find out.
     */
    if (result.cleared) {
      return answerAction(input, {
        ok: true,
        payload: { ok: true, cleared: true },
        notice: 'Both fields were blank, so the override was removed and the record serves its own words again.',
      });
    }

    const parts: string[] = [];
    parts.push(result.title ? 'the title' : 'no title (the record’s own is served)');
    parts.push(result.description ? 'the description' : 'no description (the record’s own summary is served)');
    return answerAction(input, {
      ok: true,
      payload: { ok: true, title: result.title, description: result.description },
      notice: `Saved: ${parts.join(', and ')}. The change is in the audit trail and reaches every page that record is served on.`,
    });
  } catch (error) {
    if (error instanceof MemberError) return answerAction(input, memberErrorOutcome(error));
    console.error('[ozikoro/admin/seo-records]', error);
    return answerAction(input, {
      ok: false,
      status: 500,
      payload: { error: 'failed' },
      notice: 'That could not be saved, and nothing was changed.',
    });
  }
}
