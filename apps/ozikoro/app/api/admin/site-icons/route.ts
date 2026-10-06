/**
 * POST /api/admin/site-icons — the site's own icon, stored beside the site rather than in a file.
 *
 * ── WHY THIS IS NOT `/api/admin/design` ──────────────────────────────────────────────────────────────
 *
 * That endpoint speaks the design-override model: a `(screen, kind, key)` row applied to a page's markup. A
 * favicon is not an edit to a page — it is a fact about the whole site, like the verification tokens
 * `/api/admin/seo` stores, and it is read by an EMPTY-HEAD browser request rather than by the override pass.
 * Filing it under a screen and a selector would be a lie about what it is, and the first `reset-screen` would
 * delete it.
 *
 * ── TWO ACTIONS, AND THE SHAPE OF THE BODY IS PART OF THEM ────────────────────────────────────────────
 *
 *   action=set     a FILE, multipart. An icon is a picture; asking the owner to base64 it by hand would be
 *                  asking him to use a tool this screen exists to spare him.
 *   action=clear   a form field. Removes the row, so the archive serves the mark it shipped with.
 *
 * `readAction` is deliberately NOT used for the set path: it flattens a request body to
 * `Record<string, string>`, which would turn the uploaded `File` into the string `"[object File]"`. So this
 * route reads the multipart body itself and hands the guard the same `ActionInput` shape everything else
 * uses, which is what keeps the capability check, the cross-origin check and the answer one implementation.
 *
 * ── THE CAPABILITY AND THE AUDIT ARE THE EXISTING ONES, UNCHANGED ────────────────────────────────────
 *
 * `manage_design` — the same capability `/admin/design/`, `/design-theme.css`, `/admin/seo/` and
 * `/admin/seo-records/` all ask for, and the reasoning is written out in `app/api/admin/seo/route.ts`: it is
 * the capability the owner's other site-wide, reader-visible settings are gated on. **No new capability is
 * invented**, and every change writes an `ozikoro_audit` row under `site_icon` through `setSiteFavicon`.
 */
import { getDb } from '@ozituma/db/client';
import { SiteIconError, faviconFromUpload, setSiteFavicon } from '@ozikoro/platform';
import { sameOrigin } from '@/lib/access';
import { answerAction, guardNarration, type ActionInput } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RETURN = '/admin/design/?section=icons';
/** The largest upload this route will read into memory, before its own size check is reached. */
const MAX_UPLOAD_BYTES = 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  const data: Record<string, string> = {};
  let upload: { type: string; bytes: Buffer } | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') {
        data[name] = value;
        continue;
      }
      if (name === 'icon') {
        const bytes = Buffer.from(await value.arrayBuffer());
        upload = { type: value.type, bytes };
      }
    }
  } else if (contentType.includes('application/json')) {
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [name, value] of Object.entries(raw)) {
      if (value === null || value === undefined) continue;
      data[name] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  } else {
    const form = await request.formData();
    for (const [name, value] of form.entries()) if (typeof value === 'string') data[name] = value;
  }

  const input: ActionInput = {
    data,
    isForm: !contentType.includes('application/json'),
    returnTo: data.returnTo && data.returnTo.startsWith('/') ? data.returnTo : DEFAULT_RETURN,
  };

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

  const action = (data.action ?? 'set').trim();
  const db = await getDb();
  const note = (data.note ?? '').trim().slice(0, 500) || null;

  try {
    if (action === 'clear') {
      const result = await setSiteFavicon(db, { dataUrl: null, actorId: guard.actorId, note });
      return answerAction(input, {
        ok: true,
        payload: { ok: true, cleared: result.cleared },
        notice: result.cleared
          ? 'Cleared. Every page now carries the archive’s own mark again, and the change is in the audit trail.'
          : 'No icon was stored, so there was nothing to clear — the archive was already serving its own mark.',
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

    if (!upload) {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'missing_icon' },
        notice: 'No image arrived with that form. Choose a file and try again — the icon is the file, so nothing can be saved without one.',
      });
    }
    if (upload.bytes.byteLength > MAX_UPLOAD_BYTES) {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'too_large', bytes: upload.bytes.byteLength },
        notice: `That file is ${Math.round(upload.bytes.byteLength / 1024)} KB, which is larger than this form will read. A site icon is a few hundred pixels square.`,
      });
    }

    const read = faviconFromUpload(upload);
    if ('problem' in read) {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'refused', message: read.problem },
        notice: read.problem,
      });
    }

    const result = await setSiteFavicon(db, { dataUrl: read.dataUrl, actorId: guard.actorId, note });
    const stored = result.stored;
    return answerAction(input, {
      ok: true,
      payload: {
        ok: true,
        mediaType: stored?.mediaType ?? null,
        bytes: stored?.bytes ?? null,
        href: '/favicon.ico',
      },
      notice:
        `Saved: ${stored ? `${Math.round(stored.bytes / 1024 * 10) / 10} KB of ${stored.mediaType}` : 'the icon'} is now served at /favicon.ico. ` +
        'That is the address every page already asks for, so the design screens and the article pages carry it too — ' +
        'and the audit trail records the change.',
    });
  } catch (error) {
    if (error instanceof SiteIconError) {
      return answerAction(input, { ok: false, status: 400, payload: { error: 'refused', message: error.message }, notice: error.message });
    }
    console.error('[ozikoro/site-icon] the site icon failed to save:', String(error).slice(0, 300));
    return answerAction(input, {
      ok: false,
      status: 500,
      payload: { error: 'failed' },
      notice: 'That icon could not be saved, and nothing was changed.',
    });
  }
}

/**
 * GET is not implemented, and the `405` is deliberate — the same answer `/api/admin/seo` gives.
 *
 * The icon is served from `/favicon.ico`, which every reader already asks for; a second read endpoint would
 * be one more place a stored value is returned without anybody asking for it. The screen reads through the
 * capability-gated page.
 */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
}
