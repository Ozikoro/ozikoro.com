/**
 * Create one account, deliberately and one at a time.
 *
 * WHY THIS EXISTS (round 132)
 *
 * Round 128 found the `account` table empty: the schema is complete, 53 role-capability grants are in
 * place, the 11 real contributors are imported — and **nobody can sign in**, so the byline claim path that
 * rounds 1-50 built and verified cannot be entered by anyone.
 *
 * Everything needed to fix that already exists in `@ozituma/db` — `createAccountAsAdmin` validates the
 * email, validates the password, defaults the role and refuses a duplicate. **There was simply no way to
 * run it**: the only caller is an Ozituma admin route, so creating an Ozikoro account meant going through
 * another site's UI.
 *
 * This is that same validated call, on the command line.
 *
 * IT CANNOT INVENT ANYBODY. An email must be supplied, it must look like an address, and `createAccountAsAdmin`
 * refuses one that is already taken — so this cannot be used to populate the table with fixtures. The
 * addresses are the owner's to provide.
 *
 * Usage:
 *   node scripts/create-account.ts someone@example.org [role] [--name "Their Name"]
 *   node scripts/create-account.ts someone@example.org contributor --dry-run
 *
 * A password is generated and printed ONCE unless --password is given. Roles come from the database's own
 * list; an unknown one is refused rather than silently defaulted.
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { createAccountAsAdmin } from '@ozituma/db/admin';
import { MIN_PASSWORD_LENGTH, type AccountRole } from '@ozituma/db/accounts';
import { generatePassword } from '@ozituma/db/passwords';

/*
 * The roles, MIRRORED from `packages/db/src/admin.ts:45`, where the list is module-private and not
 * exported. That matters more than it looks: `createAccountAsAdmin` **silently falls back to
 * `contributor`** when it is handed a role it does not recognise —
 *
 *     const role: AccountRole = ROLES.includes(input.role as AccountRole) ? input.role : 'contributor';
 *
 * — so `--role owner` with a typo would create a contributor and say nothing. This script therefore
 * validates against this list FIRST and refuses an unknown role, rather than passing it through to be
 * quietly downgraded. If the database list ever changes, this is the second place to update, and the
 * first is `admin.ts`.
 */
const ROLES: AccountRole[] = ['contributor', 'editor', 'admin', 'owner'];

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const nameAt = argv.indexOf('--name');
const displayName = nameAt >= 0 ? argv[nameAt + 1] : null;
const passAt = argv.indexOf('--password');
const givenPassword = passAt >= 0 ? argv[passAt + 1] : null;

/*
 * Positional arguments, with the values of --name and --password removed.
 *
 * The first version was:
 *
 *     argv.filter((a, i) => !a.startsWith('--') && i !== nameAt + 1 && i !== passAt + 1)
 *
 * and when `--password` was NOT supplied, `passAt` was `-1`, so `passAt + 1` was **0** — a perfectly
 * valid index. The first argument was therefore always discarded whenever the flag was absent, which is
 * the common case. The email vanished and the next word became the email:
 *
 *     "would create editor as contributor"   for   <email> editor
 *
 * A sentinel that becomes a real index when incremented. The guard below is the fix, and the reason the
 * dry run is tested with AND without each optional flag.
 */
const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  if (nameAt >= 0 && i === nameAt + 1) return false;
  if (passAt >= 0 && i === passAt + 1) return false;
  return true;
});
const [email, role = 'contributor'] = positional;

function usage(code: number): never {
  console.error(`
  Create one account.

    node scripts/create-account.ts <email> [role] [--name "Display Name"] [--dry-run]

  Roles: ${ROLES.join(', ')}
  A password is generated and printed once unless --password is given (min ${MIN_PASSWORD_LENGTH} chars).
`);
  process.exit(code);
}

if (!email) usage(2);
if (!ROLES.includes(role as (typeof ROLES)[number])) {
  console.error(`  "${role}" is not one of: ${ROLES.join(', ')}`);
  process.exit(2);
}

/*
 * The email check, MIRRORED from `packages/db/src/admin.ts:95`, which does this inline:
 *
 *     if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AdminError('invalid_email', …)
 *
 * It is repeated here so the DRY RUN rejects what the real call would reject. The first version of the
 * dry run claimed to "validate exactly what the real call validates" and only checked for an existing
 * account — a malformed address passed the dry run and would have thrown on the real one. **A dry run
 * that accepts what the real call refuses is worse than no dry run**, because it is believed.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalisedEmail = email.trim().toLowerCase();
if (!EMAIL.test(normalisedEmail)) {
  console.error(`  "${email}" does not look like an email address.`);
  process.exit(2);
}

const password = givenPassword ?? generatePassword();
const db = await getDb();

try {
  if (dryRun) {
    // Bad email is caught above; a duplicate here; a weak password by `assertPasswordAcceptable` in the
    // real call — which the dry run does not reach, and says so rather than implying otherwise.
    const existing = await db.one('select id from account where email = $1', [normalisedEmail]);
    if (existing) {
      console.error(`  DRY RUN: an account already exists for ${email} (id ${existing.id}).`);
      process.exit(1);
    }
    console.log(`  DRY RUN: would create ${email} as ${role}${displayName ? ` ("${displayName}")` : ''}.`);
    console.log('  Nothing was written. Remove --dry-run to create it.');
  } else {
    const created = await createAccountAsAdmin(db, {
      email,
      password,
      role: role as (typeof ROLES)[number],
      displayName,
    });
    console.log(`  Created account ${created.id} for ${created.email} as ${role}.`);
    if (!givenPassword) {
      console.log('');
      console.log(`  PASSWORD (shown once): ${password}`);
      console.log('  Give it to them directly; it is not stored anywhere in readable form.');
    }
    console.log('');
    console.log('  They can sign in at https://ozikoro.com/signin');
  }
} catch (error) {
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  await closeDb();
  process.exit(1);
}

await closeDb();
