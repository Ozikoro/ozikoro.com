/**
 * Is mail configured, and does a message actually leave?
 *
 * WHY THIS EXISTS
 *
 * The password-reset link is the one thing on this site that has to leave the building, and every way it
 * fails is quiet: an unset variable, a sender on a domain the provider will not send from, a key that was
 * rotated. The site itself cannot tell anyone — the person waiting is locked out and the log is on a
 * server — so the only useful instrument is one that says, out loud and on demand, which transport would
 * carry a message and whether it did.
 *
 * TWO MODES, AND THE SECOND ONE IS THE POINT
 *
 *   node --env-file=apps/ozikoro/.env.local scripts/mail-test.ts
 *       reports the transport, the From address, and what is missing if nothing would send.
 *
 *   node --env-file=apps/ozikoro/.env.local scripts/mail-test.ts --send=someone@example.org
 *       sends ONE real message and reports the provider's own answer, including the id it returned.
 *       A transport this says is configured can still be refused for a reason only the provider knows.
 *
 * The environment file is loaded from `apps/ozikoro/.env.local` when the relevant variables are not
 * already in the environment, so the command above works from the repository root without remembering the
 * flag. Nothing here reads a credential it does not need, and nothing prints one.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mailStatus, sendMail } from '@ozituma/core';

const argv = process.argv.slice(2);

function usage(code: number): never {
  console.error(`
  Is mail configured, and does a message actually leave?

    node --env-file=apps/ozikoro/.env.local scripts/mail-test.ts
    node --env-file=apps/ozikoro/.env.local scripts/mail-test.ts --send=<address>

  --send sends ONE real message to the address given and prints the provider's response, including the
  message id it returned. Without it nothing leaves this machine: the transport is reported, not used.

  Mail is preferred in this order and the first one configured is the one used:
    Resend (RESEND_API_KEY) > SMTP (OZITUMA_SMTP_HOST) > Amazon SES (AWS_REGION and its keys)
`);
  process.exit(code);
}

/*
 * Arguments are read in a loop, not by index arithmetic.
 *
 * `argv.indexOf('--send') + 1` is `0` when `--send` is absent, and `0` is a valid index — the bug this
 * project has now fixed three times in CLI scripts (rounds 122, 132 and 160), where the first argument was
 * silently discarded and the command printed its usage instead of doing anything. **A loop cannot express
 * that mistake.**
 */
let sendTo: string | null = null;
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]!;
  if (arg === '--send') {
    sendTo = (argv[i + 1] ?? '').trim() || null;
    i += 1;
  } else if (arg.startsWith('--send=')) {
    sendTo = arg.slice('--send='.length).trim() || null;
  } else if (arg === '--help' || arg === '-h') {
    usage(0);
  } else {
    console.error(`  unknown argument "${arg}"`);
    usage(2);
  }
}

if (sendTo !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sendTo)) {
  console.error(`  "${sendTo}" does not look like an email address.`);
  usage(2);
}

/*
 * Load the app's environment when the shell has not already provided it.
 *
 * `--env-file` does the same job and is what the usage line shows, because it is what this repository
 * documents elsewhere. This is the convenience: `mail-test` is run by hand, often from a shell that has
 * nothing set, and a tool that reports "not configured" on a machine that is configured teaches people to
 * ignore it.
 */
const ENV_FILES = ['apps/ozikoro/.env.local', '.env.local'];
const looksConfigured =
  Boolean(process.env.RESEND_API_KEY) ||
  Boolean(process.env.OZITUMA_SMTP_HOST) ||
  Boolean(process.env.AWS_ACCESS_KEY_ID);
let loadedFrom: string | null = null;
if (!looksConfigured) {
  for (const candidate of ENV_FILES) {
    const path = join(process.cwd(), candidate);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
      loadedFrom = candidate;
      break;
    } catch (error) {
      console.error(`  could not read ${candidate}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

const status = mailStatus();

console.log('');
console.log('  Mail');
console.log('  ----');
console.log(`  configured   ${status.configured ? 'yes' : 'no'}`);
console.log(`  transport    ${status.transport ?? '(none)'}`);
console.log(`  from         ${status.from ?? '(none)'}`);
if (status.reason) console.log(`  reason       ${status.reason}`);
if (loadedFrom) console.log(`  environment  read from ${loadedFrom}`);
if (status.transport === 'resend') {
  console.log('');
  console.log('  The sender must be on a domain Resend will send from. `bash scripts/check-mail.sh` re-reads');
  console.log('  Resend’s own list and fails if it is not.');
}

if (!status.configured) {
  console.error('\n  Nothing would send. See `reason` above.\n');
  process.exit(1);
}

if (!sendTo) {
  console.log('\n  Nothing was sent. Pass --send=<address> to send one real message.\n');
  process.exit(0);
}

const text = [
  'This is a test message from the Ozikoro archive, sent by scripts/mail-test.ts to confirm that mail',
  'is configured and that it reaches an inbox.',
  '',
  `Transport: ${status.transport}`,
  `From:      ${status.from}`,
  '',
  'Nothing has changed on any account, and nothing needs doing about this message. It exists so that a',
  'person can see for themselves that the password-reset link has a working way out of the building.',
  '',
  'Ozikoro — history and archive',
  'https://ozikoro.com',
].join('\n');

const html = [
  '<p>This is a test message from the Ozikoro archive, sent by <code>scripts/mail-test.ts</code> to confirm',
  'that mail is configured and that it reaches an inbox.</p>',
  `<p>Transport: ${status.transport}<br>From: ${status.from}</p>`,
  '<p>Nothing has changed on any account, and nothing needs doing about this message.</p>',
  '<hr>',
  '<p>Ozikoro — history and archive<br><a href="https://ozikoro.com">ozikoro.com</a></p>',
].join('\n');

console.log(`\n  sending one message to ${sendTo} ...`);

const result = await sendMail({
  to: sendTo,
  subject: 'Ozikoro mail test',
  text,
  html,
});

console.log(`  delivered    ${result.delivered ? 'yes' : 'no'}`);
console.log(`  transport    ${result.transport ?? '(none)'}`);
// The provider's own identifier, which is the only part of this report that is not the client's opinion
// of itself. A delivered message without an id means the provider answered 200 without a body to read.
console.log(`  id           ${result.id ?? '(the provider returned none)'}`);
if (result.error) console.log(`  error        ${result.error}`);

if (!result.delivered) {
  console.error('\n  The provider refused it. Read `error` above: it is the provider’s own sentence.\n');
  process.exit(1);
}

console.log('\n  Accepted by the provider. Delivery to the inbox is the provider’s next step, not this one.\n');
