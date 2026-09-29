/**
 * Account administration CLI.
 *
 *   node src/role.ts list
 *   node src/role.ts promote <email> [editor|admin|owner|contributor]
 *   node src/role.ts create <email> <password> [display name]
 *
 * WHY THIS IS A CLI AND NOT A ROUTE
 *
 * Granting `editor` means granting write access to the published dictionary.
 * Exposing that over HTTP would create a privilege-escalation surface that has
 * to be authenticated, rate limited, audited and monitored forever. Requiring
 * shell access to the database host instead means gaining the role requires the
 * same access as editing the database directly — so there is nothing extra to
 * defend.
 *
 * The first editor has to come from here; there is no bootstrap exception in the
 * web application.
 */
import { closeDb, getDb } from './client.ts';
import {
  getAccountByEmail,
  listAccounts,
  registerAccount,
  setAccountRole,
  type AccountRole,
} from './accounts.ts';

const ROLES: AccountRole[] = ['contributor', 'editor', 'admin', 'owner'];

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const db = await getDb();

  try {
    switch (command) {
      case 'list': {
        const accounts = await listAccounts(db);
        if (accounts.length === 0) {
          console.log('\n  No accounts yet.\n');
          return;
        }
        console.log('\n  Role          Email                              Last sign-in');
        console.log('  ' + '-'.repeat(74));
        for (const account of accounts) {
          console.log(
            `  ${account.role.padEnd(13)} ${account.email.padEnd(34)} ${account.lastLoginAt ?? 'never'}`
          );
        }
        console.log('');
        return;
      }

      case 'promote': {
        const [email, role = 'editor'] = args;
        if (!email) {
          console.error('Usage: node src/role.ts promote <email> [editor|admin|owner|contributor]');
          process.exitCode = 1;
          return;
        }
        if (!ROLES.includes(role as AccountRole)) {
          console.error(`Unknown role "${role}". Choose one of: ${ROLES.join(', ')}`);
          process.exitCode = 1;
          return;
        }
        const account = await setAccountRole(db, email, role as AccountRole);
        if (!account) {
          console.error(`\n  No account exists with the email "${email}".\n`);
          process.exitCode = 1;
          return;
        }
        console.log(`\n  ${account.email} is now "${account.role}".\n`);
        return;
      }

      case 'create': {
        const [email, password, ...nameParts] = args;
        if (!email || !password) {
          console.error('Usage: node src/role.ts create <email> <password> [display name]');
          process.exitCode = 1;
          return;
        }
        const existing = await getAccountByEmail(db, email);
        if (existing) {
          console.error(`\n  An account already exists for "${email}".\n`);
          process.exitCode = 1;
          return;
        }
        const account = await registerAccount(db, {
          email,
          password,
          displayName: nameParts.join(' ') || null,
        });
        console.log(
          `\n  Created ${account.email} (${account.role}).\n` +
            `  Promote to editor with: node src/role.ts promote ${account.email} editor\n`
        );
        return;
      }

      default:
        console.error(
          'Usage:\n' +
            '  node src/role.ts list\n' +
            '  node src/role.ts promote <email> [editor|admin|contributor]\n' +
            '  node src/role.ts create <email> <password> [display name]'
        );
        process.exitCode = 1;
    }
  } finally {
    await closeDb();
  }
}

main().catch((error) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
