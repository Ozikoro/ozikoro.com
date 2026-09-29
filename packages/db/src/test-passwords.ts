/**
 * Changing a password, and getting back in without one.
 *
 *   npm -w @ozituma/db run test:passwords
 *
 * WHY THIS EXISTS
 *
 * These flows decide whether somebody can reach their own account, and every way
 * they can go wrong is silent. A reset link that survives being used is a key
 * that keeps working. A password change that leaves the old sessions alive does
 * not do the one thing it was asked to do. A recovery form that answers
 * differently for a known address than an unknown one is an address book of
 * everyone who has an account here. None of those produce an error message.
 *
 * So each is asserted, and the assertions are about what the database holds
 * afterwards rather than about what a function returned: the hash changed, the
 * sessions are revoked, the token is spent, the audit row says which route it
 * came by.
 */
import { createHash } from 'node:crypto';
import { closeDb, getDb, type Db } from './client.ts';
import {
  authenticateAccount,
  createSession,
  getAccountByEmail,
  hashPassword,
  registerAccount,
  resolveSession,
  verifyPassword,
} from './accounts.ts';
import {
  RESET_TTL_MINUTES,
  changeOwnPassword,
  checkResetToken,
  generatePassword,
  listOpenResetRequests,
  listPasswordChanges,
  requestPasswordReset,
  resetPasswordWithToken,
  setPasswordAsAdmin,
} from './passwords.ts';

const db: Db = await getDb();
let failures = 0;

if (db.driver !== 'pglite' && process.env.OZITUMA_ALLOW_DESTRUCTIVE_TEST !== '1') {
  console.error(
    '\n  Refusing to run against a non-local database.\n' +
      '  This test creates accounts and deletes them again.\n' +
      '  Run it against PGlite (leave DATABASE_URL unset), or set\n' +
      '  OZITUMA_ALLOW_DESTRUCTIVE_TEST=1 if you truly mean it.\n'
  );
  await closeDb();
  process.exit(1);
}

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function expectRefusal(label: string, run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
    assert(label, false, 'it was allowed');
  } catch (error) {
    const actual = (error as { code?: string }).code ?? '';
    assert(label, actual === code, actual === code ? '' : `refused with "${actual}"`);
  }
}

const ORIGINAL = 'correct horse battery';
const CHANGED = 'a different long phrase';

// A clean slate, so a re-run cannot pass on a leftover row.
const EMAIL = 'zztest-passwords@example.com';
const ADMIN_EMAIL = 'zztest-password-admin@example.com';
for (const email of [EMAIL, ADMIN_EMAIL]) {
  await db.query(`delete from account where lower(email) = lower($1)`, [email]).catch(() => {});
}

const account = await registerAccount(db, { email: EMAIL, password: ORIGINAL });
const admin = await registerAccount(db, { email: ADMIN_EMAIL, password: ORIGINAL });
await db.query(`update account set role = 'admin' where id = $1`, [admin.id]);

// Two devices signed in, which is the ordinary case and the one that matters.
const first = await createSession(db, account.id, { userAgent: 'test device one' });
const second = await createSession(db, account.id, { userAgent: 'test device two' });

console.log('\n--- Changing your own password ---');

await expectRefusal(
  'the current password is required',
  () => changeOwnPassword(db, account.id, 'not the password', CHANGED),
  'wrong_password'
);

await expectRefusal(
  'a new password that is too short is refused',
  () => changeOwnPassword(db, account.id, ORIGINAL, 'short'),
  'weak_password'
);

await expectRefusal(
  'reusing the same password is refused, so a change is always a change',
  () => changeOwnPassword(db, account.id, ORIGINAL, ORIGINAL),
  'same_password'
);

// The real change, keeping the session it was made from.
await changeOwnPassword(db, account.id, ORIGINAL, CHANGED, { keepSessionToken: first.token });


const storedHash = await db.one<{ password_hash: string }>(
  `select password_hash from account where id = $1`,
  [account.id]
);
assert('the new password signs in', (await authenticateAccount(db, EMAIL, CHANGED)) !== null);
assert('the old password does not', (await authenticateAccount(db, EMAIL, ORIGINAL)) === null);
assert('the stored hash is not the password', !storedHash!.password_hash.includes(CHANGED));
assert(
  'the hash is the same shape as a fresh one',
  storedHash!.password_hash.startsWith('scrypt$'),
  storedHash!.password_hash.slice(0, 12)
);
const stamped = await db.one<{ password_changed_at: string | null }>(
  `select password_changed_at from account where id = $1`,
  [account.id]
);
assert(
  'the account records when its password last changed',
  stamped?.password_changed_at !== null && stamped?.password_changed_at !== undefined
);

const kept = await resolveSession(db, first.token);
const killed = await resolveSession(db, second.token);
assert('the session the change was made from stays signed in', kept !== null);
assert('the other session is signed out — a change that leaves it alive has not done its job', killed === null);

const changes = await listPasswordChanges(db, account.id);
assert('the change is on the audit trail', changes.length === 1, `${changes.length} rows`);
assert('and the trail says it was made by the account holder', changes[0]?.changedBy === 'self');

console.log('\n--- A recovery link ---');

const missing = await requestPasswordReset(db, 'nobody-here@example.com');
assert('an unknown address produces no link', missing === null);

const link = await requestPasswordReset(db, EMAIL, { ipAddress: '203.0.113.7', userAgent: 'test' });
assert('a known address produces one', link !== null);

const open = await listOpenResetRequests(db);
assert(
  'the request is visible to an administrator',
  open.some((row) => row.email === EMAIL)
);
assert(
  'but the token itself is not in that list, because it is not stored',
  !JSON.stringify(open).includes(link!.token)
);

const looked = await checkResetToken(db, link!.token);
assert('the link checks out before it is used', looked?.accountId === account.id);

const soonest = new Date(link!.expiresAt).getTime() - Date.now();
assert(
  `it expires in about ${RESET_TTL_MINUTES} minutes`,
  soonest > (RESET_TTL_MINUTES - 2) * 60_000 && soonest <= RESET_TTL_MINUTES * 60_000
);

console.log('\n--- A second request voids the first ---');

const secondLink = await requestPasswordReset(db, EMAIL);
assert('asking again makes a new link', secondLink !== null);
assert('the older link stops working immediately', (await checkResetToken(db, link!.token)) === null);
assert('and the newer one works', (await checkResetToken(db, secondLink!.token)) !== null);

console.log('\n--- Using it ---');

await expectRefusal(
  'a weak password is refused even with a valid link',
  () => resetPasswordWithToken(db, secondLink!.token, 'short'),
  'weak_password'
);
// The refusal above must not have spent the link: nothing was written.
assert('a refused attempt leaves the link usable', (await checkResetToken(db, secondLink!.token)) !== null);

// Signed in on another device, to prove the reset closes it.
const otherDevice = await createSession(db, account.id, { userAgent: 'a device they forgot about' });

const RECOVERED = 'the phrase they chose after recovering';
await resetPasswordWithToken(db, secondLink!.token, RECOVERED, { ipAddress: '203.0.113.9' });

assert('the recovered password signs in', (await authenticateAccount(db, EMAIL, RECOVERED)) !== null);
assert('the password it replaced does not', (await authenticateAccount(db, EMAIL, CHANGED)) === null);
assert(
  'a link cannot be used twice',
  (await checkResetToken(db, secondLink!.token)) === null
);
assert(
  'the device they had forgotten about is signed out',
  (await resolveSession(db, otherDevice.token)) === null
);

await expectRefusal(
  'a spent link is refused with a plain reason',
  () => resetPasswordWithToken(db, secondLink!.token, RECOVERED),
  'bad_token'
);
await expectRefusal(
  'a made-up token is refused too',
  () => resetPasswordWithToken(db, 'x'.repeat(43), RECOVERED),
  'bad_token'
);

const trail = await listPasswordChanges(db, account.id);
assert('the recovery is on the trail', trail.some((row) => row.changedBy === 'recovery'));
assert('and the change before it is still there', trail.some((row) => row.changedBy === 'self'));

console.log('\n--- What an administrator can do, and cannot ---');

const handed = generatePassword();
await setPasswordAsAdmin(db, account.id, handed, admin.id);
assert('an administrator can set a password', (await authenticateAccount(db, EMAIL, handed)) !== null);
assert(
  'the trail records that an administrator did it',
  (await listPasswordChanges(db, account.id)).some((row) => row.changedBy === 'admin')
);

await expectRefusal(
  'but not their own, which would skip proving the current password',
  () => setPasswordAsAdmin(db, admin.id, handed, admin.id),
  'self_admin'
);

console.log('\n--- Expiry ---');

const expiring = await requestPasswordReset(db, EMAIL);
// Backdate the link the way an hour of waiting would.
await db.query(
  `update password_reset set expires_at = now() - interval '1 minute' where token_hash = $1`,
  [createHash('sha256').update(expiring!.token, 'utf8').digest('hex')]
);
assert('an expired link is not usable', (await checkResetToken(db, expiring!.token)) === null);
await expectRefusal(
  'and using it says so rather than failing obscurely',
  () => resetPasswordWithToken(db, expiring!.token, RECOVERED),
  'bad_token'
);
const waiting = await listOpenResetRequests(db);
assert(
  'an expired link is not listed as waiting either',
  waiting.every((row) => new Date(row.expiresAt).getTime() > Date.now()),
  `${waiting.length} listed`
);

console.log('\n--- A hashed password is a hashed password ---');

const hash = await hashPassword('a password of sufficient length');
assert('hashing is salted, so the same password gives two different hashes', hash !== (await hashPassword('a password of sufficient length')));
assert('and both verify', await verifyPassword('a password of sufficient length', hash));

// Clean up.
for (const email of [EMAIL, ADMIN_EMAIL]) {
  await db.query(`delete from account where lower(email) = lower($1)`, [email]).catch(() => {});
}

console.log(`\n${failures === 0 ? 'ALL PASSWORD CHECKS PASSED' : `${failures} PASSWORD CHECKS FAILED`}\n`);
await closeDb();
process.exitCode = failures === 0 ? 0 : 1;
