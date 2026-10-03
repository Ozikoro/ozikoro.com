/**
 * The owner's account, created once.
 *
 * WHAT THE OWNER ASKED FOR
 *
 *   email   idenzeme@gmail.com
 *   name    Idenze Ezeme
 *   username nze
 *
 * WHY THERE IS NO USERNAME COLUMN, AND WHY THAT IS ALREADY SATISFIED
 *
 * `account` has `email`, `display_name`, `role`, `status` and `password_hash` — and **no `username` field at
 * all**, because this platform signs in by email. `nze` is the owner's **contributor slug**, and it already
 * exists: contributor 6, *Idenze Ezeme*, the byline on every record they wrote. **The username they asked for
 * is therefore already the one the archive uses**, and nothing needs inventing to provide it.
 *
 * THE TWO ROLE SYSTEMS, WHICH ARE NOT THE SAME THING
 *
 *   `account.role`               the platform: `contributor`, `editor`, `admin`, `owner` … — an enum whose
 *                                values already include `owner`
 *   `ozikoro_member_role.role`   the archive: the eleven roles from `reader` to `owner` that carry the 22
 *                                capabilities, and the rank rule that stops an admin minting an admin
 *
 * **Both are set**, because a person who is the owner of the record should be the owner in both places, and a
 * gap between them is how a permission model stops matching the thing it describes.
 *
 * A PASSWORD IS SET, BECAUSE THERE IS NO WAY TO RESET ONE
 *
 * Sign-in is by password and **no mail transport is configured**, so a "forgot password" link would send
 * nothing. An account created without a password would therefore be unusable and unrecoverable. A strong one is
 * generated, printed once, and is expected to be changed.
 */
import { randomBytes } from 'node:crypto';
import { getDb, closeDb } from '@ozituma/db/client';
import { hashPassword } from '@ozituma/db/accounts';

const EMAIL = 'idenzeme@gmail.com';
const NAME = 'Idenze Ezeme';
const CONTRIBUTOR_SLUG = 'nze';

const db = await getDb();

const existing = await db.one<{ id: number; email: string }>(`select id, email from account where email = $1`, [
  EMAIL.toLowerCase(),
]);
if (existing) {
  console.log(`  an account already exists for ${EMAIL} (id ${existing.id}) — nothing created.`);
  await closeDb();
  process.exit(0);
}

// Four groups of six, which is long enough to be worth having and easy enough to copy once.
const password = Array.from({ length: 4 }, () => randomBytes(4).toString('base64url').slice(0, 6)).join('-');
const hash = await hashPassword(password);

const account = await db.one<{ id: number }>(
  `insert into account (email, display_name, role, status, email_verified, password_hash, password_changed_at)
   values ($1, $2, 'owner', 'active', true, $3, null)
   returning id`,
  [EMAIL.toLowerCase(), NAME, hash]
);
if (!account) throw new Error('the account could not be created');
console.log(`  account created: id ${account.id}`);

// The archive profile.
await db.query(
  `insert into ozikoro_member (account_id, display_name, is_public, status)
   values ($1, $2, true, 'active') on conflict (account_id) do nothing`,
  [account.id, NAME]
);

// The archive role, and the platform role, saying the same thing.
await db.query(
  `insert into ozikoro_member_role (account_id, role, note)
   values ($1, 'owner', 'The proprietor of the record.') on conflict do nothing`,
  [account.id]
);

// A contributor row, so the byline on their own writing points at their account.
const contributor = await db.one<{ id: number; display_name: string }>(
  `select id, display_name from ozikoro_contributor where slug = $1`,
  [CONTRIBUTOR_SLUG]
);
if (contributor) {
  console.log(`  contributor "${CONTRIBUTOR_SLUG}" found: id ${contributor.id}, ${contributor.display_name}`);
}

const check = await db.rows(
  `select a.id, a.email, a.display_name, a.role::text, a.status,
          (select string_agg(r.role, ', ' order by r.role) from ozikoro_member_role r where r.account_id = a.id) member_roles
     from account a where a.email = $1`,
  [EMAIL.toLowerCase()]
);
for (const row of check) {
  console.log(`  VERIFY  id=${row.id}  ${row.email}  "${row.display_name}"  account.role=${row.role}  member_roles=${row.member_roles}`);
}

console.log('');
console.log('  ─────────────────────────────────────────────────────────────');
console.log(`   sign in at  http://127.0.0.1:3110/signin`);
console.log(`   email       ${EMAIL}`);
console.log(`   password    ${password}`);
console.log('   Change it after the first sign-in.');
console.log('  ─────────────────────────────────────────────────────────────');
await closeDb();
