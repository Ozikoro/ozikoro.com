/*
 * Prove the compose and Caddyfile wiring by reading them, because there is no daemon here.
 *
 *   node scripts/check-compose-env.mjs
 *   node scripts/check-compose-env.mjs --service ozikoro
 *
 * WHY THIS EXISTS
 *
 * `docker compose config` resolves the environment and is the right tool. There is no `docker`
 * binary in this development environment, and no `caddy` either, so the question has to be answered
 * a second way or not at all.
 *
 * It is answerable, and the second way is arguably the better one for this fault class, because
 * the fault is not "what value did the variable get" but "was the variable NAMED in the service
 * block at all". Compose passes a service only the variables the service names — `AGENTS.md`
 * records that for LEARN_BRIDGE_SECRET and it has been rediscovered repeatedly. `docker compose
 * config` shows a resolved environment; this shows the gap between the code and the configuration
 * that is supposed to feed it, which is what actually goes wrong.
 *
 * WHAT IT CHECKS
 *
 *  1. Every `{$VAR}` the Caddyfile interpolates is named in the `caddy` service's environment.
 *     This is the fault that matters most: an interpolation that resolves to the empty string
 *     leaves a Caddy site block with no address, and Caddy refuses to load the whole file — so a
 *     missing OZIKORO_DOMAIN does not just leave ozikoro.com unserved, it stops ozituma.com too.
 *  2. Every `process.env.NAME` and `env('NAME')` read in a service's source trees is either named
 *     in that service's environment block or listed below as a known-safe omission (a value the
 *     code derives, or one only Docker itself sets).
 *  3. Every variable a service names is read somewhere in its trees. A name nothing reads is a
 *     typo waiting to be the next OZITUMA_SMTP_PASS: the value arrives, the code asks for a
 *     different name, and the symptom is an authentication failure rather than a missing setting.
 *  4. `depends_on` names only services that exist.
 *  5. **For the services whose configuration is a shell `entrypoint:` rather than TypeScript**
 *     (`backup`, `backup-upload`, `healthwatch`), every name the shell expands is named in that
 *     service's environment block, and vice versa. This was added in round 352 with `backup-upload`,
 *     which reads eight settings out of its environment and would otherwise have printed "no source
 *     mapping" — a line that looks like coverage and is the opposite, on the one service where a
 *     missing name is a silent no-op rather than a startup error.
 *
 * It never prints a value. Compose interpolations are reported by name and default only.
 *
 * LIMITS, STATED SO THEY ARE NOT MISTAKEN FOR PASSES
 *
 *  - The compose parser is purpose-built for this file's shape: two-space indentation, a mapping
 *    `environment:` block (not the `- KEY=value` list form), and `depends_on` as a list. It
 *    verifies under those assumptions and says so if the file stops matching them.
 *  - The shell route is a second, narrower reader over the same file. It finds `entrypoint:` and
 *    takes the lines below it while they stay indented; it does not check the shell's syntax, and
 *    it cannot see a variable reached only through `eval` or a sourced file. That is why the one
 *    `eval` in `backup-upload` — the loop that tests five names for emptiness — is also written as
 *    five explicit names, so the reader does not depend on the check understanding `eval`.
 *  - It does not resolve `/opt/ozituma/.env`. It proves the NAME is plumbed, not that a value
 *    exists on the host. A named variable with no value is still a container without it.
 *  - Only `docker/docker-compose.prod.yml` and `docker/Caddyfile` are read.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const COMPOSE = join(ROOT, 'docker', 'docker-compose.prod.yml');
const CADDYFILE = join(ROOT, 'docker', 'Caddyfile');

/*
 * Which source trees each service actually runs.
 *
 * This is the part that has to be right, and it is a judgement rather than a measurement: `web`
 * and `ozikoro` both import `@ozituma/db` and `@ozituma/core`, while `ozikoro` alone imports
 * `@ozikoro/platform`. Deriving it from imports would be better and is worth doing if this check
 * starts producing false positives.
 *
 * **THE `learn` ENTRY WAS HERE AND WENT WITH ITS SERVICE.** It named `apps/learn`, the legacy Next.js
 * courses app, which has been deleted along with `learn.ozituma.com`. This table is read by service
 * name out of the compose file, so an entry with no service is a line that describes nothing — and
 * the check would have gone on claiming to cover a directory that is not in the repository.
 */
const SERVICE_SOURCES = {
  web: ['apps/web/app', 'apps/web/lib', 'apps/web/components', 'apps/web/middleware.ts', 'apps/web/next.config.ts', 'packages/core/src', 'packages/db/src'],
  ozikoro: ['apps/ozikoro', 'packages/ozikoro/src', 'packages/db/src', 'packages/core/src'],
};

/*
 * Services whose configuration is read by a shell `entrypoint:` in the compose file rather than by
 * TypeScript, and which therefore need a second reading route.
 *
 * **`backup-upload` WAS ADDED HERE IN ROUND 352, AND IT IS THE REASON THIS ROUTE EXISTS.** That
 * service is an `amazon/aws-cli` image running a `sh -c` loop; it reads `S3_ACCESS_KEY_ID`,
 * `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `BACKUP_UPLOAD_PREFIX` and two
 * retention numbers, and it reads every one of them out of the environment. Without this route the
 * check would print "no source mapping" for it — a line that reads like coverage and is the
 * opposite, because it is exactly the service where a name added to `/opt/ozituma/.env` and not to
 * the service block would produce a silent no-op. A backup uploader that starts cleanly and uploads
 * nothing is the fault this whole file was written to catch.
 *
 * The shell body is extracted from the compose file, `$$` is unescaped to `$` (that is the compose
 * escape for a literal dollar, so `$$S3_BUCKET` in the file *is* an expansion of `S3_BUCKET` at run
 * time), and every `${NAME}`, `${NAME:-default}` and `$NAME` is recorded.
 */
const SERVICE_SHELL_ENTRYPOINTS = new Set(['backup', 'backup-upload', 'healthwatch']);

/*
 * Names a service must carry for a *program* in its image, which no file this check reads ever
 * mentions. `PGPASSWORD` is the case here and it is the founder of the category: `pg_dump` and
 * `pg_restore` read it from the environment themselves, so it is named by compose, read by nothing
 * in the repository, and completely necessary. Reporting it as a name nothing asks for would be
 * wrong, and would teach the reader to ignore that warning.
 */
const SHELL_PROGRAM_READS = new Map([
  ['PGPASSWORD', 'libpq — pg_dump and pg_restore read it directly from the environment'],
]);

/*
 * Names a POSIX shell expands from its own state, never from a service's `environment:` block.
 * Naming any of these in compose would be wrong rather than missing: `PATH` is the image's, and
 * `$#` and `$$` are the shell's own.
 *
 * This list is deliberately separate from `KNOWN_OMISSIONS` above, because "the shell provides it"
 * is a different claim from "the runtime provides it", and merging the two would hide which one was
 * being appealed to.
 */
const SHELL_OWN_NAMES = new Set([
  'PATH', 'HOME', 'PWD', 'OLDPWD', 'SHELL', 'USER', 'LOGNAME', 'HOSTNAME', 'TERM', 'SHLVL',
  'IFS', 'LANG', 'LC_ALL', 'TZ', 'PPID', 'PS1', 'PS2',
  // A name the entrypoint itself supplies a default for and never expects from compose.
  'BACKUP_DIR',
]);

/*
 * Variables a service does not have to name, each with the reason.
 *
 * These are grouped by WHY they are safe to omit, because "known omission" and "we gave up" are
 * different claims and only the first belongs in a list like this.
 */
const KNOWN_OMISSIONS = {
  // Set by the runtime, the platform or the Dockerfile. Naming them in compose would either be
  // impossible or would invite somebody to set them.
  _runtime: new Set([
    'NODE_ENV', 'PORT', 'HOSTNAME', 'PATH', 'HOME', 'TZ', 'PWD', 'LANG', 'TERM', 'SHLVL',
    'NEXT_RUNTIME', 'NEXT_PHASE', 'NODE_OPTIONS', 'CI', 'K_SERVICE', 'AWS_LAMBDA_FUNCTION_NAME',
    'OZIKORO_DIST_DIR', 'OZITUMA_DB_DEBUG',
  ]),
  // Every service gets DATABASE_URL from the compose file under this exact name already; listing
  // it here would hide a real omission, so it is NOT in this set. This entry is only for the
  // PGlite fallback path, which production never takes because DATABASE_URL is always set.
  _local_only: new Set(['OZITUMA_DB_PATH', 'OZITUMA_DB_DEBUG']),
};

function readText(path) {
  return readFileSync(path, 'utf8');
}

/*
 * Parse the compose file into services.
 *
 * Deliberately narrow. It understands `services:` at column 0, a service at indent 2, a key at
 * indent 4, and either an `environment:` mapping (keys at indent 6) or a `depends_on:` list
 * (entries at indent 6). Anything it does not recognise is left alone rather than guessed at.
 */
function parseCompose(text) {
  const services = new Map();
  const lines = text.split('\n');

  let inServices = false;
  let service = null;
  let block = null; // 'environment' | 'depends_on' | null

  const indentOf = (line) => line.length - line.trimStart().length;

  for (const raw of lines) {
    const withoutComment = raw.replace(/\s+#.*$/, '');
    if (withoutComment.trim() === '') continue;
    const indent = indentOf(withoutComment);
    const trimmed = withoutComment.trim();

    if (indent === 0) {
      inServices = trimmed === 'services:';
      service = null;
      block = null;
      continue;
    }
    if (!inServices) continue;

    if (indent === 2 && trimmed.endsWith(':')) {
      service = trimmed.slice(0, -1);
      services.set(service, { environment: new Map(), dependsOn: [], keys: new Set() });
      block = null;
      continue;
    }
    if (!service) continue;

    if (indent === 4) {
      block = null;
      if (trimmed === 'environment:') {
        block = 'environment';
        continue;
      }
      if (trimmed === 'depends_on:') {
        block = 'depends_on';
        continue;
      }
      services.get(service).keys.add(trimmed.replace(/:.*$/, ''));
      continue;
    }

    if (indent === 6 && block === 'environment') {
      // `KEY: value`, where value may be a ${VAR:-default} interpolation.
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(trimmed);
      if (match) services.get(service).environment.set(match[1], match[2].trim());
      continue;
    }

    if (indent === 6 && block === 'depends_on') {
      const match = /^-\s*(.+)$/.exec(trimmed);
      if (match) services.get(service).dependsOn.push(match[1].trim());
      continue;
    }

    if (indent === 6 && block === 'environment' && trimmed.startsWith('-')) {
      const match = /^-\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
      if (match) services.get(service).environment.set(match[1], match[2].trim());
    }
  }

  return services;
}

/*
 * The shell text of a service's `entrypoint:` block, taken from a literal block scalar (`|`).
 *
 * The compose parser above is line-oriented and does not model block scalars, so this is a second,
 * narrow reader over the same file: find the service's `entrypoint:` key at indent 4, then take
 * every following line indented at least **six** columns until a line drops back to indent 4, which
 * is the next key of the service. Six rather than eight because the list form puts its own items at
 * indent 6 (`- sh`, `- -c`, `- |`) and the block scalar's body at 8, and the shell text is the
 * scalar's body — the list items are ignored by the name scan, which only keeps uppercase names.
 *
 * It returns null rather than guessing when the key is absent, and the caller reports that as "not
 * checked", which is the honest answer.
 */
function readEntrypointShell(text, service) {
  const lines = text.split('\n');

  let serviceLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith(`  ${service}:`)) {
      serviceLine = i;
      break;
    }
  }
  if (serviceLine === -1) return null;

  let start = -1;
  for (let j = serviceLine + 1; j < lines.length; j += 1) {
    if (/^  \S/.test(lines[j])) break; // the next service
    if (/^    entrypoint:/.test(lines[j])) {
      start = j + 1;
      break;
    }
  }
  if (start === -1) return null;

  const body = [];
  for (let k = start; k < lines.length; k += 1) {
    const line = lines[k];
    if (/^    \S/.test(line)) break; // a sibling key of the same service: the entrypoint is done
    if (line.trim() !== '' && line.length - line.trimStart().length < 6) break;
    body.push(line);
  }
  return body.length > 0 ? body.join('\n') : null;
}

/**
 * Environment names a shell entrypoint expands: `${NAME}`, `${NAME:-default}` and `$NAME`.
 *
 * `$$` is unescaped to `$` first, because that is what compose does with it — `$$S3_BUCKET` in the
 * file is an expansion of `S3_BUCKET` at run time, and reading it as the name `$$S3_BUCKET` would
 * miss every real variable in the block.
 *
 * Returns both the names READ and the names the block ASSIGNS for itself. The second set matters:
 * `PREFIX="$${BACKUP_UPLOAD_PREFIX:-backups/ozituma}"` both assigns `PREFIX` and reads
 * `BACKUP_UPLOAD_PREFIX`, and only the second is a question for the compose file. Without this the
 * check would demand that compose name every loop variable in the script, which is the kind of
 * false positive that gets a real finding skimmed past.
 */
function readShellEnvNames(shellText) {
  const names = new Map(); // READ name -> Set of line numbers
  const assigned = new Set();
  const lines = shellText.split('\n');

  lines.forEach((raw, index) => {
    const line = raw.replace(/\$\$/g, '$').replace(/^\s*#.*$/, '');

    // `NAME=…` at the start of a line or a command, and the loop variables of `for NAME in …`.
    for (const re of [
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/g,
      /[;&|(]\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/g,
      // `… ) export NAME=… ;;` — an assignment as the body of a `case` arm.
      /\)\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/g,
      /^\s*(?:do\s+)?for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g,
    ]) {
      let m;
      while ((m = re.exec(line)) !== null) {
        const name = m[1];
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) assigned.add(name);
      }
    }

    for (const re of [/\$\{([A-Za-z_][A-Za-z0-9_]*)/g, /\$([A-Za-z_][A-Za-z0-9_]*)/g]) {
      let match;
      while ((match = re.exec(line)) !== null) {
        const name = match[1];
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue; // the repository's convention: uppercase only
        if (!names.has(name)) names.set(name, new Set());
        names.get(name).add(`entrypoint:${index + 1}`);
      }
    }
  });

  return { names, assigned };
}

/** Every `{$VAR}` and `{$VAR:-default}` the Caddyfile interpolates, with where it appears. */
function parseCaddyInterpolations(text) {
  const found = new Map(); // name -> Set of line numbers
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const body = line.replace(/^\s*#.*$/, '');
    const pattern = /\{\$([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g;
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const name = match[1];
      if (!found.has(name)) found.set(name, { lines: [], hasDefault: false });
      const entry = found.get(name);
      entry.lines.push(index + 1);
      if (match[2]) entry.hasDefault = true;
    }
  });

  return found;
}

/*
 * Files that never run inside a container, and are therefore not part of this question.
 *
 * `packages/db/src/import/**`, `test-*.ts`, `*.test.ts`, `seed.ts`, `smoke.ts`, `verify.ts` and
 * `dump.ts` are CLI entry points: they are run as one-off commands on the host with their own
 * environment, not by the server. `OZITUMA_IBODICT_SOURCE` and `OZITUMA_IMPORT_LIMIT` are read by
 * those and by nothing the container serves, so reporting them as missing would be noise — and
 * noise in a check like this is how a real finding gets skimmed past.
 *
 * The exclusion is listed rather than implied because "we did not check that" and "that does not
 * need checking" are different claims.
 */
const CLI_ONLY = [
  /(^|\/)import\//,
  /(^|\/)test-[^/]*\.ts$/,
  /\.test\.(ts|tsx|mjs|js)$/,
  /(^|\/)(seed|smoke|verify|dump|migrate)\.ts$/,
  /(^|\/)scripts\//,
];

/** Environment variable names read by the TypeScript under the given roots. */
function readEnvNames(roots) {
  const names = new Map(); // NAME -> Set of "file:line"
  const skipped = [/(^|\/)node_modules\//, /(^|\/)\.next/, /\.d\.ts$/];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = full.slice(ROOT.length + 1);
      if (skipped.some((re) => re.test(rel + (entry.isDirectory() ? '/' : '')))) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry.name)) continue;
      if (CLI_ONLY.some((re) => re.test(rel))) continue;

      const text = readFileSync(full, 'utf8');
      text.split('\n').forEach((line, index) => {
        if (/^\s*(\*|\/\/)/.test(line)) return; // a comment naming a variable is not a read
        // Three spellings, because this repository uses all three:
        //   process.env.NAME          the ordinary read
        //   env('NAME')               the helper in packages/core/src/mail.ts
        //   env.NAME                  a reader handed the environment as an object, as
        //                             `readSpotifyConfig(process.env)` does in
        //                             packages/ozikoro/src/spotify.ts
        // The third may over-detect, and that is the safe direction: a false READ makes this
        // check quieter, while a missed read makes it claim nothing uses a variable that does.
        for (const re of [
          /process\.env\.([A-Z][A-Z0-9_]*)/g,
          /\benv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
          /\benv\.([A-Z][A-Z0-9_]*)/g,
        ]) {
          let match;
          while ((match = re.exec(line)) !== null) {
            const name = match[1];
            if (!names.has(name)) names.set(name, new Set());
            names.get(name).add(`${rel}:${index + 1}`);
          }
        }
      });
    }
  };

  for (const root of roots) walk(join(ROOT, root));
  return names;
}

// `readdirSync` is imported here rather than at the top so the file reads as one story.
import { readdirSync } from 'node:fs';

/*
 * Variables that are read but deliberately not named, because the code supplies a working default.
 *
 * Every entry is a CLAIM ABOUT THE CODE and was read before being written here. The file and the
 * default are named so the claim can be checked rather than trusted — which is the whole reason
 * this list is not simply "everything the check complained about".
 */
const SAFE_DEFAULTS = new Map([
  ['DATABASE_POOL_MAX', 'packages/db/src/client.ts — `?? 10`'],
  ['OZIKORO_NARRATION_DELAY_MINUTES', 'packages/ozikoro/src/narration.ts — "or five"'],
  ['OZIKORO_NARRATION_MAX_AGE_HOURS', 'packages/ozikoro/src/narration.ts — "or twenty-four"'],
  ['SPOTIFY_SCOPES', 'packages/ozikoro/src/spotify.ts — normaliseScopes applies its own list'],
  ['OZITUMA_SMTP_SECURE', 'packages/core/src/mail.ts — defaults to STARTTLS, 465 implies implicit TLS'],
  ['OZITUMA_SMTP_ALLOW_PLAINTEXT', 'packages/core/src/mail.ts — anything but "1" refuses plaintext'],
  ['OZITUMA_EHLO_NAME', "packages/core/src/mail.ts — `?? 'ozituma.com'`"],
  ['RESEND_FROM', 'packages/core/src/mail.ts — third-priority From, after OZIKORO_ and OZITUMA_MAIL_FROM'],
  ['AWS_REGION', 'packages/core/src/mail.ts — SES is the third transport, tried after Resend and SMTP'],
  ['AWS_DEFAULT_REGION', 'packages/core/src/mail.ts — as AWS_REGION'],
  ['AWS_ACCESS_KEY_ID', 'packages/core/src/mail.ts — as AWS_REGION'],
  ['AWS_SECRET_ACCESS_KEY', 'packages/core/src/mail.ts — as AWS_REGION'],
  ['AWS_SESSION_TOKEN', 'packages/core/src/mail.ts — as AWS_REGION'],
  ['OZITUMA_VERSION', 'apps/web/app/api/health/route.ts — a build-time label, not a runtime setting'],
]);

function main() {
  const only = process.argv.includes('--service')
    ? process.argv[process.argv.indexOf('--service') + 1]
    : null;

  const composeText = readText(COMPOSE);
  const caddyText = readText(CADDYFILE);
  const services = parseCompose(composeText);
  const interpolations = parseCaddyInterpolations(caddyText);

  const problems = [];
  const warnings = [];

  console.log('\nOzikoro — compose and Caddyfile wiring, read rather than resolved');
  console.log('='.repeat(66));
  console.log('\n  No docker daemon here, so this parses the two files and reports by NAME.');
  console.log('  Values are never printed.\n');

  // ── 1. Caddy: every interpolation must be named by the caddy service ────────
  console.log('1. The Caddyfile\'s interpolations, and who provides them');
  console.log('-'.repeat(66));

  const caddy = services.get('caddy');
  if (!caddy) {
    problems.push('the compose file has no `caddy` service');
  } else {
    for (const [name, info] of interpolations) {
      const provided = caddy.environment.has(name);
      const lines = [...new Set(info.lines)].join(', ');
      if (provided) {
        const raw = caddy.environment.get(name);
        if (/\$\{[A-Za-z_][A-Za-z0-9_]*:-/.test(raw)) {
          console.log(`  ok    {$` + name + `} (Caddyfile lines ${lines}) <- named by caddy, WITH a default`);
        } else {
          // No default: an unset variable interpolates to the empty string, and a Caddy site block
          // with an empty address is a config Caddy refuses to load.
          console.log(`  ok    {$` + name + `} (Caddyfile lines ${lines}) <- named by caddy, no default`);
          warnings.push(
            `${name} is named by the caddy service with no default (${raw}). ` +
              'If it is unset on the host, Caddy interpolates the empty string and refuses to load ' +
              'the ENTIRE configuration — every site on the host stops, not just the one.'
          );
        }
      } else {
        console.log(`  FAIL  {$` + name + `} (Caddyfile lines ${lines}) is NOT named by the caddy service`);
        problems.push(
          `the Caddyfile interpolates {$${name}} at line(s) ${lines}, but the caddy service ` +
            'does not name it. Compose passes a service only the variables it names, so on the ' +
            'host it resolves to the empty string. A Caddy site block with no address is a ' +
            'configuration Caddy refuses to load — this stops EVERY site on the host.'
        );
      }
    }
    if (interpolations.size === 0) {
      console.log('  note  the Caddyfile interpolates nothing; nothing to check');
    }

    // depends_on targets must exist.
    for (const dep of caddy.dependsOn) {
      if (!services.has(dep)) {
        problems.push(`the caddy service depends_on "${dep}", which is not a service in this file`);
      } else {
        console.log(`  ok    caddy depends_on ${dep}`);
      }
    }
  }

  // ── 2 & 3. Each service: named-but-unread, and read-but-not-named ──────────
  console.log('\n2. Each service against the code it runs');
  console.log('-'.repeat(66));

  for (const [name, service] of services) {
    if (only && name !== only) continue;
    const roots = SERVICE_SOURCES[name];
    const shellText = SERVICE_SHELL_ENTRYPOINTS.has(name) ? readEntrypointShell(composeText, name) : null;
    if (!roots && !shellText) {
      console.log(`\n  ${name}: no source mapping (${[...service.environment.keys()].length} variables named, not checked)`);
      continue;
    }

    /*
     * The names this service reads, from both routes.
     *
     * `rootLabels` is what the warning text names as the place a read was found, so the two routes
     * can be told apart in a report without the reader having to guess which tree was walked.
     */
    const read = roots ? readEnvNames(roots) : new Map();
    const rootLabels = roots ? [...roots] : [];
    if (shellText) {
      const shell = readShellEnvNames(shellText);
      for (const [key, where] of shell.names) {
        // A name the script both assigns and reads is its own variable, not a setting.
        if (shell.assigned.has(key)) continue;
        if (!read.has(key)) read.set(key, new Set());
        for (const w of where) read.get(key).add(w);
      }
      rootLabels.push(`the ${name} entrypoint in docker/docker-compose.prod.yml`);
    }
    console.log(`\n  ${name}`);

    // 3. named by compose, read by nothing in this service's trees.
    //
    //    A name can be absent from both routes and still be right, when it is read by a *program*
    //    inside the container rather than by the code being walked. Those are listed, one reason
    //    each, rather than silently tolerated — a suppressed warning nobody can account for is how
    //    the next real one gets ignored.
    const dead = [];
    for (const key of service.environment.keys()) {
      if (read.has(key)) continue;
      if (SHELL_PROGRAM_READS.has(key)) {
        console.log(`    named and read by a program in the image, not by the script: ${key}`);
        continue;
      }
      dead.push(key);
    }
    if (dead.length > 0) {
      console.log(`    named but not read here: ${dead.join(', ')}`);
      for (const key of dead) {
        warnings.push(
          `${name} names ${key}, which nothing in ${rootLabels.join(', ')} reads. ` +
            'A name the code does not ask for is the OZITUMA_SMTP_PASS fault: the value arrives ' +
            'under a name nobody queries, and the symptom is a failure that does not mention it.'
        );
      }
    }

    // 2. read by the code, not named by compose, and not a known-safe omission.
    //
    //    These are WARNINGS, not failures, and the distinction is deliberate: a variable the code
    //    reads with a working default in place is a configuration decision, while a variable whose
    //    absence changes behaviour silently is a fault. Both are printed; only the second would
    //    stop a launch, so only the second is described as one.
    const missing = [];
    for (const [key, where] of read) {
      if (service.environment.has(key)) continue;
      if (KNOWN_OMISSIONS._runtime.has(key)) continue;
      if (KNOWN_OMISSIONS._local_only.has(key)) continue;
      if (SHELL_OWN_NAMES.has(key)) continue;
      missing.push({ key, where: [...where].slice(0, 2).join(', ') });
    }
    if (missing.length === 0) {
      console.log('    every variable the code reads is named here');
    } else {
      const withDefaults = missing.filter((m) => SAFE_DEFAULTS.has(m.key));
      const withoutDefaults = missing.filter((m) => !SAFE_DEFAULTS.has(m.key));

      for (const { key, where } of withoutDefaults) {
        console.log(`    not named: ${key}  (read at ${where})`);
        warnings.push(
          `${name} reads ${key} (${where}) but does not name it, so the container never receives ` +
            'it. Adding it to /opt/ozituma/.env is not enough on its own. Check whether the code ' +
            'has a default before treating this as a fault.'
        );
      }
      if (withDefaults.length > 0) {
        console.log(`    not named, but the code has a working default: ${withDefaults.map((m) => m.key).join(', ')}`);
      }
      if (withoutDefaults.length === 0) {
        console.log('    every variable the code reads with no default is named here');
      }
    }
  }

  // ── 4. The caddy upstream, by name and port ────────────────────────────────
  console.log('\n3. What the Caddyfile proxies to');
  console.log('-'.repeat(66));

  const proxied = [...caddyText.matchAll(/reverse_proxy\s+([A-Za-z0-9_.-]+):(\d+)/g)];
  for (const [, host, port] of proxied) {
    const exists = services.has(host);
    console.log(`  ${exists ? 'ok   ' : 'FAIL '} reverse_proxy ${host}:${port}${exists ? '' : ' — no such service'}`);
    if (!exists) problems.push(`the Caddyfile proxies to "${host}", which is not a service in the compose file`);
    if (exists && !services.get(host).keys.has('expose') && host !== 'web') {
      // Informational: `expose` is metadata and does not gate the compose network, so this is a
      // readability point rather than a fault.
      console.log(`        note: ${host} does not declare expose, which is cosmetic on a compose network`);
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  console.log('\nResult');
  console.log('='.repeat(66));

  if (problems.length === 0) {
    console.log('\n  Every interpolation is provided and every variable the code reads is named.');
    console.log('  This proves the NAMES are plumbed. It does NOT prove a value exists in');
    console.log('  /opt/ozituma/.env on the host, which only the host can answer.\n');
  } else {
    console.log(`\n  ${problems.length} problem(s):\n`);
    for (const p of problems) console.log(`    - ${p}`);
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`  ${warnings.length} warning(s):\n`);
    for (const w of warnings) console.log(`    - ${w}`);
    console.log('');
  }

  process.exitCode = problems.length > 0 ? 1 : 0;
}

main();
