/**
 * POST /api/admin/pronunciation — recording a word, approving it, rejecting it, and the digest.
 *
 *   action=record   with an audio file and/or a respelling      the editor's "upload or record"
 *   action=approve  id=12                                        the gate that releases a narration
 *   action=reject   id=12                                        "that is not an Igbo word"
 *   action=waive    slug=an-article                              narrate anyway, recorded on the episode
 *   action=digest   dryRun=1                                     or send it to admins and editors
 *
 * WHY ONE ENDPOINT AND NOT FIVE
 *
 * The same reason `/api/admin/users` is one: each of these is "a person filled in a form and pressed a
 * button", and five files would be five places for the capability check to be forgotten. **The checks are the
 * first thing that happens and nothing below them runs** — the plan's rule is that permissions are enforced
 * on the server and a hidden button is not authorisation.
 *
 * TWO CAPABILITIES, BECAUSE TWO DIFFERENT THINGS ARE BEING DECIDED
 *
 *   `review_audio`      recording, approving and rejecting a word. This is the editor's work, and it is the
 *                       capability migration 0046 added for it.
 *   `manage_ai_corpus`  waiving the gaps. Approving narration for a record whose words the archive cannot say
 *                       releases a charge, so it is gated on the capability that already gates the AI spend.
 *
 * THE BODY IS READ ONCE, AND THAT IS THE POINT OF `readAdminRequest`
 *
 * The first version of this route called the shared `readAction` — which consumes a multipart body to get the
 * text fields — and then called `request.formData()` again for the file. **A `Request` body is a stream and
 * can be read exactly once**, so the second read would have thrown and every upload would have failed with a
 * 500 that named nothing. The shape is the one the archive's own `/api/audio` route uses: take the form data
 * ONCE, and pull both the fields and the file out of that one read.
 */
import { getDb } from '@ozituma/db/client';
import {
  MAX_AUDIO_BYTES,
  StorageError,
  extensionFor,
  getStorage,
  normaliseAudioType,
  verifyAudioSignature,
} from '@ozituma/db/storage';
import {
  MemberError,
  approvePronunciation,
  recordPronunciation,
  rejectPronunciation,
  sendDigest,
  waivePronunciationGaps,
} from '@ozikoro/platform';
import { answerAction, guardNarration, memberErrorOutcome, type ActionInput } from '@/lib/narration-http';
import { sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RETURN = '/admin/pronunciation/';

/**
 * The request, read once.
 *
 * Returns the flat string fields the shared helpers expect, the uploaded file when there is one, and whether
 * the caller was a browser form — because a form needs a 303 with a notice and a program needs a status.
 */
async function readAdminRequest(
  request: Request
): Promise<{ input: ActionInput; file: { body: Buffer; type: string } | null }> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === undefined) continue;
      data[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return { input: { data, isForm: false, returnTo: data.returnTo ?? DEFAULT_RETURN }, file: null };
  }

  // ONE read of the body, for the fields AND the file. See the header.
  const form = await request.formData();
  const data: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') data[key] = value;

  let file: { body: Buffer; type: string } | null = null;
  const uploaded = form.get('audio');
  if (uploaded instanceof File && uploaded.size > 0) {
    if (uploaded.size > MAX_AUDIO_BYTES) {
      throw new StorageError(
        'file_too_large',
        `That recording is ${(uploaded.size / 1024 / 1024).toFixed(1)} MB. The limit is ` +
          `${MAX_AUDIO_BYTES / 1024 / 1024} MB.`
      );
    }
    file = {
      body: Buffer.from(await uploaded.arrayBuffer()),
      // A browser that sends no type gets the one the API returns, and `normaliseAudioType` decides whether
      // it is acceptable — the declared type is never trusted on its own.
      type: uploaded.type || 'audio/mpeg',
    };
  }

  return { input: { data, isForm: true, returnTo: data.returnTo ?? DEFAULT_RETURN }, file };
}

export async function POST(request: Request): Promise<Response> {
  let parsed: Awaited<ReturnType<typeof readAdminRequest>>;
  try {
    parsed = await readAdminRequest(request);
  } catch (error) {
    if (error instanceof StorageError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: 400, headers: { 'cache-control': 'no-store' } }
      );
    }
    throw error;
  }

  const { input, file } = parsed;

  // Cross-site form posts are refused. The cookie is already `SameSite=Lax`, so this is defence in depth —
  // the same line `/api/admin/users` and the Spotify endpoints carry, for the same reason.
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false,
      status: 403,
      payload: { error: 'cross_origin' },
      notice: 'That request did not come from this site.',
    });
  }

  const action = (input.data.action ?? '').trim();
  const note = (input.data.note ?? '').trim().slice(0, 500) || null;
  const id = Number.parseInt(input.data.id ?? '', 10);
  const rowId = Number.isInteger(id) && id > 0 ? id : undefined;
  const db = await getDb();

  try {
    if (action === 'waive') {
      // THE SPEND-ADJACENT DECISION, on its own capability.
      const guard = await guardNarration(input, 'manage_ai_corpus');
      if (!guard.ok) return guard.response;

      const slug = (input.data.slug ?? '').trim();
      if (!slug) {
        return answerAction(input, {
          ok: false,
          status: 400,
          payload: { error: 'A slug is required.' },
          notice: 'Name the record whose narration you are approving.',
        });
      }
      const waived = await waivePronunciationGaps(db, { slug, actorId: guard.actorId, note });
      return answerAction(input, {
        ok: true,
        notice:
          `Recorded: narration of “${slug}” is approved despite ${waived.waived} word` +
          `${waived.waived === 1 ? '' : 's'} the archive cannot pronounce. It is on the episode, with your name.`,
        payload: { ok: true, action: 'waive', slug, waived: waived.waived },
      });
    }

    const guard = await guardNarration(input, 'review_audio');
    if (!guard.ok) return guard.response;

    if (action === 'record') {
      let storageKey: string | null = null;
      let mimeType: string | null = null;
      let byteSize: number | null = null;

      if (file) {
        mimeType = normaliseAudioType(file.type);
        /*
         * THE BYTES ARE CHECKED AGAINST THEIR OWN SIGNATURE, not against the browser's label.
         *
         * A file that claims `audio/mpeg` and begins with `<svg` would otherwise be stored under an audio
         * content type and served from our origin. `/api/audio` in the dictionary makes this same check and
         * the helper is reused rather than reimplemented.
         *
         * **The object is written BEFORE the row references it**, because a row pointing at a key nobody wrote
         * is a player that answers 404 — the fault round 280 records — and the key carries the row id so two
         * spellings of one word cannot produce two objects for one entry.
         */
        verifyAudioSignature(file.body, mimeType);
        storageKey = `ozikoro/pronunciation/${rowId ?? 'word'}.${extensionFor(mimeType)}`;
        await getStorage().put(storageKey, file.body, mimeType);
        byteSize = file.body.byteLength;
      }

      const saved = await recordPronunciation(db, {
        id: rowId,
        word: rowId ? undefined : (input.data.word ?? '').trim(),
        actorId: guard.actorId,
        storageKey,
        mimeType,
        byteSize,
        respelling: input.data.respelling ?? null,
        speakerName: input.data.speakerName ?? null,
        sourceNote: input.data.sourceNote ?? null,
        note,
      });

      return answerAction(input, {
        ok: true,
        notice:
          `Saved “${saved.word}”. It is recorded and NOT yet used — approve it once you have checked it, ` +
          'because nothing is narrated with it until you do.',
        payload: {
          ok: true, action: 'record', id: saved.id, word: saved.word, status: saved.status,
          stored: Boolean(storageKey),
        },
      });
    }

    if (action === 'approve') {
      const approved = await approvePronunciation(db, { id: rowId, actorId: guard.actorId, note });
      return answerAction(input, {
        ok: true,
        notice:
          `Approved “${approved.word}”. Narration may now use it` +
          (approved.ownRecording ? ', and the record says you approved a recording you made yourself.' : '.'),
        payload: { ok: true, action: 'approve', id: approved.id, word: approved.word, ownRecording: approved.ownRecording },
      });
    }

    if (action === 'reject') {
      const rejected = await rejectPronunciation(db, { id: rowId, actorId: guard.actorId, note });
      return answerAction(input, {
        ok: true,
        notice:
          `Recorded that “${rejected.word}” is not an Igbo word. It leaves the queue and stops blocking any ` +
          'narration.',
        payload: { ok: true, action: 'reject', id: rejected.id, word: rejected.word },
      });
    }

    if (action === 'digest') {
      const dryRun = (input.data.dryRun ?? '') === '1' || (input.data.dryRun ?? '').toLowerCase() === 'true';
      const result = await sendDigest(db, { limit: 12, dryRun });
      const to = result.recipients.length > 0 ? result.recipients.join(', ') : 'nobody';
      return answerAction(input, {
        ok: true,
        notice: dryRun
          ? `Nothing was sent. The digest would go to ${to}. — ${result.digest.subject}`
          : result.sent?.delivered
            ? `Sent to ${to}. — ${result.digest.subject}`
            : `Not sent: ${result.sent?.error ?? result.reason ?? 'the mail transport refused it'}. ` +
              'The queue is unchanged and still holds every word.',
        payload: {
          ok: true, action: 'digest', dryRun, to: result.recipients,
          subject: result.digest.subject, delivered: result.sent?.delivered ?? false,
          transport: result.sent?.transport ?? null, id: result.sent?.id ?? null,
        },
      });
    }

    return answerAction(input, {
      ok: false,
      status: 400,
      payload: {
        error: 'action must be “record”, “approve”, “reject”, “waive” or “digest”.',
        actions: ['record', 'approve', 'reject', 'waive', 'digest'],
      },
      notice: 'That action is not one this screen offers.',
    });
  } catch (error) {
    if (error instanceof StorageError) {
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: error.message, code: error.code },
        notice: error.message,
      });
    }
    if (error instanceof MemberError) return answerAction(input, memberErrorOutcome(error));
    console.error('[admin/pronunciation]', String(error).slice(0, 300));
    return answerAction(input, {
      ok: false,
      status: 500,
      payload: { error: 'That could not be saved. Nothing was changed.' },
      notice: 'That could not be saved. Nothing was changed.',
    });
  }
}
