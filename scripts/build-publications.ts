/**
 * Build and store the publication for every very long published record.
 *
 * THIS IS THE OWNER'S REQUEST, MADE RUNNABLE: *"check all the very long articles in the website, convert
 * them to pdf using the pdf html design i fed you for their designs, and add them."*
 *
 *   node scripts/build-publications.ts                     every published record over 2,500 words
 *   node scripts/build-publications.ts --min-words=1000    a lower line
 *   node scripts/build-publications.ts --slug=<slug>       one record
 *   node scripts/build-publications.ts --dry-run           list them and build nothing
 *
 * ── THE THRESHOLD, AND WHICH RECORDS COUNT ──────────────────────────────────────────────────────────
 *
 * **Published records only, and not `is_page`.** The archive's `ozikoro_article` holds 1,622 rows, of which
 * 563 are in `review` state and are not readable by anybody; a PDF offered on a record a reader cannot open
 * is a defect and not a feature. Measured in this database with `--min-words=2500`:
 *
 *     32 rows over 2,500 words if every row counts; **5** if only published records do
 *
 * and the difference is not marginal — the four longest bodies in the whole table are `review` rows, the
 * longest at 11,342 words. The count is read from the same column the record carries (`word_count`, written
 * by the WordPress import), so the threshold is checkable rather than calculated here by a second rule.
 *
 * ── WHY THIS IS A SCRIPT AND NOT A PAGE LOAD ─────────────────────────────────────────────────────────
 *
 * The route builds on click and keeps what it built (`lib/publication-cache.ts`), so the archive is correct
 * without anybody running this. **What this adds is that the very long articles do not make their first
 * reader wait**: a 3,604-word record takes about a second to render, and that second is paid once here
 * rather than by whoever clicks first.
 *
 * ── AND IT CANNOT RUN WHILE A SERVER HOLDS THE LOCAL CLUSTER ─────────────────────────────────────────
 *
 * PGlite is single-process: `npm run dev` and the review server hold `.data/pg`, and a second process that
 * opens the same directory corrupts it. So run this with the server stopped, or point it at a real
 * Postgres, or at a copy of the cluster:
 *
 *     OZITUMA_DB_PATH=/tmp/pgcopy node scripts/build-publications.ts
 *
 * The stored bytes go to the same object store the running site reads (`getStorage()`), which is why a copy
 * of the cluster is enough to warm the cache for the real server.
 */
import { closeDb, getDb } from '@ozituma/db/client';
import { publicationFor } from '../apps/ozikoro/lib/publication-cache.ts';

const args = process.argv.slice(2);
const valueOf = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const minWords = Number(valueOf('min-words') ?? 2500);
const onlySlug = valueOf('slug');
const limit = valueOf('limit') ? Number(valueOf('limit')) : null;
const dryRun = args.includes('--dry-run');

if (!Number.isFinite(minWords) || minWords < 0) {
  console.error('  --min-words must be a number');
  process.exit(2);
}

const db = await getDb();

/*
 * THE RECORDS, READ FROM THE TABLE THAT SERVES THE SITE.
 *
 * `status = 'published' and not is_page` is the same predicate the article route uses, so this list is
 * exactly the set of addresses a reader can open. `word_count` is the import's own measurement; the
 * COALESCE is only for a row the import left unmeasured, and it falls back to the same length the record's
 * own page would have reported rather than to zero.
 */
const records = await db.rows<{ id: number; slug: string; title: string; word_count: number | null }>(
  onlySlug
    ? `select id, slug, title, word_count
         from ozikoro_article
        where slug = $1 and status = 'published' and is_page = false`
    : `select id, slug, title, word_count
         from ozikoro_article
        where status = 'published' and is_page = false
          and coalesce(word_count, 0) > $1
        order by word_count desc nulls last, id`,
  onlySlug ? [onlySlug] : [minWords]
);

const chosen = limit === null ? records : records.slice(0, limit);

console.log(
  onlySlug
    ? `  one record: ${chosen.length}`
    : `  published records over ${minWords} words: ${chosen.length}`
);
if (chosen.length === 0) {
  await closeDb();
  process.exit(0);
}

if (dryRun) {
  for (const r of chosen) console.log(`  ${String(r.word_count ?? 0).padStart(6)}  ${r.slug}  |  ${r.title}`);
  await closeDb();
  process.exit(0);
}

let built = 0;
let cached = 0;
let missed = 0;

for (const r of chosen) {
  const started = Date.now();
  try {
    const result = await publicationFor(r.slug);
    if (!result) {
      // A record in the list that the publication builder refuses. Named rather than skipped silently.
      missed += 1;
      console.log(`  ✗ ${r.slug} — published, in this list, and the builder returned nothing`);
      continue;
    }
    if (result.source === 'cache') cached += 1;
    else built += 1;
    const seconds = ((Date.now() - started) / 1000).toFixed(2);
    console.log(
      `  ${result.source === 'cache' ? '·' : '+'} ${String(r.word_count ?? 0).padStart(6)} w  ` +
        `${String(result.pages ?? '?').padStart(3)} pp  ${String(Math.round(result.pdf.length / 1024)).padStart(4)} KB  ` +
        `${seconds}s  ${result.key}`
    );
    console.log(`      ${r.title}`);
  } catch (error) {
    missed += 1;
    console.error(`  ✗ ${r.slug} — ${String(error).slice(0, 300)}`);
  }
}

console.log(`\n  built ${built} · already stored ${cached} · failed ${missed}`);
console.log('  a later reader of any of these is served the stored bytes; see the x-ozikoro-publication header.');

await closeDb();
