/**
 * The part of the WordPress archive the public REST API will not serve.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The first extraction used the unauthenticated REST API, which is genuinely public — for published
 * posts. Measured on the live site, unauthenticated:
 *
 *     status=publish   ->  200, x-wp-total 1051
 *     status=draft     ->  400 rest_invalid_param
 *     status=any       ->  400 rest_invalid_param
 *     users            ->  200, x-wp-total 11
 *
 * So the 1,051 published articles came across and the drafts did not, and the user list was the
 * authors of published work rather than every registered account. That is a limitation of the
 * public route, not of WordPress: seen through an authenticated session the same endpoints answer
 * `status=draft` with `x-wp-total 39` and the user list with `x-wp-total 15`.
 *
 * HOW THE AUTHENTICATED ROWS GOT HERE
 *
 * `wp-login.php` is behind a Cloudflare JavaScript challenge on the Cloudflare edge and at the
 * origin address alike, so a plain HTTP client is refused before it can POST anything. Real Chrome
 * runs the challenge, so the extraction was driven through the DevTools protocol: Chrome signed in
 * as the owner, and the REST calls were then made from inside the authenticated page, where the
 * session cookie and the REST nonce already apply. Every call was a GET.
 *
 * The raw responses are kept under `data/ozikoro-wp/cms/` exactly as WordPress returned them,
 * including the request that produced them, so the normalised records below can be checked against
 * the source rather than taken on trust.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No password hashes: WordPress never exposes them through any endpoint, authenticated or not, and
 * this import does not look for them. What crosses over is the identity — display name, email,
 * slug, registration date and role. No account is created and no credential is invented.
 *
 * NOTHING IS WRITTEN BACK TO THE LIVE SITE. Every request in this path was a GET.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
// The write path's own slug rule. Imported, never copied — see the note beside `normaliseDraft`.
import { slugForTitle } from '../authoring.ts';
import { OUT_DIR, WP_API, WP_ORIGIN } from './wordpress.ts';

/** Raw authenticated REST responses, as WordPress returned them. */
export const CMS_DIR = join(OUT_DIR, 'cms');

/** WordPress statuses that are not published work for the public site. */
export const UNPUBLISHED_STATUSES = ['draft', 'pending', 'private', 'future'] as const;
export type UnpublishedStatus = (typeof UNPUBLISHED_STATUSES)[number];

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/**
 * A draft, in the same shape as an entry of `articles.json`, plus the fields that only exist for
 * unpublished work.
 *
 * Keeping the published shape means the archive's existing import path can carry these without a
 * second, parallel code path — the surface is the same and only `status` differs.
 */
export interface WpDraftRecord {
  wpId: number;
  slug: string;
  url: string;
  title: string;
  contentHtml: string;
  excerptHtml: string;
  /**
   * When WordPress last recorded a date for the post. A draft has no publication date — it was
   * never published — so this is the date the record carries, and the import maps it to the row's
   * date without pretending the piece went live.
   */
  date: string;
  modifiedAt: string;
  authorId: number;
  featuredMediaId: number;
  categoryIds: number[];
  tagIds: number[];
  seo: { title: string | null; description: string | null; canonical: string | null; schema: unknown };
  wordCount: number;
  /** The WordPress status verbatim: `draft`, `pending`, `private` or `future`. */
  wpStatus: UnpublishedStatus;
  /** WordPress `post_modified_gmt`, kept so the editorial queue can order by recency. */
  modifiedGmt: string;
  /** The post's own `comment_status`, preserved rather than assumed. */
  commentStatus: string;
}

/** A registered account. Identity only — there is no credential here and there cannot be one. */
export interface WpAccountRecord {
  wpId: number;
  username: string;
  slug: string;
  name: string;
  firstName: string;
  lastName: string;
  nickname: string;
  /** WordPress `user_email`. Deliberately carried: it is the identity, not a secret. */
  email: string;
  url: string;
  description: string;
  locale: string;
  /** e.g. `administrator`, `editor`, `author`, `contributor`, `subscriber`. */
  roles: string[];
  /** WordPress `registered_date`, exactly as returned. */
  registeredDate: string;
  avatarUrls: Record<string, string>;
  link: string;
}

/** One `wp_postmeta` row, as the API exposes it under `meta`. */
export interface WpPostMetaRow {
  postId: number;
  metaKey: string;
  metaValue: unknown;
}

/** One `wp_usermeta` row for the capabilities and role keys the archive keeps. */
export interface WpUserMetaRow {
  userId: number;
  metaKey: string;
  metaValue: unknown;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/*
 * THE SLUG RULE IS THE BACK OFFICE'S OWN, IMPORTED RATHER THAN RE-IMPLEMENTED.
 *
 * This file used to carry a local `slugFromTitle`. It was not wrong about any of the 39 titles it
 * ran on, and that is exactly what made it dangerous: **it is a second rule beside
 * `authoring.ts`'s, and two rules that agree today drift apart the first time one is edited.**
 * `ozikoro_article.slug` is `not null unique` across posts AND pages, and both are served from the
 * same root address by `app/[slug]/route.ts`, so a draft address and an address an editor types are
 * one namespace and must be minted by one rule. The rule lives in `authoring.ts` (`slugForTitle`),
 * which is the write path; this import calls it.
 *
 * Measured before the swap, so the change is known to be a no-op on the data rather than hoped to
 * be: for the 36 drafts WordPress gave no slug to, the old local rule and `slugForTitle` produce
 * the SAME string. The three that differ — 5839, 5855, 5867 — are the three that arrived with a real
 * WordPress slug, and a real slug is never re-derived by either rule. So all 39 addresses are
 * unchanged by this edit; only the code that produces them moved to one place.
 */

/** Read a WordPress `{ raw, rendered }` value, preferring the editable form. */
function fieldValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.raw === 'string' && v.raw !== '') return v.raw;
    if (typeof v.rendered === 'string') return v.rendered;
  }
  return '';
}

/**
 * The BODY, in the form the 1,057 published records hold — WordPress's `rendered`, not `raw`.
 *
 * ⚠️ **THIS IS NOT A STYLE CHOICE, AND PREFERRING `raw` PUT LITERAL SHORTCODE TEXT IN FRONT OF A READER.**
 *
 * The public route the archive was first extracted through exposes only `content.rendered`, so all 1,057
 * published bodies are the RENDERED form: WordPress's own renderer has already expanded `[caption]`,
 * `[embed]` and the rest into `<figure>`/`<img>` markup. **The served-article pipeline therefore does not
 * strip shortcodes** — `apps/ozikoro/app/[slug]/route.ts` runs `rewriteBodyImages` → `sanitiseArchiveHtml`
 * → `tidyBody`, and only the ARCHIVE's own read path (`prepareArchiveHtml`) calls `stripShortcodes`. It has
 * never needed to, because nothing it served had any.
 *
 * A draft does. WordPress hands drafts over through the authenticated route, where `context=edit` exposes
 * BOTH `raw` and `rendered`, and this file preferred `raw`. Measured on draft 10779 through the exact
 * pipeline the article page runs, with only the media resolver stubbed:
 *
 *     raw       ->  3 literal `[caption id="attachment_10770" …]` shortcodes survive to the page
 *     rendered  ->  0 shortcodes; 3 <figure> elements carrying the images, which the pipeline rewrites
 *
 * So a draft stored from `raw` would, on the day it is published, print its own shortcode syntax where the
 * photograph should be — on the one route a reader actually opens. The archive stores what WordPress
 * serves, "verbatim, sanitised at render time"; `rendered` is what WordPress serves.
 *
 * The TITLE deliberately still comes from `raw` (see `fieldValue`): a slug is derived from it, and
 * `title.rendered` carries HTML entities (`&#038;`) whose digits would end up in the address.
 */
function renderedBody(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.rendered === 'string' && v.rendered !== '') return v.rendered;
    if (typeof v.raw === 'string') return v.raw;
  }
  return '';
}

function wordCountOf(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : [];
}

/**
 * One authenticated post row, as returned by `/wp/v2/posts?context=edit`, into a draft record.
 *
 * The Yoast fields arrive under `meta` on the authenticated route, where the public route exposed
 * them as a rendered `yoast_head_json`. Both are read, so a record normalises the same either way.
 */
export function normaliseDraft(raw: Record<string, unknown>): WpDraftRecord {
  const meta = (raw.meta ?? {}) as Record<string, unknown>;
  const title = fieldValue(raw.title);
  // The body is the RENDERED form, so that it is the same shape as the 1,057 published bodies. See
  // `renderedBody` for the measurement that makes this load-bearing rather than tidy.
  const content = renderedBody(raw.content);
  const wpId = Number(raw.id);
  const rawSlug = String(raw.slug ?? '').trim();
  const status = String(raw.status ?? 'draft') as UnpublishedStatus;

  const metaText = (key: string): string | null => {
    const v = meta[key];
    return typeof v === 'string' && v !== '' ? v : null;
  };

  return {
    wpId,
    /*
     * A REAL WORDPRESS SLUG IS KEPT VERBATIM; ONLY A MISSING ONE IS DERIVED.
     *
     * 36 of the 39 drafts have no slug — WordPress mints it at first save of the address — and those
     * get one from the title by the back office's own `slugForTitle`. Three (5839, 5855, 5867) DO
     * carry a slug, and re-deriving it would silently move an address WordPress had already assigned.
     * `authoring.ts` states the same rule for the editor's typed slug: "A real slug is never touched".
     *
     * `draft-<id>` is the archive's own placeholder for a piece with no title to derive one from
     * (`createPiece` writes exactly that), not a new fallback invented here.
     */
    slug: rawSlug || slugForTitle(title) || `draft-${wpId}`,
    url: String(raw.link ?? ''),
    title,
    contentHtml: content,
    excerptHtml: fieldValue(raw.excerpt),
    date: String(raw.date_gmt ?? raw.date ?? ''),
    modifiedAt: String(raw.modified ?? ''),
    authorId: Number(raw.author ?? 0),
    featuredMediaId: Number(raw.featured_media ?? 0),
    categoryIds: asNumberArray(raw.categories),
    tagIds: asNumberArray(raw.tags),
    seo: {
      title: metaText('_yoast_wpseo_title'),
      description: metaText('_yoast_wpseo_metadesc'),
      canonical: null,
      schema: null,
    },
    wordCount: wordCountOf(content),
    wpStatus: status,
    modifiedGmt: String(raw.modified_gmt ?? raw.modified ?? ''),
    commentStatus: String(raw.comment_status ?? ''),
  };
}

/** One authenticated user row into an account record. No credential is read or kept. */
export function normaliseAccount(raw: Record<string, unknown>): WpAccountRecord {
  return {
    wpId: Number(raw.id),
    username: String(raw.username ?? ''),
    slug: String(raw.slug ?? ''),
    name: String(raw.name ?? ''),
    firstName: String(raw.first_name ?? ''),
    lastName: String(raw.last_name ?? ''),
    nickname: String(raw.nickname ?? ''),
    email: String(raw.email ?? ''),
    url: String(raw.url ?? ''),
    description: String(raw.description ?? ''),
    locale: String(raw.locale ?? ''),
    roles: Array.isArray(raw.roles) ? raw.roles.map(String) : [],
    registeredDate: String(raw.registered_date ?? ''),
    avatarUrls: (raw.avatar_urls ?? {}) as Record<string, string>,
    link: String(raw.link ?? ''),
  };
}

/**
 * The account in the archive's own `users.json` shape.
 *
 * `users.json` is read by the archive import as the source of contributor attribution, so the extra
 * hidden accounts have to arrive in that same shape or the import will not see them. The identity
 * fields that shape does not carry are written alongside it, in `accounts.json`, rather than being
 * forced into a record type the rest of the pipeline already understands.
 */
export function accountAsUserRow(a: WpAccountRecord): {
  wpId: number;
  slug: string;
  name: string;
  description: string;
  url: string;
  avatarUrls: Record<string, string>;
  link: string;
} {
  return {
    wpId: a.wpId,
    slug: a.slug,
    name: a.name,
    description: a.description,
    url: a.url,
    avatarUrls: a.avatarUrls,
    link: a.link,
  };
}

/** The postmeta rows worth keeping: the Yoast and footnote keys the archive renders or audits. */
export function postMetaRows(drafts: WpDraftRecord[], raw: Record<string, unknown>[]): WpPostMetaRow[] {
  const KEEP = new Set([
    '_yoast_wpseo_title',
    '_yoast_wpseo_metadesc',
    '_yoast_wpseo_focuskw',
    '_yoast_wpseo_canonical',
    'footnotes',
  ]);
  const rows: WpPostMetaRow[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const meta = (raw[i]?.meta ?? {}) as Record<string, unknown>;
    const postId = drafts[i]?.wpId ?? Number(raw[i]?.id);
    for (const [metaKey, metaValue] of Object.entries(meta)) {
      if (!KEEP.has(metaKey)) continue;
      if (metaValue === '' || metaValue === null || metaValue === undefined) continue;
      rows.push({ postId, metaKey, metaValue });
    }
  }
  return rows;
}

/**
 * The `wp_usermeta` rows worth keeping, in the shape WordPress actually stores them.
 *
 * `wp_capabilities` is WordPress's role map: on a real install its value serialises as
 * `a:1:{s:13:"administrator";b:1;}` — a map whose key is the role name, not the expanded capability
 * list. The REST API hands back the *expanded* list, so writing that straight through would put
 * something in the table that WordPress never held there. The role comes from `roles` and is stored
 * as the map WordPress uses, with the legacy numeric level alongside it.
 */
export function userMetaRows(accounts: WpAccountRecord[]): WpUserMetaRow[] {
  const LEVEL: Record<string, number> = {
    administrator: 10,
    editor: 7,
    author: 2,
    contributor: 1,
    subscriber: 0,
  };
  const rows: WpUserMetaRow[] = [];
  for (const a of accounts) {
    if (a.roles.length === 0) continue;
    const roleMap: Record<string, boolean> = {};
    for (const role of a.roles) roleMap[role] = true;
    rows.push({ userId: a.wpId, metaKey: 'wp_capabilities', metaValue: roleMap });
    const level = LEVEL[a.roles[0]!];
    if (typeof level === 'number') {
      rows.push({ userId: a.wpId, metaKey: 'wp_user_level', metaValue: level });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(CMS_DIR, name), 'utf8')) as T;
}

async function writeJsonl(name: string, rows: unknown[]): Promise<number> {
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
  await writeFile(join(OUT_DIR, name), text);
  return Buffer.byteLength(text);
}

async function writeJson(name: string, value: unknown): Promise<number> {
  const text = JSON.stringify(value, null, 2);
  await writeFile(join(OUT_DIR, name), text);
  return Buffer.byteLength(text);
}

export interface RecoveredExport {
  drafts: number;
  accounts: number;
  postMeta: number;
  userMeta: number;
  byStatus: Record<string, number>;
  byAuthor: Record<string, number>;
}

/**
 * Normalise the authenticated raw responses into the archive's record shapes and write them out.
 *
 * The published `articles.json` is not rewritten: those 1,051 records came from the public route and
 * are unchanged by this. This adds the records that route could not reach.
 */
export async function exportRecovered(): Promise<RecoveredExport> {
  await mkdir(OUT_DIR, { recursive: true });

  const rawDrafts: Record<string, unknown>[] = [];
  const byStatus: Record<string, number> = {};
  for (const status of UNPUBLISHED_STATUSES) {
    let page: Record<string, unknown>[] = [];
    try {
      page = await loadJson<Record<string, unknown>[]>(`posts-${status}.json`);
    } catch {
      // A status the site holds none of is not an error; it is a zero.
      byStatus[status] = 0;
      continue;
    }
    byStatus[status] = page.length;
    rawDrafts.push(...page);
  }

  let rawUsers: Record<string, unknown>[] = [];
  try {
    rawUsers = await loadJson<Record<string, unknown>[]>('users.json');
  } catch {
    rawUsers = [];
  }

  const drafts = rawDrafts.map(normaliseDraft);
  // Sort by WordPress id so the file is stable across runs and a diff means a real change.
  drafts.sort((a, b) => a.wpId - b.wpId);
  const accounts = rawUsers.map(normaliseAccount).sort((a, b) => a.wpId - b.wpId);

  const byAuthor: Record<string, number> = {};
  for (const d of drafts) byAuthor[String(d.authorId)] = (byAuthor[String(d.authorId)] ?? 0) + 1;

  const postMeta = postMetaRows(drafts, rawDrafts);
  const userMeta = userMetaRows(accounts);

  await writeJson('drafts.json', drafts);
  await writeJsonl('drafts.jsonl', drafts);
  await writeJson('accounts.json', accounts);
  await writeJsonl('accounts.jsonl', accounts);
  await writeJsonl('postmeta.jsonl', postMeta);
  await writeJsonl('usermeta.jsonl', userMeta);
  // In the shape the archive import already reads, so the hidden accounts are picked up too.
  await writeJson('users.json', accounts.map(accountAsUserRow));

  const manifest = {
    source: WP_API,
    route: 'authenticated REST via a real browser session (Cloudflare challenge passed); GET only',
    extractedAt: new Date().toISOString(),
    counts: {
      drafts: drafts.length,
      byStatus,
      accounts: accounts.length,
      postMeta: postMeta.length,
      userMeta: userMeta.length,
    },
    byAuthor,
    notes: [
      'The public REST API refuses status=draft and status=any with rest_invalid_param, and its users endpoint lists only users with published posts.',
      'These records come from an authenticated session. Nothing was written to the live site; every request was a GET.',
      'WordPress exposes no password hashes through any endpoint, so account identities are imported and credentials are not. No account is created here.',
      'Drafts are imported as drafts, never published and never in review: an unpublished draft is not for the public site, and its own WordPress status says what it is.',
      'A draft normally has no slug — WordPress mints it at publication — so a missing one is derived from the title by authoring.ts slugForTitle, the same rule the back office uses. A slug WordPress did give is kept verbatim. The WordPress id is preserved either way.',
    ],
  };
  await writeJson('cms-manifest.json', manifest);

  return {
    drafts: drafts.length,
    accounts: accounts.length,
    postMeta: postMeta.length,
    userMeta: userMeta.length,
    byStatus,
    byAuthor,
  };
}

if (process.argv[1] && process.argv[1].endsWith('recovered.ts')) {
  const r = await exportRecovered();
  console.log(`\n  Recovered export`);
  console.log(`    drafts    ${r.drafts}   by status ${JSON.stringify(r.byStatus)}`);
  console.log(`    accounts  ${r.accounts}`);
  console.log(`    postmeta  ${r.postMeta}`);
  console.log(`    usermeta  ${r.userMeta}`);
  console.log(`    by author ${JSON.stringify(r.byAuthor)}`);
}
