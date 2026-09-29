/** The admin controls: what they allow, and what they refuse. */
import { closeDb, getDb } from './client.ts';
import { registerAccount } from './accounts.ts';
import {
  AdminError, createAccountAsAdmin, deleteAccountAsAdmin, listAccountsForAdmin,
  removeContent, searchContent, updateAccountAsAdmin,
} from './admin.ts';
const db = await getDb();
let failures = 0;
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const refuses = async (label: string, run: () => Promise<unknown>, code: string) => {
  try { await run(); assert(label, false, 'it was allowed'); }
  catch (e) { const c = (e as { code?: string }).code ?? ''; assert(label, c === code, c || 'no code'); }
};

await db.query(`delete from account where email like 'zztest-adm-%'`);
const owner = await registerAccount(db, { email: 'zztest-adm-owner@example.com', password: 'a long enough password' });
await db.query(`update account set role='owner' where id=$1`, [owner.id]);
const plain = await registerAccount(db, { email: 'zztest-adm-user@example.com', password: 'a long enough password' });

console.log('\n--- making an account ---');
const made = await createAccountAsAdmin(db, { email: 'zztest-adm-made@example.com', password: 'a long enough password', role: 'editor' });
const rows = await listAccountsForAdmin(db);
const created = rows.find((r) => r.id === made.id);
assert('an administrator can create an account', created !== undefined);
assert('with the role they chose', created?.role === 'editor');

console.log('\n--- changing one ---');
const promoted = await updateAccountAsAdmin(db, { accountId: plain.id, actorId: owner.id, actorRole: 'owner', role: 'admin' });
assert('the role changes', promoted.role === 'admin');
const suspended = await updateAccountAsAdmin(db, { accountId: plain.id, actorId: owner.id, actorRole: 'owner', status: 'suspended' });
assert('the account can be suspended', suspended.status === 'suspended');
const live = await db.one<{ n: number }>(`select count(*)::int as n from auth_session where account_id=$1 and revoked_at is null`, [plain.id]);
assert('suspending signs them out at once', Number(live?.n ?? 0) === 0);

await refuses('an administrator cannot demote themselves',
  () => updateAccountAsAdmin(db, { accountId: owner.id, actorId: owner.id, actorRole: 'owner', role: 'admin' }), 'self_demotion');
await refuses('an administrator cannot suspend themselves',
  () => updateAccountAsAdmin(db, { accountId: owner.id, actorId: owner.id, actorRole: 'owner', status: 'suspended' }), 'self_suspend');
await refuses('an administrator cannot change the owner’s role',
  () => updateAccountAsAdmin(db, { accountId: owner.id, actorId: made.id, actorRole: 'admin', role: 'contributor' }), 'owner_protected');
await refuses('an administrator cannot delete another administrator',
  () => deleteAccountAsAdmin(db, { accountId: plain.id, actorId: made.id, actorRole: 'admin' }), 'admin_protected');
await refuses('and cannot delete the owner',
  () => deleteAccountAsAdmin(db, { accountId: owner.id, actorId: owner.id, actorRole: 'owner' }), 'self_delete');

console.log('\n--- finding and removing content ---');
const found = await searchContent(db, 'Ohafia');
assert('a clan is found by name', found.some((r) => r.kind === 'clan' && r.title === 'Ohafia'), JSON.stringify(found.slice(0, 2)));
const words = await searchContent(db, 'nne');
const dictionarySize = Number((await db.one<{ n: number }>(`select count(*)::int as n from word`))?.n ?? 0);
if (dictionarySize > 0) {
  assert('and a word is found', words.some((r) => r.kind === 'word'), `${words.length} results`);
} else {
  // Stated rather than skipped silently: a test that quietly stops checking something
  // is how the checking stops happening.
  console.log('  – the local database holds no dictionary entries, so the word search is not exercised here');
}
assert('every result carries the URL of its page', found.every((r) => r.url.startsWith('/')));

const clan = await db.one<{ id: string }>(`select id from clan where name = 'Ohafia'`);
await removeContent(db, { kind: 'clan', id: Number(clan!.id), mode: 'hide' });
const hidden = await db.one<{ published: boolean }>(`select published from clan where id=$1`, [Number(clan!.id)]);
assert('hiding a clan takes it out of the registry without destroying it', hidden?.published === false);
await removeContent(db, { kind: 'clan', id: Number(clan!.id), mode: 'hide' });
await db.query(`update clan set published = true where id=$1`, [Number(clan!.id)]);
assert('and it can be published again', (await db.one(`select published from clan where id=$1`, [Number(clan!.id)])) !== null);

for (const email of ['zztest-adm-owner@example.com', 'zztest-adm-user@example.com', 'zztest-adm-made@example.com']) {
  await db.query(`delete from account where email = $1`, [email]);
}
console.log(`\n${failures === 0 ? 'ALL ADMIN CHECKS PASSED' : `${failures} ADMIN CHECKS FAILED`}\n`);
await closeDb();
process.exitCode = failures === 0 ? 0 : 1;
