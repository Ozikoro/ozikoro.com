/**
 * The trash, tested as a set of promises the bin has to keep.
 *
 * WHAT MATTERS HERE IS NOT THAT A DELETE WORKS — it is that a delete is a MOVE. So the checks are: a deleted
 * record leaves the archive but keeps everything that made it a record; recovering it puts it back as what it
 * WAS rather than as a default; destroying it needs a capability an editor does not hold, is refused without
 * it, and leaves an audit row that outlives the thing it is about.
 *
 * **THE LAST OF THOSE IS THE ONE THAT WOULD BE INVISIBLE IF IT WERE WRONG.** `ozikoro_audit.entity_id` has no
 * foreign key to its subject, so the trail survives a purge — but that is a property of the schema rather
 * than of this module, and a property nobody checks is a property that quietly stops being true. So the test
 * purges a record and then reads the audit row back.
 *
 * Run with: node src/test-trash.ts
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import { MemberError, grantRole } from './members.ts';
import {
  TRASH_PURGE_CAPABILITY,
  countTrash,
  listTrash,
  purgeArticle,
  purgeMedia,
  restoreArticle,
  restoreMedia,
  trashArticle,
  trashMedia,
  articleReference,
} from './trash.ts';
import { getArticleContent, updateArticleContent } from './editorial.ts';
import { getMediaBySlug, getMediaForEdit, listMedia } from './media.ts';

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
    assert(label, actual === code, actual || String(error).slice(0, 90));
  }
};

const SUFFIX = 'zztest-ozikoro-trash';
await db.query(`delete from account where email like '${SUFFIX}-%'`);
const editor = await registerAccount(db, { email: `${SUFFIX}-editor@example.com`, password: 'a long enough password' });
const admin = await registerAccount(db, { email: `${SUFFIX}-admin@example.com`, password: 'a long enough password' });
/*
 * THE ARCHIVE ROLE, NOT THE PLATFORM ROLE, AND THAT DISTINCTION IS THE WHOLE REASON THIS LINE EXISTS.
 *
 * `ozikoro_capabilities` grants the platform `admin` and `owner` roles the admin capability set, because that
 * is how the first administrator exists — but it does NOT do that for the platform role `editor`, which is a
 * real value in the `account_role` enum from migration 0001 and carries nothing by itself. **An "editor" on
 * this site is somebody with an `ozikoro_member_role` row saying editor**, and a test that set only the
 * platform column would be asserting capabilities for an account that has none. The first version of this
 * file did exactly that, and its capability assertions failed — which is how the distinction got written down.
 */
await grantRole(db, { accountId: editor.id, role: 'editor', grantedBy: null });
await db.query(`update account set role = 'admin' where id = $1`, [admin.id]);

/** The real capability sets, read from the database — not hand-written, because the rule lives there. */
const editorCaps = new Set(
  (await db.rows<{ capability: string }>(`select ozikoro_capabilities($1) as capability`, [editor.id])).map((r) => r.capability)
);
const adminCaps = new Set(
  (await db.rows<{ capability: string }>(`select ozikoro_capabilities($1) as capability`, [admin.id])).map((r) => r.capability)
);

console.log('\n--- the prohibition is the only one, and it is where it should be ---');
assert('an editor holds edit_entity', editorCaps.has('edit_entity'));
assert('an editor may approve and unpublish', editorCaps.has('publish'));
assert('an editor may describe and permit media use', editorCaps.has('manage_media_rights'));
assert('an editor may NOT destroy anything for good', !editorCaps.has(TRASH_PURGE_CAPABILITY));
assert('an administrator may', adminCaps.has(TRASH_PURGE_CAPABILITY));

/*
 * A record to work on, chosen for the state the test assumes: a PUBLISHED record, because the promise that
 * matters most is that recovering one restores it to published rather than to a default. Its text is captured
 * so the test can put back exactly what it found — this suite edits and destroys real archive rows.
 */
const target = await db.one<Record<string, unknown>>(
  `select id, slug, title, standfirst, body_html, status from ozikoro_article
    where status = 'published' and is_page = false order by id limit 1`
);
assert('there is a published record to work on', target !== null, target ? String(target.slug) : 'none');

const articleId = Number(target!.id);
const original = {
  title: String(target!.title),
  standfirst: target!.standfirst === null || target!.standfirst === undefined ? null : String(target!.standfirst),
  bodyHtml: String(target!.body_html ?? ''),
};

console.log('\n--- a delete is a move, and it says who and when ---');
const before = await countTrash(db);
const trashed = await trashArticle(db, { articleId, actorId: editor.id, note: 'zztest: exercising the bin' });
assert('the archive reports the state it was taken out of', trashed.from === 'published', trashed.from);
assert('and names the record by its reference', trashed.reference === articleReference(articleId), trashed.reference);

const row = await db.one<Record<string, unknown>>(`select status, deleted_at, deleted_by, deleted_from_status from ozikoro_article where id = $1`, [articleId]);
assert('the status is trashed', String(row?.status) === 'trashed', String(row?.status));
assert('the moment is recorded', row?.deleted_at !== null && row?.deleted_at !== undefined);
assert('the person is recorded', Number(row?.deleted_by) === editor.id, String(row?.deleted_by));
assert('and the state to come back to is kept', String(row?.deleted_from_status) === 'published', String(row?.deleted_from_status));

const inBin = await listTrash(db);
const mine = inBin.find((i) => i.kind === 'article' && i.id === articleId);
assert('it appears in the bin', mine !== undefined);
assert('with the account that deleted it', mine?.deletedByEmail === `${SUFFIX}-editor@example.com`, mine?.deletedByEmail ?? 'null');
assert('with the timestamp', typeof mine?.deletedAt === 'string' && mine.deletedAt.length > 10);
assert('and with what recovery would restore', mine?.wasStatus === 'published', mine?.wasStatus ?? 'null');
const after = await countTrash(db);
assert('and the bin grew by exactly one', after.total === before.total + 1, `${before.total} -> ${after.total}`);

console.log('\n--- and the archive does not serve it, which is the whole point ---');
const served = await db.one<{ n: number }>(
  `select count(*)::int as n from ozikoro_article where slug = $1 and status = 'published' and is_page = false`,
  [String(target!.slug)]
);
assert('the query the reading page runs finds nothing', Number(served?.n) === 0);

console.log('\n--- recovery restores what it WAS, not a default ---');
const restored = await restoreArticle(db, { articleId, actorId: editor.id });
assert('it comes back as published', restored.to === 'published', restored.to);
const back = await getArticleContent(db, articleId);
assert('with its title', back?.title === original.title);
assert('its summary', (back?.standfirst ?? null) === original.standfirst);
assert('and its whole body', back?.bodyHtml === original.bodyHtml, `${back?.bodyHtml.length} vs ${original.bodyHtml.length} characters`);
const cleared = await db.one<Record<string, unknown>>(`select deleted_at, deleted_by, deleted_from_status from ozikoro_article where id = $1`, [articleId]);
assert('and the bin markers are cleared', cleared?.deleted_at === null && cleared?.deleted_by === null && cleared?.deleted_from_status === null);

console.log('\n--- a purge needs the capability, and is refused without it ---');
/*
 * EVERY PURGE IN THIS TEST IS AIMED AT A RECORD THE TEST MADE.
 *
 * THIS IS NOT STYLE; IT IS A CORRECTION. The first version of this file ran its "a purge of a record that is
 * not in the bin is refused" check against article id 1 — a real published history — and **it destroyed it**,
 * because the record happened to be in the bin at that moment from the previous check. The refusal it was
 * asserting (a record not in the bin cannot be purged) was true and the test proved the opposite of what it
 * intended, because it aimed an irreversible act at the archive rather than at its own fixture.
 *
 * So: one fixture, made here, used by every destructive check below. The real record is only ever trashed and
 * restored, and the test asserts at the end that it is still there.
 */
const doomed = await db.one<{ id: number }>(
  `insert into ozikoro_article (slug, title, standfirst, body_html, status, is_page)
   values ($1, $2, $3, $4, 'draft', false) returning id`,
  [`${SUFFIX}-doomed`, 'zztest: a record made to be destroyed', 'a summary', '<p>body</p>']
);
const doomedId = Number(doomed!.id);
await updateArticleContent(db, {
  articleId: doomedId,
  title: 'zztest: a record made to be destroyed',
  standfirst: 'a summary',
  bodyHtml: '<p>a body with a revision behind it</p>',
  actorId: editor.id,
  note: 'zztest: so there is a revision to destroy with it',
});
const revisionBefore = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article_revision where article_id = $1`, [doomedId]);
assert('a fixture exists, carrying one revision to be destroyed with it', Number(revisionBefore?.n) === 1);

await refuses(
  'a purge of a record that is NOT in the bin is refused',
  () => purgeArticle(db, { articleId: doomedId, actorId: admin.id, capabilities: adminCaps, confirm: articleReference(doomedId) }),
  'not_trashed'
);
assert('and the fixture is still there', Number((await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article where id = $1`, [doomedId]))?.n) === 1);

await trashArticle(db, { articleId: doomedId, actorId: editor.id });
await refuses(
  'an editor cannot destroy a record',
  () => purgeArticle(db, { articleId: doomedId, actorId: editor.id, capabilities: editorCaps, confirm: articleReference(doomedId) }),
  'forbidden'
);
assert('and the fixture is untouched by the refusal', Number((await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article where id = $1`, [doomedId]))?.n) === 1);
await refuses(
  'and a purge whose confirmation does not name the record is refused',
  () => purgeArticle(db, { articleId: doomedId, actorId: admin.id, capabilities: adminCaps, confirm: 'yes' }),
  'confirm_mismatch'
);
assert('with the fixture still there after a refused confirmation', Number((await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article where id = $1`, [doomedId]))?.n) === 1);

console.log('\n--- the irreversible act, and the audit row that outlives it ---');
const purged = await purgeArticle(db, {
  articleId: doomedId,
  actorId: admin.id,
  capabilities: adminCaps,
  confirm: articleReference(doomedId),
});
assert('an administrator destroys it', purged.reference === articleReference(doomedId));
assert('and is told what went with it — one revision', purged.destroyed.revisions === 1, JSON.stringify(purged.destroyed));

const gone = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article where id = $1`, [doomedId]);
assert('the record is gone', Number(gone?.n) === 0);
const revisionsGone = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article_revision where article_id = $1`, [doomedId]);
assert('and its revisions went with it, which the notice said', Number(revisionsGone?.n) === 0);

const trail = await db.rows<Record<string, unknown>>(
  `select action, actor_id, note, after from ozikoro_audit where entity_type = 'ozikoro_article' and entity_id = $1 order by id`,
  [doomedId]
);
const actions = trail.map((t) => String(t.action));
assert('the audit trail survives the record', trail.length >= 3, actions.join(', '));
assert('it records the destruction', actions.includes('purge_article'));
assert('it records who deleted it first', actions.includes('trash_article'));
assert('the destroyer is named', trail.some((t) => String(t.action) === 'purge_article' && Number(t.actor_id) === admin.id));
assert('and the row says the act was irreversible', trail.some((t) => String(t.action) === 'purge_article' && JSON.stringify(t.after).includes('irreversible')));
assert('and says what it took with it', trail.some((t) => String(t.action) === 'purge_article' && JSON.stringify(t.after).includes('revisions')));

console.log('\n--- media: hidden from the catalogue, file untouched ---');
const media = await db.one<Record<string, unknown>>(`select id, slug, kind from ozikoro_media where deleted_at is null order by id limit 1`);
assert('there is a media record to work on', media !== null);
const mediaId = Number(media!.id);
const mediaSlug = String(media!.slug);
const mediaTrashed = await trashMedia(db, { mediaId, actorId: editor.id });
assert('an editor may delete a media record', mediaTrashed.reference.startsWith('OZ-'), mediaTrashed.reference);
assert('it leaves the catalogue lookups', (await getMediaBySlug(db, mediaSlug)) === null);
assert('it leaves the media list', !(await listMedia(db, { limit: 100 })).some((m) => m.id === mediaId));
assert('and it is in the bin', (await listTrash(db)).some((i) => i.kind === 'media' && i.id === mediaId));
const stillHeld = await db.one<Record<string, unknown>>(`select storage_key, caption, title from ozikoro_media where id = $1`, [mediaId]);
assert('but the row keeps everything about it', stillHeld !== null);

await refuses(
  'an editor cannot destroy a media record either',
  () => purgeMedia(db, { mediaId, actorId: editor.id, capabilities: editorCaps, confirm: mediaTrashed.reference }),
  'forbidden'
);
await restoreMedia(db, { mediaId, actorId: editor.id });
const backAgain = await getMediaBySlug(db, mediaSlug);
assert('and restoring it puts it back in the catalogue', backAgain !== null);
assert('with its own description unchanged', backAgain?.caption === (stillHeld?.caption ?? null) && backAgain?.storedTitle === (stillHeld?.title ?? null));

console.log('\n--- the record this test edited is put back as it was found ---');
const finished = await getArticleContent(db, articleId);
if (finished?.status === 'trashed') await restoreArticle(db, { articleId, actorId: editor.id });
const final = await getArticleContent(db, articleId);
assert('the real record is published again', final?.status === 'published', final?.status ?? 'missing');
assert('with its own words', final?.title === original.title && final?.bodyHtml === original.bodyHtml);
assert('and it was never a candidate for a purge in this test', articleId !== doomedId);

// Everything this test made is removed. The real record is left exactly as the archive held it.
await db.query(`delete from ozikoro_audit where actor_id in ($1, $2)`, [editor.id, admin.id]);
await db.query(`delete from ozikoro_member_role where account_id in ($1, $2)`, [editor.id, admin.id]);
await db.query(`delete from ozikoro_member where account_id in ($1, $2)`, [editor.id, admin.id]);
await db.query(`delete from account where id in ($1, $2)`, [editor.id, admin.id]);

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await closeDb();
process.exit(failures === 0 ? 0 : 1);
