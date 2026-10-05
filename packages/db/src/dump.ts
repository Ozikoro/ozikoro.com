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
 *   node packages/db/src/dump.ts --set archive > ozikoro.sql   # the archive's records
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
  'ozikoro_site',
  'ozikoro_role_capability',
  'ozikoro_entity',
  'ozikoro_label',
  'ozikoro_topic',
  'ozikoro_source',
  'ozikoro_media',
  'ozikoro_media_rights',
  'ozikoro_article',
  'ozikoro_article_entity',
  'ozikoro_article_label',
  'ozikoro_article_media',
  'ozikoro_article_revision',
  'ozikoro_article_source',
  'ozikoro_entity_label',
  'ozikoro_entity_relation',
  'ozikoro_audit',
  'ozikoro_claim',
  'ozikoro_contributor',
  'ozikoro_contributor_claim',
  'ozikoro_correction',
  'ozikoro_dating',
  'ozikoro_design_override',
  'ozikoro_episode',
  'ozikoro_episode_revision',
  'ozikoro_episode_transition',
  'ozikoro_evidence',
  'ozikoro_excavation',
  'ozikoro_follow',
  'ozikoro_institutional_access',
  'ozikoro_member',
  'ozikoro_member_role',
  'ozikoro_object',
  'ozikoro_oral_history',
  'ozikoro_podcast_show',
  'ozikoro_pronunciation',
  'ozikoro_pronunciation_occurrence',
  'ozikoro_publication',
  'ozikoro_publication_author',
  'ozikoro_publication_file',
  'ozikoro_publication_review',
  'ozikoro_publication_transition',
  'ozikoro_publication_version',
  'ozikoro_redirect',
];

/** Which set this run writes. `--set archive` chooses the archive; anything else is the dictionary. */
const TABLES = process.argv.includes('--set')
  ? (process.argv[process.argv.indexOf('--set') + 1] === 'archive' ? ARCHIVE_TABLES : DICTIONARY_TABLES)
  : DICTIONARY_TABLES;

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

export async function dumpData(db: Db, out: (chunk: string) => void): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  out('-- Ozituma data-only dump.\n');
  out('-- Load with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql\n');
  out('begin;\n');
  // Suspend FK and trigger enforcement so table order does not matter.
  out("set session_replication_role = replica;\n\n");

  for (const table of TABLES) {
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
    const { rows } = await db.query<Record<string, unknown>>(`select * from ${table}`);

    out(`-- ${table} (${rows.length} rows)\n`);
    if (rows.length > 0) {
      out(`copy ${table} (${columns.map((c) => `"${c}"`).join(', ')}) from stdin;\n`);
      for (const row of rows) {
        out(columns.map((c) => copyValue(row[c])).join('\t') + '\n');
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
    counts[table] = rows.length;
  }

  out('set session_replication_role = default;\n');
  out('commit;\n');
  return counts;
}

async function main(): Promise<void> {
  const db = await getDb();
  // Streamed to stdout so a multi-hundred-megabyte dump never has to be held in
  // memory as one string.
  const counts = await dumpData(db, (chunk) => process.stdout.write(chunk));
  await closeDb();

  process.stderr.write('\nDumped:\n');
  for (const [table, n] of Object.entries(counts)) {
    if (n < 0) continue;
    if (n > 0) process.stderr.write(`  ${table.padEnd(22)} ${n}\n`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
