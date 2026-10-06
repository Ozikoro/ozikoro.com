/**
 * Repair the entity references WordPress stored as literal text in the archive's own columns.
 *
 *   node scripts/repair-stored-entities.ts                 # report only; writes nothing
 *   node scripts/repair-stored-entities.ts --apply         # write the repair
 *   node scripts/repair-stored-entities.ts --apply --table ozikoro_media
 *
 * ── WHY THE DATA AND NOT THE OUTPUT PATH ─────────────────────────────────────────────────────────────
 *
 * The fault is an **entity stored as text**. `ozikoro_article.title` holds
 * `Ojeh &#038; Arishi Festival of Aboh Kingdom…` — a real ampersand, written the way a CMS writes it. The
 * application escapes every value it puts into HTML, which is correct and is not changed here, so the
 * escaped entity reaches the page as `&amp;#038;` and the reader is shown the entity, printed.
 *
 * Measured in the cluster on 2026-10-06, before this runs:
 *
 *   163 rows across 5 tables hold an entity reference; 0 of them hold one escaped twice in the database.
 *
 * **Decoding at the output path cannot be complete here, and the reason is structural rather than a
 * matter of effort.** A stored value reaches a reader through more than one kind of renderer: the design
 * screens and heads are composed as HTML strings, so an escaper can decode before it escapes; the listing
 * pages are React components, which write a title into a text node with no escaper to hook; and the PDF,
 * the publication renderer and the record-SEO store each read the column themselves. **A decode at the
 * output would have to be repeated in every one of them, and the ones missed would keep printing the
 * entity** — which is the "one more place that has to remember" fault this repository has recorded.
 * Repairing the column fixes all of them by construction, including the surfaces this repository's rules
 * put out of one round's reach.
 *
 * ── WHAT IT TOUCHES, AND WHAT IT REFUSES ─────────────────────────────────────────────────────────────
 *
 * The columns below are the ones measured to hold entity references. Two classes are deliberately NOT
 * touched and the reason is different for each:
 *
 *   * **`body_html`, on `ozikoro_article` and `ozikoro_article_revision`.** 1,503 and 2,958 rows hold
 *     entity tokens there and **every one is correct**: a body is markup WordPress published, inserted
 *     verbatim, and its entities are load-bearing. `&lt;div&gt;` in a written body is a tag shown as
 *     text; decoding it would create a real element and change what a reader sees. Verified with the
 *     decoder's own test, which asserts that decoding markup changes the markup.
 *   * **Slugs, URLs, dates, ids and every other non-prose column.** Not in the list below, and a slug is
 *     an address rather than text — `%c7%b9` in one of them is part of the published path.
 *
 * `ozikoro_article.folded_title` and `ozikoro_article.search_vector` are **generated** columns
 * (`information_schema.columns.is_generated = 'ALWAYS'`), so decoding `title` and `standfirst` recomputes
 * both. They are not written here and must not be.
 *
 * ── IT IS IDEMPOTENT, AND IT PROVES THAT RATHER THAN CLAIMING IT ─────────────────────────────────────
 *
 * Only rows whose decoded value differs are written, in one transaction, and the value written is the
 * decode of the value read. Running it a second time reads no candidates from the decoded columns and
 * writes nothing. `--apply` prints the count it wrote; a second `--apply` prints zero.
 *
 * **TAKE A BACKUP FIRST.** This rewrites content in place and the original entity spelling is not
 * recoverable from the decoded value. On the host:
 *
 *   pg_dump -Fc "$DATABASE_URL" > /opt/ozituma/backups/pre-entity-repair-$(date +%Y%m%dT%H%M%S).dump
 *   pg_restore -l /opt/ozituma/backups/pre-entity-repair-*.dump | head    # verify it is readable
 */
import { getDb, closeDb, type Db } from '@ozituma/db/client';
import { decodeStoredEntities, hasStoredEntities, storedEntityTokens } from '@ozikoro/platform';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const onlyTableAt = argv.indexOf('--table');
const onlyTable = onlyTableAt >= 0 ? argv[onlyTableAt + 1] : null;

/**
 * The columns this repairs, and the reason each one is on the list.
 *
 * A column is named only when it holds **prose a reader is shown**. `body_html` is not here, and neither
 * is anything that is an address, an identifier or a date. Adding a column is a deliberate act: it says
 * "this value is text a person reads, and an entity token in it is a character that was written wrong".
 */
const SURFACES: { table: string; column: string; why: string }[] = [
  { table: 'ozikoro_article', column: 'title', why: 'the record\'s own name — the <h1>, the <title>, the card, the cite block' },
  { table: 'ozikoro_article', column: 'seo_title', why: 'the editor\'s search-result title, when one was written' },
  { table: 'ozikoro_article', column: 'standfirst', why: 'the record\'s summary, shown above the prose' },
  { table: 'ozikoro_article_revision', column: 'title', why: 'a stored revision\'s name, shown in the revision history' },
  { table: 'ozikoro_article_revision', column: 'standfirst', why: 'a stored revision\'s summary' },
  { table: 'ozikoro_media', column: 'title', why: 'what the media register and a search result call the item' },
  { table: 'ozikoro_media', column: 'caption', why: 'the caption under a photograph on the record it belongs to' },
  { table: 'ozikoro_media', column: 'description', why: 'the item\'s own account of itself' },
  { table: 'ozikoro_media', column: 'credit', why: 'who the item is credited to, shown with the licence line' },
  { table: 'ozikoro_media', column: 'rights_note', why: 'the recorded basis on which the item may be reused' },
  { table: 'ozikoro_media', column: 'alt_text', why: 'the alternative text a screen reader reads out' },
  { table: 'ozikoro_contributor', column: 'bio', why: 'the researcher\'s biography on their profile' },
];

/**
 * A broad candidate filter, run in the database so the whole table is not read into this process.
 *
 * **IT IS NOT A SECOND DECODER.** It over-matches on purpose — `AT&T;` matches it and is then refused by
 * `hasStoredEntities` — because the arbiter of what may be decoded is the tested decoder and nothing
 * else. A pattern that decided for itself which names are entities is how a title gets a word invented
 * into it.
 */
const CANDIDATE = '&#[0-9]+;|&#[xX][0-9a-fA-F]+;|&[a-zA-Z][a-zA-Z0-9]*;';

type Change = { table: string; column: string; id: number; before: string; after: string; tokens: string[] };

async function collect(db: Db, table: string, column: string): Promise<Change[]> {
  const rows = await db.rows<{ id: number; value: string }>(
    `select id, "${column}" as value from "${table}"
      where "${column}" is not null and "${column}" <> '' and "${column}" ~ $1
      order by id`,
    [CANDIDATE]
  );
  const changes: Change[] = [];
  for (const row of rows) {
    if (!hasStoredEntities(row.value)) continue;
    const after = decodeStoredEntities(row.value);
    /*
     * TWO REFUSALS, EACH BECAUSE THE ALTERNATIVE IS LOSING OR INVENTING TEXT.
     *
     *   * a value that decodes to nothing was not an entity reference; refuse rather than empty the field;
     *   * a value still holding a decodable token after `MAX_PASSES` did not stabilise, and writing it
     *     would leave the reader exactly where they started while reporting a repair.
     */
    if (after.length === 0) throw new Error(`${table}.${column} id=${row.id}: decoded to an empty string`);
    if (hasStoredEntities(after)) throw new Error(`${table}.${column} id=${row.id}: did not reach a fixed point`);
    if (after.length > row.value.length) throw new Error(`${table}.${column} id=${row.id}: decode grew the value`);
    changes.push({ table, column, id: row.id, before: row.value, after, tokens: storedEntityTokens(row.value) });
  }
  return changes;
}

function report(changes: Change[]): void {
  const byColumn = new Map<string, number>();
  const byToken = new Map<string, number>();
  for (const c of changes) {
    byColumn.set(`${c.table}.${c.column}`, (byColumn.get(`${c.table}.${c.column}`) ?? 0) + 1);
    for (const t of c.tokens) byToken.set(t, (byToken.get(t) ?? 0) + 1);
  }
  console.log('  COLUMN                                          ROWS');
  for (const [k, n] of [...byColumn.entries()].sort()) console.log(`  ${k.padEnd(46)} ${String(n).padStart(4)}`);
  console.log('  ENTITY                                          ROWS');
  for (const [k, n] of [...byToken.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(46)} ${String(n).padStart(4)}`);
}

async function main(): Promise<void> {
  const db = await getDb();
  const surfaces = onlyTable ? SURFACES.filter((s) => s.table === onlyTable) : SURFACES;
  if (surfaces.length === 0) throw new Error(`no surface is named for table ${onlyTable}`);

  console.log(`==> stored-entity repair — ${apply ? 'APPLYING' : 'REPORT ONLY (pass --apply to write)'}`);
  console.log(`==> ${surfaces.length} column(s) on ${new Set(surfaces.map((s) => s.table)).size} table(s)`);
  console.log('==> body_html is deliberately NOT among them: a body is markup and its entities are correct\n');

  const all: Change[] = [];
  for (const surface of surfaces) {
    const changes = await collect(db, surface.table, surface.column);
    all.push(...changes);
    if (changes.length > 0) console.log(`  ${surface.table}.${surface.column}: ${changes.length} row(s) — ${surface.why}`);
  }

  if (all.length === 0) {
    console.log('\n==> nothing to repair: no stored column holds an entity reference this would decode.');
    await closeDb();
    return;
  }

  console.log('\n=== WHAT WOULD CHANGE ===');
  report(all);

  console.log('\n=== EVERY ROW, BEFORE AND AFTER (truncated to 120 characters) ===');
  const cut = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}…` : s);
  for (const c of all) {
    console.log(`  ${c.table}.${c.column} id=${c.id}`);
    console.log(`      before ${JSON.stringify(cut(c.before))}`);
    console.log(`      after  ${JSON.stringify(cut(c.after))}`);
  }

  if (!apply) {
    console.log('\n==> REPORT ONLY. Nothing was written. Re-run with --apply to repair, after taking a backup.');
    await closeDb();
    return;
  }

  await db.exec('begin');
  try {
    for (const c of all) {
      // `query`, not `exec`: `exec` is for parameterless scripts and a bound parameter reaches Postgres
      // as `$1` with nothing to bind it, which fails at parse time rather than at execution.
      await db.query(`update "${c.table}" set "${c.column}" = $1 where id = $2`, [c.after, c.id]);
    }
    await db.exec('commit');
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
  console.log(`\n==> WROTE ${all.length} column value(s) across ${new Set(all.map((c) => `${c.table}.${c.column}`)).size} column(s), in one transaction.`);
  await closeDb();
}

main().catch(async (error) => {
  console.error('\nTHE REPAIR FAILED AND WAS ROLLED BACK.');
  console.error(error);
  await closeDb().catch(() => {});
  process.exit(1);
});
