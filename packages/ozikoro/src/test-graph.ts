/**
 * The knowledge graph, following, and manuscript files — tested as rules and as audits.
 *
 * WHAT THESE CHECKS ARE FOR
 *
 * All three of these moved data that had never moved before:
 *
 *   * `ozikoro_entity` held ZERO rows, so every filter on the public archive that offers a clan, a town
 *     or an ethnic group was provably empty. The graph builder fills it from the dictionary's own 188
 *     published clans, and the checks below are about what it REFUSES to write — a coordinate, a
 *     period, a source, a duplicate, an entity for a colonial section.
 *   * `ozikoro_publication_file` had never held a row, so a manuscript had nowhere to go. The checks
 *     are about what may be stored and who may read it back.
 *   * Following is new, and its rules are that it is idempotent, that nobody follows themselves, and
 *     that an account's reading list is nobody else's.
 *
 * THE AUDIT IS ASSERTED, NOT ASSUMED. Every mutation in this file writes an `ozikoro_audit` row naming
 * the actor, and each test asks for it — because the requirement is that an attributed change is a
 * property of the write path rather than of the UI.
 *
 * A NOTE ON THE DATA THIS NEEDS. The dictionary assertions are conditional and ANNOUNCE what they
 * skipped, so the suite still runs against an empty database — but the archive tests only mean
 * something where the archive is present, and pretending otherwise would be the kind of green run this
 * project has already been burned by.
 *
 * Run with: npm -w @ozikoro/platform run test:graph
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import { resetStorage } from '@ozituma/db/storage';
import { getArchiveFacets, PLACE_ENTITY_KINDS_SQL } from './archive.ts';
import { buildEntityGraph, getEntityGraphState, titleNames } from './entity-graph.ts';
import {
  countFollowers,
  followedIds,
  followsResearcher,
  listFollowing,
  setFollow,
} from './follows.ts';
import { MemberError } from './members.ts';
import {
  ACCEPTED_FILE_LABEL,
  ACCEPTED_FILE_TYPES,
  MAX_MANUSCRIPT_BYTES,
  attachPublicationFile,
  getPublicationFile,
  listPublicationFiles,
  mayReadPublicationFiles,
  resolveFileType,
  verifyFileSignature,
} from './publication-files.ts';
import { createPublication } from './publications.ts';

const db = await getDb();
let failures = 0;

const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const refuses = async (label: string, run: () => unknown, code: string) => {
  try {
    await run();
    assert(label, false, 'it was allowed');
  } catch (error) {
    const actual = error instanceof MemberError ? error.code : '';
    assert(label, actual === code, actual || String(error).slice(0, 70));
  }
};

const SUFFIX = 'zztest-ozikoro-graph';
await db.query(`delete from account where email like '${SUFFIX}-%'`);

const owner = await registerAccount(db, { email: `${SUFFIX}-owner@example.com`, password: 'a long enough password' });
const reader = await registerAccount(db, { email: `${SUFFIX}-reader@example.com`, password: 'a long enough password' });
const other = await registerAccount(db, { email: `${SUFFIX}-other@example.com`, password: 'a long enough password' });

async function cleanup() {
  try {
    await db.query(`delete from ozikoro_follow where account_id in ($1,$2,$3)`, [owner.id, reader.id, other.id]);
    await db.query(`delete from ozikoro_audit where actor_id in ($1,$2,$3)`, [owner.id, reader.id, other.id]);
    await db.query(`delete from ozikoro_publication where submitted_by in ($1,$2,$3)`, [owner.id, reader.id, other.id]);
    await db.query(`delete from account where email like '${SUFFIX}-%'`);
  } catch (error) {
    console.error('cleanup failed:', String(error).slice(0, 200));
  }
  await closeDb();
}

// ---------------------------------------------------------------------------
console.log('\n--- the title matcher, which is where the round-323 faults were ---');

/*
 * THE THREE FAULTS, ASSERTED. Each of these was WRONG before round 323 and each one cost a real
 * record a place on the archive's first page. These run without the database, so they hold even
 * where the archive is empty.
 */
assert('a name spelled with a dash matches its space spelling', titleNames('Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots', 'Ute Okpu'));
assert('and the reverse holds too', titleNames('Ute Okpu: An Ika-Igbo Clan', 'Ute-Okpu'));
assert('a three-letter name is evidence at a word boundary', titleNames('Owa: An Ika-Igbo Kingdom Built from Many Lineages', 'Owa'));
assert('but a dash at the boundary joins a word, so it does not match inside one', !titleNames('Owa-Alero and Owa-Oyibu are towns', 'Owa'));
assert('a longer word is not a match either', !titleNames('Owan: A Community of Many Origins', 'Owa'));
assert('a hyphenated prefix is not a match of the bare name', !titleNames('Emu-Uno: Unveiling the Rich Cultural Heritage', 'Emu'));
assert('an Igbo letter is a letter for the boundary, so Ọka matches', titleNames('Mgbokwo of Ọka, 1910', 'Ọka'));
assert('and a name ending in one does not match inside a longer word', !titleNames('Ọkara is a different place', 'Ọka'));

/* ---------------------------------------------------------------------------
 * The dictionary the graph is built from
 */
console.log('\n--- the dictionary the graph is built from ---');

const dictionary = await db.one<{ published: number; not_places: number }>(
  `select count(*)::int as published,
          count(*) filter (where kind in ('section','other'))::int as not_places
     from clan where published = true`
);
const DICTIONARY_PRESENT = Number(dictionary?.published ?? 0) > 0;

if (DICTIONARY_PRESENT) {
  assert(
    'the graph has published dictionary rows to build from',
    Number(dictionary!.published) > 0,
    `${dictionary!.published} published rows, ${dictionary!.not_places} of them not places anybody names`
  );
} else {
  console.log('  ! the dictionary holds no published clans, so the graph checks below cannot run here');
}

// ---------------------------------------------------------------------------
console.log('\n--- building the graph ---');

const before = await getEntityGraphState(db);
assert('the graph reports its own state', typeof before.entities === 'number', `${before.entities} entities, ${before.articleLinks} links`);
assert(
  'the graph is offered only published dictionary rows',
  before.dictionaryPublished <= (await db.one<{ n: number }>(`select count(*)::int as n from clan`))!.n,
  `${before.dictionaryPublished} published of all clans`
);

/* An actor is required, because the audit row must name somebody. */
await refuses('building with no real account is refused', () => buildEntityGraph(db, { actorId: 999999 }), 'no_actor');

/* A dry run must write NOTHING — not a row, not an audit entry. */
const auditsBefore = (await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_audit`))!.n;
const dry = await buildEntityGraph(db, { actorId: owner.id, dryRun: true });
const auditsAfterDry = (await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_audit`))!.n;
assert('a dry run reports what it would do', dry.entitiesCreated + dry.entitiesAlreadyPresent === dry.considered, `${dry.entitiesCreated} would be created`);
assert('a dry run writes no audit row', auditsAfterDry === auditsBefore, `${auditsBefore} → ${auditsAfterDry}`);
assert('a dry run writes no coordinate either', dry.coordinatesWritten === 0);

const auditMarkBeforeBuild = Number((await db.one<{ n: number }>(`select coalesce(max(id), 0)::int as n from ozikoro_audit`))!.n);
const built = await buildEntityGraph(db, { actorId: owner.id });
assert('the build creates or finds every published place', built.entitiesCreated + built.entitiesAlreadyPresent + built.skipped.length === built.considered, `${built.entitiesCreated} created, ${built.entitiesAlreadyPresent} present, ${built.skipped.length} skipped`);
/*
 * THE REFUSALS ARE REPORTED, NOT SILENT. `Oba` is a king in four titles and a clan's name; a run
 * that matched it would put a wrong `Place: Oba` on four history pages, and a run that dropped it
 * without saying so would leave the next reader unable to tell a refusal from a miss.
 */
assert(
  'a name that is not evidence on its own is refused and counted, not linked',
  built.ambiguousNames.every((a) => a.titles > 0) && built.ambiguousNames.some((a) => a.token === 'oba'),
  built.ambiguousNames.map((a) => `${a.token} (${a.titles})`).join(', ') || 'none seen'
);
assert(
  'a colonial section or administrative grouping is never made an entity',
  built.skipped.every((s) => s.kind === 'section' || s.kind === 'other'),
  built.skipped.map((s) => `${s.name} (${s.kind})`).slice(0, 3).join(', ') || 'none skipped'
);
assert('the build writes no coordinates', built.coordinatesWritten === 0);

/* The invariant the whole design rests on: no entity carries a coordinate it was not given. */
const withCoords = (await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_entity where latitude is not null or longitude is not null`))!.n;
assert('and none exists in the table afterwards', withCoords === 0, `${withCoords} with coordinates`);

const after = await getEntityGraphState(db);
assert('the graph grew by what the report said', after.entities === before.entities + built.entitiesCreated, `${before.entities} → ${after.entities}`);
assert('every entity from the dictionary points at a dictionary row', after.entities > 0 ? (await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_entity where clan_id is null and kind in ('clan','town','kingdom','people')`))!.n === 0 : true);

/* Idempotence: the second run must create nothing that already exists. */
const second = await buildEntityGraph(db, { actorId: owner.id });
assert('a second run creates no entity', second.entitiesCreated === 0, `${second.entitiesCreated} created`);
assert('a second run links nothing new', second.linksCreated === 0, `${second.linksCreated} links`);
assert('a second run finds everything already present', second.entitiesAlreadyPresent === second.considered - second.skipped.length, `${second.entitiesAlreadyPresent} present`);

/* Every mutation named its actor. */
const createAudits = (await db.one<{ n: number; actors: number; unattributed: number }>(
  `select count(*)::int as n,
          count(distinct actor_id)::int as actors,
          count(*) filter (where actor_id is null)::int as unattributed
     from ozikoro_audit where action in ('create_from_dictionary','link_entity_from_title','build_from_dictionary')`
))!;
assert('every graph write is audited', Number(createAudits.n) > 0, `${createAudits.n} audit rows`);
/*
 * THE PROPERTY IS "NO UNATTRIBUTED WRITE", NOT "EXACTLY ONE ACCOUNT EVER WROTE".
 *
 * Until round 323 the graph was built once, by one account, and never grew afterwards — so
 * `count(distinct actor_id) === 1` happened to hold. It stopped holding the moment the builder could
 * find a link on a database that already carried the owner's own links: the test's run is attributed
 * to the test account and the archive's earlier rows to the owner, and BOTH are correct. **The
 * requirement is that a change names who made it** — which is asserted twice: nothing is
 * unattributed, and the writes THIS run made name this run's actor (below).
 */
assert('and every one names an account', Number(createAudits.unattributed) === 0, `${createAudits.n} rows, ${createAudits.actors} actor(s), ${createAudits.unattributed} unattributed`);

/*
 * AND THE RUN'S OWN WRITES NAME THE RUN'S ACTOR.
 *
 * `built` is the only build in this file that may write a link, so every audit row written after it
 * began must name `owner` — not an account inherited from the archive's earlier builds.
 */
const buildAuditActors = await db.rows<{ actor_id: string | null; n: number }>(
  `select actor_id, count(*)::int as n from ozikoro_audit
    where action in ('link_entity_from_title','build_from_dictionary') and id > $1
    group by 1`,
  [auditMarkBeforeBuild]
);
assert(
  "and the write this run made names this run's actor",
  buildAuditActors.length > 0 && buildAuditActors.every((r) => Number(r.actor_id) === Number(owner.id)),
  `${built.linksCreated} links created; ` + (buildAuditActors.map((r) => `actor ${r.actor_id} ×${r.n}`).join(', ') || 'nothing written')
);

/* ---------------------------------------------------------------------------
 * The graph is what the archive's own filters read, so the two must agree.
 */
console.log('\n--- what the archive can now offer ---');

const facets = await getArchiveFacets(db);
const linked = after.articlesWithAPlace;
assert('the facet counts never exceed the records they are over', facets.records >= linked, `${linked} linked of ${facets.records}`);
if (after.entities > 0 && built.articlesLinked > 0) {
  assert('an ethnic group is offered once records are linked', facets.ethnicGroups.length > 0, facets.ethnicGroups.map((e) => `${e.label} ${e.count}`).join(', '));
  assert(
    'the ethnic-group count equals the records linked to a clan',
    facets.ethnicGroups.reduce((n, e) => n + e.count, 0) === linked,
    `${facets.ethnicGroups.reduce((n, e) => n + e.count, 0)} of ${linked}`
  );
  assert('clans and towns are offered separately, not merged', facets.clans.length > 0 || facets.towns.length > 0);
  /*
   * THE INVARIANT THAT REPLACED "KEEP THE TWO GROUPS DISJOINT".
   *
   * Round 305 asserted that no entity is offered as both a clan and a town, because the builder had
   * once written `role = 'town'` for every link and left the clan group empty while 146 records were
   * linked to clans. **Round 322 deliberately breaks that disjointness**: `clan` joined the entity
   * kinds that read as a place, so a record about a clan is now chipped `Place` AND offered under the
   * clan group. What must hold instead — and it is the stronger property — is that **the chip and the
   * facet are the same statement**: every entity the rail offers as a place is one the card would
   * chip, and every entity a card chips is one the rail offers. A chip beside a filter that cannot
   * find the record is the fault this guards against.
   */
  const chipSlugs = new Set(
    (
      await db.rows<{ slug: string }>(
        `select distinct en.slug from ozikoro_article_entity ae
           join ozikoro_entity en on en.id = ae.entity_id
           join ozikoro_article a on a.id = ae.article_id
          where a.status = 'published' and a.is_page = false and en.kind in ${PLACE_ENTITY_KINDS_SQL}`
      )
    ).map((r) => r.slug)
  );
  const facetSlugs = new Set(facets.towns.map((t) => t.value));
  assert(
    'every place a card chips is offered by the rail',
    [...chipSlugs].every((s) => facetSlugs.has(s)),
    `${chipSlugs.size} chipped, ${facetSlugs.size} offered`
  );
  assert(
    'and the rail offers no place no card chips',
    [...facetSlugs].every((s) => chipSlugs.has(s)),
    `${facetSlugs.size} offered, ${chipSlugs.size} chipped`
  );
  const clanSlugs = new Set(facets.clans.map((c) => c.value));
  assert(
    'a clan is a place as well as a clan, which is the round-323 decision',
    facets.clans.length === 0 || facets.towns.some((t) => clanSlugs.has(t.value)),
    `${facets.clans.length} clans, ${facets.towns.length} places`
  );
}

/* ---------------------------------------------------------------------------
 * Following
 */
console.log('\n--- following ---');

assert('nobody follows anybody yet', (await countFollowers(db, owner.id)) === 0);
assert('a reader does not follow an author they have not followed', (await followsResearcher(db, reader.id, owner.id)) === false);

await setFollow(db, { accountId: reader.id, on: true, kind: 'researcher', subjectAccountId: owner.id });
assert('following a researcher records it', await followsResearcher(db, reader.id, owner.id));
assert('and the count a profile shows agrees', (await countFollowers(db, owner.id)) === 1);

await setFollow(db, { accountId: reader.id, on: true, kind: 'researcher', subjectAccountId: owner.id });
assert('following twice is the same as following once', (await countFollowers(db, owner.id)) === 1);

await refuses('an account cannot follow itself', () => setFollow(db, { accountId: reader.id, on: true, kind: 'researcher', subjectAccountId: reader.id }), 'follow_self');
await refuses('following an account that does not exist is refused', () => setFollow(db, { accountId: reader.id, on: true, kind: 'researcher', subjectAccountId: 999999 }), 'no_account');

const mine = await listFollowing(db, { accountId: reader.id, viewerId: reader.id });
assert('a reader can read their own list', mine.length === 1, `${mine.length} follows`);
await refuses('and nobody else’s', () => listFollowing(db, { accountId: reader.id, viewerId: other.id }), 'not_your_list');

/* A topic follow, which is the one the reader dashboard's "Followed topics" would fill from. */
const topic = await db.one<{ id: string }>(`select id from ozikoro_topic order by id limit 1`);
if (topic) {
  await setFollow(db, { accountId: reader.id, on: true, kind: 'topic', topicId: Number(topic.id) });
  assert('a series can be followed', (await followedIds(db, { accountId: reader.id, kind: 'topic' })).includes(Number(topic.id)));
} else {
  console.log('  ! no series exists, so the topic-follow check cannot run here');
}

await setFollow(db, { accountId: reader.id, on: false, kind: 'researcher', subjectAccountId: owner.id });
assert('unfollowing removes it', (await countFollowers(db, owner.id)) === 0);
const followAudits = (await db.one<{ n: number; unattributed: number }>(
  `select count(*)::int as n, count(*) filter (where actor_id is null)::int as unattributed
     from ozikoro_audit where entity_type = 'ozikoro_follow' and actor_id = $1`,
  [reader.id]
))!;
/*
 * THREE, NOT FOUR, AND THE COUNT IS THE POINT.
 *
 * The test follows one researcher (1), follows the same researcher a second time (no audit row,
 * because nothing changed), follows a series (2), and unfollows the researcher (3). **A repeated
 * follow must not write a second row** — an audit trail with a row for every press is a trail whose
 * counts mean nothing, and the `already` check in `setFollow` is what stops it.
 */
assert('every follow and unfollow is audited, and a repeated follow is not', Number(followAudits.n) === 3, `${followAudits.n} rows`);
assert('and none of them is unattributed', Number(followAudits.unattributed) === 0);

/* ---------------------------------------------------------------------------
 * Manuscript files
 */
console.log('\n--- manuscript files ---');

resetStorage();

const type = resolveFileType('application/pdf', 'chapter.pdf');
assert('a declared PDF resolves to the PDF type', type.contentType === 'application/pdf', type.label);
await refuses('an unaccepted type is refused', () => resolveFileType('application/x-msdownload', 'thing.exe'), 'unsupported_file_type');
assert('an octet-stream with an accepted extension resolves', resolveFileType('application/octet-stream', 'chapter.pdf').contentType === 'application/pdf');

await refuses('an empty file is refused', () => verifyFileSignature(Buffer.alloc(0), type), 'empty_file');
await refuses(
  'a file whose bytes are not what it claims is refused',
  () => verifyFileSignature(Buffer.from('<?php echo 1;'), type),
  'content_type_mismatch'
);
verifyFileSignature(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(120, 0x20)]), type);
assert('a real PDF passes the signature check', true);
await refuses(
  'a file over the ceiling is refused',
  () => verifyFileSignature(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_MANUSCRIPT_BYTES + 1)]), type),
  'file_too_large'
);

const publicationId = await createPublication(db, {
  author: { accountId: owner.id, name: 'Test Depositor' },
  publication: { title: `${SUFFIX} a work with a manuscript`, authors: [{ name: 'Test Depositor', accountId: owner.id }] },
});

const attached = await attachPublicationFile(db, {
  publicationId,
  filename: 'chapter one.pdf',
  declaredType: 'application/pdf',
  body: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]),
  actorId: owner.id,
});
assert('a manuscript is stored and its checksum computed', attached.checksum.length === 64, `sha256 ${attached.checksum.slice(0, 16)}…`);
assert('the stored key is chosen by the archive, not the uploader', attached.file.storageKey.startsWith(`publications/${publicationId}/`), attached.file.storageKey);
assert('the filename is kept as the uploader wrote it', attached.file.filename === 'chapter one.pdf', attached.file.filename);

const listed = await listPublicationFiles(db, publicationId);
assert('the work lists its file', listed.length === 1, `${listed.length} file(s)`);
const fetched = await getPublicationFile(db, attached.file.id);
assert('the file is readable by id, with the work it belongs to', fetched?.publicationId === publicationId, fetched?.publicationSlug ?? 'none');

/*
 * ACCESS: a private draft's manuscript is readable by its author and by an editor, and by nobody else.
 * A 404 is what the route answers, so the question here is the boolean that decides it.
 */
const editorCaps = new Set(['review_queue']);
assert('a private draft is readable by its depositor', await mayReadPublicationFiles(db, { publicationId, accountId: owner.id, capabilities: new Set() }));
assert('and by an editor', await mayReadPublicationFiles(db, { publicationId, accountId: other.id, capabilities: editorCaps }));
assert('and NOT by an unrelated account', !(await mayReadPublicationFiles(db, { publicationId, accountId: other.id, capabilities: new Set() })));
assert('and NOT by a signed-out visitor', !(await mayReadPublicationFiles(db, { publicationId, accountId: null, capabilities: new Set() })));

const fileAudits = (await db.one<{ n: number; unattributed: number }>(
  `select count(*)::int as n, count(*) filter (where actor_id is null)::int as unattributed
     from ozikoro_audit where entity_type = 'ozikoro_publication_file'`
))!;
assert('storing a file is audited', Number(fileAudits.n) >= 1, `${fileAudits.n} rows`);
assert('and names the uploader', Number(fileAudits.unattributed) === 0);

/* ---------------------------------------------------------------------------
 * The helpers the screens quote, so a reader is told the truth about limits.
 */
assert('the accepted-type list is exposed for the screens to print', ACCEPTED_FILE_TYPES.length > 0, ACCEPTED_FILE_LABEL);
assert(
  'every accepted type has a distinct extension and a usable label',
  new Set(ACCEPTED_FILE_TYPES.map((t) => t.extension)).size === ACCEPTED_FILE_TYPES.length &&
    ACCEPTED_FILE_TYPES.every((t) => t.label.length > 1)
);

await cleanup();
console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
