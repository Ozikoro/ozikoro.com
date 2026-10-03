/**
 * GET /publication-file/<id> — a manuscript, served under the rules that govern the work it belongs to.
 *
 * WHY THIS IS NOT `/media/<key>`
 *
 * The media route serves the archive's own migrated files, and its key pattern is deliberately narrow:
 * one prefix, no slash, a traversal guard that is the reason it exists. A manuscript's key is
 * `publications/<id>/<uuid>.<ext>` — a second shape — and widening that pattern would have weakened
 * the guard for all 3,750 archived images to serve a handful of papers. **A second door is cut that
 * opens onto one room.**
 *
 * WHY ACCESS IS DECIDED HERE AND NOT BY THE STORAGE KEY
 *
 * A key is an address, and an address that can be guessed is not access control. The rule is asked of
 * the database — the work's state, its authors, and the reader's capabilities — so a private draft's
 * manuscript is not readable by somebody who obtained its URL. **A request that may not read a file
 * is answered 404 and not 403**, because a 403 confirms the file exists, and "there is a draft here"
 * is itself information about an unpublished work.
 *
 * WHY THE BYTES ARE STREAMED FROM STORAGE ON EVERY REQUEST
 *
 * `Cache-Control: private` rather than the immutable public caching the media route uses. These files
 * are unpublished until they are not, and a CDN or a shared proxy holding a private draft would
 * outlive the decision to keep it private.
 */
import { getDb } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import { capabilitiesFor, getPublicationFile, humanSize, mayReadPublicationFiles } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Not found, with no detail: the same answer for a file that does not exist and one there is no right to read. */
function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * A filename that cannot break the header it is written into.
 *
 * `Content-Disposition` is a header, so a filename containing a quote or a newline could end it and
 * let the rest of the name be read as another header. The archive keeps real filenames with spaces,
 * commas, parentheses and apostrophes — **quoted-and-escaped is not optional here** — and a
 * sanitised fallback is offered for clients that cannot read the RFC 5987 form.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const fileId = Number.parseInt(id, 10);
  if (!Number.isInteger(fileId) || fileId <= 0) return notFound();

  const db = await getDb();
  const file = await getPublicationFile(db, fileId);
  if (!file) return notFound();

  /*
   * The reader is resolved BEFORE the query that decides, so a public work's file costs one session
   * lookup and a private one costs the same lookup plus the access question. A signed-out visitor is
   * `null` rather than an error: the public half of the repository is meant to be readable without an
   * account, and the brief's diaspora audience is the reason.
   */
  const current = await getCurrentAccount();
  const accountId = current?.account.id ?? null;
  const capabilities = accountId === null ? new Set<string>() : await capabilitiesFor(db, accountId);

  const mayRead = await mayReadPublicationFiles(db, {
    publicationId: file.publicationId,
    accountId,
    capabilities,
  });
  if (!mayRead) return notFound();

  const object = await getStorage().get(file.storageKey);
  if (!object) {
    /*
     * THE ROW EXISTS AND THE BYTES DO NOT — the fault round 280 records for the archive's own media,
     * and the one a silent 404 hides. It is logged loudly here with the key, because the remedy is an
     * operator restoring the object, not a reader retrying.
     */
    console.error(
      `[publication-file] row ${fileId} points at ${file.storageKey}, which object storage does not hold. ` +
        `The record is intact (${file.filename}, ${humanSize(file.sizeBytes)}, sha256 ${file.checksum?.slice(0, 16) ?? 'not recorded'}) ` +
        'and the file must be re-uploaded or restored.'
    );
    return notFound();
  }

  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      /*
       * THE STORED TYPE WINS, AND IT IS ONE WE ACCEPTED.
       *
       * `object.contentType` is the type recorded when the file was accepted, after its bytes were
       * checked against it. It is used in preference to the extension because a manuscript's key
       * extension is chosen by us from that same type, so the two agree by construction — and a
       * generic `application/octet-stream` from the storage driver is ignored in favour of it.
       */
      'Content-Type': file.mimeType,
      'Content-Length': String(object.body.length),
      'Content-Disposition': contentDisposition(file.filename),
      /*
       * These files carry no script and must never be interpreted as a document. `nosniff` stops a
       * browser second-guessing the type, and the sandbox policy means that if a file somehow does
       * contain markup it is inert. A repository that serves what its authors upload owes its readers
       * both lines.
       */
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}
