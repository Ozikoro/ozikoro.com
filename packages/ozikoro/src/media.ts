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
/*
 * The one place a storage key becomes a URL. `mediaPath` lives in `design-fill.ts` and is imported rather
 * than re-implemented, because **a second copy of the per-segment encoding is how a filename with a space in
 * it starts 404ing on one screen and not another** — that fault is already recorded in this repository.
 */
import { mediaPath } from './design-fill.ts';
import { MemberError } from './members.ts';

export interface MediaRecord {
  id: number;
  slug: string;
  kind: 'image' | 'audio' | 'video' | 'document' | 'dataset' | 'other';
  /**
   * The stored title, exactly as the row holds it — `null` where the record has none.
   *
   * Deliberately separate from `title` below, which substitutes "Untitled image" so that a column in the
   * rights register or the audit has something to print. **A caller that must not claim a title the
   * record does not have has to be able to see the null**, and `mediaName` is that caller.
   */
  storedTitle: string | null;
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
  /**
   * How many articles carry the record as a FEATURED image, counted from `ozikoro_article_media`.
   *
   * Not the number of articles that embed it in their text — that relationship lives in `body_html` and
   * is read by `getMediaArticles`. The rights register orders its work queue by this figure, and a
   * placement in a body does not raise an article's dependence on the file the way a lead image does.
   */
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
    storedTitle: row.title ? String(row.title) : null,
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

// ---------------------------------------------------------------------------
// What a record is called
// ---------------------------------------------------------------------------

/** The noun the archive uses for each kind of record, so a heading and a table agree. */
export const MEDIA_KIND_LABEL: Record<string, string> = {
  image: 'Photograph', video: 'Film', audio: 'Recording', document: 'Document',
  dataset: 'Dataset', other: 'Item',
};

export type MediaNameSource = 'caption' | 'description' | 'alt' | 'title' | 'fallback';

export interface MediaName {
  /** What the page is headed, and what the `<title>` says. */
  name: string;
  /** Which field it came from, so a caller can be honest about a name that is not a title. */
  from: MediaNameSource;
}

/**
 * Whether a stored string is a name a machine gave the file rather than a name a person gave the record.
 *
 * WHY THIS TEST EXISTS AT ALL
 *
 * The owner reported that `/documents/opta/` "has the correct caption, but not the correct name": the
 * heading was `opta`, which is the name the FILE was uploaded under. Measured over the 3,488 migrated
 * records, **1,742 carry a title that is only their file's own name** and 306 carry no title at all. So
 * the heading is composed from the record's own descriptive text first, and the stored title is read
 * afterwards — which leaves one class to decide: a record with no caption and no description whose title
 * is itself the upload's file name. `title` and `alt_text` are the two fields the migration filled from
 * the file (`scripts/import-inbody-images.ts` writes the file's name into both), and this is how a
 * machine-named file is told apart from a name a person wrote:
 *
 *   - ONE WORD. A person titling a record writes words; WordPress writes `opta`, `owa`, `SAMTDO-7v1`.
 *   - A PARENTHESISED COUNTER — `download (20)`, `images (13)`, `get (1)` — which a browser adds when a
 *     name is already taken.
 *   - A LONG HEXADECIMAL RUN, which is an upload id or a content hash (`64b6dfc8d0d66d1e4a8d149a`).
 *   - A TRAILING DIMENSION PAIR, which is a resized copy's suffix (`Iguaro-Nri-Festival-768 432`).
 *   - A MACHINE DATE OR TIME (`Screenshot 2025-05-17 at 11.32.51`, `images 2025-03-12T231330.373`).
 *
 * IT IS APPLIED TO `title` AND `alt_text` AND NOT TO THE CAPTION OR THE DESCRIPTION. Those two are prose
 * fields the archive published as text, and a caption ending "(1978)" is a citation, not a file name —
 * refusing it would put "Untitled" on a record that plainly is described, which is the opposite fault. A
 * one-word caption is the single exception, and `mediaName` draws that line separately.
 */
function isMachineFileName(value: string): boolean {
  const text = value.trim();
  if (text === '') return true;
  if (!text.includes(' ')) return true;
  if (/\(\s*\d+\s*\)$/.test(text)) return true;
  if (/[0-9a-f]{10,}/.test(text.toLowerCase())) return true;
  if (/-?\d{2,4}\s*[x×]\s*\d{2,4}$/.test(text) || /-?\d{2,4}\s+\d{2,4}$/.test(text)) return true;
  if (/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{2}\.\d{2}|\d{8}[_ ]\d{4,}/.test(text)) return true;
  return false;
}

/**
 * What the archive calls a media record.
 *
 * THE RECORD'S OWN TEXT, IN THE ORDER THE RECORD ITSELF STATES IT. `caption` is the text the previous
 * site published *with* the item, `description` is the record's own description, and `alt_text` is the
 * description written for a reader who cannot see it. The owner's rule is that "every image name can be
 * gotten from the photograph caption/description", and this is that rule: over the 3,488 migrated records
 * the caption names 2,852 of them, 11 more are named by their alternative text and 3 by their description.
 *
 * NOTHING IS COMPOSED HERE. A name is a field the record actually holds. Where the record holds no
 * descriptive text and its title is a machine-named file, the heading is `Untitled photograph — opta`:
 * the name the file carries is kept, because it is evidence about the record, and it is not passed off as
 * a title. **A page headed "opta" is wrong; a page headed "Untitled photograph — opta" is honest.**
 *
 * WHAT THIS DOES NOT DO. 117 records with no caption or description keep a title that has spaces and no
 * machine marker — `nde aboh`, `Orashi River`, `Igbo Folk Idioms In Caribbean Phrase`. Those are names a
 * person could have written and the archive holds them as titles, so they are used; the alternative is to
 * deny a title the row actually has.
 */
export function mediaName(record: {
  kind: string;
  slug: string;
  storedTitle: string | null;
  caption: string | null;
  description: string | null;
  altText: string | null;
}): MediaName {
  const prose: [MediaNameSource, string | null][] = [
    ['caption', record.caption],
    ['description', record.description],
  ];
  for (const [from, value] of prose) {
    const text = value?.trim();
    /*
     * A SINGLE WORD IS NOT A DESCRIPTION, IN ANY FIELD. `capacity_building_for_traditional` and `SAMTDO-7v1`
     * are the captions two of this archive's twelve documents actually carry: the previous site's caption
     * field holds the file's own name. A person writing a caption writes a phrase, so a one-word caption is
     * passed over and the record reaches the fallback, which shows the same word as what it is. The other
     * machine markers are deliberately NOT applied here — a caption ending "(1978)" is a citation.
     */
    if (text && text.includes(' ')) return { name: text, from };
  }

  const names: [MediaNameSource, string | null][] = [
    ['alt', record.altText],
    ['title', record.storedTitle],
  ];
  for (const [from, value] of names) {
    const text = value?.trim();
    if (text && !isMachineFileName(text)) return { name: text, from };
  }

  const evidence = record.storedTitle?.trim() || record.slug;
  return {
    name: `Untitled ${(MEDIA_KIND_LABEL[record.kind] ?? 'Item').toLowerCase()} — ${evidence}`,
    from: 'fallback',
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
  /*
   * A TRASHED RECORD IS NOT A RECORD A READER MAY MEET.
   *
   * `m.deleted_at is null` is the whole of the trash's effect on this list, and it is here rather than in
   * each caller for the reason migration 0056 gives for using a STATUS on articles and a FLAG here: media
   * has no status column, so every read path has to know about the flag, and **the way to make that safe is
   * to have as few of them as possible and to put them in one file.** There are five, they are all in this
   * file, and they are named in the round's report.
   */
  const conditions: string[] = ['m.mime_type is not null', 'm.deleted_at is null'];
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
  const row = await db.one<Record<string, unknown>>(`${MEDIA_SELECT} where m.slug = any($1::text[]) and m.deleted_at is null limit 1`, [slugVariants(slug)]);
  return row ? rowToMedia(row) : null;
}

/**
 * The published records an image is associated with, so a photograph leads back to the histories it
 * supports.
 *
 * THERE ARE TWO RELATIONSHIPS IN THIS ARCHIVE AND THEY ARE NOT THE SAME ONE.
 *
 *   `featured`  an `ozikoro_article_media` row — how the record is drawn as the article's lead image.
 *               `ozikoro_article.featured_media_id` is the same fact, and the importer wrote both.
 *   `embedded`  the image appears in the article's own `body_html`, which is where most of them are:
 *               measured, 2,871 images sit inside 1,027 article bodies.
 *
 * The function used to read the link table alone, which is why `/documents/opta/` — an image the article
 * `the-igbo-origins-and-development-of-the-aboh-kingdom` embeds — said nothing about it. **The link table
 * holds featured images only**: `packages/ozikoro/src/import/archive.ts` writes a row there for
 * `featured_media_id` and for nothing else, and `scripts/import-inbody-images.ts` rewrites a body to
 * `/media/<storage_key>` without touching the table. So a reader asking "which histories does this
 * photograph belong to?" was answered from the one relationship that does not hold them.
 *
 * THE BODY STILL HOLDS THE OLD SITE'S ADDRESS, AND THAT IS WHAT IS MATCHED. Measured in this cluster: 1,024
 * of the 1,051 published bodies hold a `ozikoro.com/wp-content/uploads/…` address and only 7 hold a
 * `/media/…` one, because the article route rewrites them **at render time** through `mediaUrlResolver`.
 * So the test is the record's own `source_url`, with the WordPress resize suffix stripped from the file
 * name, and a `/media/<storage key>` address for the bodies that have already been rewritten. The suffix is
 * stripped because a body that quotes a resized copy (`…/opta-184x300.jpeg`) names the same file as the
 * record holding the original (`…/opta.jpeg`) — which is exactly what `mediaUrlMap` resolves.
 *
 * THE OCCURRENCE MUST END AT A FILE BOUNDARY. `strpos` finds the file name and the next character must be
 * `.` or `-`, so `…/opta.jpeg` is not matched by a record whose file is `…/optical.jpeg`. A record that
 * claimed an article it is not in would be worse than one that says nothing.
 *
 * BOTH ARE REPORTED, AND A RECORD THAT IS BOTH IS LISTED ONCE, as `featured`: that is the stronger of the
 * two statements and it is not false. The page labels them differently — see
 * `apps/ozikoro/app/documents/[slug]/page.tsx`.
 */
export interface MediaArticleLink {
  slug: string;
  title: string;
  role: 'featured' | 'embedded';
}

export async function getMediaArticles(db: Db, mediaId: number): Promise<MediaArticleLink[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `with media as (
       select id, storage_key,
              case when source_url is null then null
                   else regexp_replace(regexp_replace(source_url, '\\.[A-Za-z0-9]+$', ''), '-\\d+x\\d+$', '')
              end as file_stem
         from ozikoro_media where id = $1
     )
     select a.slug, a.title,
            (am.media_id is not null) as is_featured,
            (m.storage_key is not null
              and strpos(a.body_html, '/media/' || m.storage_key) > 0
              and substring(a.body_html
                            from strpos(a.body_html, '/media/' || m.storage_key)
                                 + length('/media/' || m.storage_key) for 1) !~ '[A-Za-z0-9._-]'
            ) as by_served_path,
            (m.file_stem is not null
              and strpos(a.body_html, m.file_stem) > 0
              and substring(a.body_html from strpos(a.body_html, m.file_stem) + length(m.file_stem) for 1)
                  in ('.', '-')
            ) as by_source_file
       from ozikoro_article a
       cross join media m
       left join ozikoro_article_media am on am.article_id = a.id and am.media_id = m.id
      where a.status = 'published' and a.is_page = false
        and (am.media_id is not null
             or (m.storage_key is not null and strpos(a.body_html, '/media/' || m.storage_key) > 0)
             or (m.file_stem is not null and strpos(a.body_html, m.file_stem) > 0))
      order by a.published_at desc nulls last, a.id desc
      limit 20`,
    [mediaId]
  );
  return rows
    .filter((r) => Boolean(r.is_featured) || Boolean(r.by_served_path) || Boolean(r.by_source_file))
    .map((r) => ({
      slug: String(r.slug),
      title: String(r.title ?? '').trim() || 'Untitled record',
      role: (Boolean(r.is_featured) ? 'featured' : 'embedded') as MediaArticleLink['role'],
    }));
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
    where deleted_at is null
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
  // The register is a catalogue, and a trashed record has left the catalogue. See `mediaWhere`.
  const conditions: string[] = ['m.deleted_at is null'];
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

  // `m.deleted_at is null` is always present, so the clause is never empty; "everything" now means
  // everything the archive still holds, which is what the register is for.
  return { clause: `where ${conditions.join(' and ')}`, params };
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

/*
 * ================================================================================================
 * THE ARCHIVE'S OWN ADDRESS FOR AN IMAGE THE OLD SITE STILL OWNS THE URL OF.
 * ================================================================================================
 */

/**
 * WordPress writes a resized variant as `<name>-<width>x<height>.<ext>`.
 *
 * **Stripping it recovers the address of the original**, which is the one the migration catalogued: a
 * `…-680x541.jpg` in a body was measured to have the full-size `….jpg` as its `source_url`, and only the
 * original was imported.
 */
const WORDPRESS_RESIZE = /-\d+x\d+(?=\.[a-z]+$)/i;

/**
 * `-scaled`, WHICH IS WORDPRESS'S OWN NAME FOR THE LARGEST COPY OF AN IMAGE ABOVE ITS BIG-IMAGE THRESHOLD.
 *
 * WHEN WORDPRESS UPLOADS AN IMAGE LARGER THAN 2,560 PX IT KEEPS THE ORIGINAL AND WRITES A `-scaled`
 * COPY, AND THE ATTACHMENT'S OWN FILE NAME BECOMES THE SCALED ONE. Every `<img src>` WordPress then
 * emits names the resized variants of that SAME attachment — `…-642x317.png` — and **`-scaled` is
 * therefore a name for the same picture as the resized spelling, not a different file.**
 *
 * Strip the resize suffix from `…-642x317.png` and you get `….png`, which is an address no row holds:
 * the row holds `…-scaled.png`. So the archive had the file, the body asked for a resize of it, and
 * the resolver returned `null` — the picture came out as an empty box.
 *
 * MEASURED, and this is why the suffix is worth a comment of its own rather than one more line in a
 * regex: **293 of the 376 addresses that survive `rewriteBodyImages` across the 1,024 published bodies
 * that still carry an old-site address are this case, in 40 articles, and every one of the 293 sits in
 * a `srcset`** — which is the attribute a browser actually loads and the one `img-src 'self'` refuses.
 * `/ichi-mark-the-igbo-scarification/` alone carries ten of them, and one of those ten is the image
 * the browser reported as *"violates the following Content Security Policy directive"*.
 */
const WORDPRESS_SCALED = /-scaled(?=\.[A-Za-z0-9]+$)/i;

/** Maps an address the old WordPress site served to the address this archive serves the same file from. */
export type MediaUrlResolver = (url: string) => string | null;

/**
 * BUILD THE URL MAP FROM THE ROWS THEMSELVES, so the two callers cannot disagree about how a URL matches.
 *
 * WHY A SHARED RESOLVER RATHER THAN EACH ROUTE'S OWN
 *
 * **`source_url` and `storage_key` ARE the mapping**: one is the address the file had on WordPress and the
 * other is where this archive keeps it. Two routes need that mapping — the article route, for **2,871 images
 * across 1,027 article bodies**, and the design-screen route, for the **57 images the design screens still
 * hot-link** — and a second copy of the matching rule is how one of them silently stops finding files the
 * other still finds. That is the drift this repository has already recorded four times.
 *
 * A URL WITH NO ROW IS RETURNED AS `null`, AND THE CALLER LEAVES IT ALONE. **This is deliberate and is the
 * whole safety property of the function.** A third of the addresses that do not match were never on
 * ozikoro.com at all — a BBC or a Google image quoted in an article — and substituting anything for those
 * would be putting a different photograph on a history page, which is worse than an empty box.
 *
 * ── THREE LAYERS, IN THIS ORDER, AND THE ORDER IS THE SAFETY PROPERTY ─────────────────────────────────
 *
 *   1. `exact`  — the row whose `source_url` is the address itself.
 *   2. `base`   — the same address with WordPress's `-<width>x<height>` suffix removed, which is what
 *                 already resolved a body quoting `…-680x541.jpg` against the row holding `….jpg`.
 *   3. `aliased` — **added by round 347, and consulted LAST**: the row's `source_url` with WordPress's
 *                 `-scaled` removed. See `WORDPRESS_SCALED` for the measurement.
 *
 * A key is registered in layer 3 **only if neither of the first two already claims it**, and layer 3 is
 * only ever consulted after both have missed. So this change cannot alter one address that already
 * resolved — it can only turn a `null` into the file the archive already holds for that same attachment.
 */
export function mediaUrlMap(
  rows: ReadonlyArray<{ source_url: string | null; storage_key: string | null }>
): MediaUrlResolver {
  const exact = new Map<string, string>();
  const base = new Map<string, string>();
  for (const m of rows) {
    if (!m.source_url || !m.storage_key) continue;
    const own = mediaPath(m.storage_key);
    exact.set(m.source_url, own);
    base.set(m.source_url.replace(WORDPRESS_RESIZE, ''), own);
  }

  /*
   * `…-scaled.png` ALSO ANSWERS FOR `….png`, WHICH IS THE ADDRESS A BODY WRITTEN BEFORE THE SCALE QUOTES.
   *
   * Both spellings are registered, because a body can quote either one: the scaled name itself, and the
   * plain name that stripping the resize suffix produces from a `…-642x317.png`.
   */
  const aliased = new Map<string, string>();
  for (const m of rows) {
    if (!m.source_url || !m.storage_key) continue;
    const unscaled = m.source_url.replace(WORDPRESS_SCALED, '');
    if (unscaled === m.source_url) continue;
    const own = mediaPath(m.storage_key);
    for (const key of [unscaled, unscaled.replace(WORDPRESS_RESIZE, '')]) {
      if (!exact.has(key) && !base.has(key) && !aliased.has(key)) aliased.set(key, own);
    }
  }

  return (url) =>
    exact.get(url) ??
    base.get(url.replace(WORDPRESS_RESIZE, '')) ??
    aliased.get(url.replace(WORDPRESS_RESIZE, '')) ??
    null;
}

/**
 * The same map, read from the database.
 *
 * **Deliberately uncached**: a media row added by an import is visible to the next request rather than to the
 * next restart, which is the failure this archive has recorded for its own `mediaIndexCache`. Both callers
 * are `force-dynamic` routes that already pay several queries, and this is one of them.
 */
export async function mediaUrlResolver(db: Db): Promise<MediaUrlResolver> {
  const rows = await db.rows<{ source_url: string | null; storage_key: string | null }>(
    `select source_url, storage_key from ozikoro_media
      where source_url is not null and storage_key is not null`
  );
  return mediaUrlMap(rows);
}

// ---------------------------------------------------------------------------
// Writes — the record's own description, and nothing else
// ---------------------------------------------------------------------------

/** The longest text each descriptive field accepts, and why each number is what it is. */
export const MEDIA_TEXT_LIMITS = {
  title: 400,
  caption: 1_000,
  altText: 1_000,
  description: 5_000,
  creator: 300,
  credit: 300,
} as const;

export interface MediaEditRecord {
  id: number;
  slug: string;
  kind: string;
  reference: string;
  title: string | null;
  caption: string | null;
  altText: string | null;
  description: string | null;
  creator: string | null;
  credit: string | null;
  licence: string | null;
  rightsNote: string | null;
  held: boolean;
  /** Whether a rights record exists at all, so the form can say a licence is decided elsewhere. */
  rightsRecorded: boolean;
}

/**
 * One media record's descriptive fields, read for the editor's form.
 *
 * The stored title is returned as it is, nulls included, rather than through `MediaRecord.title`'s
 * "Untitled photograph" substitution — **a form that pre-filled a title the row does not have would write
 * that invented string into the row the first time somebody pressed Save without touching it.** The page
 * shows the substituted name separately, as what a reader currently sees.
 *
 * The rights fields are read so the form can SAY that a licence is decided elsewhere and show what is
 * currently recorded, without offering an editor a control that this path would refuse.
 */
export async function getMediaForEdit(db: Db, mediaId: number): Promise<MediaEditRecord | null> {
  const row = await db.one<Record<string, unknown>>(
    `select m.id, m.slug, m.kind, m.title, m.caption, m.alt_text, m.description, m.creator, m.credit,
            m.licence, m.rights_note, m.storage_key,
            exists (select 1 from ozikoro_media_rights r where r.media_id = m.id) as rights_recorded
       from ozikoro_media m where m.id = $1`,
    [mediaId]
  );
  if (!row) return null;
  const kind = String(row.kind);
  return {
    id: Number(row.id),
    slug: String(row.slug),
    kind,
    reference: referenceFor(kind, Number(row.id)),
    title: row.title ? String(row.title) : null,
    caption: row.caption ? String(row.caption) : null,
    altText: row.alt_text ? String(row.alt_text) : null,
    description: row.description ? String(row.description) : null,
    creator: row.creator ? String(row.creator) : null,
    credit: row.credit ? String(row.credit) : null,
    licence: row.licence ? String(row.licence) : null,
    rightsNote: row.rights_note ? String(row.rights_note) : null,
    held: Boolean(row.storage_key),
    rightsRecorded: Boolean(row.rights_recorded),
  };
}

/** What a save changed, so a route can say it rather than implying it. */
export interface MediaDescriptionChange {
  changed: { field: string; from: string | null; to: string | null }[];
}

/**
 * Change what a media record SAYS about itself — the name, the caption, the alt text, the description, and
 * the creator and credit it states.
 *
 * WHERE THE LINE IS, AND WHY IT IS THERE
 *
 * This is the archive's editorial description of an object, and it is the same kind of work as dating a
 * record or linking it to a clan: an editor correcting the catalogue. **It is not a rights decision.** The
 * licence, the permission basis, the living-subject consent and the restriction live in
 * `ozikoro_media_rights` and are written by `setMediaRights`, which is gated on `manage_media_rights` and is
 * admin-only on the archive's own stated reasoning — *"rights are a legal matter, not editorial"*
 * (`docs/OZIKORO-REMAINING.md`, round 45). So this function has no parameter that could set a permission, and
 * that is deliberate: **a function that cannot express a rights decision cannot be talked into making one.**
 *
 * `creator` and `credit` are here rather than in the rights record because they are statements of
 * attribution the catalogue holds — who made the thing, and how it should be credited — not a claim that
 * anybody permitted anything. `setMediaRights` also writes `credit` when it is told to, and leaves it alone
 * otherwise, so the two paths cannot silently overwrite each other.
 *
 * WHY AN EMPTY FIELD CLEARS RATHER THAN KEEPS
 *
 * `setMediaRights` draws the opposite distinction for `credit` — `undefined` means "do not touch" — and it
 * is right there, because a bulk rights pass must not wipe a credit the record already states. **A form is
 * not a bulk pass.** The editor is looking at the current value in a text box; emptying the box is a
 * statement that the record has no caption, and keeping the old text would make the control a lie.
 *
 * WHAT IT CANNOT DO, WHICH IS THE POINT OF SAYING SO
 *
 * It cannot change the file. There is no parameter for `storage_key`, `source_url`, `mime_type`, `width` or
 * `height`, and no path in this archive replaces or deletes an object. **3,443 objects are in the bucket and
 * there are 3,488 rows; 307 files sit in `data/media/ozikoro-wp` with no row at all**, and a round measured
 * that keying those would mean inventing keys for them. An upload control beside this form is how those keys
 * would get invented by accident, so the form has none and says why. See the round's report for the scope.
 */
export async function updateMediaDescription(
  db: Db,
  input: {
    mediaId: number;
    title: string | null;
    caption: string | null;
    altText: string | null;
    description: string | null;
    creator: string | null;
    credit: string | null;
    actorId: number;
  }
): Promise<MediaDescriptionChange> {
  if (!Number.isInteger(input.actorId) || input.actorId <= 0) {
    throw new MemberError('no_actor', 'An edit must name the account that made it.');
  }

  const before = await getMediaForEdit(db, input.mediaId);
  if (!before) throw new MemberError('no_media', 'That record does not exist.');

  /**
   * A field is trimmed and an empty one becomes null.
   *
   * Null and the empty string are different things in this table — `storedTitle: null` is a record with no
   * title, and `''` is a title somebody cleared — and `mediaName` branches on exactly that difference. So a
   * cleared box is stored as null and nothing else is.
   */
  const field = (name: keyof typeof MEDIA_TEXT_LIMITS, raw: string | null): string | null => {
    const text = (raw ?? '').trim();
    if (text.length === 0) return null;
    if (text.length > MEDIA_TEXT_LIMITS[name]) {
      throw new MemberError(
        'too_long',
        `The ${name === 'altText' ? 'alternative text' : name} is ${text.length.toLocaleString('en-GB')} ` +
          `characters and the archive accepts ${MEDIA_TEXT_LIMITS[name].toLocaleString('en-GB')}. Nothing was changed.`
      );
    }
    return text;
  };

  const title = field('title', input.title);
  const caption = field('caption', input.caption);
  const altText = field('altText', input.altText);
  const description = field('description', input.description);
  const creator = field('creator', input.creator);
  const credit = field('credit', input.credit);

  const changed: MediaDescriptionChange['changed'] = [];
  const compare = (name: string, from: string | null, to: string | null) => {
    if ((from ?? null) !== (to ?? null)) changed.push({ field: name, from: from ?? null, to: to ?? null });
  };
  compare('title', before.title, title);
  compare('caption', before.caption, caption);
  compare('altText', before.altText, altText);
  compare('description', before.description, description);
  compare('creator', before.creator, creator);
  compare('credit', before.credit, credit);

  if (changed.length === 0) return { changed };

  await db.query(
    `update ozikoro_media
        set title = $2, caption = $3, alt_text = $4, description = $5, creator = $6, credit = $7,
            updated_at = now()
      where id = $1`,
    [input.mediaId, title, caption, altText, description, creator, credit]
  );

  await mediaAudit(db, {
    entityType: 'ozikoro_media',
    entityId: input.mediaId,
    action: 'update_description',
    before: Object.fromEntries(changed.map((c) => [c.field, c.from])),
    after: Object.fromEntries(changed.map((c) => [c.field, c.to])),
    actorId: input.actorId,
    note: `The record's own description of ${before.reference} (${before.slug}).`,
  });

  return { changed };
}

/**
 * The audit row, written the way every other module in this package writes one.
 *
 * A failed audit insert does not undo the write, and it is logged rather than thrown: the archive's rule is
 * that a change is recorded, and the alternative — refusing a legitimate edit because the trail table had a
 * bad moment — would make the trail the thing that stops the work rather than the thing that witnesses it.
 * The same choice is made in `editorial.ts`, `rights.ts` and four other modules.
 */
async function mediaAudit(
  db: Db,
  event: {
    entityType: string;
    entityId: number;
    action: string;
    before?: unknown;
    after?: unknown;
    actorId: number | null;
    note?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        event.entityType, event.entityId, event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId, event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/media] could not record audit event:', String(error).slice(0, 160));
  }
}

