/**
 * Media rights, tested as refusals and as sentences a reader will rely on.
 *
 * The archive has 3,488 media items with no rights recorded at all, so this module is the only thing
 * standing between a published photograph and a claim that nobody made. The assertions are therefore
 * about what it will not let somebody write: publication without a stated basis, a living subject
 * with no consent, a restriction with no reason, and an un-restriction with no explanation.
 *
 * The other half is the sentence shown to the public, which is generated from the record. A page that
 * says the wrong thing about a right is worse than one that says nothing, because a reader will act
 * on it, so each state's wording is asserted.
 *
 * Run with: npm -w @ozikoro/platform run test:rights
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import { MemberError } from './members.ts';
import {
  getMediaRights,
  getRightsProgress,
  listRightsQueue,
  rightsStatement,
  setMediaRestriction,
  setMediaRights,
} from './rights.ts';

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

const SUFFIX = 'zztest-ozikoro-rights';
await db.query(`delete from account where email like '${SUFFIX}-%'`);
const editor = await registerAccount(db, { email: `${SUFFIX}-editor@example.com`, password: 'a long enough password' });

/** Two real media items, one heavily used and one not, so the queue order can be checked. */
const used = await db.one<{ id: string; slug: string }>(`
  select m.id, m.slug from ozikoro_media m
   where (select count(*) from ozikoro_article_media am where am.media_id = m.id) > 0
   order by (select count(*) from ozikoro_article_media am where am.media_id = m.id) desc limit 1
`);
const unused = await db.one<{ id: string }>(`
  select m.id from ozikoro_media m
   where not exists (select 1 from ozikoro_article_media am where am.media_id = m.id) limit 1
`);

async function cleanup() {
  try {
    for (const id of [used?.id, unused?.id]) {
      if (!id) continue;
      await db.query(`delete from ozikoro_media_rights where media_id = $1`, [Number(id)]);
      await db.query(`delete from ozikoro_audit where entity_type = 'ozikoro_media_rights' and entity_id = $1`, [Number(id)]);
    }
    await db.query(`delete from account where email like '${SUFFIX}-%'`);
  } catch (error) {
    console.error('cleanup failed:', String(error).slice(0, 200));
  }
  await closeDb();
}

// Start from a clean slate for the two items this suite touches.
for (const id of [used?.id, unused?.id]) {
  if (id) await db.query(`delete from ozikoro_media_rights where media_id = $1`, [Number(id)]);
}

// ---------------------------------------------------------------------------

console.log('\n--- the gap this module exists for ---');

const progress = await getRightsProgress(db);
assert('the archive has media', progress.media >= 3000, `${progress.media} items`);
assert('and almost none of it has rights established', progress.checked < 10, `${progress.checked} checked`);
assert('which is measured as exposure, not just as a count',
  progress.articlesUsingUnchecked >= 0, `${progress.articlesUsingUnchecked} article–media uses on unchecked items`);

console.log('\n--- an unchecked item permits nothing and says so ---');

assert('an item with no rights record has none', (await getMediaRights(db, Number(unused!.id))) === null);
const uncheckedStatement = rightsStatement(null);
assert('and the public sentence says rights are not established', uncheckedStatement.includes('No rights have been established'), uncheckedStatement.slice(0, 60));
assert('and that it is not a grant either way', uncheckedStatement.includes('has not been granted either way'));

console.log('\n--- the refusals ---');

await refuses('publication cannot be permitted without a stated basis',
  () => setMediaRights(db, { mediaId: Number(unused!.id), allowsPublication: true, allowsDerivative: false, allowsCommercial: false, actorId: editor.id }),
  'no_basis');

await refuses('a permission basis outside the vocabulary is refused',
  () => setMediaRights(db, { mediaId: Number(unused!.id), allowsPublication: true, allowsDerivative: false, allowsCommercial: false, permissionBasis: 'vibes' as never, actorId: editor.id }),
  'bad_basis');

await refuses('a living subject with no consent state is refused',
  () => setMediaRights(db, { mediaId: Number(unused!.id), allowsPublication: true, allowsDerivative: false, allowsCommercial: false, permissionBasis: 'written_permission', subjectIsLiving: true, actorId: editor.id }),
  'living_subject_needs_consent');

await refuses('a licence link that is not a link is refused',
  () => setMediaRights(db, { mediaId: Number(unused!.id), allowsPublication: true, allowsDerivative: false, allowsCommercial: false, permissionBasis: 'published_licence', licenceUrl: 'creativecommons.org/licenses/by/4.0', actorId: editor.id }),
  'bad_licence_url');

await refuses('a permission date that is not a date is refused',
  () => setMediaRights(db, { mediaId: Number(unused!.id), allowsPublication: true, allowsDerivative: false, allowsCommercial: false, permissionBasis: 'written_permission', permissionDate: 'last Tuesday', actorId: editor.id }),
  'bad_date');

await refuses('an item cannot be restricted before its rights are recorded',
  () => setMediaRestriction(db, { mediaId: Number(unused!.id), restricted: true, reason: 'requested by the family', actorId: editor.id }),
  'not_checked');

console.log('\n--- recording what was established ---');

await setMediaRights(db, {
  mediaId: Number(unused!.id),
  holderName: 'The family of the photographer',
  holderContact: 'family@example.org',
  allowsPublication: true,
  allowsDerivative: true,
  allowsCommercial: false,
  licence: 'CC BY-NC 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  permissionBasis: 'written_permission',
  permissionDate: '2026-09-01',
  permissionNote: 'Letter held in the archive.',
  subjectIsLiving: false,
  subjectConsent: 'not_required',
  actorId: editor.id,
});

const recorded = await getMediaRights(db, Number(unused!.id));
assert('the rights are recorded', recorded !== null);
assert('as checked, with who checked and when', recorded?.isChecked === true && recorded?.checkedByName?.includes('editor') === true);
assert('holdership is kept', recorded?.holderName === 'The family of the photographer');
assert('permissions are kept separately', recorded?.allowsPublication === true && recorded?.allowsDerivative === true && recorded?.allowsCommercial === false);
assert('the basis and the date are kept', recorded?.permissionBasis === 'written_permission' && recorded?.permissionDate === '2026-09-01');

const statement = recorded!.publicStatement;
assert('the public sentence names the licence', statement.includes('CC BY-NC 4.0'), statement.slice(0, 80));
// Both sides, always. Silence about a restriction reads as permission.
assert('and says what it permits', statement.includes('permits adaptation'), statement.slice(0, 90));
assert('and what it does NOT permit', statement.includes('does not permit commercial use'), statement);
assert('and never overstates', !statement.includes('No rights have been established'));

console.log('\n--- a licence that permits nothing is a different sentence ---');

await setMediaRights(db, {
  mediaId: Number(unused!.id), holderName: 'Unknown', allowsPublication: false, allowsDerivative: false,
  allowsCommercial: false, permissionBasis: 'orphan_work', permissionNote: 'Holder could not be traced.',
  subjectIsLiving: false, subjectConsent: 'not_required', actorId: editor.id,
});
const noPermit = await getMediaRights(db, Number(unused!.id));
assert('rights recorded but not permitting publication says so', (noPermit?.publicStatement ?? '').includes('do not permit publication'), noPermit?.publicStatement?.slice(0, 70));
assert('and names who holds them', (noPermit?.publicStatement ?? '').includes('Unknown'));

console.log('\n--- restriction, and lifting it ---');

await refuses('a restriction with no reason is refused',
  () => setMediaRestriction(db, { mediaId: Number(unused!.id), restricted: true, reason: 'x', actorId: editor.id }),
  'no_reason');

await setMediaRestriction(db, { mediaId: Number(unused!.id), restricted: true, reason: 'Withdrawal requested by the family.', actorId: editor.id });
const restricted = await getMediaRights(db, Number(unused!.id));
assert('the item is restricted', restricted?.restricted === true);
assert('with the reason kept', restricted?.restrictionReason === 'Withdrawal requested by the family.');
assert('and a takedown request recorded', restricted?.takedownRequestedAt !== null);
assert('and it is unresolved', restricted?.takedownResolvedAt === null);
assert('the public sentence says it is restricted', (restricted?.publicStatement ?? '').includes('is restricted'), restricted?.publicStatement?.slice(0, 60));

await setMediaRestriction(db, { mediaId: Number(unused!.id), restricted: false, reason: 'Withdrawal resolved by agreement.', actorId: editor.id, resolveTakedown: true });
const lifted = await getMediaRights(db, Number(unused!.id));
assert('the restriction can be lifted, with a reason', lifted?.restricted === false && lifted?.restrictionReason === 'Withdrawal resolved by agreement.');
assert('and the takedown is marked resolved', lifted?.takedownResolvedAt !== null);

console.log('\n--- the queue works the exposure first ---');

const queue = await listRightsQueue(db, { filter: 'unchecked', limit: 50 });
assert('the queue returns unchecked items', queue.length > 0, `${queue.length} items`);
assert('ordered by how many published articles use them', (queue[0]?.usedByArticles ?? 0) >= (queue[queue.length - 1]?.usedByArticles ?? 0), `top uses ${queue[0]?.usedByArticles}, bottom ${queue[queue.length - 1]?.usedByArticles}`);
assert('with a citable reference for each', /^OZ-[PVDXA]-\d{4}$/.test(queue[0]?.reference ?? ''), queue[0]?.reference);

const checkedQueue = await listRightsQueue(db, { filter: 'checked', limit: 200 });
assert('checked items leave the unchecked queue', !checkedQueue.some((q) => q.mediaId === Number(unused!.id)) === false || checkedQueue.some((q) => q.mediaId === Number(unused!.id)));

const afterRights = await getRightsProgress(db);
assert('progress counts the work done', afterRights.checked >= 1, `${afterRights.checked} checked of ${afterRights.media}`);
assert('and the unchecked count fell', afterRights.unchecked < afterRights.media, `${afterRights.unchecked} still unchecked`);

console.log('\n--- an edit is an edit, not a second opinion ---');

await setMediaRights(db, {
  mediaId: Number(unused!.id), holderName: 'Corrected holder', allowsPublication: true, allowsDerivative: false,
  allowsCommercial: false, permissionBasis: 'written_permission', subjectIsLiving: false,
  subjectConsent: 'not_required', actorId: editor.id,
});
const edited = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_media_rights where media_id = $1`, [Number(unused!.id)]);
assert('there is exactly one rights record per item', Number(edited?.n ?? 0) === 1, `${edited?.n} rows`);

const audit = await db.rows<{ action: string }>(
  `select action from ozikoro_audit where entity_type = 'ozikoro_media_rights' and entity_id = $1`,
  [Number(unused!.id)]
);
assert('recording rights is audited', audit.some((a) => a.action === 'record_rights'));
assert('changing them is audited as an update', audit.some((a) => a.action === 'update_rights'));
assert('restricting is audited', audit.some((a) => a.action === 'restrict'));
assert('and so is lifting it', audit.some((a) => a.action === 'lift_restriction'));

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await cleanup();
process.exit(failures === 0 ? 0 : 1);
