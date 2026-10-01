/**
 * WordPress extraction and import for the ozikoro.com archive.
 *
 * WHY THIS EXISTS
 *
 * ozikoro.com is live and it is WordPress. It holds the entire existing archive: the articles,
 * the media, the authors, the tags. That content is the platform's reason to exist, and the
 * build plan is explicit that it must be preserved and never replaced with invented records.
 * So the first piece of the real system is the piece that gets the real content out.
 *
 * HOW IT GETS IN, WITHOUT CREDENTIALS
 *
 * The site exposes the standard WordPress REST API at `https://ozikoro.com/wp-json/wp/v2`, and
 * it is publicly readable. That matters: there is no cPanel or WordPress credential for
 * ozikoro.com anywhere on this machine, and a previous session recorded that finding and
 * concluded the archive was unreachable. It is reachable. The read endpoints need no
 * authentication, so the whole archive can be inventoried, extracted and preserved without ever
 * having had access to the server.
 *
 * Measured at the time of writing, unauthenticated:
 *
 *     posts 1051 · pages 6 · media 3582 · categories 14 · tags 11056 · users 11
 *
 * WHAT IT CANNOT GET, AND WHY THAT IS FINE
 *
 * WordPress never exposes password hashes through any endpoint, public or authenticated, so the
 * 11 author identities come across and their credentials do not and cannot. Any account that
 * needs to sign in on the new platform is created through the new platform's own registration,
 * or handed a password reset. That is not a limitation to work around; it is the correct
 * behaviour, and it is worth stating so nobody looks for a missing export.
 *
 * The `users` endpoint also lists only users with published posts, so the 11 are the authors,
 * not every registered subscriber. Subscriber accounts would need admin access, and subscriber
 * rows would not be useful here: they carry no content and no verifiable identity.
 *
 * IDEMPOTENT AND RESUMABLE
 *
 * Every API page is cached on disk before it is parsed, keyed by endpoint and page number. A
 * re-run reads the cache and makes no network requests; `--refresh` ignores it. That makes the
 * extraction cheap to repeat, which matters because it will be run again before the migration is
 * final, and it makes a partial run recoverable rather than something to start over.
 *
 * Usage:
 *   node src/import/wordpress.ts              # use the cache, fetch only what is missing
 *   node src/import/wordpress.ts --refresh    # ignore the cache and fetch everything again
 *   node src/import/wordpress.ts --binaries   # also download media into data/media/ozikoro-wp
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');

export const WP_ORIGIN = 'https://ozikoro.com';
export const WP_API = `${WP_ORIGIN}/wp-json/wp/v2`;

/** Extracted metadata. Tracked: it is the migration's source of record. */
export const OUT_DIR = join(REPO, 'data', 'ozikoro-wp');
/** Raw API responses. Ignored: large, and reproducible from the API. */
export const CACHE_DIR = join(OUT_DIR, '.cache');
/** Media binaries. Ignored: they belong in object storage, not in Git. */
export const MEDIA_DIR = join(REPO, 'data', 'media', 'ozikoro-wp');

const USER_AGENT = 'OzikoroArchiveMigration/1.0 (+https://ozikoro.com; archive preservation)';

// ---------------------------------------------------------------------------
// HTTP with a disk cache
// ---------------------------------------------------------------------------

interface FetchOptions {
  refresh?: boolean;
  /** Retries on a transient failure. The API is on shared hosting and does blip. */
  attempts?: number;
}

async function cachedFetchJson(
  url: string,
  cacheKey: string,
  options: FetchOptions = {}
): Promise<{ body: unknown; headers: Headers; fromCache: boolean }> {
  const cachePath = join(CACHE_DIR, `${cacheKey}.json`);

  if (!options.refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      return { body: cached.body, headers: new Headers(cached.headers), fromCache: true };
    } catch {
      // No cache entry, or an unreadable one. Fetch it.
    }
  }

  const attempts = options.attempts ?? 4;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(45_000),
      });

      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }

      const body = await response.json();
      const headers: Record<string, string> = {};
      for (const key of ['x-wp-total', 'x-wp-totalpages']) {
        const value = response.headers.get(key);
        if (value) headers[key] = value;
      }

      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify({ url, fetchedAt: new Date().toISOString(), headers, body }));
      return { body, headers: new Headers(headers), fromCache: false };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        // Backoff: 1s, 2s, 4s. Shared hosting punishes enthusiasm.
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${attempts} attempts: ${String(lastError)}`);
}

interface Page<T> {
  items: T[];
  total: number;
  totalPages: number;
}

/** Walk every page of a collection endpoint. */
async function fetchAllPages<T>(
  endpoint: string,
  params: Record<string, string>,
  options: FetchOptions = {},
  onProgress?: (fetched: number, total: number) => void
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const search = new URLSearchParams({ ...params, page: String(page), per_page: '100' });
    const url = `${WP_API}/${endpoint}?${search.toString()}`;
    const { body, headers } = await cachedFetchJson(url, `${endpoint}/page-${page}`, options);

    if (!Array.isArray(body)) {
      throw new Error(`${endpoint} page ${page} did not return an array`);
    }

    items.push(...(body as T[]));

    const headerTotalPages = Number(headers.get('x-wp-totalpages') ?? '1');
    const headerTotal = Number(headers.get('x-wp-total') ?? String(body.length));
    if (Number.isFinite(headerTotalPages) && headerTotalPages > 0) totalPages = headerTotalPages;
    else if ((body as T[]).length < 100) totalPages = page; // last page

    onProgress?.(items.length, Number.isFinite(headerTotal) ? headerTotal : items.length);
    page += 1;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Normalised records
// ---------------------------------------------------------------------------

/** Strip WordPress's rendered-HTML fields down to what the new model stores. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'rendered' in (value as Record<string, unknown>)) {
    const rendered = (value as Record<string, unknown>).rendered;
    return typeof rendered === 'string' ? rendered : '';
  }
  return '';
}

export interface WpArticleRecord {
  wpId: number;
  slug: string;
  url: string;
  title: string;
  /** WordPress `content.rendered`. HTML, preserved verbatim: it is the record. */
  contentHtml: string;
  excerptHtml: string;
  publishedAt: string;
  modifiedAt: string;
  authorId: number;
  featuredMediaId: number;
  categoryIds: number[];
  tagIds: number[];
  /** The Yoast metadata, so canonical URLs and descriptions survive the move. */
  seo: {
    title: string | null;
    description: string | null;
    canonical: string | null;
    schema: unknown;
  };
  wordCount: number;
}

export interface WpMediaRecord {
  wpId: number;
  slug: string;
  url: string;
  sourceUrl: string;
  mimeType: string;
  mediaType: string;
  title: string;
  altText: string;
  captionHtml: string;
  descriptionHtml: string;
  width: number | null;
  height: number | null;
  filesizeBytes: number | null;
  uploadedAt: string;
  authorId: number;
  /** Every generated size, so the right one can be fetched per use. */
  sizes: Record<string, { url: string; width: number; height: number; mimeType: string }>;
}

export interface WpUserRecord {
  wpId: number;
  slug: string;
  name: string;
  description: string;
  url: string;
  avatarUrls: Record<string, string>;
  /** Present on the users endpoint only; not a credential. */
  link: string;
}

export interface WpTaxonomyRecord {
  wpId: number;
  slug: string;
  name: string;
  description: string;
  count: number;
  parent: number;
}

function normaliseArticle(raw: Record<string, unknown>): WpArticleRecord {
  const yoast = (raw.yoast_head_json ?? {}) as Record<string, unknown>;
  const content = textOf(raw.content);
  return {
    wpId: Number(raw.id),
    slug: String(raw.slug ?? ''),
    url: String(raw.link ?? ''),
    title: textOf(raw.title),
    contentHtml: content,
    excerptHtml: textOf(raw.excerpt),
    publishedAt: String(raw.date_gmt ?? raw.date ?? ''),
    modifiedAt: String(raw.modified_gmt ?? raw.modified ?? ''),
    authorId: Number(raw.author ?? 0),
    featuredMediaId: Number(raw.featured_media ?? 0),
    categoryIds: Array.isArray(raw.categories) ? raw.categories.map(Number) : [],
    tagIds: Array.isArray(raw.tags) ? raw.tags.map(Number) : [],
    seo: {
      title: typeof yoast.title === 'string' ? yoast.title : null,
      description: typeof yoast.description === 'string' ? yoast.description : null,
      canonical: typeof yoast.canonical === 'string' ? yoast.canonical : null,
      schema: yoast.schema ?? null,
    },
    // Rough, and only used for display hints. The real count is computed from the text.
    wordCount: content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
  };
}

function normaliseMedia(raw: Record<string, unknown>): WpMediaRecord {
  const details = (raw.media_details ?? {}) as Record<string, unknown>;
  const rawSizes = (details.sizes ?? {}) as Record<string, Record<string, unknown>>;
  const sizes: WpMediaRecord['sizes'] = {};
  for (const [name, size] of Object.entries(rawSizes)) {
    if (typeof size?.source_url !== 'string') continue;
    sizes[name] = {
      url: size.source_url,
      width: Number(size.width ?? 0),
      height: Number(size.height ?? 0),
      mimeType: String(size.mime_type ?? ''),
    };
  }
  return {
    wpId: Number(raw.id),
    slug: String(raw.slug ?? ''),
    url: String(raw.link ?? ''),
    sourceUrl: String(raw.source_url ?? ''),
    mimeType: String(raw.mime_type ?? ''),
    mediaType: String(raw.media_type ?? ''),
    title: textOf(raw.title),
    altText: String(raw.alt_text ?? ''),
    captionHtml: textOf(raw.caption),
    descriptionHtml: textOf(raw.description),
    width: typeof details.width === 'number' ? details.width : null,
    height: typeof details.height === 'number' ? details.height : null,
    filesizeBytes: typeof details.filesize === 'number' ? details.filesize : null,
    uploadedAt: String(raw.date_gmt ?? raw.date ?? ''),
    authorId: Number(raw.author ?? 0),
    sizes,
  };
}

function normaliseUser(raw: Record<string, unknown>): WpUserRecord {
  return {
    wpId: Number(raw.id),
    slug: String(raw.slug ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    url: String(raw.url ?? ''),
    avatarUrls: (raw.avatar_urls ?? {}) as Record<string, string>,
    link: String(raw.link ?? ''),
  };
}

function normaliseTaxonomy(raw: Record<string, unknown>): WpTaxonomyRecord {
  return {
    wpId: Number(raw.id),
    slug: String(raw.slug ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    count: Number(raw.count ?? 0),
    parent: Number(raw.parent ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

async function writeJson(name: string, value: unknown): Promise<number> {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  const text = JSON.stringify(value, null, 2);
  await writeFile(path, text);
  return text.length;
}

async function writeJsonl(name: string, rows: unknown[]): Promise<number> {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  const text = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await writeFile(path, text);
  return text.length;
}

// ---------------------------------------------------------------------------
// Media binaries
// ---------------------------------------------------------------------------

/**
 * Download every media file, keyed by its WordPress id and original filename.
 *
 * Off by default. The bytes do not belong in Git, and an import that silently pulls several
 * gigabytes on first run is a surprise. Object storage is where these end up; this puts them on
 * disk in a gitignored directory so the upload can be done from somewhere the bytes actually
 * exist.
 */
async function downloadBinaries(media: WpMediaRecord[]): Promise<{ downloaded: number; skipped: number; failed: number }> {
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of media) {
    if (!item.sourceUrl) {
      failed += 1;
      continue;
    }
    const name = decodeURIComponent(item.sourceUrl.split('/').pop() ?? `${item.wpId}`);
    const destination = join(MEDIA_DIR, `${item.wpId}-${name}`);

    try {
      const existing = await stat(destination).catch(() => null);
      if (existing && existing.size > 0) {
        skipped += 1;
        continue;
      }

      const response = await fetch(item.sourceUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        failed += 1;
        continue;
      }

      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(await response.arrayBuffer()));
      downloaded += 1;
      if (downloaded % 100 === 0) console.log(`    … ${downloaded} downloaded`);
    } catch (error) {
      failed += 1;
      console.error(`    ! ${item.wpId}: ${String(error).slice(0, 120)}`);
    }
  }

  return { downloaded, skipped, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function extractWordPress(options: FetchOptions & { binaries?: boolean } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const label = (name: string) => console.log(`\n  ${name}`);

  label('posts');
  const posts = await fetchAllPages<Record<string, unknown>>(
    'posts',
    { status: 'publish', _fields: 'id,slug,link,title,content,excerpt,date_gmt,modified_gmt,author,featured_media,categories,tags,yoast_head_json' },
    options,
    (got, total) => process.stdout.write(`\r    ${got}/${total}   `)
  );
  console.log('');

  label('pages');
  const pages = await fetchAllPages<Record<string, unknown>>('pages', { status: 'publish' }, options);

  label('media');
  const media = await fetchAllPages<Record<string, unknown>>(
    'media',
    {},
    options,
    (got, total) => process.stdout.write(`\r    ${got}/${total}   `)
  );
  console.log('');

  label('users');
  const users = await fetchAllPages<Record<string, unknown>>('users', { per_page: '100' }, options);

  label('categories');
  const categories = await fetchAllPages<Record<string, unknown>>('categories', { per_page: '100' }, options);

  label('tags');
  const tags = await fetchAllPages<Record<string, unknown>>(
    'tags',
    { per_page: '100', orderby: 'count', order: 'desc' },
    options,
    (got, total) => process.stdout.write(`\r    ${got}/${total}   `)
  );
  console.log('');

  const articles = posts.map(normaliseArticle);
  const mediaRecords = media.map(normaliseMedia);
  const userRecords = users.map(normaliseUser);
  const categoryRecords = categories.map(normaliseTaxonomy);
  const tagRecords = tags.map(normaliseTaxonomy);
  const pageRecords = pages.map(normaliseArticle);

  const manifest = {
    source: WP_ORIGIN,
    sourceApi: WP_API,
    extractedAt: startedAt,
    completedAt: new Date().toISOString(),
    counts: {
      articles: articles.length,
      pages: pageRecords.length,
      media: mediaRecords.length,
      users: userRecords.length,
      categories: categoryRecords.length,
      tags: tagRecords.length,
    },
    /*
     * Stated in the data itself, not only in a document, because this is the fact a future
     * reader is most likely to assume wrongly.
     */
    notes: [
      'No WordPress credential was used or needed: the REST API read endpoints are public.',
      'WordPress never exposes password hashes, so author identities are imported and credentials are not. Accounts are created through the new platform.',
      'The users endpoint lists only users with published posts, so these are the authors, not every registered subscriber.',
      'Article HTML is preserved verbatim as the source record. Sanitisation happens at render time, not here.',
    ],
  };

  console.log('\n  Writing');
  const sizes: Record<string, number> = {};
  sizes['articles.json'] = await writeJson('articles.json', articles);
  sizes['articles.jsonl'] = await writeJsonl('articles.jsonl', articles);
  sizes['pages.json'] = await writeJson('pages.json', pageRecords);
  sizes['media.json'] = await writeJson('media.json', mediaRecords);
  sizes['users.json'] = await writeJson('users.json', userRecords);
  sizes['categories.json'] = await writeJson('categories.json', categoryRecords);
  sizes['tags.json'] = await writeJson('tags.json', tagRecords);
  sizes['manifest.json'] = await writeJson('manifest.json', manifest);
  for (const [name, bytes] of Object.entries(sizes)) {
    console.log(`    ${name.padEnd(18)} ${(bytes / 1024).toFixed(0)} KB`);
  }

  // A media manifest for the upload step, kept small and separate from the full metadata.
  const mediaManifest = mediaRecords.map((m) => ({
    wpId: m.wpId,
    sourceUrl: m.sourceUrl,
    mimeType: m.mimeType,
    mediaType: m.mediaType,
    title: m.title,
    altText: m.altText,
    width: m.width,
    height: m.height,
    filesizeBytes: m.filesizeBytes,
    uploadedAt: m.uploadedAt,
    authorId: m.authorId,
  }));
  await writeFile(join(OUT_DIR, 'media-manifest.jsonl'), mediaManifest.map((m) => JSON.stringify(m)).join('\n') + '\n');

  const totalBytes = mediaRecords.reduce((sum, m) => sum + (m.filesizeBytes ?? 0), 0);
  console.log(`\n  Media bytes recorded by the API: ${(totalBytes / 1024 / 1024).toFixed(1)} MB across ${mediaRecords.length} files`);

  let binaryResult: { downloaded: number; skipped: number; failed: number } | null = null;
  if (options.binaries) {
    console.log('\n  Downloading media binaries');
    binaryResult = await downloadBinaries(mediaRecords);
    console.log(`    downloaded ${binaryResult.downloaded}, already present ${binaryResult.skipped}, failed ${binaryResult.failed}`);
  } else {
    console.log('  (media binaries not downloaded; pass --binaries to fetch them)');
  }

  return { manifest, articles, mediaRecords, userRecords, categoryRecords, tagRecords, pageRecords, binaryResult };
}

// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const refresh = process.argv.includes('--refresh');
  const binaries = process.argv.includes('--binaries');
  console.log(`WordPress extraction from ${WP_API}${refresh ? ' (refreshing cache)' : ''}`);
  const result = await extractWordPress({ refresh, binaries });
  console.log('\n  Counts');
  for (const [key, value] of Object.entries(result.manifest.counts)) {
    console.log(`    ${key.padEnd(12)} ${value}`);
  }
  console.log(`\n  Output: ${OUT_DIR}\n`);
}
