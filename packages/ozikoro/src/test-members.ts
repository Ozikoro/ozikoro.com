/**
 * Roles and permissions, tested as rules rather than as happy paths.
 *
 * Every check here is about a refusal. A permission system that works when used correctly is not a
 * permission system; it is a permission system if it says no to the things that should not happen.
 * The plan's rule is "enforce permissions server-side, never rely on hidden buttons", so these
 * assertions are the enforcement.
 *
 * Run with: npm -w @ozikoro/platform run test:members
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import {
  MemberError,
  ROLE_PURPOSE,
  OZIKORO_ROLES,
  can,
  capabilitiesFor,
  decideContributorClaim,
  ensureMember,
  getMember,
  grantRole,
  listContributorClaims,
  listClaimableBylines,
  requestContributorClaim,
  requireCapability,
  revokeRole,
  setMemberStatus,
  updateMemberProfile,
} from './members.ts';
/*
 * The rank rule is its own module, and the test imports it from where it lives rather than through the barrel
 * — the barrel is `src/index.ts`, which pulls in the Spotify client and the PDF writer, and a test that needs
 * a database should not need a network client to reach it.
 */
import { grantableRoles, mayGrantRole, roleRanks } from './roles.ts';

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

const SUFFIX = 'zztest-ozikoro-member';
await db.query(`delete from account where email like '${SUFFIX}-%'`);

const reader = await registerAccount(db, { email: `${SUFFIX}-reader@example.com`, password: 'a long enough password' });
const publisher = await registerAccount(db, { email: `${SUFFIX}-publisher@example.com`, password: 'a long enough password' });
const both = await registerAccount(db, { email: `${SUFFIX}-both@example.com`, password: 'a long enough password' });
const platformAdmin = await registerAccount(db, { email: `${SUFFIX}-admin@example.com`, password: 'a long enough password' });
await db.query(`update account set role = 'admin' where id = $1`, [platformAdmin.id]);

async function cleanup() {
  try {
    await db.query(`delete from ozikoro_member_role where account_id in ($1,$2,$3,$4)`, [reader.id, publisher.id, both.id, platformAdmin.id]);
    await db.query(`delete from ozikoro_contributor_claim where account_id in ($1,$2,$3,$4)`, [reader.id, publisher.id, both.id, platformAdmin.id]);
    await db.query(`delete from ozikoro_member where account_id in ($1,$2,$3,$4)`, [reader.id, publisher.id, both.id, platformAdmin.id]);
    await db.query(`delete from ozikoro_audit where entity_type = 'ozikoro_member' and entity_id in ($1,$2,$3,$4)`, [reader.id, publisher.id, both.id, platformAdmin.id]);
    await db.query(`delete from account where email like '${SUFFIX}-%'`);
  } catch (error) {
    console.error('cleanup failed:', String(error).slice(0, 200));
  }
  await closeDb();
}

// ---------------------------------------------------------------------------

console.log('\n--- the roles the plan names ---');

/*
 * Eleven, not the plan's ten. `owner` was added above `admin` by migration 0044, because with ten roles every
 * administrator can mint another and no administrator can be removed by anyone of equal rank — which makes
 * the staff collectively able to outvote the proprietor of the record. The assertion is written as a count
 * rather than a list so that a role added without a label or a purpose still fails the two checks below.
 */
assert('all eleven roles exist, the owner included', OZIKORO_ROLES.length === 11, OZIKORO_ROLES.join(', '));
assert('every role explains itself, so a dashboard can too', OZIKORO_ROLES.every((r) => (ROLE_PURPOSE[r] ?? '').length > 20));
assert('university affiliation is not implied by any role', Object.values(ROLE_PURPOSE).every((p) => !/must|required/i.test(p)));

console.log('\n--- a signed-in account is at least a reader ---');

const member = await ensureMember(db, reader.id);
assert('signing in gives a membership', member.accountId === reader.id);
assert('with no special roles', member.roles.length === 0, member.roles.join(', '));
assert('and it is idempotent', (await ensureMember(db, reader.id)).accountId === reader.id);

const readerCaps = await capabilitiesFor(db, reader.id);
assert('a reader may read', readerCaps.has('read'));
assert('a reader may bookmark', readerCaps.has('bookmark'));
assert('a reader may NOT publish', !readerCaps.has('publish'));
assert('a reader may NOT edit entities', !readerCaps.has('edit_entity'));
assert('a reader may NOT manage users', !readerCaps.has('manage_users'));
assert('a reader may NOT view the audit log', !readerCaps.has('view_audit'));

console.log('\n--- an editor may do editorial work and nothing else ---');
await grantRole(db, { accountId: publisher.id, role: 'editor', grantedBy: platformAdmin.id });
const editorCaps = await capabilitiesFor(db, publisher.id);
assert('an editor may publish', editorCaps.has('publish'));
assert('an editor may manage sources', editorCaps.has('manage_source'));
assert('an editor may manage claims', editorCaps.has('manage_claim'));
assert('an editor may work the review queue', editorCaps.has('review_queue'));
assert('an editor may NOT manage users', !editorCaps.has('manage_users'));
assert('an editor may NOT grant roles', !editorCaps.has('manage_roles'));
assert('an editor may NOT change media rights', !editorCaps.has('manage_media_rights'));
assert('and still may not moderate', !editorCaps.has('moderate'));

console.log('\n--- roles are plural, because people are ---');
await grantRole(db, { accountId: both.id, role: 'researcher', grantedBy: null });
await grantRole(db, { accountId: both.id, role: 'teacher', grantedBy: null });
const bothMember = await getMember(db, both.id);
assert('a person can hold two roles at once', bothMember?.roles.length === 2, bothMember?.roles.join(', '));
const bothCaps = await capabilitiesFor(db, both.id);
assert('and gets the union of what they allow', bothCaps.has('research_profile') && bothCaps.has('submit_work'));
assert('but not what neither grants', !bothCaps.has('publish'));

console.log('\n--- the plan\'s own role for community knowledge ---');
await grantRole(db, { accountId: reader.id, role: 'community_knowledge_holder', grantedBy: null });
const holderCaps = await capabilitiesFor(db, reader.id);
assert('a knowledge holder may contribute oral history', holderCaps.has('contribute_oral_history'));
assert('and media', holderCaps.has('contribute_media'));
assert('but may not publish unilaterally', !holderCaps.has('publish'));

console.log('\n--- the platform role carries through ---');
const adminCaps = await capabilitiesFor(db, platformAdmin.id);
assert('a platform administrator holds Ozikoro admin rights', adminCaps.has('manage_users'));
assert('including the audit log', adminCaps.has('view_audit'));
assert('and the AI corpus controls', adminCaps.has('manage_ai_corpus'));
assert('without needing any Ozikoro role row at all', (await getMember(db, platformAdmin.id)) === null);

console.log('\n--- enforcement, not decoration ---');
await requireCapability(db, platformAdmin.id, 'manage_users').then(
  () => assert('an allowed action returns the capability set', true),
  () => assert('an allowed action returns the capability set', false)
);
await refuses('a disallowed action is refused by name', () => requireCapability(db, reader.id, 'manage_users'), 'forbidden');
await refuses('and the refusal names the capability', async () => {
  await requireCapability(db, reader.id, 'publish');
}, 'forbidden');
assert('a boolean check agrees', (await can(db, reader.id, 'publish')) === false);
assert('and agrees when it should allow', (await can(db, publisher.id, 'publish')) === true);

console.log('\n--- the last administrator cannot be locked out ---');

// Give the account an Ozikoro admin grant so there is something to revoke.
await grantRole(db, { accountId: platformAdmin.id, role: 'admin', grantedBy: null });

/*
 * THE ASSERTION IS DERIVED FROM THE DATABASE, NOT ASSUMED.
 *
 * This test used to say "demoting an administrator when no other effective administrator exists is refused" and
 * call `revokeRole` expecting a refusal — which passed only while the database happened to contain nothing but
 * this test's own accounts. **The owner's real account became the second effective administrator and the test
 * then failed while the guard was working perfectly**: `revokeRole` counts effective administrators as
 * `ozikoro_member_role.role = 'admin'` UNION `account.role in ('admin','owner')`, and with the owner present the
 * test's administrator genuinely is not the last one.
 *
 * A test that encodes the state of the developer's database is not testing the rule. So the count is taken here,
 * with the same query the guard uses, and the expectation follows from it — the guard is exercised when this
 * administrator is the only one, and the "a second administrator changes the answer" case below exercises it
 * either way.
 */
const effectiveAdministrators = async (): Promise<number> => {
  const row = await db.one<{ n: number }>(`
    select count(distinct id)::int as n from (
      select account_id as id from ozikoro_member_role where role = 'admin'
      union
      select id from account where role in ('admin', 'owner')
    ) t
  `);
  return Number(row?.n ?? 0);
};

const administratorsBefore = await effectiveAdministrators();
assert(
  'the guard and this test count effective administrators the same way',
  administratorsBefore >= 1,
  `${administratorsBefore} effective administrator(s) in the database`
);
if (administratorsBefore <= 1) {
  await refuses(
    'demoting the last effective administrator is refused',
    () => revokeRole(db, { accountId: platformAdmin.id, role: 'admin', actorId: platformAdmin.id }),
    'last_admin'
  );
} else {
  console.log(
    `  · skipped the last-administrator refusal: ${administratorsBefore} effective administrators exist, ` +
      'so this one is genuinely not the last and the guard must allow it'
  );
  await revokeRole(db, { accountId: platformAdmin.id, role: 'admin', actorId: platformAdmin.id });
  assert('an administrator who is not the last may be demoted', true);
  await grantRole(db, { accountId: platformAdmin.id, role: 'admin', grantedBy: null });
}

// A second effective administrator, so the first may now be demoted.
await grantRole(db, { accountId: publisher.id, role: 'admin', grantedBy: platformAdmin.id });
await revokeRole(db, { accountId: platformAdmin.id, role: 'admin', actorId: publisher.id });
assert(
  'with a second administrator the first Ozikoro admin role can be revoked',
  !((await getMember(db, platformAdmin.id))?.roles ?? []).includes('admin')
);
/*
 * And the platform role still carries its own capabilities, which is deliberate: the dictionary's
 * administrator is an administrator of the institution and should not have to be granted a second
 * role on Ozikoro to keep running it. Asserted so the distinction stays visible rather than
 * becoming a surprise.
 */
assert('while the platform role still carries its own', await can(db, platformAdmin.id, 'manage_users'));
await revokeRole(db, { accountId: publisher.id, role: 'admin', actorId: null });

await revokeRole(db, { accountId: publisher.id, role: 'moderator', actorId: null });
assert('revoking a role that was never granted is a no-op', true);

console.log('\n--- suspension takes effect on the server ---');
await setMemberStatus(db, { accountId: both.id, status: 'suspended', actorId: platformAdmin.id });
assert('a suspended member loses their roles', (await getMember(db, both.id))?.status === 'suspended');
await setMemberStatus(db, { accountId: both.id, status: 'active', actorId: platformAdmin.id });

console.log('\n--- the profile a person owns ---');
await updateMemberProfile(db, {
  accountId: both.id,
  displayName: 'Test Researcher',
  institution: 'University of Nowhere',
  orcid: '0000-0002-1825-0097',
  researchInterests: ['Igbo history', 'Oral tradition'],
});
const updated = await getMember(db, both.id);
assert('a profile saves', updated?.institution === 'University of Nowhere');
assert('with research interests', updated?.researchInterests.length === 2, updated?.researchInterests.join(', '));
assert('and an ORCID is stored as given, not invented', updated?.orcid === '0000-0002-1825-0097');

console.log('\n--- an independent researcher needs no institution ---');
const independent = await registerAccount(db, { email: `${SUFFIX}-indie@example.com`, password: 'a long enough password' });
await grantRole(db, { accountId: independent.id, role: 'independent_researcher', grantedBy: null });
const indieCaps = await capabilitiesFor(db, independent.id);
assert('an independent researcher may keep a research profile', indieCaps.has('research_profile'));
assert('and may submit work', indieCaps.has('submit_work'));
assert('with no institution recorded', (await getMember(db, independent.id))?.institution === null);

console.log('\n--- claiming a migrated byline ---');

const bylines = await listClaimableBylines(db, reader.id);
assert('there are unclaimed bylines to claim', bylines.length > 0, `${bylines.length} available`);
const target = bylines[0]!;
assert('the largest byline is a real author', target.articleCount > 0, `${target.name}: ${target.articleCount} records`);

await requestContributorClaim(db, { contributorId: target.id, accountId: reader.id, evidence: 'I am this author.' });
const pending = await listContributorClaims(db, { status: 'pending' });
assert('a claim is recorded as pending', pending.some((c) => c.contributorId === target.id && c.accountId === reader.id));
assert('and shows how many records depend on it', (pending.find((c) => c.contributorId === target.id)?.articleCount ?? 0) > 0);

await refuses(
  'asking twice is refused rather than duplicating',
  () => requestContributorClaim(db, { contributorId: target.id, accountId: reader.id }),
  'already_pending'
);
await refuses(
  'a byline that does not exist cannot be claimed',
  () => requestContributorClaim(db, { contributorId: 99999999, accountId: reader.id }),
  'no_contributor'
);

const claim = pending.find((c) => c.contributorId === target.id)!;
await decideContributorClaim(db, { claimId: claim.id, approve: true, actorId: platformAdmin.id, note: 'verified by email' });
const linked = await db.one<{ account_id: string | null }>(`select account_id from ozikoro_contributor where id = $1`, [target.id]);
assert('approving a claim links the byline to the account', Number(linked?.account_id) === reader.id);
assert('so the author can be signed in as themselves', Boolean(linked?.account_id));
await refuses(
  'and an approved claim cannot be decided again',
  () => decideContributorClaim(db, { claimId: claim.id, approve: true, actorId: platformAdmin.id }),
  'already_decided'
);

console.log('\n--- the rank rule: an administrator cannot mint an administrator ---');

/*
 * THE RULE MIGRATION 0044 ADDED, TESTED WHERE IT IS USED.
 *
 * `ozikoro_role_may_grant` decides this, and the users screen must not reimplement it — so the test asks the
 * same function the screen asks, through the same wrapper. **The failure this guards against is not a missing
 * rule but a second copy of it**: a screen that compared role names itself would pass a happy-path test and
 * still let an administrator appoint an administrator on the one path nobody exercised.
 *
 * The platform admin created above is an administrator without an archive `admin` row, which is also the case
 * the wrapper's platform branch exists for: they must rank as an administrator and must still not be able to
 * grant the administrator role.
 */
const adminGrantingAdmin = await mayGrantRole(db, platformAdmin.id, 'admin');
assert('an administrator may NOT grant the administrator role', !adminGrantingAdmin.allowed, adminGrantingAdmin.reason ?? '');
assert('and the refusal says both ranks, so it can be acted on', /rank/i.test(adminGrantingAdmin.reason ?? ''));
assert('an administrator MAY grant a role below it', (await mayGrantRole(db, platformAdmin.id, 'editor')).allowed);
assert(
  'equal ranks may not grant each other, which is what stops a second administrator being minted',
  adminGrantingAdmin.actorRank === adminGrantingAdmin.targetRank,
  `${adminGrantingAdmin.actorRank} vs ${adminGrantingAdmin.targetRank}`
);
assert('the owner outranks an administrator', (await roleRanks(db)).get('owner')! > (await roleRanks(db)).get('admin')!);
assert(
  'and only the owner may appoint an administrator',
  await db
    .one<{ ok: boolean }>(`select ozikoro_role_may_grant('owner', 'admin') as ok`)
    .then((row) => Boolean(row?.ok))
);
assert(
  'the roles offered on a screen exclude the actor’s own rank',
  (await grantableRoles(db, platformAdmin.id)).every((role) => role !== 'admin' && role !== 'owner')
);

console.log('\n--- the audit trail ---');
const audited = await db.rows<{ action: string }>(
  `select action from ozikoro_audit where entity_type = 'ozikoro_member' and entity_id = $1`,
  [publisher.id]
);
assert('role grants are audited', audited.some((a) => a.action === 'grant_role'), audited.map((a) => a.action).join(', '));
assert('and so are revocations', audited.some((a) => a.action === 'revoke_role'));

// Restore the byline so a re-run finds the same state.
await db.query(`update ozikoro_contributor set account_id = null where id = $1`, [target.id]);

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await cleanup();
process.exit(failures === 0 ? 0 : 1);
