/**
 * Putting the authors' own portraits back on the record.
 *
 * WHY THIS EXISTS
 *
 * The owner's report: *"on the authors, the main blog ozikoro.com has all the authors profile, yet you could
 * not get them?"* He was right, and the fault was the same one the article credits had already suffered.
 *
 * `ozikoro_contributor.avatar_url` was filled by the archive import from the WordPress REST API's
 * `avatar_urls` field — which is **Gravatar**, and Gravatar's `d=mm` fallback is one grey silhouette served
 * identically for every person who has no Gravatar account. So the column held either nothing or a stock
 * face, and the page, correctly refusing to print a stock face, printed a monogram for everybody and said
 * **"no author on ozikoro.com has uploaded one"**.
 *
 * That sentence was false. The live site's author box reads a usermeta field — `sabox-profile-image`, and in
 * one case Molongui's `molongui_author_image_url` — and **six of the eleven published contributors have
 * one**. Every one of those six files was already in this archive's media store, migrated with the other
 * 3,488 items. The REST import looked at the one field that could not carry a portrait and never at the
 * table that could. **This is the EXIF-credit loss again, in the same place: the API dropped a field the
 * database holds, and the archive then stated the field's absence as a fact.**
 *
 * WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE
 *
 *   - For a contributor whose uploaded portrait is a file this archive holds: `avatar_url` becomes that
 *     file's servable path. The file is checked on disk first, so a path that would 404 is never written.
 *   - For every other contributor: `avatar_url` is set to NULL. **A `d=mm` Gravatar URL is cleared, not
 *     kept** — a silhouette is a stock face, and a stock face standing in for a person is the thing the
 *     archive's rule forbids. Null is the honest value: the author supplied no portrait, and the page draws
 *     a monogram.
 *   - No biography is written by this script. The eleven biographies are the WordPress `description` field
 *     and were already imported; this script only counts them, so the two figures cannot be confused.
 *
 * Nothing is invented: every URL comes from the SQL dump, and every path is a file already on disk.
 *
 * Usage (dry run is the default; nothing is written without `--apply`):
 *   node packages/ozikoro/src/ops/backfill-author-portraits.ts
 *   node packages/ozikoro/src/ops/backfill-author-portraits.ts --apply --actor 1
 *   node packages/ozikoro/src/ops/backfill-author-portraits.ts --apply --actor 1 --expect-portraits 6
 *
 * `--expect-portraits N` is the shape check, in the form `merge-contributor.ts` established: if the number of
 * resolvable portraits differs from the measurement, the script refuses before writing anything. It exists
 * because a migration that silently finds nothing looks exactly like a site that has nothing.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from '@ozituma/db/client';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const DUMP = resolve(REPO_ROOT, 'data', 'ozikoro-wp', 'dbdump', 'sql', 'ozikbfpe_ozikoro.sql');
const MEDIA_ROOT = resolve(REPO_ROOT, '.data', 'media');

/** The usermeta keys the live site's author box reads, in the order it prefers them. */
const PORTRAIT_KEYS = ['sabox-profile-image', 'molongui_author_image_url'] as const;

interface Args {
  apply: boolean;
  actor: number | null;
  expectPortraits: number | null;
  dump: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, actor: null, expectPortraits: null, dump: DUMP };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--actor') args.actor = Number(argv[++i]);
    else if (a === '--expect-portraits') args.expectPortraits = Number(argv[++i]);
    else if (a === '--dump') args.dump = resolve(argv[++i] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log('usage: backfill-author-portraits.ts [--apply] [--actor <account id>] [--expect-portraits N] [--dump <file>]');
      process.exit(0);
    }
  }
  return args;
}

/**
 * A WordPress dump writes one row per line inside its INSERT blocks; this is the row shape we need.
 *
 * The terminator is `,` between rows and `);` on the LAST row of each INSERT statement, so a pattern that
 * accepts only a comma drops exactly one row per statement — and a dropped row is the class of loss this
 * whole script exists to undo. Measured on the real dump: 724 rows, of which a comma-only pattern reads 722.
 */
const META_ROW = /^\((\d+), (\d+), '((?:[^'\\]|\\.)*)', '(.*)'\),?;?$/;

/**
 * Read only the `wpc9_usermeta` block of the dump, line by line.
 *
 * The file is 116 MB and the usermeta block is a few hundred lines of it, so it is streamed and abandoned
 * at the next `CREATE TABLE` rather than read whole. **The dump is the source of truth here** — it is the
 * only artefact that still carries the field the REST import dropped.
 */
async function readUsermeta(path: string): Promise<Map<number, Map<string, string>>> {
  const out = new Map<number, Map<string, string>>();
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let inTable = false;
  for await (const line of rl) {
    if (!inTable) {
      if (line.startsWith('CREATE TABLE `wpc9_usermeta`')) inTable = true;
      continue;
    }
    // The block ends at the next table; everything after it is 116 MB of posts we do not need.
    if (line.startsWith('CREATE TABLE ')) break;
    const m = META_ROW.exec(line.trim());
    if (!m) continue;
    const userId = Number(m[2]);
    const key = (m[3] ?? '').replace(/\\'/g, "'");
    const value = (m[4] ?? '').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    let row = out.get(userId);
    if (!row) { row = new Map(); out.set(userId, row); }
    if (!row.has(key)) row.set(key, value);
  }
  rl.close();
  if (!inTable) throw new Error(`no wpc9_usermeta table in ${path} — is this the Ozikoro dump?`);
  return out;
}

/** A servable path for a stored media key. Kept in step with `mediaPath` in `src/design-fill.ts`. */
function mediaPath(key: string): string {
  return `/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

interface Contributor {
  id: string;
  wp_user_id: number;
  slug: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  records: number;
}

interface MediaMatch {
  storage_key: string;
  source_url: string;
  exact: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('\n  Author portraits, backfilled from the WordPress usermeta table');
  console.log(`  Dump: ${args.dump}\n`);
  if (!existsSync(args.dump)) throw new Error(`dump not found: ${args.dump}`);

  const meta = await readUsermeta(args.dump);
  console.log(`  usermeta: ${meta.size} WordPress users read`);

  const db = await getDb();

  /*
   * EVERY CONTRIBUTOR ROW IS READ, BUT THE REPORT IS ABOUT THE ONES `/about/` LISTS.
   *
   * The page's rule is "at least one published, non-page record", so that is the subset the two counts are
   * stated over. **The write is not limited to it**, and the first run of this script proved why: it cleared
   * the Gravatar defaults of the ten published people and left the same false value on the five who have not
   * published yet — measured, `Gravatar defaults remaining: 4` after the run. A byline that publishes
   * tomorrow would then have appeared with a grey silhouette on it, because the row was never touched. **A
   * byline with no published work is still a person the archive holds a row for.**
   */
  const all = await db.rows<Contributor>(
    `select c.id::text, c.wp_user_id, c.slug, c.display_name, c.bio, c.avatar_url,
            (select count(*)::int from ozikoro_article a
              where a.author_id = c.id and a.status = 'published' and a.is_page = false) as records
       from ozikoro_contributor c
      order by records desc, c.display_name`
  );
  const contributors = all.filter((c) => Number(c.records) > 0);

  const withBio = contributors.filter((c) => (c.bio ?? '').trim().length > 0).length;
  console.log(`  contributor rows: ${all.length}`);
  console.log(`  contributors with a published record: ${contributors.length}`);
  console.log(`    of those, with a biography:         ${withBio}`);

  /* Resolve each contributor's uploaded portrait to a file this archive actually holds. */
  const resolved: { c: Contributor; url: string; media: MediaMatch; path: string }[] = [];
  const unresolved: { c: Contributor; url: string; why: string }[] = [];

  for (const c of all) {
    const row = meta.get(Number(c.wp_user_id));
    const url = PORTRAIT_KEYS.map((k) => row?.get(k)?.trim()).find((v) => v && /^https?:\/\//i.test(v));
    if (!url) continue; // no portrait in usermeta at all; the table below shows this as a dash

    const base = url.split('?')[0]!;
    const exact = await db.one<MediaMatch>(
      `select storage_key, source_url, true as exact from ozikoro_media
        where source_url = $1 and storage_key is not null limit 1`,
      [base]
    );
    const matched =
      exact ??
      (await db.one<MediaMatch>(
        /* A WordPress resize (`-1024x576`) is the same file at another size; the archive stores the original. */
        `select storage_key, source_url, false as exact from ozikoro_media
          where storage_key is not null
            and regexp_replace(source_url, '-[0-9]+x[0-9]+(?=\\.[a-z0-9]+$)', '', 'i') = $1
          limit 1`,
        [base]
      ));

    if (!matched?.storage_key) {
      unresolved.push({ c, url, why: 'no media row for that URL' });
      continue;
    }
    const file = resolve(MEDIA_ROOT, matched.storage_key);
    if (!existsSync(file)) {
      unresolved.push({ c, url, why: `media row ${matched.storage_key} has no file on disk` });
      continue;
    }
    resolved.push({ c, url, media: matched, path: mediaPath(matched.storage_key) });
  }

  const resolvedPublished = resolved.filter((r) => Number(r.c.records) > 0);
  console.log(`    of those, with a portrait on file:  ${resolvedPublished.length}\n`);

  const width = Math.max(...contributors.map((c) => c.display_name.length), 12);
  console.log('  WHO HAS WHAT');
  for (const c of contributors) {
    const hit = resolved.find((r) => r.c.id === c.id);
    console.log(
      `    ${c.display_name.padEnd(width)}  bio ${(c.bio ?? '').trim() ? 'yes' : ' no'}   ` +
        `portrait ${hit ? hit.path : '—'}`
    );
  }
  for (const u of unresolved) {
    console.log(`    ${u.c.display_name.padEnd(width)}  no portrait (${u.why})`);
  }

  const gravatar = all.filter((c) => (c.avatar_url ?? '').includes('gravatar.com'));
  console.log(`\n  rows whose stored avatar_url is a Gravatar default: ${gravatar.length}`);
  console.log(`    (all ${gravatar.length} are cleared — a d=mm silhouette is a stock face)\n`);

  if (args.expectPortraits !== null && args.expectPortraits !== resolvedPublished.length) {
    throw new Error(
      `expected ${args.expectPortraits} resolvable portraits among published contributors, measured ${resolvedPublished.length}. ` +
        'Refusing to write: the shape check exists because a migration that finds nothing looks like a site that has nothing.'
    );
  }

  if (!args.apply) {
    console.log('  DRY RUN — nothing written. Add --apply to publish these.\n');
    await closeDb();
    return;
  }

  let written = 0;
  let cleared = 0;
  for (const c of all) {
    const hit = resolved.find((r) => r.c.id === c.id);
    const next = hit ? hit.path : null;
    if (next === c.avatar_url) continue;

    await db.query(
      `update ozikoro_contributor set avatar_url = $1, updated_at = now() where id = $2::bigint`,
      [next, c.id]
    );
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_contributor', $1::bigint, 'backfill_author_portrait', $2::jsonb, $3::jsonb, $4, $5)`,
      [
        c.id,
        JSON.stringify({ avatar_url: c.avatar_url, source: c.avatar_url?.includes('gravatar.com') ? 'gravatar default (d=mm)' : 'none' }),
        JSON.stringify(
          hit
            ? { avatar_url: next, source: 'wordpress usermeta', usermeta_url: hit.url, media_key: hit.media.storage_key, exact_url_match: hit.media.exact }
            : { avatar_url: null, source: 'none recorded' }
        ),
        args.actor,
        hit
          ? `Portrait restored for "${c.display_name}" from the WordPress usermeta table (${hit.url}) — ` +
            `file held by this archive as ${hit.media.storage_key}.`
          : `No portrait recorded for "${c.display_name}" on ozikoro.com; a Gravatar default was cleared so ` +
            `no stock face stands in for the person. The page draws a monogram.`,
      ]
    );
    if (hit) written += 1;
    else cleared += 1;
  }

  const after = await db.one<{ with_portrait: number }>(
    `select count(*)::int as with_portrait from ozikoro_contributor
      where avatar_url is not null and length(trim(avatar_url)) > 0
        and exists (select 1 from ozikoro_article a
                     where a.author_id = ozikoro_contributor.id and a.status = 'published' and a.is_page = false)`
  );
  const afterGravatar = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_contributor where avatar_url ilike '%gravatar.com%'`
  );

  console.log(`  applied: ${written} portrait(s) restored, ${cleared} row(s) cleared and audited`);
  console.log(`  contributors with a published record and a portrait now: ${Number(after?.with_portrait ?? 0)}`);
  console.log(`  Gravatar defaults remaining: ${Number(afterGravatar?.n ?? 0)}\n`);

  await closeDb();
}

if (process.argv[1] && process.argv[1].endsWith('backfill-author-portraits.ts')) {
  main().catch(async (error) => {
    console.error(`\n  Failed: ${String(error).slice(0, 600)}\n`);
    await closeDb().catch(() => {});
    process.exitCode = 1;
  });
}
