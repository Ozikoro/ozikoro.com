/**
 * POST /api/admin/seo — the owner's site-verification tokens, saved beside the site rather than in a file.
 *
 * ONE ENDPOINT, TWO ACTIONS:
 *
 *   action=set     store (or replace) one engine's token
 *   action=remove  clear one engine, so no tag is emitted for it
 *
 * ── WHY THERE IS NO MIGRATION BEHIND THIS ────────────────────────────────────────────────────────────
 *
 * The tokens are rows in `site_setting`, the key/value table migration 0031 created for "the things an
 * administrator changes without a deploy", under the keys `seo.verify.<engine>`. **Nothing in this repository
 * wrote to that table before this round and it is empty in this database** — checked, not assumed — and a
 * key/value table takes a new key by receiving a row. So this feature adds no numbered migration. `0031` is
 * an applied migration in the middle of the chain and must not be edited; the reason no later one is needed
 * is written down here so the next agent does not go looking for the missing file.
 *
 * The other candidate, `ozikoro_design_override`, is the wrong table and the reason is in
 * `seo-verification.ts`: it is keyed on a design SCREEN, it is read by `applyDesignOverrides` as an edit to
 * markup, and a verification token is a fact about the site's identity rather than an edit to one of its
 * pages.
 *
 * ── WHAT IT ACCEPTS, AND WHY IT ACCEPTS MORE THAN IT STORES ───────────────────────────────────────────
 *
 * Search Console shows the owner a whole `<meta name="google-site-verification" content="…">` and calls it
 * "the HTML tag". Bing's screen does the same. So the field accepts EITHER that tag or the bare token, reads
 * the token out of the tag when there is one, and **says so in the notice** — an owner who pasted a Bing tag
 * into the Yandex row must be told that is what happened, not silently verified against the wrong engine.
 *
 * Only the token is stored: see `readPastedToken` and `tokenProblem`. A value that is not a token is refused
 * with a sentence rather than written down, so `"><script>` cannot reach a served page — and even if it did,
 * `verificationTags` escapes every attribute it writes. Both halves are tested.
 *
 * ── THE CAPABILITY, AND WHY IT IS `manage_design` ────────────────────────────────────────────────────
 *
 * Gated on `manage_design`, decided here and stated in the screen. The reasoning:
 *
 *   * **It is the closest existing capability and the honest one.** The alternatives are `edit_entity` (the
 *     archive's own records — tokens verify the SITE, not a record), `manage_users` and `manage_roles` (about
 *     people), and `view_audit` (reading). `manage_design` is the capability the owner's other site-wide,
 *     reader-visible setting is already gated on: `/admin/design/` and `/design-theme.css` both ask for it,
 *     and the owner's rule — "an editor can do everything except delete trash" (migration 0055) — already
 *     decided that the site's own face is an editor's to change. A verification token is the same kind of
 *     thing: it changes what a machine learns about the whole site, not what any record says.
 *   * **A new `manage_seo` would be a name with no rule behind it.** It would need its own migration to grant
 *     it, it would be held by exactly the accounts `manage_design` already admits, and it would make the
 *     refusal message say "seo" to somebody who reached the screen from the Appearance editor's own nav.
 *     It is worth adding the day a role must hold one and not the other, and not before.
 *   * **The owner is the only `owner` account** (`idenzeme@gmail.com`, `account.id = 199`), and holding
 *     `owner` resolves the admin and owner capability rows, so `manage_design` is his — measured through
 *     `ozikoro_capabilities(199)`, not assumed. A plain `reader` holds `read`, `bookmark` and `collection`
 *     and is refused here.
 *
 * The guard asks for the capability and never for a role, so a later change to `ozikoro_role_capability` is
 * the only place the rule has to change.
 */
import { getDb } from '@ozituma/db/client';
import {
  OTHER_ENGINE_ID,
  SeoVerificationError,
  engineById,
  readPastedToken,
  resolveMetaName,
  setSeoVerification,
  verifyKey,
} from '@ozikoro/platform';
import { sameOrigin } from '@/lib/access';
import { answerAction, guardNarration, readAction } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RETURN = '/admin/seo/';

export async function POST(request: Request): Promise<Response> {
  const input = await readAction(request, DEFAULT_RETURN);

  // The same defence-in-depth line every other admin endpoint carries. The cookie is `SameSite=Lax`, so this
  // is not the only barrier; it is the one that says out loud that a cross-site post is refused.
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false,
      status: 403,
      payload: { error: 'cross_origin' },
      notice: 'That request did not come from this site.',
    });
  }

  const guard = await guardNarration(input, 'manage_design');
  if (!guard.ok) return guard.response;

  const action = (input.data.action ?? 'set').trim();
  const engineId = (input.data.engine ?? '').trim();
  const db = await getDb();

  try {
    if (action === 'remove') {
      const engine = engineById(engineId);
      if (!engine) {
        return answerAction(input, {
          ok: false,
          status: 400,
          payload: { error: 'unknown_engine' },
          notice: 'That is not an engine this screen lists, so there was nothing to clear.',
        });
      }
      const result = await setSeoVerification(db, {
        engineId,
        metaName: engine.metaName || 'unused',
        token: null,
        actorId: guard.actorId,
      });
      return answerAction(input, {
        ok: true,
        payload: { ok: true, cleared: result.cleared },
        notice: result.cleared
          ? `Cleared. No verification tag is emitted for ${engine.label} any more, and the change is in the audit trail.`
          : `Nothing was stored for ${engine.label}, so there was nothing to clear.`,
      });
    }

    if (action !== 'set') {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'unknown_action' },
        notice: `“${action}” is not an action this endpoint has.`,
      });
    }

    if (!engineById(engineId)) {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'unknown_engine' },
        notice: 'That is not an engine this screen lists. Reload the page and choose one of the engines it draws.',
      });
    }

    /*
     * WHAT THE OWNER PASTED, AND WHAT IS KEPT FROM IT. Both shapes arrive in the same field because both are
     * what an engine's own screen puts on the clipboard, and the difference between them is not something to
     * make him decide.
     */
    const pasted = input.data.token ?? '';
    const read = readPastedToken(pasted);
    if (read.problem || read.token.length === 0) {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'refused', message: read.problem },
        notice: read.problem ?? 'Nothing usable was pasted, so nothing was stored.',
      });
    }

    /*
     * THE ENGINE IS RE-READ FROM THE FORM, AND A PASTED TAG IS ALLOWED TO CORRECT IT.
     *
     * If the owner has chosen "Google" and pasted a tag whose `name` is `msvalidate.01`, the paste is the
     * better evidence — it came from an engine — so the token is stored against BING, and the notice says so.
     * If the tag names nothing the archive recognises, the chosen engine stands and the tag's own name is
     * used for the emitted attribute (which is what makes the "another engine" row work at all).
     */
    const chosen = engineById(engineId)!;
    const target = read.detected ?? chosen;
    const metaName = resolveMetaName({
      engineId: target.id,
      detected: read.detected,
      pastedMetaName: read.metaName,
      customName: input.data.metaName,
    });
    if (metaName.problem || !metaName.metaName) {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'refused', message: metaName.problem },
        notice: metaName.problem ?? 'That tag has no name to emit.',
      });
    }

    const label = target.id === OTHER_ENGINE_ID
      ? (input.data.label ?? '').trim().slice(0, 80) || metaName.metaName
      : null;

    const result = await setSeoVerification(db, {
      engineId: target.id,
      metaName: metaName.metaName,
      token: read.token,
      label,
      actorId: guard.actorId,
      note: (input.data.note ?? '').trim().slice(0, 500) || null,
    });

    const emitted = `<meta name="${metaName.metaName}" content="…">`;
    const where = target.id === OTHER_ENGINE_ID ? label ?? metaName.metaName : target.label;
    const corrections: string[] = [];
    if (read.detected && read.detected.id !== chosen.id) {
      corrections.push(
        `The tag you pasted is ${read.detected.label}'s, not ${chosen.label}'s, so it was stored against ${read.detected.label}.`
      );
    }
    if (read.fromTag) {
      corrections.push(
        `A whole <meta> tag was pasted, so only its content value was kept — ${read.token.length} characters — and the archive writes the tag itself, escaped. Nothing of your paste is stored as markup.`
      );
    }
    corrections.push(`Every page now carries ${emitted}, and nothing is stored for an engine you leave empty.`);

    return answerAction(input, {
      ok: true,
      payload: {
        ok: true,
        engine: target.id,
        metaName: metaName.metaName,
        fromTag: read.fromTag,
        tokenLength: read.token.length,
        stored: result.stored !== null,
      },
      notice: `Saved for ${where}. ${corrections.join(' ')}`,
    });
  } catch (error) {
    if (error instanceof SeoVerificationError) {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'refused', message: error.message },
        notice: error.message,
      });
    }
    console.error('[ozikoro/seo] the verification token failed to save:', String(error).slice(0, 300));
    return answerAction(input, {
      ok: false,
      status: 500,
      payload: { error: 'failed' },
      notice: 'That token could not be saved, and nothing was changed.',
    });
  }
}

/**
 * GET is not implemented, and the `405` is deliberate.
 *
 * A `GET /api/admin/seo` has nothing to return that `/admin/seo/` does not already draw, and an endpoint that
 * answers a read without being asked for one is one more place a token could be printed into a log, a proxy
 * cache or a transcript. The screen reads through the capability-gated page.
 *
 * ⚠️ AND NOTHING ELSE MAY BE EXPORTED FROM THIS FILE. **A Next.js route module may export only the HTTP verbs
 * and its own route configuration**, and a named constant beside them fails the build with
 * `"…" is not a valid Route export field` — which is exactly how the first build of this screen failed while
 * the running site kept serving the previous build. **The capability is written out as a string literal at
 * the guard below, not carried in a constant**, because `npm -w @ozikoro/platform run check:capabilities`
 * reads the capability out of each call site and proves some role holds it; a constant would hide the name
 * from that check. The page writes the same literal for the same reason.
 */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
}
