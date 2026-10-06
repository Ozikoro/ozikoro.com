/**
 * The per-record SEO override, tested as the promises the screen makes.
 *
 * WHAT MATTERS HERE IS NOT THAT A SAVE WORKS. Four things have to be true or the feature is worse than not
 * having it, and each of them is invisible from the happy path:
 *
 *   1. **AN ACCOUNT WITHOUT `manage_design` IS REFUSED, IN THE WRITE PATH.** The screen has its own guard, but
 *      the archive's rule is that *the rule lives in the write path, not in the UI* — so the refusal has to
 *      come from `saveRecordSeo` itself, which is what a script or a later route would reach. A guard that is
 *      only ever exercised through the happy path is a guard nobody has watched refuse anything.
 *   2. **THE FALLBACK IS THE RECORD'S OWN WORDS.** A record with no override must serve exactly what it
 *      served before this table existed, and a record with ONE field overridden must keep the other. This is
 *      the property that makes the change safe on a live archive, and it is decided in `resolveRecordSeo`.
 *   3. **BLANK IS NOT A THIRD STATE.** Both fields blank removes the row, so there is no arrangement in which
 *      an "override" exists and is empty and a served `<title>` is empty with it.
 *   4. **THE TRAIL RECORDS THE VALUES, NOT ONLY THE ACT.** A removal must say what it removed, or "this
 *      record's search result used to say something else" is unanswerable.
 *
 * Run with: npm -w @ozikoro/platform run test:seo-records
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import { grantRole } from './members.ts';
import {
  RECORD_SEO_CAPABILITY,
  SEO_FIELD_MAX,
  clearRecordSeo,
  listRecordSeo,
  loadRecordSeo,
  recordSeoStats,
  resolveRecordSeo,
  saveRecordSeo,
  titleAdvice,
} from './seo-records.ts';

let failures = 0;

function assert(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function refuses(label: string, run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
    assert(label, false, 'it was allowed');
  } catch (error) {
    const actual =
      typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    assert(label, actual === code, actual || String(error).slice(0, 120));
  }
}

const SUFFIX = 'zztest-ozikoro-seo-records';
const db = await getDb();

// ---------------------------------------------------------------------------------------------
// The pure part: the fallback, which needs no cluster and is the property everything else rests on.
// ---------------------------------------------------------------------------------------------
console.log('\n--- The fallback, which is what a record with no override serves ---');

{
  const none = resolveRecordSeo({ articleTitle: 'Ute-Okpu', standfirst: 'A summary.' , override: null });
  assert('no override means the record’s own title', none.title === 'Ute-Okpu');
  assert('and the record’s own standfirst as the description', none.description === 'A summary.');
  assert('and neither is reported as overridden', !none.titleOverridden && !none.descriptionOverridden);

  const titleOnly = resolveRecordSeo({
    articleTitle: 'Ute-Okpu',
    standfirst: 'A summary.',
    override: { title: 'Ute-Okpu — the kingdom and its records', description: null },
  });
  assert('a title override replaces the title', titleOnly.title === 'Ute-Okpu — the kingdom and its records');
  assert('and the record’s own standfirst still serves as the description', titleOnly.description === 'A summary.');
  assert('the title is reported as overridden', titleOnly.titleOverridden);
  assert('and the description is not', !titleOnly.descriptionOverridden);

  const descriptionOnly = resolveRecordSeo({
    articleTitle: 'Ute-Okpu',
    standfirst: 'A summary.',
    override: { title: null, description: 'What this record holds.' },
  });
  assert('a description override leaves the title alone', descriptionOnly.title === 'Ute-Okpu');
  assert('and replaces the description', descriptionOnly.description === 'What this record holds.');

  const noStandfirst = resolveRecordSeo({ articleTitle: 'Ute-Okpu', standfirst: null, override: null });
  assert('a record with no standfirst and no override serves no description', noStandfirst.description === null);

  const whitespace = resolveRecordSeo({
    articleTitle: 'Ute-Okpu',
    standfirst: 'A summary.',
    override: { title: '   ', description: '' },
  });
  assert(
    'a whitespace-only override is treated as absent rather than served as a blank title',
    whitespace.title === 'Ute-Okpu' && whitespace.description === 'A summary.'
  );
}

console.log('\n--- Advice is advice, and does not refuse a long title ---');
assert('a short title is not advised against', titleAdvice('Short') === null);
assert('a long title is reported rather than rejected', (titleAdvice('x'.repeat(80)) ?? '').includes('80'));

// ---------------------------------------------------------------------------------------------
// The database part.
// ---------------------------------------------------------------------------------------------
await db.query(`delete from account where email like $1`, [`${SUFFIX}-%`]);
await db.query(`delete from ozikoro_article where slug like $1`, [`${SUFFIX}-%`]);

const editor = await registerAccount(db, {
  email: `${SUFFIX}-editor@example.com`,
  password: 'a long enough password',
});
const reader = await registerAccount(db, {
  email: `${SUFFIX}-reader@example.com`,
  password: 'a long enough password',
});
/*
 * THE ARCHIVE ROLE, NOT THE PLATFORM ROLE. `account.role = 'editor'` carries nothing by itself — an editor on
 * this site is somebody with an `ozikoro_member_role` row saying editor, which is what migration 0055's
 * read-out-the-table grant is keyed on. The reader is granted `reader` and nothing else, so it holds
 * `manage_design` NOT — which is the account the refusal below is about.
 */
await grantRole(db, { accountId: editor.id, role: 'editor', grantedBy: null });
await grantRole(db, { accountId: reader.id, role: 'reader', grantedBy: null });

const caps = async (id: number) =>
  new Set(
    (await db.rows<{ c: string }>(`select x as c from ozikoro_capabilities($1) x`, [id])).map((r) => r.c)
  );

const editorCaps = await caps(editor.id);
const readerCaps = await caps(reader.id);
assert(
  `the editor holds ${RECORD_SEO_CAPABILITY}, so the module is usable by the account it is meant for`,
  editorCaps.has(RECORD_SEO_CAPABILITY),
  `editor holds ${editorCaps.size} capabilities`
);
assert(
  `the plain reader does NOT hold ${RECORD_SEO_CAPABILITY}, which is what makes the refusal below meaningful`,
  !readerCaps.has(RECORD_SEO_CAPABILITY),
  `reader holds ${readerCaps.size} capabilities`
);

const fixture = await db.one<{ id: number }>(
  `insert into ozikoro_article (slug, title, standfirst, body_html, status, is_page)
   values ($1, $2, $3, $4, 'published', false) returning id`,
  [`${SUFFIX}-record`, 'zztest: a record to write a search result for', 'zztest: its own summary', '<p>body</p>']
);
const articleId = Number(fixture!.id);
assert('a published fixture record exists', Number.isInteger(articleId));

console.log('\n--- The refusal: an account without the capability cannot write ---');

await refuses(
  'a reader is refused by the write path itself, not only by the screen',
  () => saveRecordSeo(db, { articleId, actorId: reader.id, title: 'A title', description: null }),
  'forbidden'
);
assert(
  'and nothing was written by the refused call',
  (await loadRecordSeo(db, articleId)) === null
);
await refuses(
  'a reader is refused the removal too',
  () => clearRecordSeo(db, { articleId, actorId: reader.id }),
  'forbidden'
);

console.log('\n--- The write, and what the read path then gets ---');

const saved = await saveRecordSeo(db, {
  articleId,
  actorId: editor.id,
  title: 'zztest: the search-result title',
  description: 'zztest: the search-result description',
  note: 'zztest',
});
assert('an editor holding the capability writes the override', !saved.cleared && saved.title !== null);

const loaded = await loadRecordSeo(db, articleId);
assert('the row reads back', loaded?.title === 'zztest: the search-result title');
assert('with both fields', loaded?.description === 'zztest: the search-result description');

const resolved = resolveRecordSeo({
  articleTitle: 'zztest: a record to write a search result for',
  standfirst: 'zztest: its own summary',
  override: loaded,
});
assert('the served title is the override', resolved.title === 'zztest: the search-result title');
assert('the served description is the override', resolved.description === 'zztest: the search-result description');

/*
 * ONE FIELD CLEARED, THE OTHER KEPT — the case that makes the two fields independent rather than a pair, and
 * the one a form that posted only one of them would get wrong.
 */
await saveRecordSeo(db, { articleId, actorId: editor.id, title: 'zztest: a title kept', description: '' });
const half = resolveRecordSeo({
  articleTitle: 'zztest: a record to write a search result for',
  standfirst: 'zztest: its own summary',
  override: await loadRecordSeo(db, articleId),
});
assert('clearing the description keeps the title that was written', half.title === 'zztest: a title kept');
assert('and the description falls back to the record’s own summary', half.description === 'zztest: its own summary');

console.log('\n--- Blank is not a third state ---');

const cleared = await saveRecordSeo(db, { articleId, actorId: editor.id, title: '   ', description: '' });
assert('saving both fields blank removes the row rather than storing an empty one', cleared.cleared);
assert('and there is no row left', (await loadRecordSeo(db, articleId)) === null);
const afterClear = resolveRecordSeo({
  articleTitle: 'zztest: a record to write a search result for',
  standfirst: 'zztest: its own summary',
  override: await loadRecordSeo(db, articleId),
});
assert('so the record serves its own title again', afterClear.title === 'zztest: a record to write a search result for');
assert('and its own summary', afterClear.description === 'zztest: its own summary');

console.log('\n--- What would break a head is refused, and what would only be truncated is not ---');

await refuses(
  'a value longer than the field maximum is refused by name',
  () => saveRecordSeo(db, { articleId, actorId: editor.id, title: 'x'.repeat(SEO_FIELD_MAX + 1), description: null }),
  'too_long'
);
assert('and the refusal wrote nothing', (await loadRecordSeo(db, articleId)) === null);
const longButStorable = await saveRecordSeo(db, {
  articleId,
  actorId: editor.id,
  title: 'x'.repeat(80),
  description: null,
});
assert(
  'a title a search engine would truncate is SAVED, because truncation is not a refusal',
  !longButStorable.cleared
);
await clearRecordSeo(db, { articleId, actorId: editor.id });

await refuses(
  'an override cannot be written for a record that does not exist',
  () => saveRecordSeo(db, { articleId: 2_000_000_000, actorId: editor.id, title: 'A title', description: null }),
  'no_article'
);

console.log('\n--- The trail records the values, not only the act ---');

await saveRecordSeo(db, { articleId, actorId: editor.id, title: 'zztest: before', description: 'zztest: before' });
await saveRecordSeo(db, { articleId, actorId: editor.id, title: 'zztest: after', description: null });
await clearRecordSeo(db, { articleId, actorId: editor.id });

const trail = await db.rows<{ action: string; before: unknown; after: unknown }>(
  `select action, before, after from ozikoro_audit
    where entity_type = 'ozikoro_article' and entity_id = $1
    order by id`,
  [articleId]
);
/*
 * EVERY ROW IS ONE ACT, AND THE LAST THREE ARE THE THREE THIS SECTION WROTE. The fixture is new, so the trail
 * on it is exactly the acts above — but the assertions read the LAST three rather than a fixed count, so a
 * module that later audits something else about the same record does not break a test about these three.
 */
const lastThree = trail.slice(-3);
assert('every act in this section wrote its own audit row', trail.length >= 3, `got ${trail.length}`);
assert(
  'a save records what it wrote',
  JSON.stringify(lastThree[1]?.after ?? null).includes('zztest: after'),
  JSON.stringify(lastThree[1]?.after ?? null)
);
assert(
  'a save records what it replaced',
  JSON.stringify(lastThree[1]?.before ?? null).includes('zztest: before'),
  JSON.stringify(lastThree[1]?.before ?? null)
);
assert(
  'and the removal records the values it removed, so “what did it used to say” is answerable',
  JSON.stringify(lastThree[2]?.before ?? null).includes('zztest: after'),
  JSON.stringify(lastThree[2]?.before ?? null)
);
assert(
  'the three actions are named for what they did',
  lastThree.map((t) => t.action).join(',') === 'record_seo_saved,record_seo_saved,record_seo_cleared',
  lastThree.map((t) => t.action).join(',')
);

console.log('\n--- The list, and its scope ---');

await saveRecordSeo(db, { articleId, actorId: editor.id, title: 'zztest: listed', description: null });

const listed = await listRecordSeo(db, { search: SUFFIX, limit: 20 });
assert('a search for the fixture finds it', listed.some((r) => r.id === articleId), `got ${listed.length}`);
const row = listed.find((r) => r.id === articleId);
assert('and it carries its override', row?.override?.title === 'zztest: listed');
assert(
  'and the record’s own title is beside the override, which is what the screen prints',
  row?.title === 'zztest: a record to write a search result for'
);

const onlyOverridden = await listRecordSeo(db, { search: SUFFIX, onlyOverridden: true, limit: 20 });
assert('the “only overridden” filter finds it', onlyOverridden.some((r) => r.id === articleId));

await clearRecordSeo(db, { articleId, actorId: editor.id });
const afterRemoval = await listRecordSeo(db, { search: SUFFIX, onlyOverridden: true, limit: 20 });
assert('and it drops out of that filter once the override is removed', !afterRemoval.some((r) => r.id === articleId));

/*
 * A DRAFT IS NOT LISTED, WHICH IS A STATEMENT ABOUT WHAT A SEARCH ENGINE CAN REACH RATHER THAN A PERMISSION.
 * Asserted because the screen's promise — "every row here is a record a crawler can reach" — is exactly the
 * kind of claim that quietly stops being true.
 */
const draft = await db.one<{ id: number }>(
  `insert into ozikoro_article (slug, title, standfirst, body_html, status, is_page)
   values ($1, $2, $3, $4, 'draft', false) returning id`,
  [`${SUFFIX}-draft`, 'zztest: a draft', 'zztest: draft summary', '<p>body</p>']
);
const draftListed = await listRecordSeo(db, { search: `${SUFFIX}-draft`, limit: 20 });
assert('a draft is not offered, because its search result does not exist', !draftListed.some((r) => r.id === Number(draft!.id)));

const stats = await recordSeoStats(db);
assert('the stats count published records', stats.records > 0, `${stats.records} records`);
assert('and the counts are consistent with each other', stats.withEither >= stats.withTitle);

// ---------------------------------------------------------------------------------------------
// Clean up the fixture, so a served page never carries a synthetic value.
// ---------------------------------------------------------------------------------------------
console.log('\n--- Cleanup ---');
await db.query(`delete from ozikoro_audit where entity_type = 'ozikoro_article' and entity_id = $1`, [articleId]);
await db.query(`delete from ozikoro_article where slug like $1`, [`${SUFFIX}-%`]);
await db.query(`delete from account where email like $1`, [`${SUFFIX}-%`]);
const leftover = await db.one<{ n: number }>(
  `select count(*)::int as n from ozikoro_article where slug like $1`,
  [`${SUFFIX}-%`]
);
assert('every fixture row is gone', Number(leftover?.n) === 0);

await closeDb();

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} assertion(s)`}`);
process.exit(failures === 0 ? 0 : 1);
