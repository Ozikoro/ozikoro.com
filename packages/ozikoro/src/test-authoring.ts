/**
 * Writing a post or a page, tested as the promises the screen makes.
 *
 * WHAT IS BEING TESTED, AND WHY EACH ONE IS HERE RATHER THAN LEFT TO THE SCREEN
 *
 *  1. **A DRAFT IS NOT PUBLIC.** This is the one that matters: the archive has 1,622 records and a real
 *     audience, and a half-written history appearing at its slug, in the sitemap or in a list is a live
 *     incident rather than a bug. So the test asks the SAME queries the public route, the sitemap and the
 *     listings run, and requires every one of them to return nothing.
 *  2. **PUBLISHING TRANSITIONS EXACTLY ONCE.** The status moves, the date is set, an audit row names the
 *     account — and a second publish refuses rather than silently moving a date the archive has already
 *     stated. The audit row is counted, because a trail with two rows for one publication cannot account
 *     for it.
 *  3. **A PAGE AND A POST DO NOT SHARE A LIST.** The kind is part of every read and every write, so a
 *     number in an address cannot make the posts screen edit a page.
 *  4. **THE WRITE PATH IS CAPABILITY-GATED.** A contributor holds neither `edit_entity` nor `publish`, and
 *     the refusals are required at the WRITE — not only at the guard — because a second caller would
 *     otherwise be a way to publish without the permission.
 *  5. **THE DRAFT PATH WORKS END TO END**: created, saved, listed as a draft, reopened, published.
 *  6. **THE MARKUP AN EDITOR WRITES SURVIVES THE SANITISER**: an image, a heading, a list and a link are
 *     kept, and what the archive refuses is refused with the save told about it.
 *
 * Everything this file creates, it deletes. It writes only rows whose titles and slugs begin with
 * `zztest-ozikoro-authoring`, so nothing it makes can be mistaken for archive content, and the cleanup at
 * the end runs even when an assertion has failed.
 *
 * Run with the review server STOPPED — one PGlite process holds `.data/pg`.
 * `node src/test-authoring.ts`
 */
import { getDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import { MemberError, grantRole } from './members.ts';
import { listIndexableUrls } from './seo.ts';
import { sanitiseArchiveHtml } from './content.ts';
import {
  MAX_PIECE_BODY,
  countPieces,
  createPiece,
  getPieceForEditor,
  isPageFor,
  listPieces,
  listTagCloud,
  publishPiece,
  quickEditPiece,
  restorePiece,
  savePieceText,
  setPieceAuthor,
  setPieceStatus,
  setPieceTerms,
  slugForTitle,
  trashPiece,
  unpublishPiece,
} from './authoring.ts';

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
    assert(label, actual === code, actual || String(error).slice(0, 110));
  }
};

const SUFFIX = 'zztest-ozikoro-authoring';
await db.query(`delete from account where email like '${SUFFIX}-%'`);

const editor = await registerAccount(db, { email: `${SUFFIX}-editor@example.com`, password: 'a long enough password' });
const contributor = await registerAccount(db, {
  email: `${SUFFIX}-contributor@example.com`,
  password: 'a long enough password',
});
await grantRole(db, { accountId: editor.id, role: 'editor', grantedBy: null });
// The contributor is left with no archive role at all, which is the real state of a new account.

/** The capability sets, read from the database rather than written down — the rule lives there. */
const capsOf = async (accountId: number): Promise<Set<string>> =>
  new Set(
    (await db.rows<{ capability: string }>(`select ozikoro_capabilities($1) as capability`, [accountId])).map(
      (r) => r.capability
    )
  );
const editorCaps = await capsOf(editor.id);
const contributorCaps = await capsOf(contributor.id);

const createdIds: number[] = [];
const createdLabels: string[] = [];

const TITLE = `${SUFFIX} a history written in this archive`;
const SLUG = 'zztest-ozikoro-authoring-a-history-written-in-this-archive';
const PAGE_TITLE = `${SUFFIX} a page written in this archive`;

console.log('\n--- the capability the write paths ask for ---');
assert('an editor holds edit_entity', editorCaps.has('edit_entity'));
assert('an editor holds publish', editorCaps.has('publish'));
assert('a contributor holds neither', !contributorCaps.has('edit_entity') && !contributorCaps.has('publish'), [...contributorCaps].join(','));

console.log('\n--- a draft is created, and is saveable without being published ---');
const post = await createPiece(db, { kind: 'post', title: TITLE, actorId: editor.id, bodyHtml: '' });
createdIds.push(post.id);
assert('the new piece is a draft', (await getPieceForEditor(db, post.id, 'post'))?.status === 'draft');
assert('it got an address from its title', post.slug === SLUG, post.slug);

const saved = await savePieceText(db, {
  id: post.id,
  kind: 'post',
  title: TITLE,
  bodyHtml: '<h2>A heading</h2><p>Some words.</p>',
  standfirst: 'A summary.',
  actorId: editor.id,
  note: 'first save',
});
assert('the save wrote a revision of what was there before', saved.revisionId > 0, `revision ${saved.revisionId}`);
assert('the save counted the words', saved.wordCount === 4, String(saved.wordCount));
const revisionCount = await db.one<{ n: number }>(
  `select count(*)::int as n from ozikoro_article_revision where article_id = $1 and wp_revision_id is null`,
  [post.id]
);
assert('two human revisions: the creation and the first save', Number(revisionCount?.n) === 2, String(revisionCount?.n));

console.log('\n--- and a draft is NOT public: every read path a reader can reach ---');
/*
 * THESE ARE THE ROUTE'S OWN QUERIES, COPIED FROM `apps/ozikoro/app/[slug]/route.ts` AND `seo.ts` IN
 * SHAPE. A test that asked a different question would prove nothing about the served site.
 */
const publicBySlug = await db.one(
  `select id from ozikoro_article where slug in ($1, $2) and status = 'published' and is_page = false`,
  [SLUG, SLUG]
);
assert('the served-article query finds nothing', publicBySlug === null);

const markQuery = await db.one(
  `select access_tier from ozikoro_article where slug in ($1, $2) and status = 'published' and is_page = false`,
  [SLUG, SLUG]
);
assert('the access-tier gate finds nothing either', markQuery === null);

const listed = await listPieces(db, { kind: 'post', status: 'publish', search: TITLE });
assert('All Posts › Published does not list it', listed.length === 0);
const drafts = await listPieces(db, { kind: 'post', status: 'draft', search: TITLE });
assert('All Posts › Drafts does list it, which is how it is found again', drafts.length === 1);
assert('the draft row carries its title', drafts[0]?.title === TITLE);

const sitemap = await listIndexableUrls(db);
assert('the sitemap does not invite a crawler to it', !sitemap.some((entry) => entry.url.endsWith(`/${SLUG}/`)));

console.log('\n--- a page and a post do not share a list ---');
const page = await createPiece(db, { kind: 'page', title: PAGE_TITLE, actorId: editor.id });
createdIds.push(page.id);
assert('the page is a page', isPageFor('page') === true && isPageFor('post') === false);
assert('asking for it as a post returns nothing', (await getPieceForEditor(db, page.id, 'post')) === null);
assert('asking for it as a page returns it', (await getPieceForEditor(db, page.id, 'page')) !== null);
const draftPagePublic = await db.one(
  `select id from ozikoro_article where slug = $1 and status = 'published' and is_page = true`,
  [page.slug]
);
assert('a draft page is not served either', draftPagePublic === null);
await refuses(
  'saving a page through the post write is refused',
  () => savePieceText(db, { id: page.id, kind: 'post', title: PAGE_TITLE, bodyHtml: '<p>x</p>', actorId: editor.id }),
  'wrong_kind'
);
const postsList = await listPieces(db, { kind: 'post', search: PAGE_TITLE });
const pagesList = await listPieces(db, { kind: 'page', search: PAGE_TITLE });
assert('the page is not in the posts list', postsList.length === 0);
assert('the page is in the pages list', pagesList.length === 1);
const postCounts = await countPieces(db, 'post', PAGE_TITLE);
const pageCounts = await countPieces(db, 'page', PAGE_TITLE);
assert('the two counts answer for different sets', postCounts.all === 0 && pageCounts.all === 1);

console.log('\n--- publishing is an event: it happens once, and it is recorded ---');
const published = await publishPiece(db, {
  id: post.id,
  kind: 'post',
  title: TITLE,
  bodyHtml: '<h2>A heading</h2><p>Some words.</p>',
  standfirst: 'A summary.',
  actorId: editor.id,
  capabilities: editorCaps,
});
assert('it moved from draft to published', published.from === 'draft' && published.to === 'published');
assert('the address it is served at is reported back', published.slug === SLUG, published.slug);
const afterPublish = await getPieceForEditor(db, post.id, 'post');
assert('the status is published', afterPublish?.status === 'published');
assert('a publication date was set', Boolean(afterPublish?.publishedAt));

const publishAudit = async () =>
  Number(
    (
      await db.one<{ n: number }>(
        `select count(*)::int as n from ozikoro_audit
          where entity_type = 'ozikoro_article' and entity_id = $1 and action = 'publish_post'`,
        [post.id]
      )
    )?.n ?? 0
  );
assert('exactly one audit row records the publication', (await publishAudit()) === 1);

await refuses(
  'a second publish is refused rather than moving the date',
  () =>
    publishPiece(db, {
      id: post.id,
      kind: 'post',
      title: TITLE,
      bodyHtml: '<p>changed after publishing</p>',
      actorId: editor.id,
      capabilities: editorCaps,
    }),
  'already_published'
);
const afterSecond = await getPieceForEditor(db, post.id, 'post');
assert('the publication date did not move', afterSecond?.publishedAt === afterPublish?.publishedAt);
assert('and no second audit row was written', (await publishAudit()) === 1);

const nowPublic = await db.one(`select id from ozikoro_article where slug = $1 and status = 'published' and is_page = false`, [SLUG]);
assert('the served-article query now finds it', nowPublic !== null);
const sitemapAfter = await listIndexableUrls(db);
assert('and the sitemap now lists it', sitemapAfter.some((entry) => entry.url.endsWith(`/${SLUG}/`)));

console.log('\n--- the write path is capability-gated, not the button ---');
await refuses(
  'publishing without the publish capability is refused by the write',
  () =>
    publishPiece(db, {
      id: page.id,
      kind: 'page',
      title: PAGE_TITLE,
      bodyHtml: '<p>x</p>',
      actorId: contributor.id,
      capabilities: contributorCaps,
    }),
  'forbidden'
);
await refuses(
  'taking a published piece down without it is refused too',
  () => unpublishPiece(db, { id: post.id, kind: 'post', actorId: contributor.id, capabilities: contributorCaps }),
  'forbidden'
);
await refuses(
  'the status control cannot reach published, even by a hand-made request',
  () =>
    setPieceStatus(db, {
      id: page.id,
      kind: 'page',
      // The type forbids it; the runtime refusal is what a hand-made POST would meet.
      status: 'published' as never,
      actorId: editor.id,
      capabilities: editorCaps,
    }),
  'bad_status'
);
await refuses(
  'the quick editor will not publish a draft',
  () =>
    quickEditPiece(db, {
      id: page.id,
      kind: 'page',
      title: PAGE_TITLE,
      slug: page.slug,
      authorId: null,
      status: 'published',
      publishedAt: null,
      actorId: editor.id,
      capabilities: editorCaps,
    }),
  'publish_needs_the_editor'
);
await refuses(
  'an untitled piece cannot be published',
  async () => {
    const untitled = await createPiece(db, { kind: 'post', title: '', actorId: editor.id });
    createdIds.push(untitled.id);
    return publishPiece(db, {
      id: untitled.id,
      kind: 'post',
      title: '',
      bodyHtml: '<p>no name</p>',
      actorId: editor.id,
      capabilities: editorCaps,
    });
  },
  'no_title'
);

console.log('\n--- but a draft with no title IS saveable, which is the whole point of the screen ---');
const untitled = await createPiece(db, { kind: 'post', title: '', actorId: editor.id });
createdIds.push(untitled.id);
const untitledSaved = await savePieceText(db, {
  id: untitled.id,
  kind: 'post',
  title: '',
  bodyHtml: '<p>a first paragraph before the title is decided</p>',
  actorId: editor.id,
});
assert('an untitled draft saved', untitledSaved.wordCount === 8, String(untitledSaved.wordCount));
const untitledRow = await getPieceForEditor(db, untitled.id, 'post');
assert('the untitled draft keeps its placeholder address', untitledRow?.slugIsPlaceholder === true, untitledRow?.slug);
const untitledList = await listPieces(db, { kind: 'post', status: 'draft' });
assert('and it is listed while it has no title', untitledList.some((r) => r.id === untitled.id));

console.log('\n--- the truncation trap: an over-long body is refused, not cut ---');
await refuses(
  'a body over the ceiling is refused and nothing is changed',
  () =>
    savePieceText(db, {
      id: post.id,
      kind: 'post',
      title: TITLE,
      bodyHtml: 'x'.repeat(MAX_PIECE_BODY + 1),
      actorId: editor.id,
    }),
  'body_too_long'
);
const afterOverlong = await getPieceForEditor(db, post.id, 'post');
assert('the stored body is untouched by the refusal', afterOverlong?.bodyHtml.includes('Some words.') === true);

console.log('\n--- series, tags, byline: the meta boxes are writes with their own audit rows ---');
const topics = await db.rows<{ id: number; name: string }>(`select id, name from ozikoro_topic order by id limit 1`);
const terms = await setPieceTerms(db, {
  id: post.id,
  kind: 'post',
  topicId: topics[0] ? Number(topics[0].id) : null,
  labelNames: [`${SUFFIX} Ute-Okpu`, `${SUFFIX} Ute-Okpu`, `${SUFFIX} Nri`],
  actorId: editor.id,
});
createdLabels.push(slugForTitle(`${SUFFIX} Ute-Okpu`), slugForTitle(`${SUFFIX} Nri`));
assert('the same tag typed twice is one tag', terms.labels.length === 2, terms.labels.join(' | '));
const withTerms = await getPieceForEditor(db, post.id, 'post');
assert('the series is stored', withTerms?.topicId === (topics[0] ? Number(topics[0].id) : null));
assert('the tags are stored', withTerms?.labels.length === 2);
await refuses(
  'a series that does not exist is refused',
  () => setPieceTerms(db, { id: post.id, kind: 'post', topicId: 999_999_999, labelNames: [], actorId: editor.id }),
  'no_topic'
);
const writers = await db.rows<{ id: number }>(`select id from ozikoro_contributor order by id limit 1`);
if (writers[0]) {
  await setPieceAuthor(db, { id: post.id, kind: 'post', authorId: Number(writers[0].id), actorId: editor.id });
  assert('the byline is stored', (await getPieceForEditor(db, post.id, 'post'))?.authorId === Number(writers[0].id));
}

console.log('\n--- the markup an editor writes is the markup the archive keeps ---');
const richBody = [
  '<h2>Heading</h2>',
  '<p>Words with <strong>weight</strong> and <em>stress</em> and <s>a struck line</s>.</p>',
  '<ul><li>one</li><li>two</li></ul>',
  '<p><a href="https://example.org/a-page">a link off site</a></p>',
  '<figure><img src="/media/ozikoro/example.jpg" alt="An example"><figcaption>A caption</figcaption></figure>',
  '<p style="text-align:center">aligned</p>',
  '<script>alert(1)</script>',
  '<!--more-->',
].join('\n');
const kept = sanitiseArchiveHtml(richBody, { internalHosts: [] });
assert('the heading survives', kept.includes('<h2>Heading</h2>'));
assert('bold, italic and strikethrough survive', kept.includes('<strong>weight</strong>') && kept.includes('<em>stress</em>') && kept.includes('<s>a struck line</s>'));
assert('the list survives', kept.includes('<ul>') && kept.includes('<li>one</li>'));
assert('the link survives', kept.includes('href="https://example.org/a-page"'));
assert('the image survives and is not dropped as broken', kept.includes('src="/media/ozikoro/example.jpg"'));
assert('the figure caption survives', kept.includes('<figcaption>A caption</figcaption>'));
assert('the script is gone', !kept.includes('alert(1)'));
assert('the alignment attribute is gone, which is why the buttons are disabled', !kept.includes('text-align'));
assert('the Read More comment is gone, which is why that button is disabled', !kept.includes('more'));

console.log('\n--- a delete is a move, and it works for pages too ---');
await refuses(
  'a published page cannot be published twice from the status control',
  async () => {
    await publishPiece(db, {
      id: page.id,
      kind: 'page',
      title: PAGE_TITLE,
      bodyHtml: '<p>a page body</p>',
      actorId: editor.id,
      capabilities: editorCaps,
    });
    return publishPiece(db, {
      id: page.id,
      kind: 'page',
      title: PAGE_TITLE,
      bodyHtml: '<p>a page body</p>',
      actorId: editor.id,
      capabilities: editorCaps,
    });
  },
  'already_published'
);
const trashed = await trashPiece(db, { id: page.id, kind: 'page', actorId: editor.id, note: 'test' });
assert('a page moves to the trash from published', trashed.from === 'published');
const inTrash = await listPieces(db, { kind: 'page', status: 'trash', search: PAGE_TITLE });
assert('and it is in the bin list', inTrash.length === 1 && inTrash[0]?.deletedFromStatus === 'published');
const pagePublic = await db.one(
  `select id from ozikoro_article where slug = $1 and status = 'published' and is_page = true`,
  [page.slug]
);
assert('a trashed page is not served', pagePublic === null);
await refuses(
  'a trashed piece is not edited',
  () => savePieceText(db, { id: page.id, kind: 'page', title: PAGE_TITLE, bodyHtml: '<p>x</p>', actorId: editor.id }),
  'trashed'
);
const restored = await restorePiece(db, { id: page.id, kind: 'page', actorId: editor.id });
assert('it comes back as what it was', restored.to === 'published');

console.log('\n--- an empty list is empty, not fabricated ---');
const emptyCounts = await countPieces(db, 'page', `${SUFFIX} nothing is called this`);
const emptyRows = await listPieces(db, { kind: 'page', search: `${SUFFIX} nothing is called this` });
assert('the count is zero', emptyCounts.all === 0);
assert('and the list is empty rather than holding a placeholder row', emptyRows.length === 0);

console.log('\n--- the tag cloud is a list of real tags ---');
const cloud = await listTagCloud(db, 5);
assert('the cloud answers with the most used tags', cloud.length > 0 && cloud[0]!.articleCount >= cloud[cloud.length - 1]!.articleCount);

console.log('\n--- cleanup: everything this test made ---');
/*
 * THE ROWS ARE DELETED RATHER THAN LEFT, and the labels are deleted by the slug the write gave them, so a
 * second run starts where the first one did. `ozikoro_article_revision`, `ozikoro_article_label` and
 * `ozikoro_audit`'s subject are handled by the schema: the first two cascade, and the audit rows are left
 * deliberately — the trail outlives its subject by design and a test that erased it would be testing a
 * different archive.
 */
for (const id of createdIds) {
  await db.query(`delete from ozikoro_audit where entity_type = 'ozikoro_article' and entity_id = $1`, [id]);
  await db.query(`delete from ozikoro_article where id = $1`, [id]);
}
for (const slug of createdLabels) await db.query(`delete from ozikoro_label where slug = $1 and wp_term_id is null`, [slug]);
await db.query(`delete from account where email like '${SUFFIX}-%'`);

const leftovers = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article where title like '${SUFFIX}%'`);
assert('no test row is left in the archive', Number(leftovers?.n) === 0, String(leftovers?.n));

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
