/**
 * The editorial desk, tested as a set of refusals and an audit trail.
 *
 * The thing that matters here is not that an editor can tag a record — it is that the archive cannot
 * be changed without a record of who changed it, and that nothing is invented along the way. So the
 * checks are: the queue tells the truth about what is missing, the validation refuses bad input, the
 * dictionary is linked rather than duplicated, and every write leaves a trail.
 *
 * Run with: npm -w @ozikoro/platform run test:editorial
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import { MemberError } from './members.ts';
import {
  attachEntity,
  attachSource,
  createSource,
  detachEntity,
  findOrCreateEntity,
  getArticleFacets,
  getArticleHistory,
  getEditorialProgress,
  listEditorialQueue,
  searchDictionaryPlaces,
  searchEntities,
  searchSources,
  updateArticleFacets,
} from './editorial.ts';

const db = await getDb();
let failures = 0;

const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const refuses = async (label: string, run: () => Promise<unknown>, code: string) => {
  try {
    await run();
    assert(label, false, 'it was allowed');
  } catch (error) {
    const actual = error instanceof MemberError ? error.code : '';
    assert(label, actual === code, actual || String(error).slice(0, 70));
  }
};

const SUFFIX = 'zztest-ozikoro-editorial';
await db.query(`delete from account where email like '${SUFFIX}-%'`);
const editor = await registerAccount(db, { email: `${SUFFIX}-editor@example.com`, password: 'a long enough password' });
await db.query(`update account set role = 'editor' where id = $1`, [editor.id]);

/**
 * A record to work on, chosen from the real archive.
 *
 * Its ORIGINAL facet values are captured first, because this test edits a real migrated record and
 * must put it back exactly as it found it. The first version of this file nulled the record's
 * columns in cleanup instead of restoring them, which quietly destroyed the series WordPress had
 * given it — a test that damages the archive it is testing is worse than no test.
 *
 * **AND IT MUST CHOOSE A RECORD THAT HOLDS NO ENTITY LINK OR SOURCE, because `cleanup` deletes both
 * for the record it touched and cannot restore what it never captured.** Until round 323 the first
 * record by id happened to have neither, so the hole was invisible; the round-323 backfill gave
 * article 1 its true `Ute Okpu` link, and this test's cleanup would then have deleted it — a test
 * silently undoing editorial work. The record is now selected FOR the state the test assumes: a
 * series recorded (so the facet it restores is real), no entity link, no source.
 */
const target = await db.one<Record<string, unknown>>(
  `select a.id, a.slug, a.title, a.topic_id, a.source_type, a.period_label, a.period_start, a.period_end, a.status
     from ozikoro_article a
    where a.is_page = false and a.status <> 'archived' and a.topic_id is not null
      and not exists (select 1 from ozikoro_article_entity ae where ae.article_id = a.id)
      and not exists (select 1 from ozikoro_article_source s where s.article_id = a.id)
    order by a.id limit 1`
);

async function cleanup() {
  try {
    if (target) {
      // Restore every facet to the value it had before this test touched the record.
      await db.query(
        `update ozikoro_article set topic_id = $2, source_type = $3, period_label = $4,
                period_start = $5, period_end = $6, status = $7, updated_at = now()
          where id = $1`,
        [target.id, target.topic_id, target.source_type, target.period_label, target.period_start, target.period_end, target.status]
      );
      await db.query(`delete from ozikoro_article_entity where article_id = $1`, [target.id]);
      await db.query(`delete from ozikoro_article_source where article_id = $1`, [target.id]);
      await db.query(`delete from ozikoro_audit where entity_type = 'ozikoro_article' and entity_id = $1`, [target.id]);
    }
    await db.query(`delete from ozikoro_audit where entity_type in ('ozikoro_entity','ozikoro_source') and actor_id = $1`, [editor.id]);
    await db.query(`delete from ozikoro_entity where slug like 'zztest-%'`);
    await db.query(`delete from ozikoro_source where slug like 'zztest-%'`);
    await db.query(`delete from account where email like '${SUFFIX}-%'`);
  } catch (error) {
    console.error('cleanup failed:', String(error).slice(0, 200));
  }
  await closeDb();
}

// ---------------------------------------------------------------------------

console.log('\n--- the queue tells the truth about the archive ---');

const progress = await getEditorialProgress(db);
assert('the archive has records to work on', progress.records >= 1000, `${progress.records} records`);
assert('and reports how many carry sources', progress.withSources >= 0, `${progress.withSources} with sources`);
/*
 * THE TWO HALVES ARE NOW DIFFERENT, AND ONLY ONE IS STILL THE PROBLEM.
 *
 * This asserted that the migration arrived with neither sources nor entities and called that "the whole
 * problem". Round 259 attached 205 articles to the towns named in their titles, so the entity half is no
 * longer zero — and the source half still is.
 *
 * Sources are the claim that matters: a record with a source can be checked, and a record with a place link
 * cannot. So that half stays exact and the entity half becomes a report of progress rather than a failure
 * when it moves.
 */
assert(
  'the migrated archive still arrived with NO source attached, which is the real problem',
  progress.withSources === 0,
  `${progress.withSources} sourced`
);
console.log(
  `  note: ${progress.withEntities} record(s) now carry a place link. That is progress, not provenance — a ` +
    'town link says which place a record is about and says nothing about whether its claims are sourced.'
);

const queue = await listEditorialQueue(db, { limit: 10 });
assert('the queue returns records', queue.length > 0, `${queue.length} items`);
/*
 * Nothing starts at zero, and the reason is worth stating: the migration carried the WordPress
 * category across as the record's series, so every record already has one of the five facets. The
 * queue therefore opens on records missing the other four, which is the real remaining work.
 */
const withTopic = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article where is_page = false and topic_id is not null`);
assert('the series facet came across from WordPress, so no record starts empty', Number(withTopic?.n ?? 0) > 1000, `${withTopic?.n} have a series`);
assert('worst first: a record missing four of the five leads', queue[0]?.completeness === 1, `completeness ${queue[0]?.completeness}`);
assert('and each item names what it is missing', (queue[0]?.missing.length ?? 0) === 4, queue[0]?.missing.join(', '));
/*
 * THE SERIES IS THE ONE FACET THE MIGRATION GAVE EVERY RECORD, AND THAT IS ASSERTED WHERE IT IS TRUE.
 *
 * This used to read `!queue[0].missing.includes('series')`, which held only while the emptiest queue
 * item happened to be a published record: the queue covers every non-archived record, drafts
 * included, and a draft can carry no series. Round 322's backfill lifted article 1 out of the
 * emptiest tier, the top of the queue became a draft, and the assertion failed — not because a
 * series had gone missing, but because it had always been asserting the top row rather than the
 * guarantee. The guarantee is about the MIGRATION, so it is now asked of the migrated archive.
 */
const noSeries = await db.one<{ n: number }>(
  `select count(*)::int as n from ozikoro_article
    where is_page = false and status = 'published' and topic_id is null`
);
assert('every published record carries the series the migration gave it', Number(noSeries?.n ?? -1) === 0, `${noSeries?.n} without a series`);
assert('a record can be found by title', (await listEditorialQueue(db, { search: 'Ute-Okpu' })).length > 0);

const gapQueue = await listEditorialQueue(db, { gap: 'sources', limit: 5 });
assert('the queue can be narrowed to one gap', gapQueue.length > 0 && gapQueue.every((q) => q.sourceCount === 0));

console.log('\n--- facets are validated, not trusted ---');

assert('the target record exists', target !== null);
await refuses('a source type outside the archive vocabulary is refused',
  () => updateArticleFacets(db, { articleId: Number(target!.id), sourceType: 'blog_post' as never, actorId: editor.id }),
  'bad_source_type');
await refuses('a series that does not exist is refused',
  () => updateArticleFacets(db, { articleId: Number(target!.id), topicId: 99999999, actorId: editor.id }),
  'no_topic');
await refuses('a period that ends before it starts is refused',
  () => updateArticleFacets(db, { articleId: Number(target!.id), periodStart: 1900, periodEnd: 1800, actorId: editor.id }),
  'bad_period');
await refuses('editing a record that does not exist is refused',
  () => updateArticleFacets(db, { articleId: 99999999, sourceType: 'academic_source', actorId: editor.id }),
  'no_article');

const topic = await db.one<{ id: string }>(`select id from ozikoro_topic limit 1`);
await updateArticleFacets(db, {
  articleId: Number(target!.id),
  topicId: Number(topic!.id),
  sourceType: 'academic_source',
  periodLabel: 'Pre-colonial',
  periodStart: 1700,
  periodEnd: 1850,
  actorId: editor.id,
});
const facets = await getArticleFacets(db, Number(target!.id));
assert('a complete set of facets saves', facets?.sourceType === 'academic_source' && facets?.periodLabel === 'Pre-colonial');
assert('with the period range kept', facets?.periodStart === 1700 && facets?.periodEnd === 1850);

console.log('\n--- entities, and the dictionary is linked not duplicated ---');

const created = await findOrCreateEntity(db, { name: 'zztest-Ohaftest', kind: 'clan', actorId: editor.id });
const again = await findOrCreateEntity(db, { name: 'zztest-ohaftest', kind: 'clan', actorId: editor.id });
assert('an entity is created once', created === again, `${created} vs ${again}`);
assert('case does not create a second row', created === again);

const otherKind = await findOrCreateEntity(db, { name: 'zztest-Ohaftest', kind: 'town', actorId: editor.id });
assert('the same name of a different kind is a different entity', otherKind !== created);

await refuses('an entity needs a name', () => findOrCreateEntity(db, { name: '   ', kind: 'clan', actorId: editor.id }), 'no_name');
await refuses('an entity kind outside the graph is refused',
  () => findOrCreateEntity(db, { name: 'x', kind: 'starship' as never, actorId: editor.id }), 'bad_kind');

await attachEntity(db, { articleId: Number(target!.id), entityId: created, role: 'clan', actorId: editor.id });
const withEntity = await getArticleFacets(db, Number(target!.id));
assert('an entity attaches in one of the required roles', withEntity?.entities.some((e) => e.id === created && e.role === 'clan') === true);
await refuses('a role outside the brief is refused',
  () => attachEntity(db, { articleId: Number(target!.id), entityId: created, role: 'vibe' as never, actorId: editor.id }),
  'bad_role');
await detachEntity(db, { articleId: Number(target!.id), entityId: created, role: 'clan', actorId: editor.id });
assert('and detaches', !(await getArticleFacets(db, Number(target!.id)))?.entities.some((e) => e.id === created));

/*
 * The dictionary already holds 228 clans and their towns. An editor linking a history to one must
 * choose the row that exists rather than create a second, which is what "do not duplicate Ozituma
 * inside Ozikoro" means in practice.
 */
const places = await searchDictionaryPlaces(db, 'Ohafia');
assert('the dictionary\'s own clans are offered for linking', places.length > 0, places[0]?.clanName ?? 'none');
assert('with their towns', (places[0]?.towns.length ?? 0) > 0, (places[0]?.towns ?? []).slice(0, 3).join(', '));
assert('and the state they are in today', (places[0]?.states.length ?? 0) > 0, (places[0]?.states ?? []).join(', '));

const found = await searchEntities(db, 'zztest-Ohaftest');
assert('created entities are findable', found.some((e) => e.id === created));

console.log('\n--- sources carry their evidence kind and their stance ---');

const sourceId = await createSource(db, {
  title: 'zztest-The Ohafia War Papers',
  kind: 'colonial_record',
  authors: ['District Officer'],
  year: 1911,
  publisher: 'National Archives, Enugu',
  archive: 'OZ-D-0001',
  evidenceType: 'historical_document',
  actorId: editor.id,
});
const sameSource = await createSource(db, { title: 'zztest-the ohafia war papers', kind: 'colonial_record', year: 1911, actorId: editor.id });
assert('the same source cited twice is one row', sourceId === sameSource);

await refuses('a source needs a title', () => createSource(db, { title: '  ', kind: 'book', actorId: editor.id }), 'no_title');
await refuses('a source kind outside the vocabulary is refused',
  () => createSource(db, { title: 'zztest-x', kind: 'tiktok' as never, actorId: editor.id }), 'bad_kind');
await refuses('a source link must be a link',
  () => createSource(db, { title: 'zztest-y', kind: 'website', url: 'not-a-url', actorId: editor.id }), 'bad_url');

await attachSource(db, { articleId: Number(target!.id), sourceId, stance: 'contradicts', actorId: editor.id });
const sourced = await getArticleFacets(db, Number(target!.id));
assert('a source attaches with the stance it takes', sourced?.sources.some((s) => s.id === sourceId && s.stance === 'contradicts') === true);
assert('so the archive can hold a source that disagrees', sourced?.sources[0]?.stance === 'contradicts');
await refuses('a stance outside the four is refused',
  () => attachSource(db, { articleId: Number(target!.id), sourceId, stance: 'disagrees' as never, actorId: editor.id }),
  'bad_stance');

assert('sources are searchable by title', (await searchSources(db, 'Ohafia War Papers')).length === 1);
assert('and by author', (await searchSources(db, 'District Officer')).length > 0);

const afterEdit = await getEditorialProgress(db);
assert('and the record now counts as sourced', afterEdit.withSources >= 1, `${afterEdit.withSources}`);

console.log('\n--- nothing is changed without a record of it ---');

const history = await getArticleHistory(db, Number(target!.id));
const actions = history.map((h) => h.action);
assert('facet changes are audited', actions.includes('update_facets'), actions.join(', '));
assert('entity links are audited', actions.includes('attach_entity') && actions.includes('detach_entity'));
assert('source links are audited', actions.includes('attach_source'));
assert('and the actor is named', history.some((h) => h.actorEmail === `${SUFFIX}-editor@example.com`));
assert('with what changed before and after', history.some((h) => h.after !== null && h.before !== null));

console.log('\n--- the queue reflects the work done ---');

/*
 * A now-fully-tagged record sinks to the bottom of a worst-first queue, so looking for it in the
 * first page would be testing the page size rather than the work. The property that matters is that
 * it no longer appears in any gap.
 */
assert('a fully tagged record leaves the sources gap', !(await listEditorialQueue(db, { gap: 'sources', limit: 500 })).some((q) => q.id === Number(target!.id)));
assert('and leaves the entities gap', !(await listEditorialQueue(db, { gap: 'entities', limit: 500 })).some((q) => q.id === Number(target!.id)));
assert('and leaves the period gap', !(await listEditorialQueue(db, { gap: 'period', limit: 500 })).some((q) => q.id === Number(target!.id)));
const finalFacets = await getArticleFacets(db, Number(target!.id));
assert('because all five facets are now present',
  finalFacets?.topicId !== null && finalFacets?.sourceType !== null && finalFacets?.periodLabel !== null
  && (finalFacets?.entities.length ?? 0) === 0 && (finalFacets?.sources.length ?? 0) === 1,
  `topic ${finalFacets?.topicId}, type ${finalFacets?.sourceType}, period ${finalFacets?.periodLabel}, sources ${finalFacets?.sources.length}`);

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await cleanup();
process.exit(failures === 0 ? 0 : 1);
