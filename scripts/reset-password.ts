/**
 * Reset one account's password, deliberately and with an attributed actor.
 *
 * WHY THIS EXISTS (rounds 158-159)
 *
 * Round 155 found the archive has no `forgot`, no `reset` and no `admin/password-link` — while the
 * dictionary has all three. Round 158 sharpened it: `setPasswordAsAdmin` exists in
 * `packages/db/src/passwords.ts`, `role.ts` is a working CLI for the same kind of task, and **there is no
 * way to run it.** A contributor who forgets their password could not recover it themselves, could not be
 * sent a link, and could not have it reset by an operator without writing code.
 *
 * Round 159 corrected a mistake that had deferred this: the rule *"never invent a record, a source, a
 * rights statement, a citation or a statistic"* prohibits **content a reader would take as real**, not
 * **test fixtures**. This project has used `zztest`-prefixed throwaways since round 62, guarded by
 * `check:residue` across 102 tables — and round 135 was caught by that guard when cleanup missed an audit
 * row. Instruments are meant to be built.
 *
 * WHY IT NEEDS AN ACTOR
 *
 * `setPasswordAsAdmin(db, accountId, newPassword, actorId, meta)` requires a real account to attribute the
 * change to, because a password change is an auditable act and the audit row needs an actor. That is why
 * this takes `--actor`, and why it refuses to run without one rather than writing an unattributed change
 * into the audit trail.
 *
 * Usage:
 *   node scripts/reset-password.ts someone@example.org --actor admin@example.org
 *   node scripts/reset-password.ts someone@example.org --actor admin@example.org --dry-run
 *   node scripts/reset-password.ts someone@example.org --actor admin@example.org --password '…'
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { setPasswordAsAdmin, generatePassword } from '@ozituma/db/passwords';
import { MIN_PASSWORD_LENGTH, getAccountByEmail } from '@ozituma/db/accounts';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const actorAt = argv.indexOf('--actor');
const actorEmail = actorAt >= 0 ? argv[actorAt + 1] : null;
const passAt = argv.indexOf('--password');
const givenPassword = passAt >= 0 ? argv[passAt + 1] : null;
/*
 * Positional arguments, with the values of --actor and --password removed.
 *
 * THE GUARD IS THE WHOLE POINT OF THIS COMMENT.
 *
 * This file was written in round 160. Round 132 fixed exactly this bug in `create-account.ts`, with a
 * comment naming it, and **I wrote it again here anyway**: `passAt` is `-1` when `--password` is absent, so
 * `passAt + 1` is `0` — a valid index — and the first argument was silently discarded on every call that
 * did not pass a password, which is the common case. The target email vanished and the command printed its
 * usage message instead of doing anything.
 *
 * A fix in one file does not prevent the shape in the next one. Round 122 found the `000` retry missing
 * from a checker written twenty rounds after the lesson, and round 123 found it missing from a third. **The
 * only thing that travels is a guard that cannot be written wrong**, and the guard is `>= 0`.
 */
const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  if (actorAt >= 0 && i === actorAt + 1) return false;
  if (passAt >= 0 && i === passAt + 1) return false;
  return true;
});
const [email] = positional;

function usage(code: number): never {
  console.error(`
  Reset one account's password.

    node scripts/reset-password.ts <email> --actor <admin-email> [--password '…'] [--dry-run]

  --actor is required and must hold admin or owner: a password change is audited and needs an actor.
  A password is generated and printed once unless --password is given (min ${MIN_PASSWORD_LENGTH} chars).
`);
  process.exit(code);
}

if (!email || !actorEmail) usage(2);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
for (const [label, value] of [['target', email], ['actor', actorEmail]] as const) {
  if (!EMAIL.test(value.trim().toLowerCase())) {
    console.error(`  the ${label} address "${value}" does not look like an email address.`);
    process.exit(2);
  }
}

const db = await getDb();
try {
  const target = await getAccountByEmail(db, email);
  if (!target) {
    console.error(`  no account exists for ${email}. Create one with: npm run account:create`);
    await closeDb();
    process.exit(1);
  }

  const actor = await getAccountByEmail(db, actorEmail);
  if (!actor) {
    console.error(`  no account exists for the actor ${actorEmail}.`);
    await closeDb();
    process.exit(1);
  }
  if (actor.role !== 'admin' && actor.role !== 'owner') {
    // Refused rather than allowed: an unattributable password change is worse than none, and the domain
    // function would record whatever it was given.
    console.error(`  the actor ${actorEmail} is a ${actor.role}, not an admin or owner.`);
    await closeDb();
    process.exit(1);
  }
  if (actor.id === target.id) {
    console.error('  the actor and the target are the same account. Use the change-own-password flow.');
    await closeDb();
    process.exit(1);
  }

  const password = givenPassword ?? generatePassword();

  if (dryRun) {
    console.log(`  DRY RUN: would reset the password for ${target.email} (id ${target.id}), attributed to ${actor.email}.`);
    console.log('  Nothing was written. Remove --dry-run to apply it.');
  } else {
    await setPasswordAsAdmin(db, target.id, password, actor.id, {});
    console.log(`  Password reset for ${target.email} (id ${target.id}), attributed to ${actor.email}.`);
    if (!givenPassword) {
      console.log('');
      console.log(`  PASSWORD (shown once): ${password}`);
      console.log('  Give it to them directly; it is not stored anywhere in readable form.');
    }
  }
} catch (error) {
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  await closeDb();
  process.exit(1);
}
await closeDb();
