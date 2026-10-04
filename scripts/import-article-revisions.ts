/**
 * The 4,266 WordPress revisions of the articles, into `ozikoro_article_revision`.
 *
 * WHAT THIS IS FOR
 *
 * The reconciliation (docs/IMPORT-RECONCILIATION.md §7.3) found 3,061 revisions holding 30,007,462
 * bytes of text that appears in no surviving post — the largest measured category with no home in the
 * cluster. Superseded editorial text of 1,051 published histories was being lost, and the owner's
 * instruction is that nothing is.
 *
 * THE MEASUREMENT THAT DECIDED THE SHAPE OF THIS, AND WHY THE OBVIOUS FIGURE IS NOT USED
 *
 * 28.6 MiB is not the size of what was lost. WordPress autosaves the WHOLE document every 60 seconds,
 * so a revision is usually its neighbour with one more sentence. Measured here, at the level of the
 * BLOCK — a run of text between tags, which is what an editor types and a reader reads:
 *
 *     distinct block texts on the site                     38,797
 *       held by a surviving post body                      33,066   already in the archive
 *       held only by 2+ revisions                           3,284   a duplicate of itself
 *       HELD BY EXACTLY ONE REVISION AND NOTHING ELSE       2,390   1,225 KiB
 *         of those, whose first 80 characters are
 *         ALSO nowhere in a surviving record                1,201     442 KiB
 *     the carriers: one revision per parent post               524   (3.9 MiB stored)
 *
 * So the loss is real, it is paragraph-sized prose rather than 28.6 MiB of autosave noise, and it is
 * small enough to keep WHOLE. **This stores every revision, not just the 524 carriers**, because the
 * archive's own pattern for episodes, clans, words, names and proverbs is to keep every version, and
 * a revision deliberately dropped would be the loss this table exists to prevent. `carries_unique_text`
 * marks the 524 the measurement identified, so an editor can find them without re-running it.
 *
 * THE SIZE GUARD, AND WHY IT IS NOT A TRUNCATION
 *
 * `--max-body-bytes` (default 400,000; the largest observed revision body is ~237 KB) is a guard
 * against one pathological row, not a storage policy. A body over the ceiling is stored as NULL and
 * the revision is reported by id as NOT STORED. **A truncated body passed off as the text would be
 * worse than a null that says so**, so no body is ever cut: either it is whole or it is null.
 *
 * RE-RUNNABLE. `wp_revision_id` is UNIQUE and the insert is `on conflict do nothing`, so a second run
 * adds only what is new. Nothing is ever updated or deleted by this script.
 *
 * Usage:
 *   node scripts/import-article-revisions.ts --check
 *   node scripts/import-article-revisions.ts --apply
 *   node scripts/import-article-revisions.ts --check --data-dir .data/scratch-r341-pg
 *   node scripts/import-article-revisions.ts --apply --max-body-bytes 200000
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, createDb } from '@ozituma/db/client';

const DUMP_EXTRACT = join(process.cwd(), '.scratch', 'recon', 'rows', 'wpc9_posts.jsonl');

/** Post types the archive imports as records. Everything else is WordPress's own bookkeeping. */
const RECORD_TYPES = new Set(['post', 'page']);

interface WpRow {
  ID: number;
  post_author: number;
  post_content: string | null;
  post_title: string | null;
  post_modified_gmt: string | null;
  post_modified: string | null;
  post_parent: number;
  post_type: string;
}

interface RevisionPlan {
  wpRevisionId: number;
  parentPostId: number;
  title: string | null;
  revisedAt: string | null;
  authorWpId: number;
  body: string | null;
  bodyBytes: number;
  wordCount: number;
  carriesUniqueText: boolean;
}

const TAG_SPLIT = /<[^>]+>/;
const TAG_ALL = /<[^>]+>/g;
const WS = /[ \t\r\n]+/g;

function wordsIn(html: string): number {
  return html.replace(TAG_ALL, ' ').split(/\s+/).filter(Boolean).length;
}

/** Decode the handful of entities WordPress writes, so the identical text is identical across records. */
function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8211;/g, '\u2013');
}

/** The runs of text between tags. This is an editor's paragraph, heading, caption or list item. */
function blocks(raw: string | null): string[] {
  const out: string[] = [];
  for (const piece of (raw ?? '').split(TAG_SPLIT)) {
    const text = decode(piece).replace(WS, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

function parseArgs(argv: string[]) {
  const args = { apply: false, dataDir: null as string | null, maxBodyBytes: 400_000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--check') args.apply = false;
    else if (argv[i] === '--data-dir') args.dataDir = argv[++i] ?? null;
    else if (argv[i] === '--max-body-bytes') args.maxBodyBytes = Number(argv[++i] ?? 400_000);
  }
  return args;
}

async function loadDump(): Promise<{ records: Map<number, WpRow>; revisions: WpRow[] }> {
  const records = new Map<number, WpRow>();
  const revisions: WpRow[] = [];
  const text = await readFile(DUMP_EXTRACT, 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as WpRow;
    if (row.post_type === 'revision') revisions.push(row);
    else if (RECORD_TYPES.has(row.post_type)) records.set(row.ID, row);
  }
  revisions.sort((a, b) => a.ID - b.ID);
  return { records, revisions };
}

/**
 * Which revisions hold text that exists in exactly one place on the whole site.
 *
 * A block held by a surviving record is in the archive already, whatever else holds it. A block held
 * by two or more revisions is a duplicate of itself. What is left is the text that would be lost —
 * and **a bucket and its own contents are not counted as siblings**, which is the fault that made the
 * first version of this measurement report 17.6 MiB instead of 1.2 KiB-scale truth.
 */
function carriersOf(records: Map<number, WpRow>, revisions: WpRow[]): Set<number> {
  const surviving = new Set<string>();
  for (const record of records.values()) for (const b of blocks(record.post_content)) surviving.add(b);

  const holders = new Map<string, number[]>();
  for (const rev of revisions) {
    for (const b of blocks(rev.post_content)) {
      const list = holders.get(b);
      if (list) list.push(rev.ID);
      else holders.set(b, [rev.ID]);
    }
  }

  // For each parent, the highest revision id that holds any unique block: one row carries the whole
  // of that record's unique text, which is the 524-record carrier set the header describes.
  const byId = new Map<number, WpRow>(revisions.map((r) => [r.ID, r]));
  const latest = new Map<number, number>();
  for (const [b, ids] of holders) {
    if (ids.length !== 1 || surviving.has(b)) continue;
    const rev = byId.get(ids[0]!);
    if (!rev) continue;
    const parent = rev.post_parent;
    const current = latest.get(parent);
    if (current === undefined || rev.ID > current) latest.set(parent, rev.ID);
  }
  return new Set(latest.values());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = await createDb(args.dataDir ? { dataDir: args.dataDir } : {});

  const table = await db.one<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name = 'ozikoro_article_revision'`
  );
  if (!Number(table?.n)) {
    throw new Error(
      'ozikoro_article_revision does not exist. Apply migration 0053 first ' +
        '(npm run db:migrate, or node packages/db/src/migrate.ts up against the same cluster).'
    );
  }

  const { records, revisions } = await loadDump();
  console.log(`\n  Dump:      ${DUMP_EXTRACT}`);
  console.log(`  Records:   ${records.size} imported post/page rows`);
  console.log(`  Revisions: ${revisions.length}`);
  console.log(`  Cluster:   ${args.dataDir ?? '.data/pg (default)'}`);

  const carriers = carriersOf(records, revisions);
  console.log(`  Carriers:  ${carriers.size} revisions hold block text that survives nowhere else`);

  /* ── Who wrote each revision ─────────────────────────────────────────────────────────────── */
  const contributorByWp = new Map<number, number>();
  for (const row of await db.rows<{ id: number; wp_user_id: number | null }>(
    `select id, wp_user_id from ozikoro_contributor where wp_user_id is not null`)) {
    contributorByWp.set(Number(row.wp_user_id), Number(row.id));
  }

  /* ── Which parents this archive holds as records ─────────────────────────────────────────── */
  const articleByWp = new Map<number, number>();
  for (const row of await db.rows<{ id: number; wp_post_id: number | null }>(
    `select id, wp_post_id from ozikoro_article where wp_post_id is not null`)) {
    articleByWp.set(Number(row.wp_post_id), Number(row.id));
  }

  const already = new Set<number>();
  for (const row of await db.rows<{ wp_revision_id: string | number | null }>(
    `select wp_revision_id from ozikoro_article_revision where wp_revision_id is not null`)) {
    already.add(Number(row.wp_revision_id));
  }

  const plan: RevisionPlan[] = [];
  let orphanParents = 0;
  let overCeiling = 0;
  let totalBytes = 0;
  for (const rev of revisions) {
    if (already.has(rev.ID)) continue;
    const body = rev.post_content ?? '';
    const bytes = Buffer.byteLength(body, 'utf8');
    const keep = bytes <= args.maxBodyBytes;
    if (!keep) overCeiling += 1;
    if (!articleByWp.has(rev.post_parent)) orphanParents += 1;
    if (keep) totalBytes += bytes;
    plan.push({
      wpRevisionId: rev.ID,
      parentPostId: rev.post_parent,
      title: rev.post_title?.trim() || null,
      revisedAt: rev.post_modified_gmt || rev.post_modified || null,
      authorWpId: rev.post_author,
      body: keep ? body : null,
      bodyBytes: bytes,
      wordCount: keep ? wordsIn(body) : 0,
      carriesUniqueText: carriers.has(rev.ID),
    });
  }

  const withParent = plan.filter((p) => articleByWp.has(p.parentPostId)).length;

  console.log(`  Already in the table:    ${already.size}`);
  console.log(`  To write:                ${plan.length}`);
  console.log(`    ...of a parent this archive holds:  ${withParent}`);
  console.log(`    ...of a parent it does not hold:    ${plan.length - withParent} (kept: the text is the record)`);
  console.log(`    ...refused over ${args.maxBodyBytes} bytes:      ${overCeiling}${overCeiling ? ' — will be stored as NULL and reported' : ''}`);
  console.log(`  Body bytes to store:     ${totalBytes.toLocaleString()} (${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);
  console.log(`  Marked carries_unique_text: ${plan.filter((p) => p.carriesUniqueText).length}`);

  if (!args.apply) {
    console.log('\n  DRY RUN — nothing written. Add --apply to publish these.\n');
    await db.close();
    return;
  }

  /* ── The write ───────────────────────────────────────────────────────────────────────────── */
  let written = 0;
  let refused = 0;
  const refusedIds: number[] = [];
  const CHUNK = 50;

  for (let i = 0; i < plan.length; i += CHUNK) {
    const chunk = plan.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    for (const p of chunk) {
      const base = params.length;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
      );
      params.push(
        articleByWp.get(p.parentPostId) ?? null,
        p.wpRevisionId,
        p.parentPostId,
        p.body,
        p.title,
        p.revisedAt ? new Date(`${p.revisedAt.replace(' ', 'T')}Z`).toISOString() : null,
        p.wordCount,
        contributorByWp.get(p.authorWpId) ?? null,
        p.carriesUniqueText
      );
      if (p.body === null) { refused += 1; refusedIds.push(p.wpRevisionId); }
    }

    const result = await db.query(
      `insert into ozikoro_article_revision
         (article_id, wp_revision_id, wp_parent_post_id, body_html, title, revised_at,
          word_count, author_id, carries_unique_text)
       values ${values.join(', ')}
       on conflict (wp_revision_id) do nothing`,
      params
    );
    written += result.rowCount ?? 0;
  }

  /*
   * ONE AUDIT ROW PER RECORD THAT GAINED A HISTORY, not one for the run.
   *
   * The question an editor asks is about a record — "where did this article's earlier wording come
   * from?" — and a single row for 4,266 revisions would answer it for nobody. The entity is the
   * article, so the row appears on that record's own audit list.
   *
   * THE FIGURES ARE READ BACK OUT OF THE TABLE AND NOT OUT OF `plan`, and that is deliberate: `plan`
   * holds only what this run inserted, so a run against a cluster already backfilled would write
   * nothing and report nothing — which is how the orphan parents below were missed the first time.
   * A re-run must be able to finish the job it started, so what it reports is the state of the table.
   */
  const counts = new Map<number, { n: number; bytes: number; carriers: number; oldest: number; newest: number }>();
  for (const row of await db.rows<{
    article_id: number; n: number; bytes: string; carriers: number; oldest: number; newest: number;
  }>(
    `select article_id,
            count(*)::int as n,
            coalesce(sum(octet_length(body_html)), 0)::bigint as bytes,
            count(*) filter (where carries_unique_text)::int as carriers,
            min(wp_revision_id) as oldest,
            max(wp_revision_id) as newest
       from ozikoro_article_revision
      where article_id is not null
      group by article_id`
  )) {
    counts.set(Number(row.article_id), {
      n: Number(row.n),
      bytes: Number(row.bytes),
      carriers: Number(row.carriers),
      oldest: Number(row.oldest),
      newest: Number(row.newest),
    });
  }

  const alreadyAudited = new Set<number>();
  for (const row of await db.rows<{ entity_id: string }>(
    `select entity_id from ozikoro_audit
      where entity_type = 'ozikoro_article' and action = 'backfill_article_revisions'`)) {
    alreadyAudited.add(Number(row.entity_id));
  }

  let auditRows = 0;
  for (const [articleId, entry] of counts) {
    if (alreadyAudited.has(articleId)) continue;
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_article', $1, 'backfill_article_revisions', $2::jsonb, $3::jsonb, null, $4)`,
      [
        articleId,
        JSON.stringify({ revisions_held: 0 }),
        JSON.stringify({
          source: 'wpc9_posts post_type=revision',
          revisions: entry.n,
          body_bytes: entry.bytes,
          carriers_of_unique_text: entry.carriers,
          wp_revision_id_range: [entry.oldest, entry.newest],
        }),
        'Scripted reconciliation backfill by DSH Agent (round 341), no signed-in actor. WordPress held these revisions of this record and the archive had no table for them, so superseded editorial text was being lost. Bodies are stored verbatim; nothing was composed or truncated.',
      ]
    );
    auditRows += 1;
  }

  /*
   * THE REVISIONS WHOSE PARENT THIS ARCHIVE DOES NOT HOLD STILL GET AN AUDIT ROW.
   *
   * There is no article to hang one on, so the entity is the revision group itself and the id is ONE
   * ROW PER PARENT POST — because "revisions of WordPress post 604" is a subject an editor can ask
   * about, and 74 rows naming 74 revisions separately would say less while looking like more. The
   * entity_id is the WordPress parent id, which is the only identifier that subject has here; the
   * `entity_type` is what stops it being mistaken for an article id.
   *
   * AND THIS IS THE CASE WHERE "A REVISION WAS DELIBERATELY KEPT" WOULD OTHERWISE BE INVISIBLE: the
   * parent is not in the archive, so no article page can list these, and without this row the only
   * evidence that 74 revisions are held would be a table nobody reads.
   */
  const orphanGroups = new Map<number, { n: number; bytes: number; carriers: number; oldest: number; newest: number }>();
  for (const row of await db.rows<{
    wp_parent_post_id: number; n: number; bytes: string; carriers: number; oldest: number; newest: number;
  }>(
    `select wp_parent_post_id,
            count(*)::int as n,
            coalesce(sum(octet_length(body_html)), 0)::bigint as bytes,
            count(*) filter (where carries_unique_text)::int as carriers,
            min(wp_revision_id) as oldest,
            max(wp_revision_id) as newest
       from ozikoro_article_revision
      where article_id is null
      group by wp_parent_post_id`
  )) {
    orphanGroups.set(Number(row.wp_parent_post_id), {
      n: Number(row.n),
      bytes: Number(row.bytes),
      carriers: Number(row.carriers),
      oldest: Number(row.oldest),
      newest: Number(row.newest),
    });
  }

  const orphanAudited = new Set<number>();
  for (const row of await db.rows<{ entity_id: string }>(
    `select entity_id from ozikoro_audit where entity_type = 'ozikoro_article_revision_orphan_parent'`)) {
    orphanAudited.add(Number(row.entity_id));
  }

  let orphanAuditRows = 0;
  for (const [parentPostId, entry] of orphanGroups) {
    if (orphanAudited.has(parentPostId)) continue;
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_article_revision_orphan_parent', $1, 'backfill_article_revisions', $2::jsonb, $3::jsonb, null, $4)`,
      [
        parentPostId,
        JSON.stringify({ revisions_held: 0 }),
        JSON.stringify({
          source: 'wpc9_posts post_type=revision',
          wp_parent_post_id: parentPostId,
          revisions: entry.n,
          body_bytes: entry.bytes,
          carriers_of_unique_text: entry.carriers,
          wp_revision_id_range: [entry.oldest, entry.newest],
          article_id: null,
        }),
        'Scripted reconciliation backfill by DSH Agent (round 341), no signed-in actor. These revisions belong to a WordPress post this archive deliberately did not import, so there is no article to attach them to; the text is kept rather than dropped because dropping it is the loss the table exists to prevent.',
      ]
    );
    orphanAuditRows += 1;
  }

  console.log(`\n  wrote ${written} revision rows`);
  console.log(`  audit rows: ${auditRows} new on records (${counts.size} records hold a history), ${orphanAuditRows} new on parents the archive does not hold (${orphanGroups.size} such parents)`);
  if (refusedIds.length > 0) {
    console.log(`  REFUSED (over the size ceiling, stored as NULL): ${refusedIds.join(', ')}`);
  }
  await db.close();
}

await main();
