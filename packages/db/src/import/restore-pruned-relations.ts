/**
 * Put back the stem relations that a prune took with it.
 *
 * WHAT WENT WRONG, AND WHY IT IS WORTH A SCRIPT
 *
 * `word_relation` is built by resolving each source record's `stems[]` to a word
 * row, matching on the FOLDED form — so `-jù` and `-jụ`, which differ only in tone
 * marks, are the same target to that code and whichever row came back first won.
 *
 * That is fine until definition-less duplicates are pruned. When `-jù` was
 * deleted as a spelling of `-jụ`, foreign keys cascaded and the twenty words that
 * recorded `-jù` as their root lost the fact entirely — while the spelling that
 * survived was sitting right there. On the first run of that prune, 72 relations
 * went this way and 48 of them had a surviving spelling to move to.
 *
 * So this reads the prune's own audit file and restores exactly those relations,
 * onto the spelling that survived. It restores ONLY them: a stem is looked up in
 * the audit by its recorded spelling, never re-resolved against the corpus in
 * general, because a general re-resolution would also invent relations for
 * records the importer deliberately collapsed into another entry.
 *
 *     npm -w @ozituma/db run restore:relations -- --audit <pruned-empty.json>
 *     npm -w @ozituma/db run restore:relations -- --audit <file> --apply --confirm
 *
 * Safe to run repeatedly: a relation that already exists is left alone.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireLanguage } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { DEFAULT_SOURCE_DIR } from './igbo.ts';
import { wordFields } from './corpus.ts';

interface CorpusEntry {
  stems?: string[] | null;
}

type Corpus = Record<string, CorpusEntry[]>;

interface AuditRow {
  id: number;
  headword: string;
  twin: { id: number; headword: string } | null;
}

const db = await getDb();
const apply = process.argv.includes('--apply');
const confirm = process.argv.includes('--confirm');
const sourceDir = process.env.OZITUMA_IGBO_SOURCE ?? DEFAULT_SOURCE_DIR;
const languageCode = 'ibo';

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function log(message = ''): void {
  console.log(message);
}

const auditPath = arg('--audit');
if (!auditPath) {
  console.error('Pass --audit <the pruned-empty-*.json written by prune-empty.ts>');
  process.exit(2);
}

const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { removed: AuditRow[] };
const rows = audit.removed.filter((row) => row.twin !== null);
const withoutTwin = audit.removed.length - rows.length;

log(`Audit: ${auditPath}`);
log(`  ${audit.removed.length} entries were removed; ${rows.length} of them left a spelling behind.`);
log();

/** The importer's own lookup: headword, then exact form, then folded form. */
async function findWord(db: Db, headword: string, cache: Map<string, number | null>) {
  const cached = cache.get(headword);
  if (cached !== undefined) return cached;

  const fields = wordFields(headword, requireLanguage(languageCode));
  const found = await db.one<{ id: string }>(
    `select id from word
      where language_code = $1 and (headword = $2 or exact_form = $3 or search_form = $4)
      limit 1`,
    [languageCode, fields.headword, fields.exactForm, fields.searchForm]
  );
  const id = found ? Number(found.id) : null;
  cache.set(headword, id);
  return id;
}

const corpus = JSON.parse(await readFile(join(sourceDir, 'ig-en.json'), 'utf8')) as Corpus;

// Which corpus records name each removed spelling as a stem.
const wanted = new Map<string, AuditRow>();
for (const row of rows) wanted.set(row.headword, row);

const incoming: Array<{ fromId: number; toId: number; from: string; stem: string }> = [];
const wordCache = new Map<string, number | null>();
const unresolvedStems = new Map<string, number>();

for (const [key, entries] of Object.entries(corpus)) {
  const stems = new Set<string>();
  for (const entry of entries) {
    for (const stem of entry.stems ?? []) {
      if (typeof stem === 'string' && wanted.has(stem.trim())) stems.add(stem.trim());
    }
  }
  if (stems.size === 0) continue;

  // The record itself must still exist: pruning may have removed it too.
  const fromId = await findWord(db, key, wordCache);
  if (fromId === null) {
    for (const stem of stems) unresolvedStems.set(stem, (unresolvedStems.get(stem) ?? 0) + 1);
    continue;
  }

  for (const stem of stems) {
    const row = wanted.get(stem)!;
    if (row.twin!.id === fromId) continue; // would relate a word to itself
    incoming.push({ fromId, toId: row.twin!.id, from: key, stem });
  }
}

log(`${incoming.length} relation(s) point at a removed spelling and can be moved to the survivor:`);
const perTwin = new Map<string, { count: number; from: string; to: string }>();
for (const relation of incoming) {
  const row = wanted.get(relation.stem)!;
  const entry = perTwin.get(relation.stem) ?? {
    count: 0,
    from: row.headword,
    to: row.twin!.headword,
  };
  entry.count += 1;
  perTwin.set(relation.stem, entry);
}

/*
 * And the other direction: the removed spelling's OWN record lists roots of its
 * own. `-jù` is not only something other words are built on, it is a word with a
 * record that names its own stems, and the prune moved those to `-jụ` as well.
 * Restoring only the incoming half would silently drop half the repair, so the
 * corpus record for each removed spelling is read here too — looked up by the
 * spelling that was removed, not by the one that survived, because the twin's own
 * stems are the importer's business and are already in the database.
 */
const outgoing: Array<{ fromId: number; toId: number; stem: string }> = [];
const stemCache = new Map<string, number | null>();
// One pass to index the corpus by its own headword form, rather than folding all
// 8,223 keys again for every removed entry.
const corpusKeyByHeadword = new Map<string, string>();
for (const candidate of Object.keys(corpus)) {
  corpusKeyByHeadword.set(
    wordFields(candidate, requireLanguage(languageCode)).headword,
    candidate
  );
}
for (const row of rows) {
  const key = corpusKeyByHeadword.get(row.headword);
  if (key === undefined) continue;
  const stems = new Set<string>();
  for (const entry of corpus[key] ?? []) {
    for (const stem of entry.stems ?? []) {
      if (typeof stem === 'string' && stem.trim().length > 0) stems.add(stem.trim());
    }
  }
  for (const stem of stems) {
    const toId = await findWord(db, stem, stemCache);
    if (toId === null || toId === row.twin!.id) continue;
    outgoing.push({ fromId: row.twin!.id, toId, stem });
  }
}

for (const [stem, info] of [...perTwin].sort((a, b) => b[1].count - a[1].count)) {
  log(`  ${String(info.count).padStart(4)}  ${stem}  ->  ${info.to}${stem === info.from ? '' : `  (was ${info.from})`}`);
}

log();
log(`${outgoing.length} relation(s) are the removed spelling's own roots, re-attributed to the survivor:`);
for (const relation of outgoing) {
  const owner = rows.find((row) => row.twin!.id === relation.fromId);
  log(`  ${String(relation.fromId).padStart(7)}  ${owner ? owner.twin!.headword : relation.fromId}  ->  ${relation.stem}`);
}

if (unresolvedStems.size > 0) {
  log();
  log('  Cannot be restored — the record that named them is gone too:');
  for (const [stem, count] of [...unresolvedStems].sort((a, b) => b[1] - a[1])) {
    log(`    ${String(count).padStart(4)}  ${stem}`);
  }
}

log();
log(`  ${withoutTwin} removed entries had no surviving spelling, so their relations have nowhere to go.`);

if (!apply || !confirm) {
  log();
  log('  DRY RUN — nothing was written. Re-run with --apply --confirm to restore these.');
  await closeDb();
  process.exit(0);
}

const relations = [...incoming, ...outgoing];

let added = 0;
let already = 0;
for (const relation of relations) {
  const result = await db.query(
    `insert into word_relation (from_word_id, to_word_id, relation_type, source_id)
     select $1, $2, 'stem', w.source_id from word w where w.id = $1
     on conflict do nothing`,
    [relation.fromId, relation.toId]
  );
  if ((result.rowCount ?? 0) > 0) added += 1;
  else already += 1;
}

const total = await db.one<{ n: number }>(
  `select count(*)::int as n from word_relation where relation_type = 'stem'`
);
log();
log(`  relations restored: ${added}`);
log(`  already present:    ${already}`);
log(`  stem relations now: ${Number(total?.n ?? 0)}`);
log();
log('  Run `npm run verify` — the gate checks the corpus invariants.');
await closeDb();
