/**
 * POST /api/admin/site-seo — every site-wide search-engine setting the owner writes, and the permalink write.
 *
 * ── ONE ENDPOINT, AND WHY RATHER THAN SEVEN ──────────────────────────────────────────────────────────
 *
 * The owner's request was for sections, and sections are what the screens are: `/admin/seo/titles/`,
 * `/permalinks/`, `/social/`, `/schema/`, `/tools/`, `/verification/`. **But a section is a layout, and the
 * thing that must not be duplicated is the rule about who may write and what a value may be.** Seven endpoints
 * would be seven places the capability check could be forgotten and seven places a value could reach
 * `site_setting` without passing `cleanSettingValueFor`.
 *
 * So the write path is here, in one file, and it does three things and only three:
 *
 *   action=set             one setting from `keys`, by its key, through `setSiteSeoSetting`
 *   action=clear           remove one setting, so the archive serves its own default again
 *   action=changePermalink move ONE record's address, and store the 301 that keeps the old one resolving
 *   action=addRedirect     add one redirect by hand, to the same table
 *   action=removeRedirect  remove one, so the address stops resolving somewhere else
 *
 * **THE KEY IS CHECKED AGAINST `WRITABLE_KEYS` IN THE PLATFORM, NOT HERE.** This file does not carry a list of
 * acceptable key names, because a list here would be the second copy that goes stale — `setSiteSeoSetting`
 * refuses anything that is not writable by name, and it is the function every caller goes through.
 *
 * ── WHY `manage_design`, AND WHY THERE IS NO `manage_seo` ───────────────────────────────────────────
 *
 * The same capability `/api/admin/seo/` and `/api/admin/seo-records/` already ask for. The full reasoning is in
 * `app/api/admin/seo/route.ts`: it is the capability the owner's other site-wide, reader-visible setting is
 * gated on, migration 0055's rule — *"an editor can do everything except delete trash"* — already decided the
 * site's own face is an editor's to change, and a `manage_seo` would be a name held by exactly the accounts
 * this one admits. **The capability is asked AGAIN in the platform** (`requireCapability` inside
 * `setSiteSeoSetting`, `setRedirect` and `changeRecordPermalink`), so this route is not what protects the
 * table: a script, a job or a route added later is refused by the same rule the screen is.
 *
 * ── NOTHING HERE WRITES A TOKEN ─────────────────────────────────────────────────────────────────────
 *
 * The per-engine verification tokens keep their own endpoint, `/api/admin/seo/`, and are not routed through
 * this file: a token is a credential with its own shape rules, its own paste reader and its own deliberate
 * absence from the audit trail, and folding it in would put four decisions in one function.
 */
import { getDb } from '@ozituma/db/client';
import {
  SiteSeoError,
  changeRecordPermalink,
  removeRedirect,
  setRedirect,
  setSiteSeoSetting,
} from '@ozikoro/platform';
import { sameOrigin } from '@/lib/access';
import { answerAction, guardNarration, readAction } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RETURN = '/admin/seo/';

/** The capability, written as a literal at each guard so `check:capabilities` reads it out of the call site. */
const CAPABILITY = 'manage_design';

/** A refusal or a domain error, as a notice an owner can read, and never a stack trace. */
function refusal(error: unknown, input: Parameters<typeof answerAction>[0]): Response {
  const message =
    error instanceof SiteSeoError || error instanceof Error
      ? error.message
      : 'That could not be saved, and nothing was changed.';
  return answerAction(input, {
    ok: false,
    status: 400,
    payload: { error: 'refused', message },
    notice: message,
  });
}

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

  const guard = await guardNarration(input, CAPABILITY);
  if (!guard.ok) return guard.response;

  const action = (input.data.action ?? '').trim();
  const db = await getDb();

  try {
    if (action === 'set' || action === 'clear') {
      const key = (input.data.key ?? '').trim();
      if (key.length === 0) {
        return answerAction(input, {
          ok: false,
          status: 400,
          payload: { error: 'no_key' },
          notice: 'That form did not name the setting it was changing, so nothing was written.',
        });
      }
      const result = await setSiteSeoSetting(db, {
        key,
        // A clear is a DELETE, and passing null is what says so. A blank field is the same act: it means "use
        // the archive's own value", which is the only honest reading of an empty box.
        value: action === 'clear' ? null : (input.data.value ?? ''),
        actorId: guard.actorId,
        note: (input.data.note ?? '').trim().slice(0, 500) || null,
      });
      return answerAction(input, {
        ok: true,
        payload: { ok: true, key, cleared: result.cleared, stored: result.stored !== null },
        notice: result.cleared
          ? 'Cleared. The archive serves its own value for that again, and the change is in the audit trail.'
          : 'Saved. Every page that reads it has already changed, and the change is in the audit trail.',
      });
    }

    if (action === 'changePermalink') {
      const articleId = Number.parseInt((input.data.articleId ?? '').trim(), 10);
      if (!Number.isInteger(articleId) || articleId <= 0) {
        return answerAction(input, {
          ok: false,
          status: 400,
          payload: { error: 'no_record' },
          notice: 'That form did not name a record, so no address was changed.',
        });
      }
      const result = await changeRecordPermalink(db, {
        articleId,
        slug: (input.data.slug ?? '').trim(),
        actorId: guard.actorId,
        note: (input.data.note ?? '').trim().slice(0, 500) || null,
      });
      return answerAction(input, {
        ok: true,
        payload: {
          ok: true,
          from: result.from,
          to: result.to,
          redirect: result.redirect?.to ?? null,
        },
        /*
         * THE NOTICE NAMES THE OLD ADDRESS, because the whole safety of this act is that the old address still
         * resolves — and a notice that said "saved" would leave the owner to find that out by fetching it.
         */
        notice:
          result.redirect === null
            ? `“${result.title}” is now at ${result.to}. It was never published, so there was no old address to keep resolving and no redirect was stored.`
            : `“${result.title}” is now at ${result.to}. ${result.from} answers 301 to it, so every address ever published for this record still resolves.`,
      });
    }

    if (action === 'addRedirect') {
      const result = await setRedirect(db, {
        from: (input.data.from ?? '').trim(),
        to: (input.data.to ?? '').trim(),
        actorId: guard.actorId,
        kind: 'manual',
        note: (input.data.note ?? '').trim().slice(0, 500) || null,
      });
      return answerAction(input, {
        ok: true,
        payload: { ok: true, from: (input.data.from ?? '').trim(), to: result.redirect.to },
        notice: result.replaced
          ? `Saved. ${(input.data.from ?? '').trim()} now answers 301 to ${result.redirect.to} instead of ${result.replaced.to}.`
          : `Saved. ${(input.data.from ?? '').trim()} now answers 301 to ${result.redirect.to}, and the change is in the audit trail.`,
      });
    }

    if (action === 'removeRedirect') {
      const from = (input.data.from ?? '').trim();
      const result = await removeRedirect(db, {
        from,
        actorId: guard.actorId,
        note: (input.data.note ?? '').trim().slice(0, 500) || null,
      });
      return answerAction(input, {
        ok: true,
        payload: { ok: true, removed: result.removed !== null },
        notice: result.removed
          ? `Removed. ${from} no longer resolves anywhere else — if nothing else serves it, it is a 404 again.`
          : `There was no redirect stored for ${from}, so there was nothing to remove.`,
      });
    }

    return answerAction(input, {
      ok: false,
      status: 400,
      payload: { error: 'unknown_action' },
      notice: `“${action}” is not an action this endpoint has.`,
    });
  } catch (error) {
    if (error instanceof SiteSeoError) return refusal(error, input);
    /*
     * A DATABASE REFUSAL IS REPORTED AS A SENTENCE, NOT AS A 500 WITH AN EMPTY BODY. The commonest one by far
     * is the unique index on `ozikoro_article.slug` — two records cannot share an address — and an owner who
     * typed an address another record holds must be told that rather than shown "that did not work".
     */
    const message = String(error);
    if (/duplicate key|unique constraint/i.test(message)) {
      return answerAction(input, {
        ok: false,
        status: 409,
        payload: { error: 'duplicate' },
        notice:
          'That address is already held by another record in this archive. Two records cannot share one address, so nothing was changed — choose another.',
      });
    }
    console.error('[ozikoro/site-seo] the write failed:', message.slice(0, 300));
    return answerAction(input, {
      ok: false,
      status: 500,
      payload: { error: 'failed' },
      notice: 'That could not be saved, and nothing was changed.',
    });
  }
}

/**
 * GET is not implemented, and the `405` is deliberate — the same decision `/api/admin/seo/` records.
 *
 * A `GET /api/admin/site-seo` has nothing to return that the section screens do not already draw, and an
 * endpoint that answers a read without being asked for one is one more place a stored value reaches a log, a
 * proxy cache or a transcript.
 *
 * ⚠️ AND NOTHING ELSE MAY BE EXPORTED FROM THIS FILE. **A Next.js route module may export only the HTTP verbs
 * and its own route configuration**; a named constant beside them fails the build with
 * `"…" is not a valid Route export field`. The capability is written out as a literal at the guard above and
 * never carried in an exported constant, because `check:capabilities` reads the name out of each call site.
 */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
}
