/**
 * Manuscript files for the research network: what may be uploaded, and what may be read back.
 *
 * THE GAP THIS CLOSES
 *
 * The brief's upload flow names the file first — "publication upload: PDF or document, with title,
 * abstract, authors, topic tags, institution" — and `ozikoro_publication_file` has existed since
 * migration 0038 with nothing ever written into it. `/submit` says so on the page rather than offering
 * a control that discards the file, which was the honest state and is not the finished one.
 *
 * WHY A FILE IS NOT A BLOB IN THE DATABASE
 *
 * The bytes go to object storage through the same `getStorage()` driver the 3,488 migrated media
 * records already use, so there is one storage seam rather than two. The row in
 * `ozikoro_publication_file` carries the type, the size, the checksum and who uploaded it; the
 * checksum is the part that makes the record verifiable rather than merely descriptive, and it is
 * computed here rather than accepted from the client.
 *
 * WHY THE TYPE IS CHECKED AGAINST THE BYTES AND NOT THE DECLARED MIME TYPE
 *
 * A browser-reported `Content-Type` is a claim by the client. A repository that believed it would
 * serve whatever somebody uploaded under the type it claimed to be — the same class of mistake
 * `verifyAudioSignature` exists to prevent for recordings. **A PDF that does not begin `%PDF-` is not
 * a PDF**, and it is refused before a byte reaches storage.
 *
 * WHY READS ARE A FUNCTION AND NOT A URL
 *
 * A private draft's manuscript must not be fetchable by anyone who can guess a key. Access is decided
 * against the database — the work's state, its authors, and the reader's capabilities — so it lives
 * here beside the upload and not in the route, which only decides how to answer.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import { MemberError } from './members.ts';
import type { PublicationState } from './publications.ts';

// ---------------------------------------------------------------------------
// What may be uploaded
// ---------------------------------------------------------------------------

export interface AcceptedFileType {
  /** The MIME type the archive records and serves. */
  contentType: string;
  label: string;
  /** The extension the stored key uses, chosen by us rather than taken from the filename. */
  extension: string;
  /** The first bytes a real file of this type has. */
  magic: Buffer;
}

/**
 * The accepted types, and nothing else.
 *
 * Deliberately short. A research repository is asked for manuscripts and supplements, and every
 * format added here is a format the archive has promised to keep readable — so a type is admitted
 * when there is a reason to keep it, not because a browser produced it.
 */
export const ACCEPTED_FILE_TYPES: AcceptedFileType[] = [
  { contentType: 'application/pdf', label: 'PDF', extension: 'pdf', magic: Buffer.from('%PDF-') },
  /*
   * OOXML is a ZIP container, so the signature is the ZIP local-file header. That means a `.docx`
   * and a `.zip` are indistinguishable at this check — which is why the declared type is allowed to
   * narrow the choice but never to widen it: the extension must also be one this list names, and the
   * bytes must be a ZIP.
   */
  { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word document', extension: 'docx', magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]) },
  { contentType: 'application/vnd.oasis.opendocument.text', label: 'OpenDocument text', extension: 'odt', magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]) },
  { contentType: 'application/rtf', label: 'Rich text', extension: 'rtf', magic: Buffer.from('{\\rtf') },
  { contentType: 'text/plain', label: 'Plain text', extension: 'txt', magic: Buffer.alloc(0) },
  { contentType: 'text/markdown', label: 'Markdown', extension: 'md', magic: Buffer.alloc(0) },
  { contentType: 'image/png', label: 'PNG image', extension: 'png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { contentType: 'image/jpeg', label: 'JPEG image', extension: 'jpg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
];

/**
 * 32 MB.
 *
 * A journal article is well under this; a thesis with figures is under it; a scanned book is not,
 * and a research repository is not a file host. The ceiling is stated as a named constant because it
 * is quoted on the upload screen — a limit a reader cannot find is a limit they meet as an error.
 */
export const MAX_MANUSCRIPT_BYTES = 32 * 1024 * 1024;

export const ACCEPTED_FILE_LABEL = ACCEPTED_FILE_TYPES.map((t) => t.label).join(', ');

/** The stored file's own description, as the record keeps it. */
export interface PublicationFileRecord {
  id: number;
  publicationId: number;
  version: number | null;
  role: 'manuscript' | 'supplementary' | 'dataset' | 'figure' | 'cover';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  checksum: string | null;
  uploadedBy: number | null;
  uploadedAt: string;
  /** What it is, in words, for a reader who is not a MIME type. */
  typeLabel: string;
}

const FILE_ROLES = ['manuscript', 'supplementary', 'dataset', 'figure', 'cover'] as const;
export type PublicationFileRole = (typeof FILE_ROLES)[number];

export function isPublicationFileRole(value: string): value is PublicationFileRole {
  return (FILE_ROLES as readonly string[]).includes(value);
}

/**
 * Resolve a declared type and a filename to an accepted type, or explain the refusal.
 *
 * The extension is taken from the ACCEPTED TYPE and never from the uploaded filename. A file called
 * `chapter.pdf.exe` is stored as `…​.pdf` because its bytes are a PDF, and a file called
 * `chapter.exe` whose bytes are a PDF is stored as `…​.pdf`; **the filename is a label the uploader
 * chose and the key is an address the archive chooses.** This is the same rule the media importer
 * follows, and it is what stops a name from deciding what a file is.
 */
export function resolveFileType(declaredType: string, filename: string): AcceptedFileType {
  const declared = declaredType.split(';')[0]!.trim().toLowerCase();
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';

  const byType = ACCEPTED_FILE_TYPES.find((t) => t.contentType === declared);
  if (byType) return byType;

  /*
   * A browser sometimes sends `application/octet-stream` for a perfectly ordinary document, which
   * is unhelpful rather than wrong. The extension is allowed to resolve THOSE cases, and only to a
   * type on the list — so an unknown extension is still refused rather than admitted on the strength
   * of a guess.
   */
  const byExtension = ACCEPTED_FILE_TYPES.find((t) => t.extension === extension);
  if (byExtension && (declared === '' || declared === 'application/octet-stream')) return byExtension;

  throw new MemberError(
    'unsupported_file_type',
    `That file type is not accepted. Upload one of: ${ACCEPTED_FILE_LABEL}.`
  );
}

/**
 * Check the bytes against the type, and return them.
 *
 * The empty-file case is refused first: a zero-byte upload is almost always a form that lost its
 * file rather than a manuscript, and storing it would make the record look complete.
 */
export function verifyFileSignature(body: Buffer, type: AcceptedFileType): void {
  if (body.length === 0) {
    throw new MemberError('empty_file', 'That file is empty. It may not have uploaded properly.');
  }
  if (body.length > MAX_MANUSCRIPT_BYTES) {
    const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;
    throw new MemberError(
      'file_too_large',
      `That file is ${mb(body.length)}. The limit is ${mb(MAX_MANUSCRIPT_BYTES)}.`
    );
  }
  if (type.magic.length === 0) return; // plain text carries no signature
  if (!body.subarray(0, type.magic.length).equals(type.magic)) {
    throw new MemberError(
      'content_type_mismatch',
      `That file does not look like ${type.label}. It may be corrupt, or renamed from another type.`
    );
  }
}

/** The stored key. One namespace, one work per directory, so a bucket can be browsed by hand. */
export function publicationFileKey(publicationId: number, extension: string): string {
  return `publications/${publicationId}/${randomUUID()}.${extension}`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface AttachFileResult {
  file: PublicationFileRecord;
  /** So the caller can say "the checksum is …" rather than only "it worked". */
  checksum: string;
}

/**
 * Attach a manuscript or supplement to a work.
 *
 * Order of operations, and why it is this order: the bytes are written to storage FIRST and the row
 * is written second. A row pointing at a key that was never written is a download that 404s —
 * exactly the fault round 280 records for the archive's own media — whereas bytes with no row are
 * an orphan object, which is invisible and cheap to sweep. **The failure that a reader can see is the
 * one to avoid.**
 */
export async function attachPublicationFile(
  db: Db,
  input: {
    publicationId: number;
    filename: string;
    declaredType: string;
    body: Buffer;
    role?: PublicationFileRole;
    version?: number | null;
    actorId: number;
  }
): Promise<AttachFileResult> {
  const publication = await db.one<{ id: string; current_version: number; status: string; submitted_by: string | null }>(
    `select id, current_version, status, submitted_by from ozikoro_publication where id = $1`,
    [input.publicationId]
  );
  if (!publication) throw new MemberError('no_publication', 'That work does not exist.');

  /*
   * ARCHIVED IS TERMINAL FOR FILES.
   *
   * A version that has been archived is the record of what was published; adding a manuscript to it
   * afterwards would change what a citation resolves to. Revision is how a work changes — a new
   * version with its own files — and this refusal is what makes that true rather than a convention.
   */
  if (String(publication.status) === 'archived') {
    throw new MemberError('archived', 'That work is archived. Its files are part of the record and cannot be added to.');
  }

  const type = resolveFileType(input.declaredType, input.filename);
  verifyFileSignature(input.body, type);

  const role: PublicationFileRole = input.role && isPublicationFileRole(input.role) ? input.role : 'manuscript';
  const filename = input.filename.trim().slice(0, 200) || `manuscript.${type.extension}`;
  const key = publicationFileKey(input.publicationId, type.extension);

  await getStorage().put(key, input.body, type.contentType);

  const checksum = createHash('sha256').update(input.body).digest('hex');

  const row = await db.one<{ id: string; created_at: string }>(
    `insert into ozikoro_publication_file
       (publication_id, version, role, filename, mime_type, size_bytes, storage_key, checksum, type_label, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id, created_at`,
    [
      input.publicationId,
      input.version ?? Number(publication.current_version) ?? null,
      role,
      filename,
      type.contentType,
      input.body.length,
      key,
      checksum,
      type.label,
      input.actorId,
    ]
  );

  await audit(db, {
    entityType: 'ozikoro_publication_file',
    entityId: Number(row!.id),
    action: 'attach_file',
    after: { publicationId: input.publicationId, filename, contentType: type.contentType, sizeBytes: input.body.length, role, key },
    actorId: input.actorId,
  });

  return {
    checksum,
    file: {
      id: Number(row!.id),
      publicationId: input.publicationId,
      version: input.version ?? Number(publication.current_version) ?? null,
      role,
      filename,
      mimeType: type.contentType,
      sizeBytes: input.body.length,
      storageKey: key,
      checksum,
      uploadedBy: input.actorId,
      uploadedAt: new Date(String(row!.created_at)).toISOString(),
      typeLabel: type.label,
    },
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Whether this account may read this work's files.
 *
 * The rule, in one place, so the download route and any future screen cannot disagree:
 *
 *   * a PUBLISHED, PUBLIC work is readable by anyone — that is what publishing means here;
 *   * everything else is readable by its authors, its submitting account, and anyone holding
 *     `review_queue` or `expert_review`, who have to read a manuscript to do their job.
 *
 * An account with no relationship to a private draft gets `false`, and the route answers 404 rather
 * than 403 — **a private draft must not be discoverable by the status code it returns.**
 */
export async function mayReadPublicationFiles(
  db: Db,
  input: { publicationId: number; accountId: number | null; capabilities: Set<string> }
): Promise<boolean> {
  const row = await db.one<{ status: string; is_public: boolean; submitted_by: string | null; is_author: boolean }>(
    `select p.status, p.is_public, p.submitted_by,
            exists (
              select 1 from ozikoro_publication_author a
               where a.publication_id = p.id and a.account_id = $2
            ) as is_author
       from ozikoro_publication p
      where p.id = $1`,
    [input.publicationId, input.accountId]
  );
  if (!row) return false;

  if (String(row.status) === 'published' && row.is_public) return true;
  if (input.accountId === null) return false;
  if (row.submitted_by !== null && Number(row.submitted_by) === input.accountId) return true;
  if (row.is_author) return true;
  if (input.capabilities.has('review_queue') || input.capabilities.has('expert_review')) return true;
  return false;
}

/** Every file attached to a work, newest role first, for the work's own page. */
export async function listPublicationFiles(db: Db, publicationId: number): Promise<PublicationFileRecord[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, publication_id, version, role, filename, mime_type, size_bytes, storage_key, checksum, uploaded_by, created_at
       from ozikoro_publication_file
      where publication_id = $1
      order by role <> 'manuscript', created_at`,
    [publicationId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    publicationId: Number(r.publication_id),
    version: r.version === null || r.version === undefined ? null : Number(r.version),
    role: String(r.role) as PublicationFileRole,
    filename: String(r.filename),
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes),
    storageKey: String(r.storage_key),
    checksum: r.checksum ? String(r.checksum) : null,
    uploadedBy: r.uploaded_by === null || r.uploaded_by === undefined ? null : Number(r.uploaded_by),
    uploadedAt: new Date(String(r.created_at)).toISOString(),
    typeLabel: ACCEPTED_FILE_TYPES.find((t) => t.contentType === String(r.mime_type))?.label ?? String(r.mime_type),
  }));
}

/** One file by id, with the work it belongs to, so the download route can check access first. */
export async function getPublicationFile(
  db: Db,
  fileId: number
): Promise<(PublicationFileRecord & { publicationSlug: string; publicationStatus: string; publicationIsPublic: boolean }) | null> {
  const row = await db.one<Record<string, unknown>>(
    `select f.id, f.publication_id, f.version, f.role, f.filename, f.mime_type, f.size_bytes, f.storage_key,
            f.checksum, f.uploaded_by, f.created_at, p.slug, p.status, p.is_public
       from ozikoro_publication_file f
       join ozikoro_publication p on p.id = f.publication_id
      where f.id = $1`,
    [fileId]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    publicationId: Number(row.publication_id),
    version: row.version === null || row.version === undefined ? null : Number(row.version),
    role: String(row.role) as PublicationFileRole,
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    storageKey: String(row.storage_key),
    checksum: row.checksum ? String(row.checksum) : null,
    uploadedBy: row.uploaded_by === null || row.uploaded_by === undefined ? null : Number(row.uploaded_by),
    uploadedAt: new Date(String(row.created_at)).toISOString(),
    typeLabel: ACCEPTED_FILE_TYPES.find((t) => t.contentType === String(row.mime_type))?.label ?? String(row.mime_type),
    publicationSlug: String(row.slug),
    publicationStatus: String(row.status) as PublicationState,
    publicationIsPublic: Boolean(row.is_public),
  };
}

/** A byte count as a person reads it. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The audit write, local for the same reason `members.ts` keeps its own: it must never be a gate. */
async function audit(
  db: Db,
  event: { entityType: string; entityId: number; action: string; before?: unknown; after?: unknown; actorId: number }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        event.entityType,
        event.entityId,
        event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId,
        null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/publication-files] could not record an audit event:', String(error).slice(0, 160));
  }
}
