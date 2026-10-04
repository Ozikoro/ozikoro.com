/**
 * The draft page "Contact Us" — the only WordPress page or post of any status that was not imported.
 *
 * WHY IT WAS MISSING, EXACTLY
 *
 * Two independent gaps, and both had to be present for the record to vanish:
 *
 *   1. `packages/ozikoro/src/import/wordpress.ts` asks the public REST API for
 *      `pages?status=publish`, so the six published pages came across and the one draft did not.
 *   2. The authenticated fetch DID capture it — `data/ozikoro-wp/cms/pages.json` holds row 3591 —
 *      but `exportRecovered` in `recovered.ts` reads only `posts-<status>.json` for its drafts, so a
 *      draft that is a PAGE was never normalised into `drafts.jsonl` and never reached the importer.
 *
 * So the record was never lost from the dump; it was never carried across. This writes it.
 *
 * WHAT STATE IT LANDS IN, AND WHY THAT IS NOT A COMPROMISE
 *
 * `review`, and `published_at` stays NULL. WordPress held it as `draft` and this archive's own
 * importer maps an unpublished record to `review` — "a recovered draft lands as `review`, never
 * `published`: it was never public, and an unpublished draft is not for the public site." The
 * archive has no `draft` status and inventing one for a single row would be a schema change to
 * serve a label. The WordPress status is preserved verbatim in `source_status` on the audit row.
 *
 * NOTHING IS COMPOSED. The body is `content.raw` — the bytes the editor wrote, which the dump holds
 * identically — and not `content.rendered`, which is WordPress's own display pass. That is the choice
 * the OTHER 39 drafts already made: `normaliseDraft` in `recovered.ts` reads the raw field, so the
 * archive's unpublished records hold editor content throughout and a draft that is a page is not
 * given a different rule from a draft that is a post. The rendered form is kept on the audit row,
 * because the difference between the two is what WordPress would have shown a reader.
 *
 * The consequence is stated rather than hidden: `body_html` holds the Contact Form 7 shortcode,
 * because the owner wrote it and stripping it would be editing the record. What the SITE does with
 * it is decided at the address, in `apps/ozikoro/app/contact/route.ts`, which does not render it.
 *
 * RE-RUNNABLE. It upserts on the preserved `wp_post_id` exactly as the importer does, so a second
 * run updates the row it made rather than creating a second one.
 *
 * Usage:
 *   node scripts/import-contact-page.ts --check
 *   node scripts/import-contact-page.ts --apply
 *   node scripts/import-contact-page.ts --check --data-dir .data/scratch-r341-pg
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, createDb } from '@ozituma/db/client';

const WP_PAGE_ID = 3591;
const CMS_PAGES = join(process.cwd(), 'data', 'ozikoro-wp', 'cms', 'pages.json');
const DUMP_EXTRACT = join(process.cwd(), '.scratch', 'recon', 'rows', 'wpc9_posts.jsonl');

/** The row shape the authenticated fetch wrote, restricted to what this script reads. */
interface WpPageRow {
  id: number;
  slug: string;
  status: string;
  link: string;
  author: number;
  date_gmt: string;
  modified_gmt: string;
  title: { raw?: string } | string;
  content: { raw?: string } | string;
  excerpt: { raw?: string } | string;
}

function parseArgs(argv: string[]) {
  const args = { apply: false, dataDir: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--check') args.apply = false;
    else if (argv[i] === '--data-dir') args.dataDir = argv[++i] ?? null;
  }
  return args;
}

/** WordPress's own word count, computed the way the importer computes it — never typed by hand. */
function wordCount(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

/**
 * The editor's own bytes.
 *
 * `content.raw` IS what the importer calls a draft's body: `normaliseDraft` in `recovered.ts` reads
 * the same field for the 39 draft posts, so using `rendered` here would give the one draft that is a
 * page a different rule from every other draft. The rendered form is kept for the audit row.
 */
function rawOf(value: unknown): string {
  if (value && typeof value === 'object' && 'raw' in (value as Record<string, unknown>)) {
    const raw = (value as Record<string, unknown>).raw;
    return typeof raw === 'string' ? raw : '';
  }
  return typeof value === 'string' ? value : '';
}

/** WordPress's display pass over the same content, which is what a reader of the old site saw. */
function renderedOf(value: unknown): string {
  if (value && typeof value === 'object' && 'rendered' in (value as Record<string, unknown>)) {
    const rendered = (value as Record<string, unknown>).rendered;
    return typeof rendered === 'string' ? rendered : '';
  }
  return typeof value === 'string' ? value : '';
}

/**
 * The published address this page will occupy if it is ever published, from the slug.
 *
 * Deliberately NOT `link`: WordPress reports an unpublished page's link as `/?page_id=3591`,
 * which is a query string and not an address, and the importer's `legacyPath` already reduces
 * that case to `/<slug>/`. The same rule, stated here so the two agree.
 */
function legacyPath(row: WpPageRow): string {
  try {
    const parsed = new URL(row.link);
    if (parsed.pathname === '/' || parsed.pathname === '') return `/${row.slug}/`;
    return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  } catch {
    return `/${row.slug}/`;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = await createDb(args.dataDir ? { dataDir: args.dataDir } : {});

  const pages = JSON.parse(await readFile(CMS_PAGES, 'utf8')) as WpPageRow[];
  const page = pages.find((p) => p.id === WP_PAGE_ID);
  if (!page) throw new Error(`no page ${WP_PAGE_ID} in ${CMS_PAGES}`);

  const rawContent = rawOf(page.content);
  const renderedContent = renderedOf(page.content);
  const rawTitle = rawOf(page.title);
  const renderedTitle = renderedOf(page.title);
  const rawExcerpt = rawOf(page.excerpt);

  /*
   * CROSS-CHECKED AGAINST THE DUMP, BECAUSE TWO SOURCES THAT DISAGREE MUST NOT BE RECONCILED BY
   * PICKING ONE. `wpc9_posts` is the record of what the database held; the REST response is the
   * record of what the API served. For the body they agree exactly — the check is here so that a
   * future re-fetch that changes the content stops this rather than silently overwriting the row.
   */
  let dumpContent: string | null = null;
  try {
    const lines = (await readFile(DUMP_EXTRACT, 'utf8')).split('\n');
    for (const line of lines) {
      if (!line) continue;
      const row = JSON.parse(line) as { ID: number; post_content?: string };
      if (row.ID === WP_PAGE_ID) { dumpContent = row.post_content ?? ''; break; }
    }
  } catch {
    dumpContent = null;
  }

  if (dumpContent !== null && dumpContent !== rawContent) {
    throw new Error(
      `the dump's post_content for page ${WP_PAGE_ID} and the REST content.raw differ ` +
        `(${dumpContent.length} vs ${rawContent.length} bytes). Refusing to choose one: read both and ` +
        'decide by hand.'
    );
  }
  const title = rawTitle || renderedTitle;

  const existing = await db.one<{ id: number; slug: string; status: string; is_page: boolean; body_html: string }>(
    `select id, slug, status, is_page, body_html from ozikoro_article where wp_post_id = $1`,
    [WP_PAGE_ID]
  );

  const author = await db.one<{ id: number; display_name: string }>(
    `select c.id, c.display_name from ozikoro_contributor c where c.wp_user_id = $1`,
    [page.author]
  );

  const slugTaken = await db.one<{ id: number; wp_post_id: number | null }>(
    `select id, wp_post_id from ozikoro_article where slug = $1`,
    [page.slug]
  );
  if (slugTaken && Number(slugTaken.wp_post_id) !== WP_PAGE_ID) {
    throw new Error(
      `the slug "${page.slug}" is already held by article ${slugTaken.id} (wp ${slugTaken.wp_post_id}). ` +
        'Refusing to move it: an address that is already published belongs to the record that holds it.'
    );
  }

  console.log(`\n  Page ${WP_PAGE_ID}  "${title}"  WordPress status "${page.status}"`);
  console.log(`  Slug          ${page.slug}   legacy address ${legacyPath(page)}`);
  console.log(`  Author        wp user ${page.author} -> ${author ? `${author.display_name} (contributor ${author.id})` : 'NO CONTRIBUTOR'}`);
  console.log(`  Words         ${wordCount(rawContent)}  (the reconciliation recorded 200)`);
  console.log(`  Body bytes    ${rawContent.length} raw · ${renderedContent.length} rendered`);
  console.log(`  Cross-check   dump post_content ${dumpContent === null ? 'not available' : 'IDENTICAL to content.raw'}`);
  console.log(`  Shortcode     ${rawContent.includes('[contact-form-7') ? 'present in content.raw (the owner wrote it; kept)' : 'absent'}`);
  console.log(`  Cluster       ${args.dataDir ?? '.data/pg (default)'}`);
  console.log(`  Existing row  ${existing ? `article ${existing.id}, status ${existing.status}, is_page ${existing.is_page}` : 'none — this is the row that was never written'}`);

  if (!args.apply) {
    console.log('\n  DRY RUN — nothing written. Add --apply to publish this.\n');
    await db.close();
    return;
  }

  const row = await db.one<{ id: number }>(
    `insert into ozikoro_article
       (wp_post_id, slug, legacy_url, title, standfirst, body_html, author_id,
        status, published_at, modified_at, word_count, is_page)
     values ($1, $2, $3, $4, $5, $6, $7, 'review', null, $8, $9, true)
     on conflict (wp_post_id) do update set
       slug = excluded.slug,
       legacy_url = excluded.legacy_url,
       title = excluded.title,
       standfirst = excluded.standfirst,
       body_html = excluded.body_html,
       author_id = excluded.author_id,
       status = excluded.status,
       published_at = excluded.published_at,
       modified_at = excluded.modified_at,
       word_count = excluded.word_count,
       is_page = excluded.is_page,
       updated_at = now()
     returning id`,
    [
      WP_PAGE_ID,
      page.slug,
      legacyPath(page),
      title,
      rawExcerpt || null,
      rawContent,
      author?.id ?? null,
      new Date(`${page.modified_gmt}Z`).toISOString(),
      wordCount(rawContent),
    ]
  );
  if (!row) throw new Error('upsert returned no row');
  const articleId = Number(row.id);

  /*
   * THE AUDIT ROW. `actor_id` is null and the actor is named in the note: this is a scripted
   * reconciliation, not an editorial decision, and the audit read-back is written to surface an
   * unattributed change rather than hide it. `source_status` carries WordPress's own word for the
   * state, so "it was a draft" is a fact on the row and not a claim in a document.
   */
  await db.query(
    `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
     values ('ozikoro_article', $1, 'backfill_contact_draft', $2::jsonb, $3::jsonb, null, $4)`,
    [
      articleId,
      existing
        ? JSON.stringify({ existed: true, status: existing.status, body_bytes: existing.body_html.length })
        : JSON.stringify({ existed: false, reason: 'the public REST import asked for pages?status=publish and the recovered export read only posts-<status>.json' }),
      JSON.stringify({
        wp_post_id: WP_PAGE_ID,
        slug: page.slug,
        title,
        source_status: page.status,
        status: 'review',
        published_at: null,
        is_page: true,
        body_bytes: rawContent.length,
        rendered_bytes: renderedContent.length,
        word_count: wordCount(rawContent),
        legacy_url: legacyPath(page),
        author_contributor_id: author?.id ?? null,
        content_sha256: (await import('node:crypto')).createHash('sha256').update(rawContent).digest('hex'),
      }),
      'Scripted reconciliation backfill by DSH Agent (round 341), no signed-in actor. Imports WordPress page 3591, the only page or post of any status that was not carried across, at the state WordPress held it in. The body is the record\'s own text, verbatim; nothing was composed.',
    ]
  );

  const written = await db.one<Record<string, unknown>>(
    `select id, wp_post_id, slug, title, status, is_page, word_count, published_at, legacy_url
       from ozikoro_article where id = $1`,
    [articleId]
  );
  console.log('\n  THE ROW, AS WRITTEN');
  console.log(JSON.stringify(written, null, 2));
  console.log('\n  Audit row written. The form shortcode and the social links are in the body verbatim;' +
    '\n  what `/contact/` does with them is decided in apps/ozikoro/app/contact/route.ts.\n');
  await db.close();
}

await main();
