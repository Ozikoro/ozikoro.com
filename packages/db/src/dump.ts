/**
 * Export the database as a data-only SQL script.
 *
 * The schema is not included: both sides run the same migrations, so a dump only
 * ever needs to carry rows. That also makes it safe to load into an already
 * migrated database, which is exactly the case this exists for — moving an
 * imported corpus from a local PGlite instance to a real Postgres.
 *
 *   node packages/db/src/dump.ts > ozituma-data.sql
 *
 * Output uses COPY rather than INSERT. COPY is the format Postgres is fastest at
 * ingesting and it sidesteps quoting rules entirely for the values, so a
 * definition containing an apostrophe, a newline or a backslash survives without
 * special cases.
 *
 * Foreign keys are suspended during load via `session_replication_role`, set by
 * the script header. Without that, tables have to be emitted in dependency order
 * and a single mistake makes the load fail partway, which is not a good property
 * for something you reach for in a hurry.
 */
import { closeDb, getDb, type Db } from './client.ts';

/**
 * Tables in the order they are written. `pg_depend`-based ordering would be
 * automatic, but an explicit list is easier to read and to keep stable in a
 * diff — and it makes an accidentally omitted table obvious.
 *
 * ⚠️ AND THERE ARE TWO SETS, BECAUSE THE DATABASE HOLDS TWO CORPORA.
 *
 * This tool was written for the DICTIONARY, whose 26 tables are below. The owner's archive — `ozikoro.com`,
 * the history and archive — lives in the same Postgres behind 44 `ozikoro_*` tables, and its records had
 * never been on the production host. *"which is exactly the case this exists for"*, says the header above,
 * and the archive is that case.
 *
 * **⚠️ AND THE TWO SETS MUST NOT BE EMITTED TOGETHER.** `account`, `session` and `api_key` are in the
 * dictionary's list, and the production host's `account` table holds the LIVE rows of the dictionary and
 * the Academy — the academy shares it. **A dump that carried `account` and was then loaded would replace
 * two running sites' users.** So the set is chosen explicitly and the default is unchanged: running this
 * script with no argument dumps the dictionary, exactly as it always has.
 *
 *   node packages/db/src/dump.ts > ozituma-data.sql            # the dictionary, as before
 *   node packages/db/src/dump.ts --set corpus > ozikoro.sql    # the archive's records, to load into a host
 *   node packages/db/src/dump.ts --table ozikoro_source --table ozikoro_article_source > delta.sql
 *                                                              # named tables only, for a second pass
 *
 * **`corpus` rather than `archive`, and the difference is two tables.** `archive` is the schema's whole
 * `ozikoro_*` list; `corpus` is that list minus the two reference tables the host's own migration chain
 * seeds. See {@link ARCHIVE_MIGRATION_SEEDED} — copying those two would collide with the host's own rows
 * and, under `ON_ERROR_STOP=1`, abort the entire load while printing almost nothing.
 */

/** The dictionary's tables — unchanged, and the default. */
const DICTIONARY_TABLES = [
  'language',
  'source',
  'part_of_speech',
  'form_type',
  'dialect',
  'tag',
  'plan_limit',
  'word',
  'definition',
  'word_form',
  'word_dialect',
  'word_relation',
  'word_script',
  'word_tag',
  'example',
  'example_word',
  'audio',
  'contributor',
  'account',
  'session',
  'api_key',
  'suggestion',
  'review_action',
  'api_usage',
  'daily_usage',
  'schema_migration',
];

/**
 * The archive's tables — all 44, taken from the production host's own
 * `information_schema` rather than from a list written by hand, so an omission is a fact rather than an
 * oversight.
 *
 * ⚠️ PARENTS FIRST. *The script's header sets `session_replication_role` so foreign keys are suspended
 * during load and order does not strictly matter* — but the list is read by people, and a child above its
 * parent reads as a mistake.
 *
 * ⚠️ AND **NO** `account`, `session` OR `api_key` HERE, DELIBERATELY. The archive has no accounts of its
 * own; the six rows in the host's `account` table belong to the dictionary and the academy.
 */
const ARCHIVE_TABLES = [
  // Sources, people and labels — the roots nearly everything else references.
  'ozikoro_source',
  'ozikoro_contributor',
  'ozikoro_label',
  'ozikoro_topic',
  // Entities, and the material that hangs off them.
  'ozikoro_entity',
  'ozikoro_entity_label',
  'ozikoro_entity_relation',
  'ozikoro_excavation',
  'ozikoro_object',
  // Media, the rights records that describe it, and the oral histories built on it.
  'ozikoro_media',
  'ozikoro_media_rights',
  'ozikoro_oral_history',
  // The articles themselves, and everything that attaches to one.
  'ozikoro_article',
  'ozikoro_article_entity',
  'ozikoro_article_label',
  'ozikoro_article_media',
  'ozikoro_article_source',
  'ozikoro_article_revision',
  'ozikoro_claim',
  'ozikoro_evidence',
  'ozikoro_correction',
  'ozikoro_dating',
  // Podcast shows, episodes, and their revisions and transitions.
  'ozikoro_podcast_show',
  'ozikoro_episode',
  'ozikoro_episode_revision',
  'ozikoro_episode_transition',
  // Publications, their authors, files and reviews.
  'ozikoro_publication',
  'ozikoro_publication_author',
  'ozikoro_publication_file',
  'ozikoro_publication_review',
  'ozikoro_publication_transition',
  'ozikoro_publication_version',
  // Pronunciation, and the occurrences that point back at an article.
  'ozikoro_pronunciation',
  'ozikoro_pronunciation_occurrence',
  // The remaining leaf tables — nothing in the archive references these.
  'ozikoro_follow',
  'ozikoro_contributor_claim',
  'ozikoro_member',
  'ozikoro_member_role',
  'ozikoro_role_capability',
  'ozikoro_audit',
  'ozikoro_design_override',
  'ozikoro_institutional_access',
  'ozikoro_redirect',
  'ozikoro_site',
];

/**
 * ⚠️ TWO OF THE ARCHIVE'S TABLES HOLD **REFERENCE** ROWS, NOT CORPUS ROWS, AND A TRANSFER MUST LEAVE THEM
 * ALONE.
 *
 * `ozikoro_role_capability` is seeded by migrations `0037`, `0042`, `0044`, `0046`, `0051`, `0055` and
 * `0057`; `ozikoro_podcast_show` by `0045`. Both are therefore already populated on any host that has run
 * the migrations, and **the host's rows are the newer ones** — it has run 63 migrations where the copy
 * this dump is taken from has run 55. Measured rather than assumed:
 *
 *     ozikoro_role_capability   host 100 rows · copy 80   (host: owner 27, admin 18, editor 24)
 *     ozikoro_podcast_show      host   1 row  · copy  1   (identical: id 1, slug 'ozikoro')
 *
 * COPY does not upsert. Emitting either table puts the copy's rows on top of the host's, and because both
 * have a primary key — `(role, capability)` and `(id)` — every emitted row is a duplicate. Under the
 * `ON_ERROR_STOP=1` this dump's own header recommends, that aborts the whole transaction and **nothing
 * loads at all**, which is the failure mode that looks like success. Without it, `ozikoro_role_capability`
 * would be replaced by a set that predates three migrations, revoking capabilities the live site's own
 * permission checks read.
 */
const ARCHIVE_MIGRATION_SEEDED = ['ozikoro_podcast_show', 'ozikoro_role_capability'];

/** What a corpus transfer writes: the archive's rows, without the migration's own reference rows. */
const ARCHIVE_CORPUS_TABLES = ARCHIVE_TABLES.filter((t) => !ARCHIVE_MIGRATION_SEEDED.includes(t));

/**
 * Every table this tool knows how to write — the complete list, and the one to read when asking whether a
 * table has been forgotten.
 *
 * **It is not the list to emit.** In one file it is the union of two corpora that live in one database on
 * the host and must not be written over each other. Emit a named set instead.
 */
export const TABLES = [...DICTIONARY_TABLES, ...ARCHIVE_TABLES];

/** The sets a run may name. `--set <name>` chooses one; the default is the dictionary, as before. */
const TABLE_SETS: Record<string, readonly string[]> = {
  dictionary: DICTIONARY_TABLES,
  archive: ARCHIVE_TABLES,
  corpus: ARCHIVE_CORPUS_TABLES,
  all: TABLES,
};

/**
 * Rows fetched per statement. See the paging comment in {@link dumpData}: a whole
 * table in one result set is what exhausts PGlite's WebAssembly heap, and the
 * failure is silent rather than loud. 200 keeps the largest page here (the
 * archive's `body_html`, 313 KB in one row) well inside it and costs nine
 * statements for the biggest table in the corpus.
 */
const PAGE_ROWS = 200;

/**
 * `--table <name>`, repeatable, as an explicit alternative to `--set`.
 *
 * **A DELTA IS NOT A SET.** The sets exist to move a whole corpus into empty
 * tables. The second pass over a host that already holds most of a table is the
 * other case: it has to name the tables it is topping up, and the ones it is
 * topping up are not a corpus, they are a measurement. `--table` therefore also
 * wins over `--set` when both are given, and the names are re-ordered into
 * {@link TABLES} order so the output still reads parents-first.
 *
 * An unknown name is refused rather than skipped. A typo that quietly dumped
 * nothing would be indistinguishable from a delta of zero rows, which is exactly
 * the silent-success fault the pagination comment above exists for.
 */
function requestedTables(argv: readonly string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--table') {
      names.push(argv[i + 1] ?? '');
      i += 1;
    }
  }
  return names;
}

/**
 * Format a JS array as a Postgres array literal.
 *
 * The `pg` driver hands back `text[]` columns as real arrays, and JSON-encoding
 * one produces `["NG","NE"]`, which Postgres rejects: "malformed array literal".
 * COPY expects the `{NG,NE}` form, with elements quoted when they contain
 * anything that would otherwise be read as structure.
 */
function arrayLiteral(values: readonly unknown[]): string {
  const parts = values.map((value) => {
    if (value === null || value === undefined) return 'NULL';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    // Bare tokens need no quoting; anything else does, with inner quotes and
    // backslashes escaped the way array literals require.
    if (/^[A-Za-z0-9_]+$/.test(text)) return text;
    return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  });
  return '{' + parts.join(',') + '}';
}

/** Escape a value into Postgres COPY text format. */
function copyValue(value: unknown): string {
  if (value === null || value === undefined) return '\\N';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '\\x' + value.toString('hex');
  if (Array.isArray(value)) return escapeJson(arrayLiteral(value));
  if (typeof value === 'object') return escapeJson(JSON.stringify(value));
  return escapeJson(String(value));
}

function escapeJson(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

async function tableExists(db: Db, table: string): Promise<boolean> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name = $1`,
    [table]
  );
  return (row?.n ?? 0) > 0;
}

export async function dumpData(
  db: Db,
  out: (chunk: string) => void,
  tables: readonly string[] = DICTIONARY_TABLES
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  out('-- Ozituma data-only dump.\n');
  out('-- Load with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql\n');
  out('begin;\n');
  // Suspend FK and trigger enforcement so table order does not matter.
  out("set session_replication_role = replica;\n\n");

  for (const table of tables) {
    if (!(await tableExists(db, table))) {
      counts[table] = -1; // reported as absent rather than zero
      continue;
    }

    // Column order comes from the catalogue rather than from a result row, so
    // an empty table still dumps its column list and the order is identical on
    // both sides of the transfer.
    // Generated columns are excluded: Postgres recomputes them on insert, and
    // COPY refuses them outright ("Generated columns cannot be used in COPY").
    // `word.search_vector` is one, derived from the headword and glosses.
    const columns = (
      await db.rows<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1
            and is_generated = 'NEVER'
          order by ordinal_position`,
        [table]
      )
    ).map((r) => r.column_name);
    if (columns.length === 0) {
      counts[table] = 0;
      continue;
    }
    // Rows are read in pages, and only the columns that will actually be
    // written — never `select *`.
    //
    // ⚠️ THE PAGING IS NOT AN OPTIMISATION, IT IS THE DIFFERENCE BETWEEN A DUMP
    // AND A FILE THAT LOOKS LIKE ONE. PGlite materialises a whole result set in
    // WebAssembly memory, and a large one does not raise a Postgres error — it
    // corrupts the heap. Measured on the archive's own copy, one `select` of
    // `ozikoro_article` (1,620 rows, 15.5 MB of `body_html`, one row of 313 KB)
    // made every *subsequent* query return nothing: the next
    // `information_schema` probe answered "0" for a table that exists, 29 of the
    // 42 tables were dropped from the output in silence, and the run ended by
    // throwing a bare `Infinity` out of `close()`. The same read in pages of
    // {@link PAGE_ROWS} succeeds and leaves the connection usable. `select *`
    // made it worse by also fetching the generated `search_vector` (8.7 MB) that
    // the line above has just excluded.
    const total = (await db.one<{ n: number }>(`select count(*)::int as n from ${table}`))?.n ?? 0;
    const selectList = columns.map((c) => `"${c}"`).join(', ');

    out(`-- ${table} (${total} rows)\n`);
    if (total > 0) {
      out(`copy ${table} (${selectList}) from stdin;\n`);
      // Keyset pagination on `ctid`: it needs no ordered column, cannot skip or
      // repeat a row, and needs no sort of the whole table in memory. The
      // cluster being read is a stopped copy, so the physical order is fixed.
      let last = '(0,0)';
      let written = 0;
      while (written < total) {
        const { rows } = await db.query<Record<string, unknown>>(
          `select ${selectList}, ctid::text as __ozituma_ctid from ${table} ` +
            `where ctid > $1::tid order by ctid limit ${PAGE_ROWS}`,
          [last]
        );
        if (rows.length === 0) break;
        const tail = rows[rows.length - 1];
        if (tail === undefined) break;
        last = String(tail.__ozituma_ctid);
        for (const row of rows) {
          out(columns.map((c) => copyValue(row[c])).join('\t') + '\n');
        }
        written += rows.length;
      }
      out('\\.\n');
    }
    // Sequences are not advanced by COPY, so without a reset the first insert
    // after a load collides with an existing primary key. Only tables with a
    // serial `id` have one to reset - `language` is keyed by `code`, and asking
    // for its sequence is an error rather than a no-op.
    // Guarded on the column list: pg_get_serial_sequence raises
    // 'column "id" of relation ... does not exist' rather than returning NULL
    // when there is no such column, so it cannot be asked speculatively.
    const seq = columns.includes('id')
      ? await db.one<{ seq: string | null }>(
          `select pg_get_serial_sequence($1, 'id') as seq`,
          [`public.${table}`]
        )
      : null;
    if (seq?.seq) {
      out(
        `select setval('${seq.seq}', coalesce((select max(id) from ${table}), 1), true);\n\n`
      );
    } else {
      out('\n');
    }
    counts[table] = total;
  }

  out('set session_replication_role = default;\n');
  out('commit;\n');
  return counts;
}

async function main(): Promise<void> {
  // An unknown set is refused rather than silently defaulted: a typo that quietly
  // dumped the dictionary when the archive was meant is the whole fault this
  // list exists to prevent.
  const flag = process.argv.indexOf('--set');
  const requested = flag === -1 ? 'dictionary' : (process.argv[flag + 1] ?? '');
  const explicit = requestedTables(process.argv);
  const nameless = explicit.filter((t) => t === '').length;
  const unknown = explicit.filter((t) => t !== '' && !TABLES.includes(t));

  let tables = explicit.length > 0 ? explicit : TABLE_SETS[requested];
  if (nameless > 0 || unknown.length > 0) {
    process.stderr.write(
      nameless > 0
        ? '--table needs a table name\n'
        : `unknown table(s) for --table: ${unknown.join(', ')}\n`
    );
    process.exitCode = 2;
    return;
  }
  if (!tables) {
    process.stderr.write(
      `unknown --set ${requested}: expected one of ${Object.keys(TABLE_SETS).join(', ')}\n`
    );
    process.exitCode = 2;
    return;
  }
  if (explicit.length > 0) {
    // Dependency order rather than the order they were typed, so a delta still
    // reads parents-first.
    tables = [...tables].sort((a, b) => TABLES.indexOf(a) - TABLES.indexOf(b));
  }
  process.stderr.write(
    explicit.length > 0
      ? `tables: ${tables.length} named by --table (${tables.join(', ')})\n`
      : `table set: ${requested} (${tables.length} tables)\n`
  );

  const db = await getDb();
  // Streamed to stdout so a multi-hundred-megabyte dump never has to be held in
  // memory as one string.
  const counts = await dumpData(db, (chunk) => process.stdout.write(chunk), tables);
  await closeDb();

  // The summary names the tables it did NOT write as well as the ones it did.
  // The failure this guards against is a dump that ends cleanly having silently
  // dropped most of its tables, which cannot be seen from the exit code or the
  // size of the file.
  const absent = Object.entries(counts)
    .filter(([, n]) => n < 0)
    .map(([t]) => t);
  const rows = Object.values(counts).reduce((a, n) => a + Math.max(n, 0), 0);
  process.stderr.write(
    `\nWrote ${Object.keys(counts).length - absent.length} of ${Object.keys(counts).length} tables, ` +
      `${rows} rows` +
      (absent.length > 0 ? `; absent from this cluster: ${absent.join(', ')}` : '') +
      '\n'
  );
  for (const [table, n] of Object.entries(counts)) {
    if (n > 0) process.stderr.write(`  ${table.padEnd(26)} ${n}\n`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
