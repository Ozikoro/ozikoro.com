/**
 * Institutional access, exercised against a real database: who holds it, what a grant opens, and what a
 * withdrawal leaves behind.
 *
 * WHY THIS SUITE EXISTS RATHER THAN A NOTE IN THE MIGRATION
 *
 * The tier is decided by a database function, a role grant and a partial unique index working together, and
 * **each of the three can be satisfied while the tier is still open to the wrong account**. The specific
 * thing this suite is written to catch is the shared account table: ozikoro.com and ozituma.com are served
 * from ONE PostgreSQL and ONE `account` table, so an account whose platform role is `admin` — the
 * dictionary's own administrator — resolves the archive's `admin` capabilities through
 * `ozikoro_capabilities`. If `grant_institutional_access` had been granted to the `admin` role, **every
 * dictionary administrator would have been able to open and close access to the parent company's cultural
 * record.** So the isolation is measured here, account by account, rather than argued about.
 *
 * WHAT IT ALSO MEASURES, WHICH IS THE HONEST HALF
 *
 * How many records actually carry the mark. The tier is built whether or not it has members, and **a tier
 * with no members is a real state; a tier pretending to have members is a fabrication.** On the archive's
 * own data the number is printed, not assumed.
 *
 * Run with: npm -w @ozikoro/platform run test:institutional-access
 * Point it at a scratch cluster with OZITUMA_DB_PATH to avoid touching the archive's own rows.
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { MemberError } from './members.ts';
import {
  ACCESS_TIERS,
  grantInstitutionalAccess,
  institutionalAccessOverview,
  listInstitutionalAccess,
  listRecordsByAgreement,
  mayReadByAgreement,
  revokeInstitutionalAccess,
  setArticleAccessTier,
  withdrawnInstitutionalAccess,
} from './institutional-access.ts';

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

const SUFFIX = 'zztest-ozikoro-access';

/** One probe account, with an archive role where the case needs one. Roles are set directly so the case is
 *  exactly the case: `registerAccount` cannot make an `owner`. */
async function account(label: string, platformRole: string, archiveRole?: string): Promise<number> {
  const row = await db.one<{ id: number }>(
    `insert into account (email, display_name, role) values ($1,$2,$3::account_role) returning id`,
    [`${SUFFIX}-${label}@example.invalid`, label, platformRole]
  );
  if (!row) throw new Error('probe account could not be created');
  if (archiveRole) {
    await db.query(`insert into ozikoro_member_role (account_id, role) values ($1,$2)`, [row.id, archiveRole]);
  }
  return Number(row.id);
}

const capabilitiesOf = async (id: number): Promise<Set<string>> =>
  new Set((await db.rows<{ c: string }>(`select ozikoro_capabilities($1) as c`, [id])).map((r) => r.c));

const AUDIT_SQL = `select action, actor_id, before, after, note, created_at
                     from ozikoro_audit
                    where entity_type = 'ozikoro_institutional_access' and entity_id = $1
                    order by id`;

async function cleanup() {
  try {
    await db.query(`delete from ozikoro_audit where note like '%${SUFFIX}%'`);
    await db.query(
      `delete from ozikoro_audit where entity_type = 'ozikoro_institutional_access'
         and entity_id in (select id from ozikoro_institutional_access where account_id in
              (select id from account where email like '${SUFFIX}-%'))`
    );
    await db.query(
      `delete from ozikoro_audit where entity_type = 'ozikoro_article'
         and entity_id in (select id from ozikoro_article where slug like '${SUFFIX}-%')`
    );
    await db.query(`delete from ozikoro_institutional_access where account_id in (select id from account where email like '${SUFFIX}-%')`);
    await db.query(`delete from ozikoro_article where slug like '${SUFFIX}-%'`);
    await db.query(`delete from ozikoro_member_role where account_id in (select id from account where email like '${SUFFIX}-%')`);
    await db.query(`delete from account where email like '${SUFFIX}-%'`);
  } catch (error) {
    console.error('cleanup failed:', String(error).slice(0, 200));
  }
}

await cleanup();

// ---------------------------------------------------------------------------

console.log('\n--- the vocabulary: what each role holds, read from ozikoro_role_capability ---');

const roleRows = await db.rows<{ role: string; capability: string }>(
  `select role, capability from ozikoro_role_capability
    where capability in ('read_restricted','grant_institutional_access')
    order by capability, role`
);
for (const row of roleRows) console.log(`      ${row.capability.padEnd(28)} ${row.role}`);
const holders = new Set(roleRows.map((r) => `${r.capability}:${r.role}`));
assert('grant_institutional_access is held by the owner role', holders.has('grant_institutional_access:owner'));
assert('and by no other role', roleRows.filter((r) => r.capability === 'grant_institutional_access').length === 1,
  roleRows.filter((r) => r.capability === 'grant_institutional_access').map((r) => r.role).join(', '));
assert('read_restricted is held by the owner role', holders.has('read_restricted:owner'));
assert('and by no other role', roleRows.filter((r) => r.capability === 'read_restricted').length === 1,
  roleRows.filter((r) => r.capability === 'read_restricted').map((r) => r.role).join(', '));

console.log('\n--- who holds the tier, account by account ---');

const proprietor = await account('proprietor', 'owner', 'owner');
const dictionaryAdmin = await account('dictionary-admin', 'admin');
const archiveAdmin = await account('archive-admin', 'admin', 'admin');
const dictionaryEditor = await account('dictionary-editor', 'editor');
const archiveEditor = await account('archive-editor', 'editor', 'editor');
const reader = await account('reader', 'contributor');

const sets = new Map<string, Set<string>>();
for (const [label, id] of [
  ['proprietor (account.role=owner, archive owner)', proprietor],
  ['dictionary administrator (account.role=admin)', dictionaryAdmin],
  ['archive administrator (ozikoro_member_role=admin)', archiveAdmin],
  ['dictionary editor (account.role=editor)', dictionaryEditor],
  ['archive editor (ozikoro_member_role=editor)', archiveEditor],
  ['reader (contributor, reader role)', reader],
] as [string, number][]) {
  const caps = await capabilitiesOf(id);
  sets.set(label, caps);
  console.log(
    `      ${label.padEnd(52)} caps=${String(caps.size).padStart(2)}` +
      ` read_restricted=${String(caps.has('read_restricted')).padEnd(5)}` +
      ` grant_institutional_access=${String(caps.has('grant_institutional_access')).padEnd(5)}` +
      ` purge_trash=${caps.has('purge_trash')}`
  );
}

assert('the proprietor holds both names', await mayReadByAgreement(db, proprietor) &&
  (sets.get('proprietor (account.role=owner, archive owner)')?.has('grant_institutional_access') ?? false));
assert('A DICTIONARY ADMINISTRATOR DOES NOT HOLD THEM — the shared account table is not a way in',
  !sets.get('dictionary administrator (account.role=admin)')?.has('grant_institutional_access') &&
    !sets.get('dictionary administrator (account.role=admin)')?.has('read_restricted'));
assert('an archive administrator does not hold them either, because the owner chose a single grantor',
  !sets.get('archive administrator (ozikoro_member_role=admin)')?.has('grant_institutional_access') &&
    !sets.get('archive administrator (ozikoro_member_role=admin)')?.has('read_restricted'));
assert('an archive editor does not hold them: the vocabulary grew, the editor set did not',
  !sets.get('archive editor (ozikoro_member_role=editor)')?.has('grant_institutional_access') &&
    !sets.get('archive editor (ozikoro_member_role=editor)')?.has('read_restricted'));

const vocabulary = (await db.rows<{ capability: string }>(`select distinct capability from ozikoro_role_capability`))
  .map((r) => r.capability);
const editorCaps = sets.get('archive editor (ozikoro_member_role=editor)') ?? new Set<string>();
const notHeld = vocabulary.filter((c) => !editorCaps.has(c)).sort();
assert('the archive editor holds every capability except exactly three', notHeld.length === 3, notHeld.join(', '));
assert('and the three are the purge and the two institutional names',
  notHeld.join(',') === 'grant_institutional_access,purge_trash,read_restricted', notHeld.join(', '));

console.log('\n--- the refusals, before anything is granted ---');

await refuses('the proprietor cannot grant to an account that does not exist',
  () => grantInstitutionalAccess(db, { email: 'nobody@example.invalid', holder: 'Probe Institute', terms: 'Reading on the premises.', actorId: proprietor }),
  'no_account');
await refuses('a grant with no institution named is refused',
  () => grantInstitutionalAccess(db, { accountId: reader, holder: ' ', terms: 'Reading on the premises.', actorId: proprietor }),
  'no_holder');
await refuses('a grant with no terms recorded is refused',
  () => grantInstitutionalAccess(db, { accountId: reader, holder: 'Probe Institute', terms: 'x', actorId: proprietor }),
  'no_terms');
await refuses('A DICTIONARY ADMINISTRATOR CANNOT GRANT ACCESS',
  () => grantInstitutionalAccess(db, { accountId: reader, holder: 'Probe Institute', terms: 'Reading on the premises.', actorId: dictionaryAdmin }),
  'forbidden');
await refuses('an archive editor cannot grant access',
  () => grantInstitutionalAccess(db, { accountId: reader, holder: 'Probe Institute', terms: 'Reading on the premises.', actorId: archiveEditor }),
  'forbidden');

console.log('\n--- the grant, and what it opens ---');

const beforeGrant = await mayReadByAgreement(db, reader);
assert('the reader cannot read a record held by agreement before the grant', beforeGrant === false);

const granted = await grantInstitutionalAccess(db, {
  email: `${SUFFIX}-reader@example.invalid`,
  holder: 'Probe Institute for the Study of the Record',
  instrument: 'Agreement of 5 October 2026, clause 4',
  terms: 'Consultation in the reading room, no photography.',
  actorId: proprietor,
});
assert('the grant is recorded with its actor and its date',
  granted.id > 0 && granted.accountId === reader && granted.grantedById === proprietor && granted.active === true,
  `id=${granted.id} grantedAt=${granted.grantedAt}`);
assert('and with the terms and the instrument as stated',
  granted.holder === 'Probe Institute for the Study of the Record' &&
    granted.instrument === 'Agreement of 5 October 2026, clause 4' &&
    granted.terms === 'Consultation in the reading room, no photography.');

const afterGrant = await mayReadByAgreement(db, reader);
assert('and the reader may now read a record held by agreement', afterGrant === true);
const readerCaps = await capabilitiesOf(reader);
assert('the grant carries read_restricted and nothing else', readerCaps.has('read_restricted') &&
  !readerCaps.has('grant_institutional_access') && !readerCaps.has('purge_trash'));
assert('a grant is not a role grant', (await db.one<{ n: number }>(
  `select count(*)::int as n from ozikoro_member_role where account_id = $1`, [reader]))?.n === 0);

await refuses('a second live grant for the same account is refused, so the terms have one answer',
  () => grantInstitutionalAccess(db, { accountId: reader, holder: 'Another Body', terms: 'Other terms entirely.', actorId: proprietor }),
  'already_granted');

const listed = await listInstitutionalAccess(db, { limit: 200 });
assert('the live grant is listed', listed.some((g) => g.id === granted.id && g.active));

const liveOverview = await institutionalAccessOverview(db);
console.log(
  `      while it is in force: agreements live=${liveOverview.live} withdrawn=${liveOverview.withdrawn}` +
    `   records by_agreement=${liveOverview.gated} of ${liveOverview.published} published`
);
assert('the overview counts the agreement while it is in force', liveOverview.live >= 1, `${liveOverview.live} live`);

console.log('\n--- the mark on the record, and the count ---');

const openRecord = await db.one<{ id: number }>(
  `insert into ozikoro_article (slug, title, body_html, status, published_at, access_tier)
   values ($1, 'An open record', '<p>Open.</p>', 'published', now(), 'open') returning id`,
  [`${SUFFIX}-open`]
);
const gatedRecord = await db.one<{ id: number }>(
  `insert into ozikoro_article (slug, title, body_html, status, published_at, access_tier)
   values ($1, 'A record held by agreement', '<p>Withheld.</p>', 'published', now(), 'open') returning id`,
  [`${SUFFIX}-gated`]
);
const openId = Number(openRecord?.id);
const gatedId = Number(gatedRecord?.id);

await refuses('a record cannot be placed in a tier with no reason',
  () => setArticleAccessTier(db, { articleId: gatedId, tier: 'by_agreement', reason: ' ', actorId: proprietor }),
  'no_reason');
await refuses('a tier outside the two is refused',
  () => setArticleAccessTier(db, { articleId: gatedId, tier: 'secret' as never, reason: 'because', actorId: proprietor }),
  'bad_tier');
await refuses('a dictionary administrator cannot place a record under an agreement',
  () => setArticleAccessTier(db, { articleId: gatedId, tier: 'by_agreement', reason: 'because', actorId: dictionaryAdmin }),
  'forbidden');

await setArticleAccessTier(db, {
  articleId: gatedId,
  tier: 'by_agreement',
  reason: 'The donor’s agreement of 4 October 2026 restricts reading to the named institution.',
  actorId: proprietor,
});
const marked = await db.one<{ access_tier: string }>(`select access_tier from ozikoro_article where id = $1`, [gatedId]);
assert('the record carries the new mark', marked?.access_tier === 'by_agreement', marked?.access_tier);
await refuses('setting the tier it is already in is refused rather than recorded',
  () => setArticleAccessTier(db, { articleId: gatedId, tier: 'by_agreement', reason: 'again', actorId: proprietor }),
  'no_change');

const byAgreement = await listRecordsByAgreement(db, { limit: 200 });
assert('the screen lists the record held by agreement, with its reference',
  byAgreement.some((r) => r.id === gatedId && r.reference === `OZ-H-${String(gatedId).padStart(4, '0')}`));
assert('and not the open one', !byAgreement.some((r) => r.id === openId));

/*
 * THE TWO CLAIMS, MEASURED AS TWO COLUMNS.
 *
 * `ozikoro_media_rights.restricted` and `ozikoro_article.access_tier` are in two different tables and there
 * is no view, trigger or generated column joining them. If a later change made one derive from the other,
 * this is where it would show.
 */
const columns = await db.rows<{ table_name: string; column_name: string }>(
  `select table_name, column_name from information_schema.columns
    where column_name in ('restricted','access_tier') and table_name in ('ozikoro_media_rights','ozikoro_article')
    order by table_name, column_name`
);
assert('the reuse claim and the reading claim are two columns in two tables',
  columns.length === 2 &&
    columns.some((c) => c.table_name === 'ozikoro_media_rights' && c.column_name === 'restricted') &&
    columns.some((c) => c.table_name === 'ozikoro_article' && c.column_name === 'access_tier'),
  columns.map((c) => `${c.table_name}.${c.column_name}`).join(', '));
assert('and the mark’s vocabulary never uses the other claim’s word',
  ACCESS_TIERS.join(',') === 'open,by_agreement' && !ACCESS_TIERS.join(',').includes('restrict'));

console.log('\n--- the revocation: its own audit row, and the grant survives ---');

const grantRowsBefore = await db.rows<{ id: number; granted_at: string; granted_by: number; terms: string }>(
  `select id, granted_at, granted_by, terms from ozikoro_institutional_access where account_id = $1 order by id`,
  [reader]
);
await refuses('a withdrawal with no reason is refused',
  () => revokeInstitutionalAccess(db, { id: granted.id, reason: ' ', actorId: proprietor }),
  'no_reason');
await refuses('a dictionary administrator cannot withdraw access',
  () => revokeInstitutionalAccess(db, { id: granted.id, reason: 'Not their decision to make.', actorId: dictionaryAdmin }),
  'forbidden');
await refuses('an agreement that does not exist is refused',
  () => revokeInstitutionalAccess(db, { id: 999_999_999, reason: 'Nothing there.', actorId: proprietor }),
  'no_grant');

const revoked = await revokeInstitutionalAccess(db, {
  id: granted.id,
  reason: 'The agreement lapsed at the end of its term and has not been renewed.',
  actorId: proprietor,
});
assert('the withdrawal is stamped on the grant rather than deleting it',
  revoked.revokedAt !== null && revoked.revokedByEmail !== null && revoked.active === false,
  `revokedAt=${revoked.revokedAt}`);
assert('the grant itself is still there, with its actor, its date and its terms unchanged',
  revoked.grantedAt === granted.grantedAt && revoked.terms === granted.terms && revoked.grantedById === proprietor);
const grantRowsAfter = await db.rows<{ id: number; granted_at: string; granted_by: number; terms: string }>(
  `select id, granted_at, granted_by, terms from ozikoro_institutional_access where account_id = $1 order by id`,
  [reader]
);
assert('so the row count is unchanged: a withdrawal is not a delete',
  grantRowsAfter.length === grantRowsBefore.length && grantRowsAfter.length === 1,
  `${grantRowsBefore.length} before, ${grantRowsAfter.length} after`);

assert('and the reader cannot read a record held by agreement again', (await mayReadByAgreement(db, reader)) === false);
const readerCapsAfter = await capabilitiesOf(reader);
assert('the capability went with the withdrawal, and nothing else changed',
  !readerCapsAfter.has('read_restricted') && readerCapsAfter.size === 3);

const told = await withdrawnInstitutionalAccess(db, reader);
assert('the person who lost access can be told when and why',
  told !== null && told.reason === 'The agreement lapsed at the end of its term and has not been renewed.',
  told?.reason);

console.log('\n--- both audit rows, quoted ---');

const audit = await db.rows<{ action: string; actor_id: number; before: unknown; after: unknown; note: string; created_at: string }>(AUDIT_SQL, [granted.id]);
assert('the grant wrote its own audit row', audit.some((a) => a.action === 'grant_institutional_access'));
assert('the withdrawal wrote a second audit row of its own', audit.some((a) => a.action === 'revoke_institutional_access'));
assert('both name the actor', audit.every((a) => Number(a.actor_id) === proprietor), audit.map((a) => String(a.actor_id)).join(','));
for (const row of audit) {
  console.log(`      ${row.created_at ?? ''} ${row.action}  actor=${row.actor_id}`);
  console.log(`        before ${JSON.stringify(row.before)}`);
  console.log(`        after  ${JSON.stringify(row.after)}`);
}
const tierAudit = await db.rows<{ action: string; before: unknown; after: unknown; note: string }>(
  `select action, before, after, note from ozikoro_audit where entity_type = 'ozikoro_article' and entity_id = $1 order by id`,
  [gatedId]
);
assert('placing the record in a tier is audited with its reason',
  tierAudit.some((a) => a.action === 'set_access_tier' && JSON.stringify(a.after).includes('by_agreement')),
  tierAudit.map((a) => a.action).join(', '));

console.log('\n--- how many records are actually held by agreement ---');

const overview = await institutionalAccessOverview(db);
console.log(
  `      agreements live=${overview.live} withdrawn=${overview.withdrawn}` +
    `   records by_agreement=${overview.gated} (published ${overview.gatedPublished}) of ${overview.published} published`
);
const liveRows = await db.one<{ n: number }>(
  `select count(*)::int as n from ozikoro_institutional_access where revoked_at is null`
);
assert('the live count agrees with the table', overview.live === Number(liveRows?.n ?? 0),
  `overview ${overview.live}, table ${liveRows?.n}`);
assert('and the withdrawn one, which is kept rather than deleted', overview.withdrawn >= 1);
assert('and the records actually carrying the mark', overview.gated >= 1);

/*
 * THE NUMBER THE REPORT HAS TO STATE PLAINLY, MEASURED RATHER THAN ASSUMED.
 *
 * On a scratch cluster this counts the two probe records the suite made. On the archive's own data the same
 * query is the answer to "how many records are actually gated?", and if it is zero the report says zero.
 */
const archiveOwnMark = await db.rows<{ slug: string }>(
  `select slug from ozikoro_article where access_tier = 'by_agreement' and slug not like '${SUFFIX}-%'`
);
console.log(
  `      records held by agreement that are NOT this suite's fixtures: ${archiveOwnMark.length}` +
    `${archiveOwnMark.length ? ` (${archiveOwnMark.map((r) => r.slug).join(', ')})` : ' — none'}`
);

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await cleanup();
await closeDb();
process.exit(failures === 0 ? 0 : 1);
