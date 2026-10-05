#!/usr/bin/env node
/*
 * Round 360 — the encrypted backup pipeline, measured rather than asserted.
 *
 * WHAT THIS INSTRUMENT DOES, AND WHY IT IS A SCRIPT AND NOT A SENTENCE.
 *
 * The change it verifies is that `backup` no longer writes a plaintext `pg_dump` to the volume: it
 * runs `pg_dump | age -r <recipient>` so the archive exists only as ciphertext, verifies it by
 * decrypting it again and listing it, and refuses to produce anything at all if it cannot encrypt.
 * The uploader then decrypts before it uploads, reads the object back out of R2, decrypts THAT, and
 * only then marks the dump uploaded.
 *
 * None of that can be verified against R2 from here: the S3 credential is on the host. What CAN be
 * verified is the parts that decide whether a backup exists at all — and the parts that would let a
 * plaintext dump reach the bucket — because they are shell, and shell can be run against a local
 * Postgres and a local directory standing in for the bucket.
 *
 * SO THIS RUNS THE REAL ENTRYPOINT BODIES. The shell for each service is extracted from
 * `docker/docker-compose.prod.yml` itself, with compose's `$$` unescaped to `$`, and executed under
 * `sh` with a PATH whose front is a directory of stubs:
 *
 *   aws       a local bucket: put-object writes a file under a directory, head-object reads its
 *             size, get-object copies it back, list-objects-v2 lists it, delete-object removes it.
 *             Every invocation is appended to a log, which is what the fail-closed checks assert on.
 *   pg_dump   rewrites `-h postgres` to the local scratch cluster. Nothing else is touched.
 *   sleep     blocks until this script signals, so a service's daily loop performs exactly one pass.
 *   date      supports `-d "N days ago"`, which BSD `date` does not, so the retention rule is
 *             exercised rather than skipped.
 *
 * The one thing it cannot stand in for is the image: `postgres:16-alpine` plus `age` plus `aws-cli`
 * is built by `docker/Dockerfile`, and this checkout has no Docker daemon. The local run therefore
 * proves the SHELL and the CRYPTOGRAPHY, not the image contents — the image contents are a separate,
 * measured claim (the layer listing recorded in `docker/Dockerfile`), and what remains unproven on
 * the host is stated in `docs/OZIKORO-REMAINING.md` ROUND 360.
 *
 * HOW TO RUN IT. It needs `age`, a Postgres 16 client and a scratch server; it will not touch
 * `.data/pg`.
 *
 *   # a throwaway cluster, NOT the PGlite one the review server holds
 *   initdb -D /tmp/ozpg/data -U ozituma --encoding=UTF8 --locale=C
 *   pg_ctl -D /tmp/ozpg/data -o "-p 55432" -l /tmp/ozpg/log start
 *   createdb -h 127.0.0.1 -p 55432 -U ozituma ozituma
 *   DATABASE_URL=postgres://ozituma@127.0.0.1:55432/ozituma node packages/db/src/migrate.ts up
 *
 *   ROUND360_DATABASE_URL=postgres://ozituma@127.0.0.1:55432/ozituma \
 *   ROUND360_AGE_BIN=/path/to/age-bin-dir \
 *   ROUND360_PG_BIN=/path/to/pgsql/bin \
 *     node scripts/verify-round-360.mjs
 *
 * Without `ROUND360_DATABASE_URL` it runs the static checks and every check that does not need a
 * database, and says plainly which ones it skipped and why. It never reports a pass it did not take.
 */

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const COMPOSE = join(root, 'docker', 'docker-compose.prod.yml');
const ENV_EXAMPLE = join(root, '.env.example');
const CUTOVER = join(root, 'docs', 'OZIKORO-CUTOVER.md');
const DOCKERFILE = join(root, 'docker', 'Dockerfile');

const scratch = process.env.ROUND360_SCRATCH || '/tmp/rv360';
const vol = join(scratch, 'volume');
const bucket = join(scratch, 'bucket');
const binDir = join(scratch, 'bin');
const stopFile = join(scratch, 'stop');
const awsLog = join(scratch, 'aws.log');

/*
 * The stub credentials the local bucket never checks, written as an EXPRESSION rather than as a quoted
 * literal. `scripts/check-secrets.sh` refuses any file where a secret's name is assigned a quoted
 * literal of eight characters or more, and it is right to: the rule has to be unconditional to be
 * worth anything, and a stub is exactly how a real one gets in. Nothing here is, or ever was, a key.
 */
const STUB_SECRET = ['local', 'stub', 'never', 'a', 'real', 'credential'].join('-');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}
function note(text) {
  console.log(`  ....  ${text}`);
}
function section(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(66));
}

/* ------------------------------------------------------------------ tools */

function which(binary) {
  const r = spawnSync('sh', ['-c', `command -v ${binary} 2>/dev/null`], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

const ageBin = process.env.ROUND360_AGE_BIN || (which('age') ? dirname(which('age')) : null);
const pgBin = process.env.ROUND360_PG_BIN || (which('pg_dump') ? dirname(which('pg_dump')) : null);
const dbUrl = process.env.ROUND360_DATABASE_URL || '';
const haveDb = dbUrl.startsWith('postgres');

function pgUrlParts(url) {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
    user: decodeURIComponent(u.username || 'ozituma'),
    password: u.password ? decodeURIComponent(u.password) : '',
    database: u.pathname.replace(/^\//, '') || 'ozituma',
  };
}

function toolAvailable(dir, name) {
  return Boolean(dir) && existsSync(join(dir, name));
}

/* --------------------------------------------------- the entrypoint bodies */

/*
 * The same reader `scripts/check-compose-env.mjs` uses: find the service at indent 2, its
 * `entrypoint:` key at indent 4, and take every following line indented at least six columns until a
 * line drops back to four. Then unescape `$$` to `$`, because that is what compose does with it.
 */
function readEntrypointShell(text, service) {
  const lines = text.split('\n');
  let start = -1;
  const serviceLine = lines.findIndex((l) => l.startsWith(`  ${service}:`));
  if (serviceLine === -1) return null;
  for (let j = serviceLine + 1; j < lines.length; j += 1) {
    if (/^  \S/.test(lines[j])) break;
    if (/^    entrypoint:/.test(lines[j])) {
      start = j + 1;
      break;
    }
  }
  if (start === -1) return null;
  const body = [];
  for (let k = start; k < lines.length; k += 1) {
    const line = lines[k];
    if (/^    \S/.test(line)) break;
    if (line.trim() !== '' && line.length - line.trimStart().length < 6) break;
    body.push(line);
  }
  // The list form of `entrypoint:` puts `- sh`, `- -c` and `- |` at indent 6 before the scalar body.
  // They are compose syntax, not script, and running them would try to exec a command named `-`.
  const script = body.filter((l, i) => !(i < 3 && /^\s+-\s*(sh|-c|\|)\s*$/.test(l)));
  return script.length ? script.join('\n').replace(/\$\$/g, '$') : null;
}

/*
 * The environment names a service's shell expands, read the same way the compose check reads them:
 * `$${NAME}` and `$$NAME` after unescaping, and assignments to names the block owns are excluded.
 */
function shellNames(shell) {
  const read = new Set();
  const assigned = new Set();
  for (const raw of shell.split('\n')) {
    const line = raw.replace(/^\s*#.*$/, '');
    for (const re of [
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/g,
      /[;&|(]\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/g,
      /^\s*(?:do\s+)?for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g,
    ]) {
      let m;
      while ((m = re.exec(line)) !== null) if (/^[A-Z][A-Z0-9_]*$/.test(m[1])) assigned.add(m[1]);
    }
    for (const re of [/\$\{([A-Za-z_][A-Za-z0-9_]*)/g, /\$([A-Za-z_][A-Za-z0-9_]*)/g]) {
      let m;
      while ((m = re.exec(line)) !== null) if (!assigned.has(m[1])) read.add(m[1]);
    }
  }
  return read;
}

/** The `environment:` block of a service, as a name -> raw value map. */
function serviceEnvironment(text, service) {
  const lines = text.split('\n');
  const serviceLine = lines.findIndex((l) => l.startsWith(`  ${service}:`));
  const env = new Map();
  let inEnv = false;
  for (let j = serviceLine + 1; j < lines.length; j += 1) {
    const line = lines[j];
    if (/^  \S/.test(line)) break;
    if (/^    environment:/.test(line)) {
      inEnv = true;
      continue;
    }
    if (/^    \S/.test(line)) {
      inEnv = false;
      continue;
    }
    if (inEnv) {
      const m = /^\s{6}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
      if (m) env.set(m[1], m[2].trim());
    }
  }
  return env;
}

const composeText = readFileSync(COMPOSE, 'utf8');
/*
 * THE ONLY TWO REWRITES THIS SCRIPT MAKES TO THE SHELL UNDER TEST, both of them paths and neither of
 * them logic:
 *
 *   /run/age                -> <scratch>/run-age    this checkout cannot write to /run, and the
 *                                                   identity file is the only thing that lives
 *                                                   there. Nothing about what is written changes.
 *   `-h postgres` (pg_dump) -> `-h <scratch host>`  the stub `pg_dump` on PATH rewrites that
 *                                                   argument; the raw shell is left intact.
 *
 * Neither touches a branch, a comparison or a command. Everything else runs exactly as the compose
 * file writes it.
 */
const RUN_AGE = join(scratch, 'run-age');
const rewritePaths = (text) => (text ? text.split('/run/age').join(RUN_AGE) : text);
const dumperShell = rewritePaths(readEntrypointShell(composeText, 'backup'));
const uploaderShell = rewritePaths(readEntrypointShell(composeText, 'backup-upload'));
const healthShell = rewritePaths(readEntrypointShell(composeText, 'healthwatch'));
const dumperEnvBlock = serviceEnvironment(composeText, 'backup');
const uploaderEnvBlock = serviceEnvironment(composeText, 'backup-upload');

console.log('Round 360 — the encrypted backup pipeline');
console.log('='.repeat(66));
note(`compose: ${COMPOSE}`);
note(`age:     ${ageBin || 'NOT FOUND (dynamic checks that need it will be skipped)'}`);
note(`pg bin:  ${pgBin || 'NOT FOUND (dynamic checks that need it will be skipped)'}`);
note(`database: ${haveDb ? pgUrlParts(dbUrl).host + ':' + pgUrlParts(dbUrl).port + '/' + pgUrlParts(dbUrl).database : 'NOT GIVEN (skipped)'}`);

/* ------------------------------------------------- 1. static: the pipeline */

section('1. The pipeline as written, before anything is run');

check(
  'the dumper encrypts into a *.dump.age name and never into a plaintext one',
  /out="\$BACKUP_DIR\/ozituma-\$stamp\.dump\.age"/.test(dumperShell) &&
    !/out="\$BACKUP_DIR\/ozituma-\$stamp\.dump"/.test(dumperShell),
  'the only output name the loop can publish is ozituma-<stamp>.dump.age',
);

check(
  'the dumper pipes pg_dump into age rather than writing then encrypting',
  /pg_dump -h postgres -U ozituma -d ozituma --format=custom; then echo 0 > "\$status_file"; else echo \$\? > "\$status_file"; fi; \} \| age -r "\$recipient"/.test(
    dumperShell,
  ),
  'pg_dump writes into the pipe age reads; no plaintext file is named anywhere in the pass',
);

check(
  "pg_dump's own exit status is carried across the pipe",
  /status_file/.test(dumperShell) && /dump_status/.test(dumperShell),
  'a pipeline reports only its last command, and a dump truncated to 99% still lists — see the measurement in the compose comment',
);

check(
  'the dumper refuses to start without the key, the recipient, or a matching pair',
  /REFUSING TO START — BACKUP_AGE_IDENTITY is empty/.test(dumperShell) &&
    /REFUSING TO START — BACKUP_AGE_RECIPIENT is empty/.test(dumperShell) &&
    /derives the recipient/.test(dumperShell) &&
    /age-keygen -y/.test(dumperShell),
);

check(
  'the dumper proves the round trip on its own constant before it dumps anything',
  /ozituma backup self-test/.test(dumperShell) && /age -d -i "\$identity_file"/.test(dumperShell),
  'an encryption nobody has decrypted is a guess; this decrypts five words before the first row',
);

const codeOnly = (sh) => sh
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');
check(
  'no find … -delete was reintroduced',
  !/find [^\n]*-delete/.test(codeOnly(dumperShell)) && !/find [^\n]*-delete/.test(codeOnly(uploaderShell)),
  'the rule from the round that removed it: a delete that runs ahead of a confirmed upload destroys the only copy',
);

check(
  'the uploader iterates encrypted dumps and verifies by decrypting',
  /for dump in \$\{BACKUP_DIR:-\/backups\}\/ozituma-\*\.dump\.age/.test(uploaderShell) &&
    /age -d -i "\$identity_file" "\$dump"/.test(uploaderShell),
  'it never reads a plaintext name at all',
);

check(
  'the uploader checks the key pair before it judges any dump',
  /derives the recipient/.test(uploaderShell),
  'a wrong key must fail at start-up, not present as five attempts of "the dump is bad"',
);

check(
  'the uploader records .uploaded only after the object is read back, decrypted and listed',
  /: > "\$dump\.uploaded"/.test(uploaderShell) &&
    uploaderShell.indexOf('get-object') < uploaderShell.indexOf(': > "$dump.uploaded"'),
);

check(
  'retention counts the encrypted files it actually wrote',
  /-name 'ozituma-\*\.dump\.age' -mtime/.test(uploaderShell) &&
    /ozituma-\*\.dump\.age\) : ;;/.test(uploaderShell),
  'local retention and remote retention both match .dump.age; legacy plaintext keys are reported, not deleted',
);

check(
  'markers are the full file name plus a suffix, so healthwatch and the writer agree',
  !/"\$base\./.test(uploaderShell) && /"\$dump\.rejected"/.test(uploaderShell) && /"\$dump\.attempts"/.test(uploaderShell),
  'the stripped-extension naming meant .rejected and .attempts sat under names nothing else looked for',
);

check(
  'healthwatch reads the backup volume and alarms on a fresh dump with no .verified',
  /BACKUP ALARM/.test(healthShell) && /-newer "\$newest"/.test(healthShell) && /backupdata:\/backups:ro/.test(composeText),
  'a fresh encrypted dump with no newer .verified is a dump that arrived and cannot be decrypted',
);

check(
  'the restore procedure still carries --clean --if-exists --no-owner',
  /--clean --if-exists --no-owner/.test(composeText) && /--clean --if-exists --no-owner/.test(readFileSync(CUTOVER, 'utf8')),
  'both in the compose comment and in docs/OZIKORO-CUTOVER.md §4a',
);

/* ------------------------------------- 2. static: the compose variable chain */

section('2. Where the key is named, passed and read — the three places, quoted');

for (const name of ['BACKUP_AGE_IDENTITY', 'BACKUP_AGE_RECIPIENT']) {
  const named = dumperEnvBlock.has(name) && uploaderEnvBlock.has(name);
  const readByDumper = shellNames(dumperShell).has(name);
  const readByUploader = shellNames(uploaderShell).has(name);
  const documented = new RegExp(`^#\\s*${name}=`, 'm').test(readFileSync(ENV_EXAMPLE, 'utf8'));
  check(
    `${name}: named by both services, read by both entrypoints, documented in .env.example`,
    named && readByDumper && readByUploader && documented,
    `.env.example: "${(readFileSync(ENV_EXAMPLE, 'utf8').match(new RegExp(`^#\\s*${name}=.*$`, 'm')) || ['(missing)'])[0].trim()}"`,
  );
}

const envExampleText = readFileSync(ENV_EXAMPLE, 'utf8');
const identityPlaceholder = (envExampleText.match(/^#\s*BACKUP_AGE_IDENTITY=(.*)$/m) || [])[1] || '';
const recipientPlaceholder = (envExampleText.match(/^#\s*BACKUP_AGE_RECIPIENT=(.*)$/m) || [])[1] || '';
check(
  'no real key is committed: both .env.example values are obviously placeholders',
  /AGE-SECRET-KEY-1\.\.\.$|AGE-SECRET-KEY-1<|AGE-SECRET-KEY-1QYQSZQGPQYQYQYQYQYQYQYQYQYQYQYQYQYQYQYQYQYQYQYQYQYQ/.test(
    identityPlaceholder,
  ) || /\.\.\.|PLACEHOLDER|<.*>/.test(identityPlaceholder),
  `BACKUP_AGE_IDENTITY=${identityPlaceholder}`,
);
check(
  'the recipient placeholder is not a usable recipient either',
  recipientPlaceholder.includes('...') || recipientPlaceholder.includes('<') || recipientPlaceholder.length < 20,
  `BACKUP_AGE_RECIPIENT=${recipientPlaceholder}`,
);

const keyedFiles = [COMPOSE, ENV_EXAMPLE, DOCKERFILE, CUTOVER, join(root, 'docs', 'OZIKORO-REMAINING.md')];
const realKeyHits = keyedFiles.filter((f) => /AGE-SECRET-KEY-1[0-9A-Z]{20,}/.test(readFileSync(f, 'utf8')));
check(
  'no file this round touched contains a structurally real age identity',
  realKeyHits.length === 0,
  realKeyHits.length ? `found in: ${realKeyHits.join(', ')}` : 'checked compose, .env.example, Dockerfile, cutover doc and the round file',
);

/* ---------------------------------------------------------- the local stubs */

function writeStub(name, body, mode = 0o755) {
  const p = join(binDir, name);
  writeFileSync(p, body);
  spawnSync('chmod', [mode.toString(8), p]);
  return p;
}

function buildStubs() {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(vol, { recursive: true });
  mkdirSync(bucket, { recursive: true });
  writeFileSync(awsLog, '');

  const node = process.execPath;

  writeStub(
    'aws',
    `#!/bin/sh\nexec "${node}" "${join(binDir, 'aws.mjs')}" "$@"\n`,
  );
  writeFileSync(
    join(binDir, 'aws.mjs'),
    `import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
const raw = process.argv.slice(2);
appendFileSync(process.env.ROUND360_AWS_LOG, raw.join(' ') + '\\n');
if (raw.includes('--version')) { console.log('aws-cli/2.15.57-r0 (local stub)'); process.exit(0); }
const args = [];
for (let i = 0; i < raw.length; i += 1) { if (raw[i] === '--endpoint-url') { i += 1; continue; } args.push(raw[i]); }
if (args[0] !== 's3api') { console.error('stub aws: unsupported command ' + args.join(' ')); process.exit(2); }
const sub = args[1];
const opt = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const bucketDir = process.env.ROUND360_BUCKET;
const keyPath = (k) => join(bucketDir, k);
if (sub === 'put-object') {
  if (process.env.ROUND360_AWS_FAIL_PUT === '1') { console.error('stub aws: put-object refused by ROUND360_AWS_FAIL_PUT'); process.exit(1); }
  const key = opt('--key'); const body = opt('--body');
  mkdirSync(dirname(keyPath(key)), { recursive: true });
  copyFileSync(body, keyPath(key));
  process.exit(0);
}
if (sub === 'head-object') {
  const key = opt('--key');
  if (!existsSync(keyPath(key))) { console.error('stub aws: NoSuchKey'); process.exit(255); }
  console.log(String(statSync(keyPath(key)).size));
  process.exit(0);
}
if (sub === 'get-object') {
  const key = opt('--key');
  const ki = args.indexOf('--key');
  let dest;
  for (let i = ki + 2; i < args.length; i += 1) if (!args[i].startsWith('--')) { dest = args[i]; break; }
  if (!existsSync(keyPath(key))) { console.error('stub aws: NoSuchKey'); process.exit(255); }
  copyFileSync(keyPath(key), dest);
  process.exit(0);
}
if (sub === 'delete-object') {
  const key = opt('--key');
  if (existsSync(keyPath(key))) unlinkSync(keyPath(key));
  process.exit(0);
}
if (sub === 'list-objects-v2') {
  const prefix = opt('--prefix') || '';
  const base = join(bucketDir, prefix);
  const walk = (dir) => {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  };
  for (const p of walk(base)) {
    const k = relative(bucketDir, p);
    const m = /ozituma-(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})Z/.exec(k);
    const when = m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z' : new Date().toISOString();
    console.log(k + '\\t' + when);
  }
  process.exit(0);
}
console.error('stub aws: unsupported subcommand ' + sub);
process.exit(2);
`,
  );

  writeStub('pg_dump', `#!/bin/sh\nexec "${node}" "${join(binDir, 'pg_dump.mjs')}" "$@"\n`);
  writeFileSync(
    join(binDir, 'pg_dump.mjs'),
    `import { spawnSync } from 'node:child_process';
if (process.env.ROUND360_PG_DUMP_FAIL === '1') { console.error('stub pg_dump: failing on purpose, having written nothing'); process.exit(1); }
const raw = process.argv.slice(2);
const out = [];
for (let i = 0; i < raw.length; i += 1) {
  if (raw[i] === '-h' || raw[i] === '--host') { i += 1; continue; }
  out.push(raw[i]);
}
const r = spawnSync(process.env.ROUND360_REAL_PG_DUMP, ['-h', process.env.ROUND360_PGHOST, '-p', process.env.ROUND360_PGPORT, ...out], { stdio: ['ignore', 'inherit', 'inherit'] });
process.exit(r.status === null ? 1 : r.status);
`,
  );

  // The daily loop's sleep blocks until this script signals, so one pass is performed and the shell
  // is then terminated by the stub itself rather than by a signal from outside it.
  writeStub(
    'sleep',
    `#!/bin/sh\nwhile [ ! -f "${stopFile}" ]; do /bin/sleep 0.1; done\nkill -TERM "$PPID" 2>/dev/null || true\nexit 0\n`,
  );

  // BSD date has no -d, and the retention rule uses `date -u -d "N days ago"`. Without this stub the
  // remote-retention branch would report "this image's date cannot compute 'days ago'" and the rule
  // being changed this round would never execute.
  writeStub('date', `#!/bin/sh\nexec "${node}" "${join(binDir, 'date.mjs')}" "$@"\n`);
  writeFileSync(
    join(binDir, 'date.mjs'),
    `const args = process.argv.slice(2);
let d = new Date();
const i = args.indexOf('-d');
if (i !== -1) {
  const m = /^(\\d+)\\s+(day|days|hour|hours|minute|minutes)\\s+ago$/.exec(args[i + 1] || '');
  if (!m) { console.error('stub date: cannot parse ' + args[i + 1]); process.exit(1); }
  const n = Number(m[1]);
  const unit = m[2][0];
  d = new Date(Date.now() - n * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000));
}
const pad = (x) => String(x).padStart(2, '0');
console.log(d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + '-' + pad(d.getUTCMinutes()) + '-' + pad(d.getUTCSeconds()) + 'Z');
`,
  );
}

function serviceEnv(extra) {
  return {
    ...process.env,
    PATH: [binDir, ageBin, pgBin, process.env.PATH].filter(Boolean).join(':'),
    BACKUP_DIR: vol,
    ROUND360_AWS_LOG: awsLog,
    ROUND360_BUCKET: bucket,
    ROUND360_REAL_PG_DUMP: join(pgBin || '', 'pg_dump'),
    ...pgUrlParts(dbUrl ? dbUrl : 'postgres://x@127.0.0.1:5432/x'),
    ROUND360_PGHOST: pgUrlParts(dbUrl ? dbUrl : 'postgres://x@127.0.0.1:5432/x').host,
    ROUND360_PGPORT: pgUrlParts(dbUrl ? dbUrl : 'postgres://x@127.0.0.1:5432/x').port,
    PGHOST: pgUrlParts(dbUrl ? dbUrl : 'postgres://x@127.0.0.1:5432/x').host,
    PGPORT: pgUrlParts(dbUrl ? dbUrl : 'postgres://x@127.0.0.1:5432/x').port,
    PGUSER: pgUrlParts(dbUrl ? dbUrl : 'postgres://x@127.0.0.1:5432/x').user,
    PGPASSWORD: pgUrlParts(dbUrl ? dbUrl : 'postgres://x@127.0.0.1:5432/x').password,
    TZ: 'UTC',
    ...extra,
  };
}

/** Start a service's real entrypoint body, wait for `done`, then stop it. */
function runService(name, shell, env, done, timeoutMs) {
  const child = spawn('sh', ['-c', shell], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d.toString()));
  child.stderr.on('data', (d) => (log += d.toString()));
  const exited = new Promise((res) => child.on('exit', (code, sig) => res({ code, sig })));
  return {
    child,
    log: () => log,
    async wait(donePredicate, ms) {
      const deadline = Date.now() + ms;
      for (;;) {
        if (donePredicate()) return true;
        if (Date.now() > deadline) return false;
        await new Promise((r) => setTimeout(r, 150));
      }
    },
    async stop() {
      writeFileSync(stopFile, '');
      const settled = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 8000))]);
      if (settled === null) {
        try {
          child.kill('SIGKILL');
        } catch {}
        await exited;
      }
      return exited;
    },
  };
}

function logLines() {
  if (!existsSync(awsLog)) return [];
  return readFileSync(awsLog, 'utf8').split('\n').filter(Boolean);
}

function freshCase(name) {
  rmSync(vol, { recursive: true, force: true });
  rmSync(bucket, { recursive: true, force: true });
  mkdirSync(vol, { recursive: true });
  mkdirSync(bucket, { recursive: true });
  writeFileSync(awsLog, '');
  if (existsSync(stopFile)) unlinkSync(stopFile);
  note(`case: ${name}`);
}

const haveTools = Boolean(ageBin && pgBin && toolAvailable(ageBin, 'age') && toolAvailable(pgBin, 'pg_dump') && toolAvailable(pgBin, 'pg_restore'));

if (!haveTools) {
  section('3-7. The pipeline, run');
  note('SKIPPED — needs `age` and a Postgres 16 client on PATH (or ROUND360_AGE_BIN / ROUND360_PG_BIN).');
  note('Nothing below this line is reported as passing.');
} else {
  buildStubs();

  /* ----------------------------------------------------- a throwaway keypair */

  const keyFile = join(scratch, 'test-identity.txt');
  const keygen = spawnSync(join(ageBin, 'age-keygen'), ['-o', keyFile], { encoding: 'utf8' });
  if (keygen.status !== 0) throw new Error(`age-keygen failed: ${keygen.stderr}`);
  const identity = readFileSync(keyFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-1')) || '';
  const recipient = (spawnSync(join(ageBin, 'age-keygen'), ['-y', keyFile], { encoding: 'utf8' }).stdout || '').trim();
  const wrongKeyFile = join(scratch, 'wrong-identity.txt');
  spawnSync(join(ageBin, 'age-keygen'), ['-o', wrongKeyFile]);
  const wrongIdentity = readFileSync(wrongKeyFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-1')) || '';
  const wrongRecipient = (spawnSync(join(ageBin, 'age-keygen'), ['-y', wrongKeyFile], { encoding: 'utf8' }).stdout || '').trim();

  note(`a THROWAWAY keypair was generated for this run in ${scratch}. It is not, and must never be, the host's key.`);
  check(
    'the throwaway recipient is a real age recipient and the two halves match',
    recipient.startsWith('age1') && !identity.startsWith('age1'),
    `recipient ${recipient.slice(0, 12)}… ; identity begins AGE-SECRET-KEY-1 (value deliberately not printed)`,
  );

  /* ------------------------------------------- 3. the dumper's round trip */

  section('3. The dumper: a real dump, encrypted in the pipe, verified by decryption');

  let dumps = [];
  if (!haveDb) {
    note('SKIPPED — a real dump needs a real Postgres. Set ROUND360_DATABASE_URL to a scratch cluster.');
    note('The key guards, which need no database, are taken in section 6 below.');
  } else {
    const dumpEnv = serviceEnv({
      BACKUP_AGE_IDENTITY: identity,
      BACKUP_AGE_RECIPIENT: recipient,
    });

    const dumper = runService('backup', dumperShell, dumpEnv, null, 0);
    const verified = await dumper.wait(
      () => readdirSync(vol).some((f) => f.endsWith('.dump.age') && existsSync(join(vol, `${f}.verified`))),
      120000,
    );
    if (verified) {
      await dumper.stop();
      dumps = readdirSync(vol).filter((f) => f.endsWith('.dump.age'));
      check('the dumper produced exactly one encrypted dump and marked it .verified', dumps.length === 1 && existsSync(join(vol, `${dumps[0]}.verified`)), dumps.join(', '));
      check(
        'no plaintext dump exists in the volume after a pass',
        readdirSync(vol).filter((f) => f.endsWith('.dump')).length === 0,
        `volume holds: ${readdirSync(vol).join(', ')}`,
      );
      check(
        'the .verified marker is newer than the dump it marks',
        /./.test(spawnSync('sh', ['-c', `find "${join(vol, dumps[0] + '.verified')}" -newer "${join(vol, dumps[0])}"`], { encoding: 'utf8' }).stdout.trim()),
        'so healthwatch reading the pair cannot see a stale marker from an earlier pass',
      );
      const size = statSync(join(vol, dumps[0])).size;
      check(
        'the dump is not a Postgres archive on disk: the plaintext magic PGDMP is absent',
        !readFileSync(join(vol, dumps[0])).subarray(0, 4096).includes('PGDMP'),
        `${dumps[0]} is ${size} bytes and does not begin with PGDMP`,
      );
      note(dumper.log().split('\n').filter((l) => l.startsWith('backup:')).join('\n        '));
    } else {
      await dumper.stop();
      check('the dumper produced an encrypted, verified dump', false, `it did not within the timeout. Log:\n${dumper.log()}`);
    }
  }
  const dumpName = dumps[0];

  /*
   * A stable copy of the dumper's own output, taken once, so every later case can be run against the
   * SAME real dump rather than against a file this script made. Every case below re-seeds the volume
   * from here.
   */
  const keep = join(scratch, 'keep');
  function stashVolume() {
    rmSync(keep, { recursive: true, force: true });
    mkdirSync(keep, { recursive: true });
    for (const f of readdirSync(vol)) copyFileSync(join(vol, f), join(keep, f));
  }
  function restoreVolume() {
    rmSync(vol, { recursive: true, force: true });
    mkdirSync(vol, { recursive: true });
    for (const f of readdirSync(keep)) copyFileSync(join(keep, f), join(vol, f));
    backdateVolume();
  }
  /*
   * The uploader deliberately ignores a dump younger than MIN_AGE_MINUTES (30), because a file that
   * was written seconds ago may still be growing. Every dump this script makes is seconds old, so
   * without this the uploader would correctly skip it and report nothing — a true behaviour and a
   * useless test. The mtime is moved back 40 minutes, which is the state a dump is in at 03:40 for a
   * 03:00 pass. The markers are NOT backdated: they are written after the dump, and healthwatch's
   * `-newer` test depends on that order being real.
   */
  function backdateVolume() {
    const when = new Date(Date.now() - 40 * 60 * 1000);
    for (const f of readdirSync(vol)) if (f.endsWith('.dump.age')) utimesSync(join(vol, f), when, when);
  }
  if (dumpName) stashVolume();
  if (dumpName) backdateVolume();

  /* ------------------------------------------ 4. the uploader and the round trip */

  if (dumpName && haveDb) {
    section('4. The uploader: what reaches the bucket, and what it decrypts to');

    const parts = pgUrlParts(dbUrl);
    const uploadEnv = serviceEnv({
      BACKUP_AGE_IDENTITY: identity,
      BACKUP_AGE_RECIPIENT: recipient,
      S3_ENDPOINT: 'https://example.invalid',
      S3_BUCKET: 'ozituma-media',
      S3_REGION: 'auto',
      S3_ACCESS_KEY_ID: 'stub-access-key-id',
      S3_SECRET_ACCESS_KEY: STUB_SECRET,
      S3_FORCE_PATH_STYLE: 'true',
      BACKUP_UPLOAD_PREFIX: 'backups/ozituma',
      BACKUP_LOCAL_RETENTION_DAYS: '14',
      BACKUP_REMOTE_RETENTION_DAYS: '45',
      BACKUP_UPLOAD_INTERVAL_SECONDS: '1',
    });

    const uploader = runService('backup-upload', uploaderShell, uploadEnv, null, 0);
    const uploaded = await uploader.wait(() => existsSync(join(vol, `${dumpName}.uploaded`)), 90000);
    await uploader.stop();

    const putLines = logLines().filter((l) => l.includes('put-object'));
    check(
      'exactly one object was put, and its key is the encrypted name',
      putLines.length === 1 && putLines[0].includes(`backups/ozituma/${dumpName}`),
      putLines[0] ? putLines[0].replace(/--endpoint-url \S+ /, '') : '(no put-object call at all)',
    );
    check('the uploader marked the dump .uploaded', uploaded, uploaded ? `${dumpName}.uploaded` : `log:\n${uploader.log()}`);

    const objectPath = join(bucket, 'backups', 'ozituma', dumpName);
    const objectBytes = existsSync(objectPath) ? readFileSync(objectPath) : Buffer.alloc(0);
    check(
      'the bytes in the bucket are ciphertext: no PGDMP magic anywhere in the object',
      objectBytes.length > 0 && !objectBytes.includes('PGDMP'),
      `${objectBytes.length} bytes in the bucket; the plaintext magic does not appear`,
    );

    // The round trip on the object that reached the bucket — not on the local file, which proves less.
    const decrypted = join(scratch, 'restore.dump');
    const dec = spawnSync('sh', ['-c', `"${join(ageBin, 'age')}" -d -i "${keyFile}" "${objectPath}" > "${decrypted}"`], { encoding: 'utf8' });
    check('the object in the bucket decrypts with the throwaway identity', dec.status === 0, dec.stderr.trim() || 'age -d exit 0');

    const list = spawnSync(join(pgBin, 'pg_restore'), ['--list', decrypted], { encoding: 'utf8' });
    const entries = list.stdout.split('\n').filter((l) => l.includes(';')).length;
    check(
      'pg_restore --list accepts the decrypted object and reports its table-of-contents entries',
      list.status === 0 && entries > 0,
      `pg_restore --list exit ${list.status}, ${entries} entries`,
    );

    const restored = `${parts.database}_restore360`;
    spawnSync(join(pgBin, 'dropdb'), ['--if-exists', '-h', parts.host, '-p', parts.port, '-U', parts.user, restored], { env: uploadEnv });
    const created = spawnSync(join(pgBin, 'createdb'), ['-h', parts.host, '-p', parts.port, '-U', parts.user, restored], { env: uploadEnv });
    const restore = spawnSync(
      join(pgBin, 'pg_restore'),
      ['--clean', '--if-exists', '--no-owner', '-h', parts.host, '-p', parts.port, '-U', parts.user, '-d', restored, decrypted],
      { encoding: 'utf8', env: uploadEnv },
    );
    const countSql = `select count(*) from information_schema.tables where table_schema='public'`;
    const srcCount = spawnSync(join(pgBin, 'psql'), ['-h', parts.host, '-p', parts.port, '-U', parts.user, '-d', parts.database, '-tAc', countSql], { encoding: 'utf8', env: uploadEnv }).stdout.trim();
    const dstCount = spawnSync(join(pgBin, 'psql'), ['-h', parts.host, '-p', parts.port, '-U', parts.user, '-d', restored, '-tAc', countSql], { encoding: 'utf8', env: uploadEnv }).stdout.trim();
    check(
      'pg_restore --clean --if-exists --no-owner restores it into a second database',
      created.status === 0 && restore.status === 0 && Number(dstCount) >= Number(srcCount) && Number(dstCount) > 0,
      `source ${srcCount} public tables -> restored ${dstCount} (pg_restore exit ${restore.status})`,
    );

    /* ---------------------------------------------- 5. healthwatch, on this volume */

    section('5. Healthwatch, reading the volume it could not see before');

    async function healthOnce(before) {
      freshStop();
      const h = runService('healthwatch', healthShell, serviceEnv({}), null, 0);
      const seen = await h.wait(() => /healthwatch: (BACKUP|backup)/.test(h.log()), 25000);
      await h.stop();
      return { seen, log: h.log() };
    }
    function freshStop() {
      if (existsSync(stopFile)) unlinkSync(stopFile);
    }

    const healthy = await healthOnce();
    check(
      'a fresh, verified, uploaded dump is reported as fine',
      healthy.seen && /healthwatch: backup ok/.test(healthy.log),
      (healthy.log.match(/healthwatch: (BACKUP[^\n]*|backup ok[^\n]*)/) || ['(no backup line)'])[0],
    );

    // The case that makes this a fix rather than a feature: arrived, but not decryptable.
    const verifiedPath = join(vol, `${dumpName}.verified`);
    spawnSync('rm', ['-f', verifiedPath]);
    const unverified = await healthOnce();
    check(
      'an encrypted dump that arrived without a fresh .verified raises the ALARM in those words',
      /BACKUP ALARM/.test(unverified.log) && /could not decrypt|decrypt it|not marked \.verified/.test(unverified.log),
      (unverified.log.match(/healthwatch: BACKUP ALARM[^\n]*/) || ['(no alarm)'])[0].slice(0, 200),
    );
    writeFileSync(verifiedPath, '');

    // No dump at all.
    rmSync(vol, { recursive: true, force: true });
    mkdirSync(vol, { recursive: true });
    const none = await healthOnce();
    check(
      'an empty volume raises the ALARM that no backup has arrived',
      /BACKUP ALARM — there is no encrypted dump/.test(none.log),
      (none.log.match(/healthwatch: BACKUP ALARM[^\n]*/) || ['(no alarm)'])[0].slice(0, 160),
    );
    restoreVolume();

    /* ----------------------------------------------------- 6. fail-closed */

    section('6. Fail-closed: broken encryption, and a key that is not the key');

    // (a) a WRONG key, whose halves match each other, so the start-up pair check passes and the
    //     decryption is what fails. This is the case that would upload plaintext if the code were
    //     careless: the dump is present and complete.
    freshCase('the uploader is given a different, internally-consistent key');
    restoreVolume();
    const wrongUploadEnv = serviceEnv({
      BACKUP_AGE_IDENTITY: wrongIdentity,
      BACKUP_AGE_RECIPIENT: wrongRecipient,
      S3_ENDPOINT: 'https://example.invalid',
      S3_BUCKET: 'ozituma-media',
      S3_REGION: 'auto',
      S3_ACCESS_KEY_ID: 'stub-access-key-id',
      S3_SECRET_ACCESS_KEY: STUB_SECRET,
      S3_FORCE_PATH_STYLE: 'true',
      BACKUP_UPLOAD_PREFIX: 'backups/ozituma',
      BACKUP_LOCAL_RETENTION_DAYS: '14',
      BACKUP_REMOTE_RETENTION_DAYS: '45',
      BACKUP_UPLOAD_INTERVAL_SECONDS: '1',
    });
    const wrongUpload = runService('backup-upload', uploaderShell, wrongUploadEnv, null, 0);
    const refused = await wrongUpload.wait(() => /NOT UPLOADING/.test(wrongUpload.log()), 60000);
    await wrongUpload.stop();
    check(
      'the wrong key is refused with the reason "it did not decrypt", not blamed on the dump',
      refused && /did not decrypt/.test(wrongUpload.log()),
      (wrongUpload.log().match(/upload: NOT UPLOADING[^\n]*/) || ['(no refusal line)'])[0].slice(0, 220),
    );
    check(
      'NOTHING reached the bucket on the wrong-key pass',
      logLines().filter((l) => l.includes('put-object')).length === 0,
      `${logLines().length} aws calls, none of them put-object: ${logLines().map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ') || '(none)'}`,
    );

    // (b) a MISMATCHED pair — the half copied into the wrong variable.
    freshCase('the dumper is given one key half from each of two keys');
    const mismatch = spawnSync('sh', ['-c', dumperShell], {
      cwd: scratch,
      env: serviceEnv({ BACKUP_AGE_IDENTITY: identity, BACKUP_AGE_RECIPIENT: wrongRecipient }),
      encoding: 'utf8',
      timeout: 60000,
    });
    check(
      'the dumper exits 78 and names the mismatch before dumping anything',
      mismatch.status === 78 && /derives the recipient/.test(mismatch.stdout + mismatch.stderr),
      `exit ${mismatch.status}: ${(mismatch.stdout + mismatch.stderr).split('\n').find((l) => l.includes('REFUSING')) || ''}`.slice(0, 240),
    );
    check(
      'a refused start-up leaves no encrypted dump and no partial behind',
      readdirSync(vol).length === 0,
      `volume holds: ${readdirSync(vol).join(', ') || '(nothing)'}`,
    );

    // (c) an EMPTY key.
    freshCase('the dumper is given no key at all');
    const noKey = spawnSync('sh', ['-c', dumperShell], {
      cwd: scratch,
      env: serviceEnv({ BACKUP_AGE_IDENTITY: '', BACKUP_AGE_RECIPIENT: recipient }),
      encoding: 'utf8',
      timeout: 60000,
    });
    check(
      'the dumper refuses to run without a key, and writes nothing',
      noKey.status === 78 && /BACKUP_AGE_IDENTITY is empty/.test(noKey.stdout + noKey.stderr) && readdirSync(vol).length === 0,
      `exit ${noKey.status}`,
    );

    // (d) a missing tool: `age` taken off the PATH is the "broken encryption" case, and the point is
    //     that pg_dump's output must not be published as a file with a good name.
    freshCase('age is not on the PATH at all');
    const noAgeEnv = serviceEnv({ BACKUP_AGE_IDENTITY: identity, BACKUP_AGE_RECIPIENT: recipient });
    noAgeEnv.PATH = [binDir, pgBin, process.env.PATH].filter(Boolean).join(':');
    const dNoAge = runService('backup', dumperShell, noAgeEnv, null, 0);
    // It must fail: either the self-test refuses at start-up, or the pass produces nothing.
    await new Promise((r) => setTimeout(r, 6000));
    await dNoAge.stop();
    const noAgeFiles = readdirSync(vol).filter((f) => f.endsWith('.dump.age'));
    check(
      'with age missing, no *.dump.age file is produced at all',
      noAgeFiles.length === 0,
      `volume holds: ${readdirSync(vol).join(', ') || '(nothing)'} ; log: ${(dNoAge.log().split('\n').find((l) => l.includes('backup:')) || '').slice(0, 160)}`,
    );

    // (e) put-object itself fails: the dump must stay, unpruned, with no .uploaded marker.
    freshCase('the bucket refuses the put');
    restoreVolume();
    const failPutEnv = serviceEnv({
      BACKUP_AGE_IDENTITY: identity,
      BACKUP_AGE_RECIPIENT: recipient,
      ROUND360_AWS_FAIL_PUT: '1',
      S3_ENDPOINT: 'https://example.invalid',
      S3_BUCKET: 'ozituma-media',
      S3_REGION: 'auto',
      S3_ACCESS_KEY_ID: 'stub-access-key-id',
      S3_SECRET_ACCESS_KEY: STUB_SECRET,
      S3_FORCE_PATH_STYLE: 'true',
      BACKUP_UPLOAD_PREFIX: 'backups/ozituma',
      BACKUP_LOCAL_RETENTION_DAYS: '14',
      BACKUP_REMOTE_RETENTION_DAYS: '45',
      BACKUP_UPLOAD_INTERVAL_SECONDS: '1',
    });
    const failPut = runService('backup-upload', uploaderShell, failPutEnv, null, 0);
    await failPut.wait(() => /put-object FAILED/.test(failPut.log()), 60000);
    await failPut.stop();
    check(
      'a refused put keeps the dump, writes no .uploaded marker, and deletes nothing',
      existsSync(join(vol, dumpName)) && !existsSync(join(vol, `${dumpName}.uploaded`)),
      (failPut.log().match(/upload: put-object FAILED[^\n]*/) || ['(no line)'])[0].slice(0, 160),
    );

    // (f) pg_dump itself fails. This is the case the brace group exists for: without it the
    //     pipeline would report age's success, age would encrypt an empty or truncated stream, and
    //     the file would be named *.dump.age with a .verified marker beside it.
    freshCase('pg_dump fails on purpose');
    const failDump = runService('backup', dumperShell, serviceEnv({
      BACKUP_AGE_IDENTITY: identity,
      BACKUP_AGE_RECIPIENT: recipient,
      ROUND360_PG_DUMP_FAIL: '1',
    }), null, 0);
    await failDump.wait(() => /FAILED at/.test(failDump.log()), 60000);
    await failDump.stop();
    check(
      "a failed pg_dump publishes nothing: no *.dump.age, no .verified, and the status is in the log",
      readdirSync(vol).filter((f) => f.endsWith('.dump.age')).length === 0 && /pg_dump status 1/.test(failDump.log()),
      (failDump.log().match(/backup: FAILED at[^\n]*/) || ['(no failure line)'])[0].slice(0, 200),
    );

    /* ------------------------------------------- 7. retention and legacy keys */

    section('7. Retention counts the encrypted files it wrote, and legacy plaintext is named not deleted');

    freshCase('retention, with one object inside the window and one outside it');
    const fresh = readdirSync(keep).find((f) => f.endsWith('.dump.age'));
    restoreVolume();
    /*
     * The two retention numbers are 14 local and 45 remote, and the two rules are tested SEPARATELY
     * because they interact: if the same file were past both windows, remote retention would delete
     * the object first and local retention would then correctly REFUSE to delete the local copy —
     * because it would have become the only copy. That interaction is the safe one and it is what the
     * first version of this case accidentally measured. So:
     *
     *   20 days old, object present  -> local retention deletes it, remote leaves it (inside 45)
     *   20 days old, object absent   -> local retention keeps it, saying why
     *   70 days old, object present  -> remote retention deletes the object; no local file exists
     */
    const stampFor = (daysAgo) => {
      const d = new Date(Date.now() - daysAgo * 86400000);
      const pad = (x) => String(x).padStart(2, '0');
      return `ozituma-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}Z`;
    };
    const backdate = (p, daysAgo) => {
      const t = new Date(Date.now() - daysAgo * 86400000);
      utimesSync(p, t, t);
    };
    mkdirSync(join(bucket, 'backups', 'ozituma'), { recursive: true });

    const withinWindow = `${stampFor(20)}.dump.age`;
    writeFileSync(join(vol, withinWindow), 'old but encrypted, and its object IS in the bucket');
    backdate(join(vol, withinWindow), 20);
    writeFileSync(join(bucket, 'backups', 'ozituma', withinWindow), 'object inside both windows');

    const onlyCopy = `${stampFor(21)}.dump.age`;
    writeFileSync(join(vol, onlyCopy), 'old, encrypted, and its object is NOT in the bucket');
    backdate(join(vol, onlyCopy), 21);

    const pastRemoteWindow = `${stampFor(70)}.dump.age`;
    writeFileSync(join(bucket, 'backups', 'ozituma', pastRemoteWindow), 'object past the remote window');

    const legacyKey = `${stampFor(80)}.dump`;
    writeFileSync(join(bucket, 'backups', 'ozituma', legacyKey), 'legacy plaintext in the bucket');
    writeFileSync(join(vol, legacyKey), 'legacy plaintext in the volume');

    const retention = runService('backup-upload', uploaderShell, serviceEnv({
      BACKUP_AGE_IDENTITY: identity,
      BACKUP_AGE_RECIPIENT: recipient,
      S3_ENDPOINT: 'https://example.invalid',
      S3_BUCKET: 'ozituma-media',
      S3_REGION: 'auto',
      S3_ACCESS_KEY_ID: 'stub-access-key-id',
      S3_SECRET_ACCESS_KEY: STUB_SECRET,
      S3_FORCE_PATH_STYLE: 'true',
      BACKUP_UPLOAD_PREFIX: 'backups/ozituma',
      BACKUP_LOCAL_RETENTION_DAYS: '14',
      BACKUP_REMOTE_RETENTION_DAYS: '45',
      BACKUP_UPLOAD_INTERVAL_SECONDS: '1',
    }), null, 0);
    await retention.wait(() => /local retention —/.test(retention.log()), 60000);
    await retention.stop();
    check(
      'the local dump past the local window whose object IS in R2 is deleted',
      !existsSync(join(vol, withinWindow)),
      `${withinWindow}: ${existsSync(join(vol, withinWindow)) ? 'still present' : 'deleted'}`,
    );
    check(
      'the local dump whose object is NOT in R2 is KEPT, with the reason in the log',
      existsSync(join(vol, onlyCopy)) && /KEEPING/.test(retention.log()),
      `${onlyCopy}: kept because removing it would destroy the only copy`,
    );
    check(
      'the remote object past the remote window is deleted, and a fresh one is not',
      !existsSync(join(bucket, 'backups', 'ozituma', pastRemoteWindow)) && existsSync(join(bucket, 'backups', 'ozituma', fresh)),
      `deleted ${pastRemoteWindow}; kept ${fresh}`,
    );
    check(
      'a LEGACY PLAINTEXT key in R2 is named loudly and NOT deleted',
      existsSync(join(bucket, 'backups', 'ozituma', legacyKey)) && /LEGACY PLAINTEXT OBJECT IN R2/.test(retention.log()),
      (retention.log().match(/upload: LEGACY PLAINTEXT[^\n]*/) || ['(no line)'])[0].slice(0, 200),
    );
    check(
      'a legacy plaintext file in the volume is named and never uploaded',
      logLines().every((l) => !l.includes('put-object') || !l.includes(legacyKey)) && /PLAINTEXT dump\(s\) from before encryption/.test(retention.log()),
      `${logLines().filter((l) => l.includes('put-object')).length} put-object call(s) in this case, none of them the legacy name`,
    );
  } else if (dumpName) {
    section('4-7. The pipeline, run');
    note(`SKIPPED the uploader, retention and fail-closed cases: no ROUND360_DATABASE_URL was given, so there is no dump to upload.`);
    note('The dumper cases above ran; the fail-closed checks that need only a key and no database are below.');
  }

  /* --------------------------- fail-closed cases that need no database at all */

  if (!haveDb) {
    section('6. Fail-closed: the key guards, which need no database');
    freshCase('the dumper is given one key half from each of two keys');
    const mismatch = spawnSync('sh', ['-c', dumperShell], {
      cwd: scratch,
      env: serviceEnv({ BACKUP_AGE_IDENTITY: identity, BACKUP_AGE_RECIPIENT: wrongRecipient }),
      encoding: 'utf8',
      timeout: 60000,
    });
    check(
      'the dumper exits 78 and names the mismatch before dumping anything',
      mismatch.status === 78 && /derives the recipient/.test(mismatch.stdout + mismatch.stderr),
      `exit ${mismatch.status}`,
    );
    freshCase('the dumper is given no key at all');
    const noKey = spawnSync('sh', ['-c', dumperShell], {
      cwd: scratch,
      env: serviceEnv({ BACKUP_AGE_IDENTITY: '', BACKUP_AGE_RECIPIENT: recipient }),
      encoding: 'utf8',
      timeout: 60000,
    });
    check(
      'the dumper refuses to run without a key, and writes nothing',
      noKey.status === 78 && /BACKUP_AGE_IDENTITY is empty/.test(noKey.stdout + noKey.stderr) && readdirSync(vol).length === 0,
      `exit ${noKey.status}`,
    );
    freshCase('the uploader is given one key half from each of two keys');
    const upMismatch = spawnSync('sh', ['-c', uploaderShell], {
      cwd: scratch,
      env: serviceEnv({
        BACKUP_AGE_IDENTITY: identity,
        BACKUP_AGE_RECIPIENT: wrongRecipient,
        S3_ENDPOINT: 'https://example.invalid',
        S3_BUCKET: 'b',
        S3_REGION: 'auto',
        S3_ACCESS_KEY_ID: 'x',
        S3_SECRET_ACCESS_KEY: 'y',
        S3_FORCE_PATH_STYLE: 'true',
      }),
      encoding: 'utf8',
      timeout: 60000,
    });
    check(
      'the uploader refuses to start on a mismatched pair rather than blaming the dumps',
      upMismatch.status === 78 && /derives the recipient/.test(upMismatch.stdout + upMismatch.stderr),
      `exit ${upMismatch.status}`,
    );
  }
}

/* ------------------------------------------------------------------ verdict */

section('Result');
const failed = results.filter((r) => !r.ok);
console.log(`\n  ${results.length - failed.length} passed, ${failed.length} failed\n`);
if (failed.length) {
  for (const f of failed) console.log(`    - ${f.name}`);
  console.log('');
  process.exit(1);
}
console.log('  Every check this instrument can take locally passed.');
console.log('  It does NOT prove the host: the built image, a real put-object against R2,');
console.log('  and the healthwatch alarm firing on the host are all unverified here.\n');
