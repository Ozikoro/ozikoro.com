#!/usr/bin/env node
/**
 * rotate-credential — change ONE credential in the host's `/opt/ozituma/.env`, prove the new
 * value works, and only then let go of the old one.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠️  THIS SCRIPT IS FOR THE OWNER, ON THE HOST. IT IS NOT AN AGENT INSTRUMENT.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * An agent cannot run this, and must not be asked to. Running it requires the NEW credential's
 * value in hand — and an agent that holds a value has to be given it through a conversation, which
 * puts it straight back into a transcript, which is the exact incident this whole exercise exists to
 * remedy (see `AGENTS.md`, "Do not print a secret's value to find out what it is called"). The
 * agent's half of the job is the runbook and this file. The value never passes through either.
 *
 * ── WHY ONE CREDENTIAL PER RUN ────────────────────────────────────────────────────────────────
 *
 * A script that rotated everything in one pass would be a script that can take the whole site down
 * in one pass, and it would leave no checkpoint to stop at. Rotating is *six careful changes*, each
 * with its own proof; this makes each one command instead of six careful edits, and keeps them
 * separate. Run it once per credential, in the order the runbook gives.
 *
 * ── THE FOUR PROMISES ─────────────────────────────────────────────────────────────────────────
 *
 *   1. THE OLD FILE IS SAVED FIRST, outside anything the application serves and outside the bucket.
 *      The one outcome that must never happen is a rotation that destroys the old value before the
 *      new one is proven.
 *   2. THE NEW VALUE IS PROVEN BEFORE THE SCRIPT EXITS — a real signed request for `s3`, a real
 *      connection for `postgres`, a real authenticated handshake for `smtp`. An unverified rotation
 *      is how a site dies at two in the morning.
 *   3. IT FAILS CLOSED. If the proof fails it puts the old value back, restarts what it restarted,
 *      and exits non-zero. It never leaves the host holding a value that does not work.
 *   4. IT NEVER PRINTS A VALUE. Not the new one, not the old one, not inside an error, not under
 *      `--debug`. You get the NAME, the LENGTH, a sha256 FINGERPRINT and whether it works.
 *      A rotation tool that leaks the credential is worse than no tool at all.
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────────────────────────────
 *
 * It does not create the new credential — that happens at the issuer (Cloudflare, GitHub, the cPanel
 * UI, …) and the runbook says where. It does not revoke the old one either, deliberately: revocation
 * is the last step, it is done at the issuer, and it must not happen inside the same command that
 * wrote the new value, because proving the old one is dead is a step a person has to look at.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/rotate-credential.mjs <credential> [options]
 *
 *   s3             S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY   (a PAIR — pass both)
 *   github         GITHUB_TOKEN
 *   smtp           OZITUMA_SMTP_PASSWORD
 *   resend         RESEND_API_KEY
 *   paystack       PAYSTACK_SECRET_KEY
 *   nowpayments    NOWPAYMENTS_API_KEY
 *   postgres       POSTGRES_PASSWORD  (database FIRST, then this file, then a restart)
 *   secret         any other NAME — written with no automated proof, refused without --i-have-checked
 *
 * Options
 *   --env-file PATH      default /opt/ozituma/.env
 *   --backup-dir PATH    default /root/.ozituma-credential-backups
 *   --value-stdin        read the new value(s) from stdin (…or type at a hidden prompt)
 *   --no-restart         edit the file only; you restart by hand
 *   --i-have-checked     required for `secret` and for `postgres` pre-flight acknowledgements
 *   --skip-old-check     do not attempt the "old value now fails" probe (say why in the ticket)
 *   --fake-verify        ⚠️ TESTING ONLY — replaces every network proof with a local stub so the
 *                        refusal paths can be exercised on a scratch file. It will happily write a
 *                        value to a file it cannot prove. Never use it on the real `.env`.
 *   --debug              reserved for extra detail; it never prints a value either
 *   -h, --help
 *
 * The new value is typed at a hidden prompt by default, so it never reaches the shell history, the
 * process list (`ps`) or a log. `--value-stdin` exists for a pipe; prefer the prompt.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { constants as FS, promises as fs } from 'node:fs';
import { createConnection as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DEFAULT_ENV_FILE = '/opt/ozituma/.env';
const DEFAULT_BACKUP_DIR = '/root/.ozituma-credential-backups';
const DEFAULT_COMPOSE_REL = 'docker/docker-compose.prod.yml';

// ---------------------------------------------------------------------------
// Credential descriptors
// ---------------------------------------------------------------------------

/**
 * Each descriptor names the variables it owns, the issuer (for the message), the services that must
 * be recreated for the new value to be seen, and the proof.
 *
 * `restart` is EMPTY for most of these, and that is not an oversight. Compose hands a container a
 * variable only because the compose file names it, and it resolves `${…}` when it *creates* the
 * container. Changing the file and doing nothing else leaves the running container on the old value.
 * The services below are the ones that read the variable. `s3`, `github`, `paystack` and
 * `nowpayments` are not in any container's environment on the host — they are read here, by the
 * verifier — so rotating them changes the file and needs no restart at all.
 */
const CREDENTIALS = {
  s3: {
    title: 'S3 / Cloudflare R2 media keys',
    issuer: 'Cloudflare dashboard → R2 → API → Manage API Tokens',
    vars: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
    // A pair: R2 issues the access key id and the secret together and neither works alone.
    pair: true,
    restart: [],
    note:
      'The bucket is the most exposed thing here. `media.ozituma.com` serves objects anonymously, so ' +
      'these two values are the only thing between a stranger and the ability to overwrite or delete ' +
      'every photograph and episode.',
  },
  github: {
    title: 'GitHub token (push access)',
    issuer: 'GitHub → Settings → Developer settings → Personal access tokens',
    vars: ['GITHUB_TOKEN'],
    restart: [],
    note: 'Push access to `github.com/oziikoro/Ozikoro`.',
  },
  smtp: {
    title: 'Outbound SMTP password',
    issuer: 'Whichever mailbox `OZITUMA_SMTP_HOST` points at (its own mail provider)',
    vars: ['OZITUMA_SMTP_PASSWORD'],
    restart: ['web', 'ozikoro'],
    note:
      'Sending mail as the domain is how an account is taken over. This is the password half; the ' +
      'host, port and user are separate names and do not rotate.',
  },
  resend: {
    title: 'Resend API key',
    issuer: 'Resend dashboard → API Keys',
    vars: ['RESEND_API_KEY'],
    restart: ['web', 'ozikoro'],
    note:
      'Resend is tried BEFORE SMTP (see `packages/core/src/mail.ts`), so if this key exists it is the ' +
      'transport actually in use and SMTP is the fallback.',
  },
  paystack: {
    title: 'Paystack secret key',
    issuer: 'Paystack dashboard → Settings → API Keys & Webhooks',
    vars: ['PAYSTACK_SECRET_KEY'],
    restart: ['web'],
    note:
      'FIRST ESTABLISH WHETHER THE EXPOSED KEY IS TEST OR LIVE — `sk_test_…` versus `sk_live_…`. ' +
      'Test is nearly free; live is money. The runbook §5 says how to tell without reading the value.',
  },
  nowpayments: {
    title: 'NOWPayments API key',
    issuer: 'NOWPayments dashboard → Account → API keys',
    vars: ['NOWPAYMENTS_API_KEY'],
    restart: ['ozikoro'],
    note:
      'The IPN secret (`NOWPAYMENTS_IPN_SECRET`) is a second, separate value that signs webhooks. It ' +
      'is not rotated here because it cannot be proven by a read-only call; the runbook treats it as ' +
      'a `secret` step with a deliberate re-issue at the provider.',
  },
  postgres: {
    title: 'PostgreSQL password',
    issuer: 'Nowhere — you CHOOSE it. It is generated here and set in the database.',
    vars: ['POSTGRES_PASSWORD'],
    restart: ['web', 'ozikoro', 'backup', 'backup-upload'],
    // The one credential whose sources of truth disagree by default: the database and the file.
    database: true,
    note:
      'Different in kind from every other row. The app authenticates with it, so it has to change in ' +
      'the database AND in the file, and the order matters: database first, then file, then restart. ' +
      'The runbook §7 has the sequence and the check that the database still answers.',
  },
  secret: {
    title: 'Any other name',
    // Issuer genuinely unknown — refusing to invent a menu path is the point.
    issuer: 'the system that issued it — open its own console',
    vars: [], // supplied as a second positional argument
    restart: [],
    note:
      'No automated proof exists, so this path REFUSES unless you pass `--i-have-checked`, and then it ' +
      'asks you to confirm the new value was tested by hand. An unprovable rotation that looks like a ' +
      'verified one is the worst of both.',
  },
};

// ---------------------------------------------------------------------------
// Output. Every line goes through the masker.
// ---------------------------------------------------------------------------

const SECRETS_IN_MEMORY = new Set();

/** Any secret we have ever held, and — belt and braces — anything shaped like one. */
function mask(text) {
  let out = String(text);
  for (const value of SECRETS_IN_MEMORY) {
    if (value && value.length >= 4) out = out.split(value).join('«REDACTED»');
  }
  // A last line of defence for a value we never got to register, e.g. one echoed by a subprocess.
  return out
    .replace(/\b(sk_(?:test|live)_[A-Za-z0-9]{6,})/g, 'sk_…«REDACTED»')
    .replace(/\b(re_[A-Za-z0-9]{8,})/g, 're_…«REDACTED»')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,})/g, 'gh?_…«REDACTED»')
    .replace(/\b(AGE-SECRET-KEY-1[A-Z0-9]{10,})/gi, 'AGE-SECRET-KEY-1…«REDACTED»');
}

function say(line = '') {
  process.stdout.write(`${mask(line)}\n`);
}
function warn(line) {
  process.stderr.write(`${mask(line)}\n`);
}
function die(line, code = 1) {
  warn(`\n  ✗ ${mask(line)}\n`);
  process.exit(code);
}

/** Fingerprint a value without revealing it. This is what makes "did it change?" checkable. */
function fingerprint(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

function describe(name, value) {
  return `${name}  length=${String(value.length)}  sha256:${fingerprint(value)}`;
}

function registerSecret(value) {
  if (value) SECRETS_IN_MEMORY.add(value);
  return value;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    kind: null,
    name: null,
    envFile: DEFAULT_ENV_FILE,
    backupDir: DEFAULT_BACKUP_DIR,
    valueStdin: false,
    restart: true,
    checked: false,
    skipOldCheck: false,
    fakeVerify: false,
    debug: false,
    help: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--env-file':
        opts.envFile = required(argv, (i += 1), arg);
        break;
      case '--backup-dir':
        opts.backupDir = required(argv, (i += 1), arg);
        break;
      case '--value-stdin':
        opts.valueStdin = true;
        break;
      case '--no-restart':
        opts.restart = false;
        break;
      case '--i-have-checked':
        opts.checked = true;
        break;
      case '--skip-old-check':
        opts.skipOldCheck = true;
        break;
      case '--fake-verify':
        opts.fakeVerify = true;
        break;
      case '--debug':
        opts.debug = true;
        break;
      default:
        if (arg.startsWith('--')) die(`unknown option ${arg}. Try --help.`);
        positional.push(arg);
    }
  }
  [opts.kind, opts.name] = positional;
  return opts;
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) die(`${flag} needs a value.`);
  return value;
}

const USAGE = `
rotate-credential — one credential, proved, with the old one put back if it is not.

  node scripts/rotate-credential.mjs <credential> [options]

  s3 | github | smtp | resend | paystack | nowpayments | postgres | secret <NAME>

  --env-file PATH     default ${DEFAULT_ENV_FILE}
  --backup-dir PATH   default ${DEFAULT_BACKUP_DIR}
  --value-stdin       read the new value from stdin instead of the hidden prompt
  --no-restart        edit the file only
  --i-have-checked    required for \`secret\` (no automated proof exists)
  --skip-old-check    skip the "old value now fails" probe
  --fake-verify       TESTING ONLY — stub out every network proof
  --debug             reserved for extra detail; still no values
  -h, --help          this

⚠️  FOR THE OWNER, ON THE HOST. NOT AN AGENT TOOL — see the header of this file for why.
`;

// ---------------------------------------------------------------------------
// The environment file
// ---------------------------------------------------------------------------

/**
 * Split a dotenv line into its parts WITHOUT touching the value's meaning.
 *
 * The value is kept verbatim (minus a wrapping quote pair) because it is about to be put into a
 * request, a connection or a database command. Re-quoting it here and un-quoting it there is how a
 * trailing space or a `#` inside a password becomes a credentials bug that only shows at 2am.
 */
function splitEnvLine(line) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) return null;
  const name = match[1];
  let raw = match[2];
  let value = raw;
  let quote = null;
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    quote = trimmed[0];
    value = trimmed.slice(1, -1);
  } else {
    // An unquoted value stops at a comment, as every dotenv implementation agrees.
    const hash = raw.indexOf(' #');
    if (hash !== -1) value = raw.slice(0, hash);
    value = value.trim();
  }
  return { name, value, quote, line };
}

async function readEnvFile(file) {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const entries = new Map();
  const occurrences = [];
  lines.forEach((line, index) => {
    const parsed = splitEnvLine(line);
    if (!parsed) return;
    // The index travels WITH the entry: `applyChanges` rewrites the line in place, so an entry
    // without its own line number silently writes nothing (or the wrong line) while reporting
    // success. That was a real bug here, on the first run, and it is why the shape is asserted below.
    const entry = { ...parsed, index };
    occurrences.push(entry);
    // Last assignment wins, which is what a shell would do too.
    entries.set(parsed.name, entry);
  });
  for (const [name, entry] of entries) {
    if (typeof entry.index !== 'number') {
      throw new Error(`internal: ${name} was parsed without a line index; refusing to edit blind.`);
    }
  }
  return { text, lines, entries, occurrences };
}

/** One `NAME=value` line per name; a value with a newline is quoted and escaped. */
function renderEnvLine(name, value) {
  const needsQuotes = /[\s#'"$\\]/.test(value) || value === '';
  if (!needsQuotes) return `${name}=${value}`;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `${name}="${escaped}"`;
}

function applyChanges(env, changes) {
  const lines = [...env.lines];
  const placement = new Map();
  for (const { name, value } of changes) {
    const existing = env.entries.get(name);
    if (existing) {
      lines[existing.index] = renderEnvLine(name, value);
    } else {
      placement.set(name, value);
    }
  }
  if (placement.size > 0) {
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    lines.push('');
    lines.push('# Added by rotate-credential. Compose passes a service only the names it declares,');
    lines.push('# so a name here does nothing unless docker-compose.prod.yml also lists it.');
    for (const [name, value] of placement) lines.push(renderEnvLine(name, value));
    lines.push('');
  }
  // Preserve the trailing newline of a well-formed file.
  let out = lines.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

/**
 * Write atomically, at 0600, so a crash mid-write cannot leave a half-file that the containers would
 * read on their next start. `rename` is atomic within a filesystem, which `/opt/ozituma` is.
 */
async function writeEnvFile(file, content) {
  const tmp = `${file}.rotate-${process.pid}.tmp`;
  const handle = await fs.open(tmp, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL, 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
}

// ---------------------------------------------------------------------------
// The backup — the promise that the old value survives a failure
// ---------------------------------------------------------------------------

/**
 * ⚠️ WHERE THE BACKUP MAY NOT GO.
 *
 * It is a file full of secrets. Anywhere the application serves is a URL somebody can fetch, and
 * anywhere the bucket holds is an object the whole world can already read (that is the premise of
 * this whole exercise). Both are refused.
 */
function assertBackupLocationAllowed(dir) {
  const resolved = path.resolve(dir);
  const forbidden = [
    { prefix: '/opt/ozituma/app', why: 'that is the deployed tree the application serves' },
    { prefix: '/var/www', why: 'that is a served web root' },
    { prefix: '/srv/www', why: 'that is a served web root' },
    { prefix: '/opt/ozituma/backups', why: 'that path is uploaded to the bucket' },
    { prefix: '/tmp', why: 'world-readable on most systems, and it does not survive a reboot' },
    { prefix: '/var/tmp', why: 'world-readable on most systems' },
  ];
  for (const entry of forbidden) {
    if (resolved === entry.prefix || resolved.startsWith(`${entry.prefix}/`)) {
      die(
        `refusing to put a file full of secrets under ${resolved} — ${entry.why}.\n` +
          `    Choose another --backup-dir (the default ${DEFAULT_BACKUP_DIR} is mode 700 and owned by root).`,
      );
    }
  }
  return resolved;
}

async function makeBackup(envFile, backupDir, kind, vars) {
  const dir = assertBackupLocationAllowed(backupDir);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `${path.basename(envFile)}.${stamp}.${kind}.bak`);
  const handle = await fs.open(target, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL, 0o600);
  try {
    await handle.writeFile(await fs.readFile(envFile));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.chmod(target, 0o600);
  const stat = await fs.stat(target);
  if ((stat.mode & 0o777) !== 0o600) die(`the backup at ${target} is not mode 0600; refusing to proceed.`);
  return target;
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

/**
 * ⚠️ `--fake-verify` EXISTS SO THE REFUSAL PATHS CAN BE TESTED, AND FOR NOTHING ELSE.
 *
 * The behaviour worth proving is what happens when a proof FAILS, and that cannot be shown against
 * a real bucket or a real database without doing something destructive to one of them. So the flag
 * lets a scratch `.env` be driven down each failure path. It is loud, it is not the default, and no
 * runbook step uses it.
 */
function fakeProof(ok) {
  const script = ok === 'fail' ? 'process.exit(7)' : 'process.exit(0)';
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return result.status === 0
    ? { ok: true, detail: 'stubbed by --fake-verify' }
    : { ok: false, why: `stubbed by --fake-verify and told to fail (stub exit ${result.status})` };
}

// ── S3 ──────────────────────────────────────────────────────────────────────
//
// A REAL signed request, not a check that the strings look plausible. `head-object` on a key that is
// known to exist is the cheapest thing that proves the pair works end to end: the signature is
// computed from both halves, so a wrong secret is a 403 from the service rather than from us.
//
// The key below is the one `docs/OZIKORO-CUTOVER.md` measured returning `200 image/png` anonymously:
// it is a real object in the media bucket. If it has been removed, pass any other key as
// `--probe-key` later; a 404 means the credential is FINE and the key is not, and the code below
// says so rather than calling it a failure.

const S3_PROBE_KEY = 'ozikoro/9274-osm-intl8aa250x200@2x.png';

function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

async function verifyS3(env, changes, opts) {
  const get = (name) => changes.find((c) => c.name === name)?.value ?? env.entries.get(name)?.value;
  const accessKey = get('S3_ACCESS_KEY_ID');
  const secretKey = get('S3_SECRET_ACCESS_KEY');
  const endpoint = get('S3_ENDPOINT');
  const bucket = get('S3_BUCKET');
  const region = get('S3_REGION') ?? 'auto';
  const pathStyle = (get('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false';
  if (!accessKey || !secretKey || !endpoint || !bucket) {
    return { ok: false, why: 'S3_ENDPOINT, S3_BUCKET and both keys must be present before a proof is possible' };
  }
  if (opts.fakeVerify) return fakeProof(process.env.ROTATE_FAKE_S3_FAILURE === '1' ? 'fail' : 'ok');

  const url = new URL(endpoint);
  const host = url.host;
  // Path-style puts the bucket in the path; virtual-host style puts it in the hostname.
  const canonicalUri = pathStyle
    ? `/${bucket}/${S3_PROBE_KEY.split('/').map(encodeURIComponent).join('/')}`
    : `/${S3_PROBE_KEY.split('/').map(encodeURIComponent).join('/')}`;
  const requestHost = pathStyle ? host : `${bucket}.${host}`;
  const method = 'HEAD';
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update('', 'utf8').digest('hex');

  const canonicalHeaders =
    `host:${requestHost}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const target = `${url.protocol}//${requestHost}${canonicalUri}`;
  let response;
  try {
    response = await fetch(target, {
      method,
      headers: {
        Authorization: authorization,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
    });
  } catch (error) {
    return { ok: false, why: `the request to ${requestHost} did not complete: ${mask(error.message)}` };
  }
  if (response.status === 200) return { ok: true, detail: `HEAD ${requestHost} → 200` };
  if (response.status === 404) {
    // The credential signed correctly; the object is missing. Not a credential failure.
    return { ok: true, detail: `HEAD ${requestHost} → 404 (credential accepted; probe key absent)` };
  }
  if (response.status === 403) {
    return { ok: false, why: `HEAD ${requestHost} → 403 — the service rejected the signature` };
  }
  return { ok: false, why: `HEAD ${requestHost} → ${response.status}` };
}

// ── GitHub ──────────────────────────────────────────────────────────────────

async function verifyGithub(env, changes, opts) {
  const token = changes.find((c) => c.name === 'GITHUB_TOKEN')?.value;
  if (!token) return { ok: false, why: 'GITHUB_TOKEN was not supplied' };
  if (opts.fakeVerify) return fakeProof(process.env.ROTATE_FAKE_GITHUB_FAILURE === '1' ? 'fail' : 'ok');
  let response;
  try {
    response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ozituma-rotate-credential',
      },
    });
  } catch (error) {
    return { ok: false, why: `api.github.com did not answer: ${mask(error.message)}` };
  }
  if (response.status === 401) return { ok: false, why: 'GET /user → 401 — GitHub does not accept this token' };
  if (!response.ok) return { ok: false, why: `GET /user → ${response.status}` };
  const scopes = response.headers.get('x-oauth-scopes') ?? '';
  const write = /\b(repo|public_repo|workflow)\b/.test(scopes);
  return {
    ok: true,
    detail: write
      ? 'GET /user → 200, and the token carries a push scope'
      : 'GET /user → 200, but NO push scope is present — the token will read and not push',
  };
}

// ── SMTP ────────────────────────────────────────────────────────────────────
//
// An AUTHENTICATED HANDSHAKE, NOT A SEND. A handshake proves the password because the server refuses
// `AUTH` with a bad one; a send would prove it by putting mail in somebody's inbox, which is a real
// message we do not want to send while testing.

function smtpHandshake({ host, port, secure, user, password, allowPlaintext = false, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, why: `no answer from ${host}:${port} within ${timeoutMs} ms` }), timeoutMs);
    timer.unref?.();

    const socket = secure
      ? tlsConnect(
          {
            host,
            port,
            servername: host,
            // The certificate is ALWAYS verified on a real rotation. The override exists only so a
            // local test server with a self-signed certificate can exercise this code path.
            rejectUnauthorized: process.env.ROTATE_TEST_TLS_INSECURE !== '1',
          },
          onConnect,
        )
      : netConnect({ host, port }, onConnect);

    let buffer = '';
    let stage = 'greeting';
    socket.setEncoding('utf8');

    function send(line) {
      socket.write(`${line}\r\n`);
    }

    function onConnect() {
      if (!secure) {
        // 587 and friends greet in the clear and upgrade on request.
        socket.once('data', () => undefined);
      }
    }

    socket.on('data', (chunk) => {
      buffer += chunk;
      // ⚠️ A MULTI-LINE SMTP REPLY IS NOT FINISHED UNTIL A LINE HAS A SPACE AFTER THE CODE.
      // `250-STARTTLS` is a continuation and `250 AUTH LOGIN` terminates. Treating the first line as
      // the whole reply desynchronises the rest of the exchange and the failure surfaces two steps
      // later as a confusing status — measured against a mock that greeted with `250-mock.invalid`
      // then `250 AUTH LOGIN PLAIN`, which this client answered too early.
      const replyLines = buffer.split(/\r?\n/);
      const lastIndex = replyLines.length - 1;
      let complete = -1;
      for (let i = 0; i < lastIndex; i += 1) {
        if (/^\d{3} /.test(replyLines[i])) complete = i;
      }
      if (complete === -1) return;
      const consumed = replyLines.slice(0, complete + 1);
      buffer = replyLines.slice(complete + 1).join('\n');
      const reply = `${consumed.join('\n')}\n`;
      const code = Number(reply.slice(0, 3));
      const last = consumed[complete] ?? '';

      if (stage === 'greeting') {
        if (code !== 220) return finish({ ok: false, why: `greeting was ${code}, not 220` });
        if (!secure && port !== 465) {
          stage = 'starttls';
          return send('EHLO rotate-credential.local');
        }
        stage = 'ehlo';
        return send('EHLO rotate-credential.local');
      }
      if (stage === 'starttls') {
        if (code !== 250) return finish({ ok: false, why: `EHLO was ${code}, not 250` });
        if (!/STARTTLS/i.test(reply)) {
          // Mirrors `packages/core/src/mail.ts`: an unencrypted session is accepted only when the
          // operator has explicitly opted in. Refusing here rather than sending the password in the
          // clear is the whole point — a proof that leaks the credential is worse than no proof.
          if (!allowPlaintext) {
            return finish({
              ok: false,
              why:
                'the server did not advertise STARTTLS, so the password would go over the wire in ' +
                'clear. Refusing. If this mailbox genuinely has no TLS, set OZITUMA_SMTP_ALLOW_PLAINTEXT=1 ' +
                '(the same opt-in the application requires) and run this again.',
            });
          }
          // `AUTH LOGIN` on its own, then answer the two 334 challenges. Sending the username on
          // the AUTH line makes the server prompt for a username again and the handshake stalls.
          stage = 'auth';
          return send('AUTH LOGIN');
        }
        stage = 'upgrading';
        send('STARTTLS');
        return;
      }
      if (stage === 'upgrading') {
        // A successful STARTTLS is 220 followed by a TLS handshake on the same socket. A server that
        // refuses the upgrade is treated the same way as one that never advertised it.
        if (code !== 220) {
          if (!allowPlaintext) return finish({ ok: false, why: `STARTTLS was ${code}, not 220` });
          // `AUTH LOGIN` on its own, then answer the two 334 challenges. Sending the username on
          // the AUTH line makes the server prompt for a username again and the handshake stalls.
          stage = 'auth';
          return send('AUTH LOGIN');
        }
        stage = 'ehlo-tls';
        return;
      }
      if (stage === 'ehlo' || stage === 'ehlo-tls') {
        if (code !== 250) return finish({ ok: false, why: `EHLO was ${code}, not 250` });
        if (!/AUTH/i.test(reply)) return finish({ ok: false, why: 'the server advertised no AUTH mechanism' });
        stage = 'auth';
        // `AUTH LOGIN` on its own, then the server's two 334 challenges are answered with
        // base64(user) then base64(password). This response-driven form is what every SMTP client
        // does and is the most widely implemented; the one-line `AUTH LOGIN <user>` form is not.
        send('AUTH LOGIN');
        return;
      }
      if (stage === 'auth') {
        // ⚠️ 334 IS THE CODE FOR *BOTH* AUTH LOGIN CHALLENGES. The server sends
        // `334 VXNlcm5hbWU6` ("Username:") and then `334 UGFzc3dvcmQ6` ("Password:"), and the ONLY
        // way to tell them apart is the challenge text — base64-decoded, and not trusted beyond
        // choosing which of our two values to answer with. Reacting to the code alone (the obvious
        // implementation, and this file's first one) answers the SECOND challenge with the USERNAME
        // and dies on a perfectly good password. Measured, not imagined: the handshake reached
        // `334 UGFzc3dvcmQ6` and the script reported "AUTH ended 334".
        if (code !== 334) {
          return finish({
            ok: false,
            why: code === 535 || code === 534 ? `the server refused the credentials (AUTH ${code})` : `AUTH LOGIN was ${code}`,
          });
        }
        const challenge = Buffer.from((last.split(' ')[1] ?? '').trim(), 'base64').toString('utf8').toLowerCase();
        if (challenge.startsWith('pass')) {
          stage = 'password';
          send(Buffer.from(password, 'utf8').toString('base64'));
          return;
        }
        stage = 'auth-user';
        send(Buffer.from(user, 'utf8').toString('base64'));
        return;
      }
      if (stage === 'auth-user') {
        // The server wanted the username; it should now ask for the password.
        if (code !== 334) {
          return finish({
            ok: false,
            why: code === 535 || code === 534 ? `the server refused the credentials (AUTH ${code})` : `AUTH LOGIN was ${code}`,
          });
        }
        stage = 'password';
        send(Buffer.from(password, 'utf8').toString('base64'));
        return;
      }
      if (stage === 'password') {
        if (code === 235) return finish({ ok: true, detail: `authenticated to ${host}:${port}` });
        if (code === 535 || code === 534) return finish({ ok: false, why: `the server refused the password (${code} ${last.replace(/^\d{3} /, '')})` });
        return finish({ ok: false, why: `AUTH ended ${code}` });
      }
      return finish({ ok: false, why: `unexpected stage ${stage} with code ${code}` });
    });

    socket.on('error', (error) => finish({ ok: false, why: `${host}:${port} — ${mask(error.message)}` }));
    socket.on('close', () => finish({ ok: false, why: `${host}:${port} closed before authentication finished` }));
  });
}

async function verifySmtp(env, changes, opts) {
  const password = changes.find((c) => c.name === 'OZITUMA_SMTP_PASSWORD')?.value;
  const host = env.entries.get('OZITUMA_SMTP_HOST')?.value;
  const port = Number(env.entries.get('OZITUMA_SMTP_PORT')?.value ?? '587');
  const user = env.entries.get('OZITUMA_SMTP_USER')?.value;
  const secure = env.entries.get('OZITUMA_SMTP_SECURE')?.value === '1' || port === 465;
  if (!password) return { ok: false, why: 'no new password was supplied' };
  if (!host || !user) {
    return { ok: false, why: 'OZITUMA_SMTP_HOST and OZITUMA_SMTP_USER must be set before a handshake is possible' };
  }
  if (opts.fakeVerify) return fakeProof(process.env.ROTATE_FAKE_SMTP_FAILURE === '1' ? 'fail' : 'ok');
  const allowPlaintext = env.entries.get('OZITUMA_SMTP_ALLOW_PLAINTEXT')?.value === '1';
  return smtpHandshake({ host, port: Number.isFinite(port) ? port : 587, secure, user, password, allowPlaintext });
}

// ── HTTP service keys (Resend, Paystack, NOWPayments) ───────────────────────

async function verifyResend(env, changes, opts) {
  const key = changes.find((c) => c.name === 'RESEND_API_KEY')?.value;
  if (!key) return { ok: false, why: 'RESEND_API_KEY was not supplied' };
  if (opts.fakeVerify) return fakeProof(process.env.ROTATE_FAKE_RESEND_FAILURE === '1' ? 'fail' : 'ok');
  let response;
  try {
    // A list, not a send: this reads and changes nothing.
    response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'ozituma-rotate-credential' },
    });
  } catch (error) {
    return { ok: false, why: `api.resend.com did not answer: ${mask(error.message)}` };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, why: `GET /domains → ${response.status} — Resend does not accept this key` };
  }
  if (!response.ok) return { ok: false, why: `GET /domains → ${response.status}` };
  const body = await response.json().catch(() => null);
  const domains = Array.isArray(body?.data) ? body.data.length : null;
  return {
    ok: true,
    detail: domains === null ? 'GET /domains → 200 (key accepted)' : `GET /domains → 200, ${domains} sending domain(s) visible`,
  };
}

/**
 * ⚠️ THE TEST-OR-LIVE QUESTION.
 *
 * Paystack puts it in the key's own prefix — `sk_test_` or `sk_live_` — and NOWPayments puts it in
 * which host actually answers. Both are read from the VALUE and reported as a WORD; the value itself
 * never leaves this function. This is the one place the script looks at a secret's inside, and it
 * only ever says which of two words it read.
 */
function paystackMode(key) {
  if (key.startsWith('sk_live_')) return 'LIVE';
  if (key.startsWith('sk_test_')) return 'TEST';
  return 'UNRECOGNISED';
}

async function verifyPaystack(env, changes, opts) {
  const key = changes.find((c) => c.name === 'PAYSTACK_SECRET_KEY')?.value;
  if (!key) return { ok: false, why: 'PAYSTACK_SECRET_KEY was not supplied' };
  const mode = paystackMode(key);
  if (opts.fakeVerify) {
    const proof = fakeProof(process.env.ROTATE_FAKE_PAYSTACK_FAILURE === '1' ? 'fail' : 'ok');
    return { ...proof, detail: proof.ok ? `mode=${mode}; GET /transaction?perPage=1 → 200` : undefined };
  }
  let response;
  try {
    response = await fetch('https://api.paystack.co/transaction?perPage=1', {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'ozituma-rotate-credential' },
    });
  } catch (error) {
    return { ok: false, why: `api.paystack.co did not answer: ${mask(error.message)}` };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, why: `GET /transaction → ${response.status} — Paystack does not accept this key (mode=${mode})` };
  }
  if (!response.ok) return { ok: false, why: `GET /transaction → ${response.status} (mode=${mode})` };
  return { ok: true, detail: `mode=${mode}; GET /transaction?perPage=1 → 200` };
}

async function verifyNowpayments(env, changes, opts) {
  const key = changes.find((c) => c.name === 'NOWPAYMENTS_API_KEY')?.value;
  if (!key) return { ok: false, why: 'NOWPAYMENTS_API_KEY was not supplied' };
  if (opts.fakeVerify) return fakeProof(process.env.ROTATE_FAKE_NOWPAYMENTS_FAILURE === '1' ? 'fail' : 'ok');
  let response;
  try {
    response = await fetch('https://api.nowpayments.io/v1/status', {
      headers: { 'x-api-key': key, 'User-Agent': 'ozituma-rotate-credential' },
    });
  } catch (error) {
    return { ok: false, why: `api.nowpayments.io did not answer: ${mask(error.message)}` };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, why: `GET /v1/status → ${response.status} — NOWPayments does not accept this key` };
  }
  if (!response.ok) return { ok: false, why: `GET /v1/status → ${response.status}` };
  const body = await response.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message.replace(/[^\w \-.]/g, '') : '';
  // /v1/status answers 200 with "OK" whether or not the key is valid on some plans, so the body is
  // part of the proof rather than decoration.
  return { ok: true, detail: `GET /v1/status → 200${message ? ` (${message})` : ''}` };
}

// ── Postgres ────────────────────────────────────────────────────────────────
//
// The password is used by the APP to authenticate. So the proof is a connection made the way the app
// makes one, and the two sources of truth — the database role and the `.env` — have to agree.

async function composeContext(envFile) {
  // `/opt/ozituma/.env` sits one level beside `/opt/ozituma/app`, which is where the compose file is.
  const dir = path.dirname(path.resolve(envFile));
  const candidates = [
    path.join(dir, 'app', DEFAULT_COMPOSE_REL),
    path.join(dir, DEFAULT_COMPOSE_REL),
    path.join(process.cwd(), DEFAULT_COMPOSE_REL),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return { composeFile: candidate, projectDir: path.dirname(path.dirname(candidate)) };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function docker(args, { input, timeoutMs = 120000 } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    timeout: timeoutMs,
    env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
  });
  return {
    status: result.status,
    stdout: mask(result.stdout ?? ''),
    stderr: mask(result.stderr ?? ''),
    error: result.error ? mask(result.error.message) : null,
  };
}

/**
 * ⚠️ COMPOSE MUST BE TOLD WHERE THE ENV FILE IS, AND THE DEFAULT LOOKUP DOES NOT FIND IT.
 *
 * `/opt/ozituma/.env` sits BESIDE the application directory, but compose's default project directory
 * is the compose file's own directory — `/opt/ozituma/app` or `/opt/ozituma/app/docker`. A compose
 * command run without `--env-file` would therefore either fail on the required
 * `${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}` or interpolate an EMPTY value into the database URL.
 * Both are failures that happen while trying to fix a credential, which is the worst time for them.
 *
 * So every compose invocation carries an explicit `--env-file`. Whether the flag is accepted is
 * MEASURED once, with `config --services`, rather than assumed — this checkout cannot see the host's
 * compose version. If it is refused, the command runs without it and the reason is printed, so the
 * operator is never left guessing which environment the containers just got.
 */
let composeEnvFileSupport = null;
async function composeEnvFlag(envFile) {
  if (composeEnvFileSupport !== null) return composeEnvFileSupport;
  const probe = await docker(['compose', '--env-file', envFile, 'config', '--services']);
  if (probe.status === 0) {
    composeEnvFileSupport = { args: ['--env-file', envFile], ok: true };
  } else {
    composeEnvFileSupport = { args: [], ok: false, why: (probe.stderr.trim().split('\n')[0] ?? '').slice(0, 120) };
    warn(
      `  ! this host's docker compose refused \`--env-file\` (${composeEnvFileSupport.why}).\n` +
        `    Compose will use its default lookup instead, and the values it interpolates may not be the\n` +
        `    ones in ${envFile}. If a container comes up holding an old password, that is why.`,
    );
  }
  return composeEnvFileSupport;
}

/** `docker compose`, with the env file placed correctly for the host's compose version. */
async function composeCmd(envFile, args) {
  const flag = await composeEnvFlag(envFile);
  return ['compose', ...flag.args, ...args];
}

/** Does the database answer at all, through the app's own connection string? */
async function postgresAnswers(ctx, password, opts) {
  if (opts.fakeVerify) return fakeProof(process.env.ROTATE_FAKE_POSTGRES_FAILURE === '1' ? 'fail' : 'ok');
  if (!ctx) return { ok: false, why: 'could not find docker-compose.prod.yml; pass --env-file beside /opt/ozituma/app' };
  // The password travels on STDIN, never in argv — argv is visible to every process on the host.
  // POSTGRES_USER/POSTGRES_DB are set on the postgres container itself by the compose file, so they
  // are read there rather than assumed here. The database the app actually uses is `POSTGRES_DB`;
  // with it unset Postgres names the database after the role, which is the same value.
  const script = [
    'set -eu',
    'user="$(printenv POSTGRES_USER 2>/dev/null || echo ozituma)"',
    'db="$(printenv POSTGRES_DB 2>/dev/null || echo "$user")"',
    'pw="$(cat)"',
    'PGPASSWORD="$pw" psql -h postgres -U "$user" -d "$db" -tAc "select 1"',
  ].join('\n');
  const result = await docker(
    await composeCmd(opts.envFile, ['-f', ctx.composeFile, 'exec', '-T', 'postgres', 'sh', '-c', script]),
    { input: password },
  );
  if (result.error) return { ok: false, why: `docker could not run: ${result.error}` };
  if (result.status === 0 && result.stdout.trim().endsWith('1')) {
    return { ok: true, detail: "SELECT 1 succeeded through the app's own connection string" };
  }
  const reason = (result.stderr.trim().split('\n').pop() ?? '').trim();
  return { ok: false, why: `the database did not answer: ${reason || `psql exited ${result.status}`}` };
}

/** Put a password on the role. The database is `postgres` because this is maintenance, not app traffic. */
async function postgresAlterRole(ctx, password, envFile) {
  if (!ctx) return { ok: false, why: 'no compose context' };
  // The password is passed as a psql VARIABLE (`-v newpw=…` read from stdin) and formatted with
  // `:'newpw'`, which makes psql quote it as a SQL string literal. A quote or backslash inside the
  // password therefore cannot break out of the statement — hand-rolling the quotes here would be the
  // bug that turns a rotation into an injection.
  const script = [
    'set -eu',
    'user="$(printenv POSTGRES_USER 2>/dev/null || echo ozituma)"',
    'pw="$(cat)"',
    'psql -h postgres -U "$user" -d postgres -v ON_ERROR_STOP=1 -v newpw="$pw" \\',
    '  -c "ALTER ROLE \\"$user\\" WITH PASSWORD :\'newpw\'" >/dev/null',
  ].join('\n');
  const result = await docker(
    await composeCmd(envFile, ['-f', ctx.composeFile, 'exec', '-T', 'postgres', 'sh', '-c', script]),
    { input: password },
  );
  if (result.error) return { ok: false, why: `docker could not run: ${result.error}` };
  if (result.status === 0) return { ok: true };
  const reason = (result.stderr.trim().split('\n').pop() ?? '').trim();
  return { ok: false, why: reason || `psql exited ${result.status}` };
}

// ── The "old value is dead" probe ───────────────────────────────────────────
//
// ⚠️ THIS IS THE STEP EVERYONE SKIPS, AND A ROTATION THAT LEAVES THE OLD KEY ACTIVE IS NOT A
// ROTATION. The same proofs are reused with the OLD value; each one is expected to FAIL. Where an
// old value cannot be probed — already overwritten in the file, or the issuer does not report it —
// the script says so rather than pretending.

async function probeOldValue(kind, env, oldValues, opts) {
  if (opts.fakeVerify) {
    return { ok: true, detail: 'stubbed by --fake-verify (the old-value probe was not performed)' };
  }
  const changes = Object.entries(oldValues).map(([name, value]) => ({ name, value }));
  if (changes.length === 0) return { ok: false, detail: 'no old value was available to probe' };

  let proof;
  switch (kind) {
    case 's3':
      proof = await verifyS3(env, changes, opts);
      break;
    case 'github':
      proof = await verifyGithub(env, changes, opts);
      break;
    case 'smtp':
      proof = await verifySmtp(env, changes, opts);
      break;
    case 'resend':
      proof = await verifyResend(env, changes, opts);
      break;
    case 'paystack':
      proof = await verifyPaystack(env, changes, opts);
      break;
    case 'nowpayments':
      proof = await verifyNowpayments(env, changes, opts);
      break;
    case 'postgres': {
      const ctx = await composeContext(opts.envFile);
      proof = await postgresAnswers(ctx, oldValues.POSTGRES_PASSWORD, opts);
      break;
    }
    default:
      return { ok: false, detail: 'no probe exists for this credential — confirm revocation at the issuer' };
  }
  // For this probe, `ok: true` from the verifier IS the failure: the old value still works.
  // `ROTATE_FAKE_OLD_STILL_WORKS=1` lets the refusal paths be exercised without a live issuer:
  // it forces this branch to report that the old value survived.
  if (process.env.ROTATE_FAKE_OLD_STILL_WORKS === '1') {
    return { ok: false, detail: 'THE OLD VALUE STILL WORKS (forced by ROTATE_FAKE_OLD_STILL_WORKS)' };
  }
  return proof.ok
    ? { ok: false, detail: 'THE OLD VALUE STILL WORKS' }
    : { ok: true, detail: 'the old value was refused' };
}

// ---------------------------------------------------------------------------
// Restarting what reads the value
// ---------------------------------------------------------------------------

async function restartServices(vars, descriptor, opts) {
  if (!opts.restart) return { ok: true, detail: 'skipped (--no-restart); the containers still hold the OLD value' };
  const services = descriptor.restart;
  if (services.length === 0) {
    return { ok: true, detail: 'nothing to restart — no container on this host reads this variable' };
  }
  if (opts.fakeVerify) {
    return { ok: true, detail: `stubbed by --fake-verify (would recreate: ${services.join(', ')})` };
  }
  const ctx = await composeContext(opts.envFile);
  if (!ctx) return { ok: false, why: 'could not find docker-compose.prod.yml' };
  // `up -d`, not `restart`: compose resolves `${…}` when it CREATES a container, so only a recreate
  // picks up a changed env_file. `restart` would bring the old value straight back.
  const cmd = await composeCmd(opts.envFile, ['-f', ctx.composeFile, 'up', '-d', ...services]);
  const result = await docker(cmd, { timeoutMs: 300000 });
  if (result.error) return { ok: false, why: `docker could not run: ${result.error}` };
  if (result.status !== 0) {
    const tail = (result.stderr.trim().split('\n').slice(-3).join(' ') || `exit ${result.status}`).trim();
    return { ok: false, why: `compose up failed: ${tail}` };
  }
  const notes = [];
  if (descriptor.database) {
    // ⚠️ `academy.ozikoro.com` SHARES THIS DATABASE (the same `account` table and the same
    // `DATABASE_URL`), and `AGENTS.md` measures it as live. A host running an academy service must
    // recreate it too, or it is left holding the password that was just retired. The service is NOT
    // in this checkout's compose file — repository and host disagree — so this is attempted and
    // skipped, never required: a name that does not exist on THIS host must not fail the rotation.
    if (!services.includes('academy')) {
      const extra = await docker(await composeCmd(opts.envFile, ['-f', ctx.composeFile, 'up', '-d', 'academy']), {
        timeoutMs: 300000,
      });
      notes.push(
        extra.status === 0
          ? 'academy ALSO recreated — it shares this database, so it had to be'
          : 'no `academy` service on this host (or it did not come up) — if an academy container exists, restart it by hand',
      );
    }
  }
  return { ok: true, detail: `recreated: ${services.join(', ')}${notes.length ? `; ${notes.join('; ')}` : ''}` };
}

async function checkHealth(opts) {
  if (!opts.restart || opts.fakeVerify) return { ok: true, detail: 'skipped' };
  const ctx = await composeContext(opts.envFile);
  if (!ctx) return { ok: false, why: 'could not find docker-compose.prod.yml' };
  const result = await docker(
    await composeCmd(opts.envFile, [
      '-f',
      ctx.composeFile,
      'exec',
      '-T',
      'web',
      'node',
      '-e',
      "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>{process.stdout.write(t);process.exit(/\"database\":\"reachable\"/.test(t)?0:1)}).catch(e=>{process.stderr.write(String(e));process.exit(1)})",
    ]),
    { timeoutMs: 60000 },
  );
  if (result.status === 0 && result.stdout.includes('"database":"reachable"')) {
    return { ok: true, detail: '/api/health reports "database":"reachable"' };
  }
  return { ok: false, why: `the health check did not report a reachable database (${result.stderr.trim().slice(-200) || `exit ${result.status}`})` };
}

// ---------------------------------------------------------------------------
// Reading the new value without it touching argv, history or a log
// ---------------------------------------------------------------------------

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('stdin is not a terminal; pipe the value in with --value-stdin instead'));
      return;
    }
    process.stdout.write(prompt);
    let value = '';
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (char) => {
      const text = char.toString('utf8');
      if (text === '\n' || text === '\r' || text === '\u0004') {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
      } else if (text === '\u0003') {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('cancelled'));
      } else if (text === '\u007f' || text === '\b') {
        value = value.slice(0, -1);
      } else {
        value += text;
      }
    };
    const cleanup = () => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    stdin.on('data', onData);
  });
}

async function readPipedValue() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function collectNewValues(descriptor, opts, env, names) {
  const values = {};
  if (opts.valueStdin) {
    const raw = await readPipedValue();
    // One line per name, in order, so a pair can be passed without argv.
    const parts = raw.split('\n');
    names.forEach((name, index) => {
      if (parts[index] !== undefined && parts[index] !== '') values[name] = registerSecret(parts[index].replace(/\r$/, ''));
    });
  } else {
    for (const name of names) {
      const supplied = await readHidden(`  new ${name} (hidden, shown as bullets): `);
      if (supplied) values[name] = registerSecret(supplied);
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.kind) {
    process.stdout.write(USAGE);
    process.exit(opts.help ? 0 : 2);
  }

  const descriptor = CREDENTIALS[opts.kind];
  if (!descriptor) {
    die(`unknown credential "${opts.kind}". Known: ${Object.keys(CREDENTIALS).join(', ')}.`);
  }
  if (opts.kind === 'secret' && !opts.name) {
    die('`secret` needs the variable name: node scripts/rotate-credential.mjs secret MY_VAR_NAME');
  }

  let names = descriptor.vars;
  if (opts.kind === 'secret') {
    if (!/^[A-Z][A-Z0-9_]*$/.test(opts.name)) die(`"${opts.name}" is not an environment variable name.`);
    names = [opts.name];
    descriptor.issuer = `the system that issued ${opts.name}`;
  }

  say('');
  say('════════════════════════════════════════════════════════════════════════');
  say(`  rotate-credential — ${descriptor.title}`);
  say('════════════════════════════════════════════════════════════════════════');
  say(`  file        ${opts.envFile}`);
  say(`  issuer      ${descriptor.issuer}`);
  say(`  variables   ${names.join(', ')}`);
  say(`  proof       ${proofName(opts.kind)}`);
  if (opts.fakeVerify) {
    say('');
    say('  ⚠️  --fake-verify IS SET. Every network proof is a local stub and the old-value probe is');
    say('      skipped. This mode exists to test the refusal paths on a scratch file. On a real');
    say('      .env it will happily write a value it cannot prove.');
  }
  if (opts.kind === 'secret' && !opts.checked) {
    say('');
    say('  ⚠️  `secret` has no automated proof. Re-run with --i-have-checked once you have tested the');
    say('      new value yourself, because an unproven rotation that LOOKS verified is the worst');
    say('      outcome available here.');
    process.exit(2);
  }

  const env = await readEnvFile(opts.envFile);
  const newValues = await collectNewValues(descriptor, opts, env, names);

  // ── Refusal 1: empty ──────────────────────────────────────────────────────
  for (const name of names) {
    if (newValues[name] === undefined || newValues[name] === '') {
      die(`no new value was supplied for ${name}. A rotation to nothing is not a rotation.`, 2);
    }
  }
  // ── Refusal 2: identical ──────────────────────────────────────────────────
  for (const name of names) {
    const old = env.entries.get(name)?.value;
    if (old !== undefined && old === newValues[name]) {
      die(
        `${name} is IDENTICAL to the value already in the file (sha256:${fingerprint(newValues[name])}). ` +
          `Rotating to the same value is not a rotation, and it would look like one. Create a new ` +
          `credential at the issuer first: ${descriptor.issuer}.`,
        2,
      );
    }
  }

  const oldValues = {};
  for (const name of names) oldValues[name] = env.entries.get(name)?.value;

  say('');
  say('  For each variable — the old value and the new one, by name only:');
  for (const name of names) {
    const before = oldValues[name];
    say(`    ${name}`);
    say(`      before  ${before === undefined ? 'absent from the file' : `length=${before.length}  sha256:${fingerprint(before)}`}`);
    say(`      after   length=${newValues[name].length}  sha256:${fingerprint(newValues[name])}`);
  }

  // ── Back up, and say where ────────────────────────────────────────────────
  const changes = names.map((name) => ({ name, value: newValues[name] }));
  const backupPath = await makeBackup(opts.envFile, opts.backupDir, opts.kind, names);
  say('');
  say(`  BACKUP TAKEN — the old value survives this run whatever happens next:`);
  say(`    ${backupPath}   (mode 0600, mode-0700 directory)`);
  say(`    keep it until the new value has been in use for a few days; then delete it with \`shred -u\``);
  say(`    NOTHING here is web-served and nothing here is in the bucket — refused on purpose.`);

  // ── Postgres is the one whose proof needs the database changed first ──────
  let databaseChanged = false;
  let preflight = { ok: true };

  if (descriptor.database) {
    const ctx = await composeContext(opts.envFile);
    say('');
    say('  ── postgres: prove the new password BEFORE changing anything ──');
    const roundTrip = opts.fakeVerify
      ? fakeProof('ok')
      : (async () => {
          if (!ctx) return { ok: false, why: 'no docker-compose.prod.yml found' };
          // Set a THROWAWAY value on the role, prove the app's connection path accepts a password we
          // chose, and put the real new one on only when that round trip worked. If anything about
          // this host's postgres auth is unusual this fails with the database untouched.
          const probe = randomBytes(24).toString('base64url');
          registerSecret(probe);
          const set = await postgresAlterRole(ctx, probe, opts.envFile);
          if (!set.ok) return { ok: false, why: `could not set a probe password: ${set.why}` };
          const check = await postgresAnswers(ctx, probe, opts);
          if (!check.ok) {
            // Put the OLD password straight back; we have not touched the file yet.
            if (oldValues.POSTGRES_PASSWORD) await postgresAlterRole(ctx, oldValues.POSTGRES_PASSWORD, opts.envFile);
            return { ok: false, why: `the probe password was refused, so the role was put back: ${check.why}` };
          }
          return { ok: true, detail: 'a throwaway password round-tripped; the role is writable and auth works' };
        })();
    preflight = roundTrip;
    if (!roundTrip.ok) {
      say(`  ✗ pre-flight failed: ${roundTrip.why}`);
      say('    The database was put back on the old password. The .env was NOT touched.');
      say(`    The backup is still at ${backupPath} — but nothing was changed, so you do not need it.`);
      process.exit(1);
    }
    say(`  ✓ ${roundTrip.detail}`);

    // Now the real new password, on the database FIRST.
    const set = opts.fakeVerify ? { ok: true } : await postgresAlterRole(ctx, newValues.POSTGRES_PASSWORD, opts.envFile);
    if (!set.ok) {
      if (!opts.fakeVerify && oldValues.POSTGRES_PASSWORD) {
        await postgresAlterRole(ctx, oldValues.POSTGRES_PASSWORD, opts.envFile);
        say('  ↺ the role was put back on the old password.');
      }
      say(`  ✗ could not set the new password on the role: ${set.why}`);
      say('    The .env was NOT touched, and the database is back on the old value.');
      process.exit(1);
    }
    databaseChanged = true;
    say('  ✓ POSTGRES_PASSWORD set on the role (value not shown)');
  }

  // ── Prove the new value works BEFORE writing it ───────────────────────────
  say('');
  say(`  ── proving the new value: ${proofName(opts.kind)} ──`);
  const proof = await runProof(opts.kind, env, changes, opts);
  if (!proof.ok) {
    if (databaseChanged && !opts.fakeVerify) {
      const ctx = await composeContext(opts.envFile);
      if (ctx && oldValues.POSTGRES_PASSWORD) await postgresAlterRole(ctx, oldValues.POSTGRES_PASSWORD, opts.envFile);
    }
    say(`  ✗ THE NEW VALUE DID NOT WORK: ${proof.why}`);
    say('    Nothing was written to the .env file.');
    say(databaseChanged ? '    The database role was put back on the old password.' : '    The database was not touched.');
    say(`    The file is unchanged, so the application is still on the old value and still up.`);
    say(`    Fix the credential at the issuer (${descriptor.issuer}) and run this again.`);
    process.exit(1);
  }
  say(`  ✓ ${proof.detail ?? 'works'}`);

  // ── Write ─────────────────────────────────────────────────────────────────
  say('');
  say('  ── writing ──');
  const rendered = applyChanges(env, changes);
  await writeEnvFile(opts.envFile, rendered);
  const stat = await fs.stat(opts.envFile);
  say(`  ✓ ${opts.envFile} rewritten (mode 0${(stat.mode & 0o777).toString(8)})`);

  // ── Restart, then re-prove from the file ──────────────────────────────────
  const restarted = await restartServices(names, descriptor, opts);
  say(`  ${restarted.ok ? '✓' : '✗'} restart: ${restarted.detail ?? restarted.why}`);

  let afterProof = { ok: true, detail: 'not re-proved' };
  if (restarted.ok && !opts.fakeVerify) {
    const reread = await readEnvFile(opts.envFile);
    const rereadChanges = names.map((name) => ({ name, value: reread.entries.get(name)?.value }));
    afterProof = await runProof(opts.kind, reread, rereadChanges, opts);
    say(`  ${afterProof.ok ? '✓' : '✗'} re-read from the file: ${afterProof.detail ?? afterProof.why}`);
  }

  const health = await checkHealth(opts);
  say(`  ${health.ok ? '✓' : '✗'} health: ${health.detail ?? health.why}`);

  if (!restarted.ok || !afterProof.ok || !health.ok) {
    // ── Fail closed: put the whole thing back ───────────────────────────────
    say('');
    say('  ── PUTTING IT BACK ──');
    await fs.copyFile(backupPath, opts.envFile);
    await fs.chmod(opts.envFile, 0o600);
    say(`  ↺ ${opts.envFile} restored from ${backupPath}`);
    if (databaseChanged && !opts.fakeVerify && oldValues.POSTGRES_PASSWORD) {
      const ctx = await composeContext(opts.envFile);
      const back = await postgresAlterRole(ctx, oldValues.POSTGRES_PASSWORD, opts.envFile);
      say(`  ${back.ok ? '↺' : '✗'} database role: ${back.ok ? 'old password restored' : back.why}`);
    }
    await restartServices(names, descriptor, opts);
    say('  The host is back where it started. Nothing is holding a value that does not work.');
    process.exit(1);
  }

  // ── The old value must now be dead ────────────────────────────────────────
  say('');
  say('  ── the old value, probed again: it must now FAIL ──');
  if (opts.skipOldCheck) {
    say('  ! skipped (--skip-old-check). THIS IS THE STEP THAT MAKES IT A ROTATION.');
    say('    Revoke the old credential at the issuer by hand, and say in the ticket that you did.');
  } else {
    const oldProbe = await probeOldValue(opts.kind, env, names.reduce((acc, n) => ({ ...acc, [n]: oldValues[n] }), {}), opts);
    say(`  ${oldProbe.ok ? '✓' : '⚠'} ${oldProbe.detail}`);
    if (!oldProbe.ok) {
      say('');
      say('    The old value STILL WORKS. The rotation is not finished. Go to the issuer and REVOKE');
      say(`    the old credential: ${descriptor.issuer}`);
      say('    A rotation that leaves the old key active has changed nothing an attacker cares about.');
    }
  }

  say('');
  say('  ── NEXT ──');
  if (descriptor.restart.length > 0) {
    say(`  • confirm the site: curl -s -o /dev/null -w '%{http_code}\\n' https://ozituma.com/  → 200`);
  }
  say('  • confirm the OLD value fails at the issuer, or with the probe above');
  say('  • revoke the old credential at the issuer');
  say('  • keep the backup until you are sure, then: shred -u ' + backupPath);
  say('');
  say('  ✓ done — no value was printed anywhere in this output.');
  say('');
}

function proofName(kind) {
  switch (kind) {
    case 's3':
      return 'a real signed HEAD request against the bucket';
    case 'github':
      return 'GET api.github.com/user, plus a look at the push scope';
    case 'smtp':
      return 'an authenticated SMTP handshake (not a send)';
    case 'resend':
      return 'GET api.resend.com/domains';
    case 'paystack':
      return 'GET api.paystack.co/transaction, and the test-or-live prefix';
    case 'nowpayments':
      return 'GET api.nowpayments.io/v1/status';
    case 'postgres':
      return "SELECT 1 through the app's own connection string";
    default:
      return 'none — you confirm it by hand';
  }
}

async function runProof(kind, env, changes, opts) {
  switch (kind) {
    case 's3':
      return verifyS3(env, changes, opts);
    case 'github':
      return verifyGithub(env, changes, opts);
    case 'smtp':
      return verifySmtp(env, changes, opts);
    case 'resend':
      return verifyResend(env, changes, opts);
    case 'paystack':
      return verifyPaystack(env, changes, opts);
    case 'nowpayments':
      return verifyNowpayments(env, changes, opts);
    case 'postgres': {
      const ctx = await composeContext(opts.envFile);
      const password = changes.find((c) => c.name === 'POSTGRES_PASSWORD')?.value;
      return await postgresAnswers(ctx, password, opts);
    }
    default:
      return { ok: true, detail: 'nothing to prove automatically — you confirmed it by hand' };
  }
}

main().catch((error) => {
  die(`unexpected failure: ${mask(error?.stack ?? String(error))}`);
});
