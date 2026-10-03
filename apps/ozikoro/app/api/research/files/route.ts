/**
 * POST /api/research/files — the manuscript upload the brief names first.
 *
 * WHY THIS IS ITS OWN ENDPOINT AND NOT AN ACTION ON `/api/research`
 *
 * `/api/research` reads `request.formData()` and acts on text fields. A manuscript is a file, and a
 * route that accepted one alongside its other actions would have to decide, inside the same handler,
 * whether the request was a small form or a 30 MB upload — and the request-size ceiling can only be
 * raised for the route it applies to. So the file has its own door, and the door is the only place
 * the ceiling is lifted.
 *
 * WHAT IS CHECKED, AND IN WHAT ORDER
 *
 *   1. The request came from this site. Same reasoning as every other state-changing endpoint.
 *   2. The account may submit work at all (`submit_work` — students, teachers and researchers hold
 *      it; community knowledge holders do not, and a manuscript is not what they contribute).
 *   3. The account may write to THIS work: it submitted it, or it is one of its authors, or it holds
 *      the editor's capability. **A capability alone is not enough and an owner check alone is not
 *      enough** — the two answer different questions and both are needed.
 *   4. The bytes are what they claim to be, checked in `attachPublicationFile` before anything is
 *      written to storage.
 *
 * Only after all four does a byte reach object storage.
 */
import { getDb } from '@ozituma/db/client';
import {
  MAX_MANUSCRIPT_BYTES,
  MemberError,
  attachPublicationFile,
  isPublicationFileRole,
} from '@ozikoro/platform';
import { redirectTo, requireCapability, sameOrigin, jsonError, formBody } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * THE REQUEST CEILING, RAISED FOR THIS ROUTE ALONE.
 *
 * Next.js caps a request body at 1 MB by default, so without this line every upload over a megabyte
 * fails with a framework error before any of the checks below run — and a limit that arrives as an
 * unexplained 413 is worse than one that is refused in words. The ceiling is the file limit plus room
 * for the multipart envelope and the form's own fields.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  /*
   * THE DECLARED LENGTH IS CHECKED BEFORE THE BODY IS PARSED.
   *
   * `request.formData()` buffers the whole multipart body, so a check on `file.size` afterwards has
   * already paid for the upload it means to refuse — and a 2 GB post would be buffered before the
   * first check ran. `Content-Length` is a claim rather than a fact, which is exactly why it is only
   * a fast refusal: **the real check is on the bytes that actually arrived**, in
   * `verifyFileSignature`, and this line exists to make the cheap case cheap.
   */
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  const envelope = 512 * 1024; // multipart boundaries and the form's own fields
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MANUSCRIPT_BYTES + envelope) {
    const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;
    return redirectTo('/submit/', {
      error: `That upload is ${mb(declaredLength)}. The limit is ${mb(MAX_MANUSCRIPT_BYTES)}.`,
    });
  }

  /*
   * THE GUARD RUNS BEFORE THE BODY IS READ. See the note in `/api/admin/entities`: an unread body is
   * what lets an anonymous request be answered with a redirect to sign in rather than a 500 from
   * `request.formData()` throwing on a request that carried no form — and here it also means an
   * unauthenticated upload is refused before a single byte is buffered.
   */
  const guard = await requireCapability('submit_work', { returnTo: '/submit/' });
  if (!guard.ok) return guard.response;
  const accountId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That upload did not arrive as a form.');

  const publicationId = Number(form.get('publicationId'));
  const returnTo = String(form.get('returnTo') ?? '').trim() || '/submit/';
  const backTo = `/submit/?work=${Number.isFinite(publicationId) ? publicationId : ''}`;

  const db = await getDb();

  try {
    if (!Number.isInteger(publicationId) || publicationId <= 0) {
      return redirectTo(returnTo, { error: 'Choose which work the file belongs to. A manuscript is attached to a work, never loose.' });
    }

    const work = await db.one<{ submitted_by: string | null; is_author: boolean; title: string }>(
      `select p.submitted_by, p.title,
              exists (select 1 from ozikoro_publication_author a
                       where a.publication_id = p.id and a.account_id = $2) as is_author
         from ozikoro_publication p where p.id = $1`,
      [publicationId, accountId]
    );
    if (!work) {
      return redirectTo(returnTo, { error: 'That work does not exist.' });
    }

    const owns = Number(work.submitted_by ?? 0) === accountId || Boolean(work.is_author);
    if (!owns && !guard.capabilities.has('review_queue')) {
      /*
       * NOT "forbidden", and not a redirect to the work either: an account that does not own a draft
       * should not be able to learn that it exists by the answer it gets. The refusal names the
       * permission it would have needed without confirming anything.
       */
      return redirectTo(returnTo, {
        error: 'You can only attach a file to your own work. An editor can attach one to any work.',
      });
    }

    const file = form.get('manuscript');
    if (!(file instanceof File) || file.size === 0) {
      return redirectTo(backTo, { error: 'Choose a file. Nothing was uploaded.' });
    }
    if (file.size > MAX_MANUSCRIPT_BYTES) {
      const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;
      return redirectTo(backTo, { error: `That file is ${mb(file.size)}. The limit is ${mb(MAX_MANUSCRIPT_BYTES)}.` });
    }

    const roleValue = String(form.get('role') ?? 'manuscript').trim();
    const role = isPublicationFileRole(roleValue) ? roleValue : 'manuscript';

    const buffer = Buffer.from(await file.arrayBuffer());
    const { file: attached, checksum } = await attachPublicationFile(db, {
      publicationId,
      filename: file.name,
      declaredType: file.type,
      body: buffer,
      role,
      actorId: accountId,
    });

    return redirectTo(backTo, {
      saved:
        `“${attached.filename}” attached to “${work.title}” as ${attached.typeLabel.toLowerCase()} ` +
        `(${Math.round(attached.sizeBytes / 1024)} kB). SHA-256 ${checksum.slice(0, 16)}… — ` +
        'the archive can prove later that it is serving the file it received.',
    });
  } catch (error) {
    /*
     * A `MemberError` is a refusal the uploader caused and can act on — a type that is not accepted,
     * bytes that are not what they claim to be, an archived work — so its message is shown. Anything
     * else is a fault and is reported as one rather than as an internal message.
     */
    if (error instanceof MemberError) return redirectTo(returnTo, { error: error.message });
    console.error('[research/files]', String(error).slice(0, 300));
    return redirectTo(returnTo, { error: 'That file could not be stored. Nothing was saved.' });
  }
}
