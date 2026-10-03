/**
 * The mail client, tested against a server that is not there.
 *
 *   npm run test:mail
 *
 * Mail is the one part of the recovery flow that leaves this repository, and it is
 * the part that cannot be exercised against a real provider from a test. So this
 * stands a small SMTP server up on a random port and has a real conversation with
 * it: greeting, EHLO, authentication, envelope, message, QUIT.
 *
 * What it cannot check is whether a provider accepts the message. What it does
 * check is everything up to that point — that the headers are well formed, a
 * non-ASCII subject is encoded rather than refused, a body line beginning with a
 * full stop is not mistaken for end-of-data, and that with no transport configured
 * the function reports failure instead of throwing. The last of those is what keeps
 * a locked-out person's request alive when mail is off.
 */
import { createServer } from 'node:net';

const received = [];
let conversation = [];

const server = createServer((socket) => {
  // The client closes the connection as soon as it has its answer, which the
  // server sees as a reset. Swallowed here: it is the test's own harness, not
  // the client, that would otherwise crash on it.
  socket.on('error', () => {});
  socket.setEncoding('utf8');
  let buffer = '';
  let inData = false;
  let data = '';
  let authStep = 0;
  socket.write('220 test.local ESMTP\r\n');
  conversation = [];
  socket.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          received.push(data);
          socket.write('250 2.0.0 Ok: queued\r\n');
        } else {
          data += line + '\r\n';
        }
        continue;
      }
      conversation.push(line);
      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO')) {
        socket.write('250-test.local\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10485760\r\n');
      } else if (upper.startsWith('AUTH PLAIN')) {
        socket.write('235 2.7.0 Authentication successful\r\n');
      } else if (upper.startsWith('AUTH LOGIN')) {
        authStep = 1;
        socket.write('334 VXNlcm5hbWU6\r\n');
      } else if (authStep === 1) {
        authStep = 2;
        socket.write('334 UGFzc3dvcmQ6\r\n');
      } else if (authStep === 2) {
        authStep = 0;
        socket.write('235 2.7.0 Authentication successful\r\n');
      } else if (upper.startsWith('MAIL FROM')) {
        socket.write('250 2.1.0 Ok\r\n');
      } else if (upper.startsWith('RCPT TO')) {
        socket.write('250 2.1.5 Ok\r\n');
      } else if (upper === 'DATA') {
        inData = true;
        data = '';
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (upper === 'QUIT') {
        socket.write('221 2.0.0 Bye\r\n');
        socket.end();
      } else {
        socket.write('250 2.0.0 Ok\r\n');
      }
    }
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

process.env.OZITUMA_SMTP_HOST = '127.0.0.1';
process.env.OZITUMA_SMTP_PORT = String(port);
process.env.OZITUMA_SMTP_SECURE = '0';
process.env.OZITUMA_SMTP_ALLOW_PLAINTEXT = '1';
process.env.OZITUMA_SMTP_USER = 'hello@ozituma.com';
process.env.OZITUMA_SMTP_PASSWORD = 'a secret';
process.env.OZITUMA_MAIL_FROM = 'Ozituma <hello@ozituma.com>';

/*
 * RESEND IS CLEARED, because it now outranks SMTP and this harness tests SMTP.
 *
 * A transport added ahead of another one silently changes what every existing test of the later one is
 * testing. A developer whose shell happens to export RESEND_API_KEY would have had this file exercise
 * the Resend HTTP path against a local SMTP server and report eleven failures with no cause in the diff.
 * **The precedence is stated here rather than inherited from the environment it is run in.**
 */
delete process.env.RESEND_API_KEY;
delete process.env.OZIKORO_MAIL_FROM;
delete process.env.RESEND_FROM;

/*
 * The module moved to `@ozituma/core` in round 178 and this path was not moved with it, so the check
 * had been failing to import anything at all. A test that cannot load its subject reports nothing
 * about it; see the note in `packages/core/src/mail.ts` on why the client is shared.
 */
const { mailStatus, sendMail } = await import(new URL('../packages/core/src/mail.ts', import.meta.url).href);

let failures = 0;
const assert = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const status = mailStatus();
console.log('\n--- Configuration ---');
assert('SMTP is detected as configured', status.configured && status.transport === 'smtp', JSON.stringify(status));

console.log('\n--- A plain-text message ---');
const plain = await sendMail({
  to: 'someone@example.com',
  subject: 'Set a new password for Ozituma',
  text: 'Open http://ozituma.com/reset?token=abc\n.second line starts with a dot',
});
assert('it reports that it was delivered', plain.delivered === true, JSON.stringify(plain));
assert('it went through SMTP', plain.transport === 'smtp');
assert('the server saw the greeting, EHLO and AUTH', conversation.some((l) => l.startsWith('EHLO')) && conversation.some((l) => l.toUpperCase().startsWith('AUTH PLAIN')));
assert('the envelope sender is the bare address', conversation.some((l) => l === 'MAIL FROM:<hello@ozituma.com>'), conversation.find((l) => l.startsWith('MAIL FROM')));
assert('the recipient is right', conversation.some((l) => l === 'RCPT TO:<someone@example.com>'));

const message = received[0] ?? '';
assert('the message carries the From header', /^From: Ozituma <hello@ozituma\.com>$/m.test(message));
assert('the message carries the To header', /^To: <someone@example\.com>$/m.test(message));
assert('the subject survives intact', /^Subject: Set a new password for Ozituma$/m.test(message));
assert('there is a Message-ID', /^Message-ID: <[0-9a-f]{32}@ozituma\.com>$/m.test(message));
assert('the body is base64 encoded', message.includes('Content-Transfer-Encoding: base64'));
const bodyText = Buffer.from(
  message.split('\r\n\r\n')[1].replace(/\r\n/g, ''),
  'base64'
).toString('utf8');
assert('the link survives the round trip', bodyText.includes('http://ozituma.com/reset?token=abc'), JSON.stringify(bodyText.slice(0, 40)));
assert('a line beginning with a dot is not treated as end-of-data', bodyText.includes('.second line starts with a dot'));

console.log('\n--- A subject with an Igbo word in it ---');
conversation = [];
await sendMail({ to: 'someone@example.com', subject: 'Nkọwa okwu', text: 'test' });
const second = received[1] ?? '';
assert('a non-ASCII subject is encoded, not sent raw', /^Subject: =\?UTF-8\?B\?/m.test(second), second.split('\r\n').find((l) => l.startsWith('Subject')));

console.log('\n--- Failing safely ---');
delete process.env.OZITUMA_SMTP_HOST;
process.env.AWS_REGION = '';
process.env.AWS_ACCESS_KEY_ID = '';
process.env.AWS_SECRET_ACCESS_KEY = '';
const unconfigured = await sendMail({ to: 'someone@example.com', subject: 'x', text: 'y' });
assert('with no transport it reports failure instead of throwing', unconfigured.delivered === false);
assert('and it says why', typeof unconfigured.error === 'string' && unconfigured.error.length > 0, unconfigured.error);

server.close();
console.log(`\n${failures === 0 ? 'ALL MAIL CHECKS PASSED' : `${failures} MAIL CHECKS FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
