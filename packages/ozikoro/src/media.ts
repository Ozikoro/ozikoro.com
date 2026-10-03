/**
 * Reading the media archive: documents, photographs, recordings and film.
 *
 * This is the archive the design calls "Archive — documents and photographs", and it is the one
 * section of the site with a genuinely large real collection behind it from day one: 3,488 records
 * migrated from WordPress, of which 3,462 are images, 13 are video and 12 are documents.
 *
 * WHAT THESE RECORDS DO AND DO NOT HAVE
 *
 * They arrived with the fields the previous site kept: a title, alt text, a caption, dimensions,
 * a file size, an upload date and the file itself. They did NOT arrive with what an archive
 * actually needs to be citable — a creator, a rights statement, an accession reference or a
 * holding institution — because WordPress has no such fields.
 *
 * That matters, and the honest way to handle it is the one the design already provides for: a
 * record whose rights are unknown shows that it is unknown rather than implying a permission
 * nobody granted. The plan is explicit that media records carry "creator, date, collection,
 * licence and attribution", and where those are absent the page says so. Nothing here invents a
 * rights statement, because a fabricated one is worse than a missing one: a reader would rely on
 * it.
 */
import type { Db } from '@ozituma/db/client';
import { slugVariants } from './archive.ts';

export interface MediaRecord {
  id: number;
  slug: string;
  kind: 'image' | 'audio' | 'video' | 'document' | 'dataset' | 'other';
  title: string;
  altText: string | null;
  caption: string | null;
  description: string | null;
  /**
   * Where the file is served from, and ONLY when the archive actually holds it.
   *
   * Deliberately null rather than falling back to the WordPress URL. 51 of the 3,488 migrated
   * files were measured and their source addresses now return 404 — gone from the old site, not
   * merely not-yet-fetched. A fallback would put a broken image on those pages AND re-establish
   * the dependency on the site this archive exists to replace, which is the point of item 1.
   */
  url: string | null;
  /** Whether the archive holds the file itself. False means the metadata is all that survives. */
  held: boolean;
  /** Where it came from, kept as provenance, shown as text, never used as a source. */
  sourceUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  filesizeBytes: number | null;
  uploadedAt: string | null;
  /** Rights, which the previous site did not record. Usually null, and shown as such. */
  creator: string | null;
  credit: string | null;
  licence: string | null;
  rightsNote: string | null;
  /** The archive's own stable reference, so a record can be cited even with no accession number. */
  reference: string;
  /** How many articles use it, so a reader can go from a document to the histories it supports. */
  usedByArticles: number;
}

const MEDIA_SELECT = `
  select m.id, m.slug, m.kind, m.title, m.alt_text, m.caption, m.description,
         m.source_url, m.storage_key, m.mime_type, m.width, m.height, m.filesize_bytes,
         m.uploaded_at, m.creator, m.credit, m.licence, m.rights_note,
         (select count(*)::int from ozikoro_article_media am where am.media_id = m.id) as used_by
    from ozikoro_media m
`;

/**
 * The archive's own reference for a media record.
 *
 * WordPress gave no accession numbers, and an archive that cannot cite its own holdings is not an
 * archive. This derives a stable, human-readable reference from the row's identity, so a catalogue
 * entry can be quoted in a footnote today and the number will still mean the same file next year.
 * It is deliberately not presented as an accession number issued by anyone — it is Ozikoro's.
 */
function referenceFor(kind: string, id: number): string {
  const letter = kind === 'image' ? 'P' : kind === 'video' ? 'V' : kind === 'audio' ? 'A' : kind === 'document' ? 'D' : 'X';
  return `OZ-${letter}-${String(id).padStart(4, '0')}`;
}

function rowToMedia(row: Record<string, unknown>): MediaRecord {
  const kind = String(row.kind) as MediaRecord['kind'];
  const id = Number(row.id);
  return {
    id,
    slug: String(row.slug),
    kind,
    title: String(row.title ?? '').trim() || `Untitled ${kind}`,
    altText: row.alt_text ? String(row.alt_text) : null,
    caption: row.caption ? String(row.caption) : null,
    description: row.description ? String(row.description) : null,
    /*
     * The archive's own copy wins once the file has been brought across, and the WordPress URL is the
     * fallback until then, so the archive is readable during the migration rather than only after it.
     * A storage key is not a URL — it is where the file lives — so it is turned into the media route
     * rather than served directly. See `apps/ozikoro/app/media/[...key]/route.ts`.
     */
    // Only ever our own address. See the note on `url` for why there is no fallback.
    url: row.storage_key ? `/media/${String(row.storage_key)}` : null,
    held: Boolean(row.storage_key),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    mimeType: row.mime_type ? String(row.mime_type) : null,
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    filesizeBytes: row.filesize_bytes === null || row.filesize_bytes === undefined ? null : Number(row.filesize_bytes),
    uploadedAt: row.uploaded_at ? new Date(String(row.uploaded_at)).toISOString() : null,
    creator: row.creator ? String(row.creator) : null,
    credit: row.credit ? String(row.credit) : null,
    licence: row.licence ? String(row.licence) : null,
    rightsNote: row.rights_note ? String(row.rights_note) : null,
    reference: referenceFor(kind, id),
    usedByArticles: Number(row.used_by ?? 0),
  };
}

export interface MediaListOptions {
  kind?: string | null;
  /** Only records the archive actually shows a picture for. */
  illustrated?: boolean;
  /** Only records some article depends on. */
  usedOnly?: boolean;
  limit?: number;
  offset?: number;
}

function mediaWhere(options: MediaListOptions): { clause: string; params: unknown[] } {
  const conditions: string[] = ['m.mime_type is not null'];
  const params: unknown[] = [];

  if (options.kind && options.kind !== 'all') {
    params.push(options.kind);
    conditions.push(`m.kind = $${params.length}`);
  }
  if (options.usedOnly) {
    conditions.push('exists (select 1 from ozikoro_article_media am where am.media_id = m.id)');
  }
  if (options.illustrated) {
    conditions.push("m.kind = 'image'");
  }

  return { clause: `where ${conditions.join(' and ')}`, params };
}

export async function listMedia(db: Db, options: MediaListOptions = {}): Promise<MediaRecord[]> {
  const { clause, params } = mediaWhere(options);
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `${MEDIA_SELECT} ${clause} order by m.uploaded_at desc nulls last, m.id desc limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return rows.map(rowToMedia);
}

export async function countMedia(db: Db, options: MediaListOptions = {}): Promise<number> {
  const { clause, params } = mediaWhere(options);
  const row = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_media m ${clause}`, params);
  return Number(row?.n ?? 0);
}

export async function getMediaBySlug(db: Db, slug: string): Promise<MediaRecord | null> {
  const row = await db.one<Record<string, unknown>>(`${MEDIA_SELECT} where m.slug = any($1::text[]) limit 1`, [slugVariants(slug)]);
  return row ? rowToMedia(row) : null;
}

/** The articles that use a media record, so a photograph leads back to the histories it supports. */
export async function getMediaArticles(db: Db, mediaId: number): Promise<{ slug: string; title: string }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select a.slug, a.title from ozikoro_article_media am
       join ozikoro_article a on a.id = am.article_id
      where am.media_id = $1 and a.status = 'published' and a.is_page = false
      order by a.published_at desc nulls last limit 20`,
    [mediaId]
  );
  return rows.map((r) => ({ slug: String(r.slug), title: String(r.title ?? '').trim() || 'Untitled record' }));
}

export interface MediaStats {
  total: number;
  images: number;
  video: number;
  documents: number;
  audio: number;
  withRights: number;
  usedByArticles: number;
  bytes: number;
}

/** What the archive holds, stated from the rows rather than from the design's demonstration values. */
export async function getMediaStats(db: Db): Promise<MediaStats> {
  const row = await db.one<Record<string, unknown>>(`
    select
      count(*)::int as total,
      count(*) filter (where kind = 'image')::int as images,
      count(*) filter (where kind = 'video')::int as video,
      count(*) filter (where kind = 'document')::int as documents,
      count(*) filter (where kind = 'audio')::int as audio,
      -- Counted from the rights table, which is the authority. The legacy string columns on this
      -- table are kept in step but are not what "has rights been established" means.
      count(*) filter (where exists (select 1 from ozikoro_media_rights r where r.media_id = ozikoro_media.id and r.checked_at is not null))::int as with_rights,
      count(*) filter (where exists (select 1 from ozikoro_article_media am where am.media_id = ozikoro_media.id))::int as used_by,
      coalesce(sum(filesize_bytes), 0)::bigint as bytes
    from ozikoro_media
  `);
  return {
    total: Number(row?.total ?? 0),
    images: Number(row?.images ?? 0),
    video: Number(row?.video ?? 0),
    documents: Number(row?.documents ?? 0),
    audio: Number(row?.audio ?? 0),
    withRights: Number(row?.with_rights ?? 0),
    usedByArticles: Number(row?.used_by ?? 0),
    bytes: Number(row?.bytes ?? 0),
  };
}

/** A file size a reader can use, rather than a byte count. */
export function humanBytes(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// The media register — every item the archive holds, with its rights basis
// ---------------------------------------------------------------------------

/**
 * WHY THIS IS NOT A SECOND RIGHTS REGISTER
 *
 * `/admin/rights` is the **work queue**: the items nobody has checked, ordered by how many published
 * articles rest on each one, with the form that records a permission. It is the screen an editor works in.
 *
 * This is the **register**: what the archive actually holds, by kind, with the size and the credit and
 * whether any rights basis exists at all — the screen an editor checks a claim against. `/admin/rights`
 * answers *"what needs my attention?"*; this answers *"do we hold it, and on what basis?"* The two read the
 * same table and neither can do the other's job, which is why the split is stated here rather than left for
 * a reader to infer from two similar-looking pages.
 *
 * THE RIGHTS COLUMNS COME FROM `ozikoro_media_rights` AND NOT FROM THE LEGACY STRINGS.
 *
 * `ozikoro_media` carries `licence`, `credit` and `rights_note` columns, and the rights register already
 * established that those are **not** what "a rights basis has been recorded" means — `checked_at` on the
 * rights row is. Reading the string column instead would report 3,488 unchecked items as if some of them
 * were settled, which is exactly the misreading the rights register exists to prevent.
 */
export interface MediaRegisterOptions {
  kind?: string | null;
  /** `missing` is the state that matters: no rights row has ever been checked. */
  rights?: 'all' | 'recorded' | 'missing';
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface MediaRegisterItem extends MediaRecord {
  rightsRecorded: boolean;
  restricted: boolean;
  allowsPublication: boolean;
}

function registerWhere(options: MediaRegisterOptions): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.kind && options.kind !== 'all') {
    params.push(options.kind);
    conditions.push(`m.kind = $${params.length}`);
  }
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`(m.title ilike $${params.length} or m.slug ilike $${params.length})`);
  }
  if (options.rights === 'recorded') {
    conditions.push(`exists (select 1 from ozikoro_media_rights r where r.media_id = m.id and r.checked_at is not null)`);
  }
  if (options.rights === 'missing') {
    conditions.push(`not exists (select 1 from ozikoro_media_rights r where r.media_id = m.id and r.checked_at is not null)`);
  }

  // No condition at all is valid here — "everything" is a real question about a register.
  return { clause: conditions.length > 0 ? `where ${conditions.join(' and ')}` : '', params };
}

export async function countMediaRegister(db: Db, options: MediaRegisterOptions = {}): Promise<number> {
  const { clause, params } = registerWhere(options);
  const row = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_media m ${clause}`, params);
  return Number(row?.n ?? 0);
}

export async function listMediaRegister(
  db: Db,
  options: MediaRegisterOptions = {}
): Promise<MediaRegisterItem[]> {
  const { clause, params } = registerWhere(options);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select m.id, m.slug, m.kind, m.title, m.alt_text, m.caption, m.description, m.source_url,
            m.mime_type, m.storage_key, m.filesize_bytes,
            m.width, m.height, m.duration_seconds, m.creator, m.credit, m.licence, m.rights_note,
            m.captured_at, m.uploaded_at,
            coalesce(r.checked_at is not null, false) as rights_recorded,
            coalesce(r.restricted, false) as restricted,
            coalesce(r.allows_publication, false) as allows_publication,
            (select count(*)::int from ozikoro_article_media am
               join ozikoro_article ar on ar.id = am.article_id
              where am.media_id = m.id and ar.status = 'published' and ar.is_page = false) as used_by
       from ozikoro_media m
       left join ozikoro_media_rights r on r.media_id = m.id
       ${clause}
      order by m.kind, m.id
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  const kindLetter = (k: string) =>
    k === 'image' ? 'P' : k === 'video' ? 'V' : k === 'audio' ? 'A' : k === 'document' ? 'D' : 'X';

  return rows.map((r) => ({
    ...rowToMedia(r),
    /*
     * THE FILE ADDRESS IS ENCODED PER SEGMENT.
     *
     * `rowToMedia` interpolates the storage key raw, and **a real WordPress filename contains spaces** —
     * `11237-Igbo Folk Idioms in Caribbean Phrase.pdf` is one of the archive's own documents. An unencoded
     * space ends the URL at the space, so the file 404s on precisely the records with the most descriptive
     * names. `mediaPath` does this for the filled screens; a register whose whole purpose is to open a record
     * cannot be the one screen that gets it wrong.
     */
    url: r.storage_key
      ? `/media/${String(r.storage_key).split('/').map(encodeURIComponent).join('/')}`
      : null,
    reference: `OZ-${kindLetter(String(r.kind))}-${String(r.id).padStart(4, '0')}`,
    rightsRecorded: Boolean(r.rights_recorded),
    restricted: Boolean(r.restricted),
    allowsPublication: Boolean(r.allows_publication),
  }));
}

