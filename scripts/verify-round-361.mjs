/**
 * Round 361's instrument: the institutional access tier, exercised over HTTP against a real server.
 *
 * WHAT IT PROVES, AND WHY IT IS OVER HTTP RATHER THAN IN A UNIT TEST
 *
 * The database suite (`packages/ozikoro/src/test-institutional-access.ts`) proves the rule. **This proves the
 * served thing**: that a reader who does not hold the capability is refused with a real 403 and a real screen
 * at the record's own address, that an Ozituma-side administrator is refused the same way, that the proprietor
 * gets the record, and that a grant opens it and a withdrawal closes it again — the last of which the person
 * who lost access is told about.
 *
 * ⚠️ IT RUNS AGAINST A SCRATCH CLUSTER, ON A THROWAWAY PORT, AND IT OWNS BOTH. The archive's own data has
 * ZERO records held by agreement, and that is the honest state this round must not fabricate away: **marking
 * a real record to demonstrate the refusal would be a false claim about that record.** So the instrument
 * brings its own fixture — one synthetic record whose slug says what it is — and removes everything it made.
 *
 * IT ALSO OWNS THE SERVER, AND THAT IS NOT A CONVENIENCE. PGlite is single-process: the fixtures and the
 * audit read-back need the cluster, and the HTTP probe needs the server that holds it, so a script that did
 * not stop and start its own server could not do both. The phases are:
 *
 *     1. open the cluster, make the fixtures, close it
 *     2. start the standalone server on 3111 against that cluster, wait for a page
 *     3. the HTTP probe — the refusal, the grant, the withdrawal, the other read paths
 *     4. stop the server with SIGTERM (never -9: it holds a WAL-writing PGlite)
 *     5. open the cluster again, read the grant row and both audit rows back, remove the fixtures
 *     6. the design parity, because this round changed served pages
 *
 *     cp -Rc .data/pg .data/scratch-361-http/pg        # a copy, so the archive's rows are untouched
 *     OZITUMA_DB_PATH=$PWD/.data/scratch-361-http/pg node scripts/verify-round-361.mjs
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';

const PORT = Number(process.env.PORT ?? 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const STANDALONE = 'apps/ozikoro/.next/standalone';
const SUFFIX = 'zzr361';
const SLUG = `${SUFFIX}-held-by-agreement`;
const PASSWORD = 'a long enough password for the probe';
let failures = 0;

const say = (line = '') => console.log(line);
const ok = (label, condition, detail = '') => {
  say(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Cookies, by hand: the server sets one cookie and reads it back, and Node's fetch keeps no jar.
// ---------------------------------------------------------------------------

async function request(label, path, options = {}) {
  const jar = options.jar ?? null;
  const headers = { ...(options.headers ?? {}) };
  if (jar) headers.cookie = jar;
  if (options.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    headers.origin = BASE;
  }
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.form ? new URLSearchParams(options.form).toString() : undefined,
    redirect: 'manual',
  });
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  let nextJar = jar ?? '';
  for (const cookie of setCookies) {
    const pair = cookie.split(';')[0];
    if (pair.startsWith('ozituma_session=')) nextJar = pair;
  }
  const body = await response.text();
  return { label, status: response.status, location: response.headers.get('location'), body, jar: nextJar };
}

async function signIn(email) {
  const first = await request(`sign in ${email}`, '/api/auth/signin', {
    method: 'POST',
    form: { email, password: PASSWORD },
  });
  return { jar: first.jar, status: first.status, location: first.location };
}

/** The text a person reads, so the report can quote the screen rather than the markup. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&rsquo;/g, '\u2019')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Phase 1 — the fixtures, in the scratch cluster, before anything holds it.
// ---------------------------------------------------------------------------

const db = await getDb();

async function cleanup(handle) {
  await handle.query(`delete from ozikoro_audit where note like '%${SUFFIX}%'`);
  await handle.query(
    `delete from ozikoro_audit where entity_type = 'ozikoro_institutional_access'
       and entity_id in (select id from ozikoro_institutional_access where account_id in
            (select id from account where email like '${SUFFIX}-%'))`
  );
  await handle.query(
    `delete from ozikoro_audit where entity_type = 'ozikoro_article'
       and entity_id in (select id from ozikoro_article where slug like '${SUFFIX}-%')`
  );
  await handle.query(`delete from ozikoro_institutional_access where account_id in (select id from account where email like '${SUFFIX}-%')`);
  await handle.query(`delete from ozikoro_article where slug like '${SUFFIX}-%'`);
  await handle.query(`delete from ozikoro_member_role where account_id in (select id from account where email like '${SUFFIX}-%')`);
  await handle.query(`delete from auth_session where account_id in (select id from account where email like '${SUFFIX}-%')`);
  await handle.query(`delete from account where email like '${SUFFIX}-%'`);
}

await cleanup(db);

const owner = await registerAccount(db, { email: `${SUFFIX}-proprietor@example.invalid`, password: PASSWORD });
await db.query(`update account set role = 'owner' where id = $1`, [owner.id]);
await db.query(`insert into ozikoro_member_role (account_id, role, note) values ($1,'owner','probe')`, [owner.id]);

const dictAdmin = await registerAccount(db, { email: `${SUFFIX}-dictionary-admin@example.invalid`, password: PASSWORD });
await db.query(`update account set role = 'admin' where id = $1`, [dictAdmin.id]);

const reader = await registerAccount(db, { email: `${SUFFIX}-reader@example.invalid`, password: PASSWORD });

const article = await db.one(
  `insert into ozikoro_article (slug, title, standfirst, body_html, status, published_at, access_tier)
   values ($1, $2, $3, $4, 'published', now(), 'open') returning id`,
  [
    SLUG,
    'A record held by agreement (round 361 fixture)',
    'Created by scripts/verify-round-361.mjs on a scratch cluster.',
    '<p>This body must not be readable by a caller without an agreement.</p>',
  ]
);

say('─'.repeat(96));
say('ROUND 361 — INSTITUTIONAL ACCESS, MEASURED OVER HTTP');
say(`base ${BASE}   scratch record ${SLUG}   accounts: proprietor=${owner.id} dictionary-admin=${dictAdmin.id} reader=${reader.id}`);
say('─'.repeat(96));

await closeDb();

// ---------------------------------------------------------------------------
// Phase 2 — the server, on its own port, against the scratch cluster.
// ---------------------------------------------------------------------------

say(`\n0. STARTING THE STANDALONE SERVER ON ${PORT} AGAINST THE SCRATCH CLUSTER`);
const server = spawn('node', ['apps/ozikoro/server.js'], {
  cwd: STANDALONE,
  env: {
    ...process.env,
    PORT: String(PORT),
    /*
     * 0.0.0.0 AND NOT 127.0.0.1, WHICH IS THE SAME FAULT `serve-review.sh` RECORDS.
     *
     * A standalone Next server proxies its own requests to `localhost:<port>`, and on this machine
     * `localhost` resolves to ::1 first. Binding IPv4 only makes that proxy fail with ECONNRESET, so
     * **every route except the index answers 500 while the process looks healthy** — measured here: three
     * search queries, all 500, with `Failed to proxy http://localhost:3111/search` in the log. The script
     * that serves the review site sets 0.0.0.0 for exactly this reason, and this instrument matches it.
     */
    HOSTNAME: '0.0.0.0',
    OZITUMA_SITE_URL: BASE,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += String(chunk); });
server.stderr.on('data', (chunk) => { serverLog += String(chunk); });

let up = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(1000);
  try {
    const probe = await fetch(`${BASE}/`, { redirect: 'manual' });
    if (probe.status > 0) { up = true; break; }
  } catch {
    // Not listening yet.
  }
}
ok(`the test server answers on ${PORT}`, up);
if (!up) {
  say(serverLog.slice(-2000));
  killServer();
  process.exit(1);
}

async function stopServer() {
  server.kill('SIGTERM');
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && server.exitCode === null && !server.killed) await sleep(250);
  await sleep(1500);
}
function killServer() {
  try { server.kill('SIGTERM'); } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// Phase 3 — the HTTP probe.
// ---------------------------------------------------------------------------

say('\n1. THE MARK, MADE THROUGH THE SCREEN\'S OWN ENDPOINT');

const anonymousMark = await request('mark, signed out', '/api/admin/access', {
  method: 'POST',
  form: { action: 'mark', record: `/${SLUG}/`, tier: 'by_agreement', reason: 'Signed out, so this must fail.' },
});
ok('a signed-out POST cannot mark a record', anonymousMark.status === 303 && /signin/.test(anonymousMark.location ?? ''),
  `${anonymousMark.status} -> ${anonymousMark.location}`);

const dictAdminSession = await signIn(`${SUFFIX}-dictionary-admin@example.invalid`);
ok('the dictionary administrator can sign in (it is the dictionary\'s own admin role)', dictAdminSession.status === 303,
  `${dictAdminSession.status} -> ${dictAdminSession.location}`);

const dictAdminMark = await request('mark as dictionary admin', '/api/admin/access', {
  method: 'POST',
  jar: dictAdminSession.jar,
  form: { action: 'mark', record: `/${SLUG}/`, tier: 'by_agreement', reason: 'A dictionary admin should not be able to do this.' },
});
ok('AN OZITUMA-SIDE ADMINISTRATOR CANNOT MARK A RECORD — the tier is not reachable through the dictionary',
  !/saved/.test(dictAdminMark.location ?? ''),
  `${dictAdminMark.status} -> ${dictAdminMark.location}`);

const ownerSession = await signIn(`${SUFFIX}-proprietor@example.invalid`);
ok('the proprietor signs in', ownerSession.status === 303, `${ownerSession.status} -> ${ownerSession.location}`);

const mark = await request('mark as proprietor', '/api/admin/access', {
  method: 'POST',
  jar: ownerSession.jar,
  form: {
    action: 'mark',
    record: `/${SLUG}/`,
    tier: 'by_agreement',
    reason: 'Round 361 fixture: a synthetic record, on a scratch cluster.',
  },
});
ok('the proprietor marks the record, and the notice names it', /saved/.test(mark.location ?? ''),
  `${mark.status} -> ${decodeURIComponent(mark.location ?? '')}`);

say('\n2. THE REFUSAL, SERVED AT THE RECORD\'S OWN ADDRESS');

const asStranger = await request('stranger', `/${SLUG}/`);
ok('an anonymous reader gets 403 and not 404', asStranger.status === 403, String(asStranger.status));
ok('and the body is the refusal screen, not a missing-page notice',
  asStranger.body.includes('held under an institutional access agreement') && !/does not resolve to an entry/i.test(asStranger.body));

const readerSession = await signIn(`${SUFFIX}-reader@example.invalid`);
ok('a signed-in reader without an agreement gets a session', readerSession.jar.startsWith('ozituma_session='));

const asReader = await request('reader without an agreement', `/${SLUG}/`, { jar: readerSession.jar });
ok('a signed-in reader without the capability is refused the same way', asReader.status === 403, String(asReader.status));

const asDictAdmin = await request('dictionary administrator', `/${SLUG}/`, { jar: dictAdminSession.jar });
ok('AND SO IS AN OZITUMA-SIDE ADMINISTRATOR', asDictAdmin.status === 403, String(asDictAdmin.status));

const asOwner = await request('proprietor', `/${SLUG}/`, { jar: ownerSession.jar });
ok('the proprietor reads the record, so the gate is not simply refusing everybody', asOwner.status === 200 &&
  asOwner.body.includes('must not be readable by a caller without an agreement'), String(asOwner.status));

say('\n   THE RESPONSE, VERBATIM (anonymous — the doctype and the document\'s own head):');
say(asStranger.body.split('\n').slice(0, 2).map((l) => `     ${l.slice(0, 340)}`).join('\n'));
say('\n   THE SCREEN, AS A READER READS IT (tags stripped):');
say(visibleText(asStranger.body).split('\n').map((l) => `     ${l}`).join('\n'));

say('\n3. THE GRANT, READ BACK, REVOKED, READ BACK');

const grantPost = await request('grant', '/api/admin/access', {
  method: 'POST',
  jar: ownerSession.jar,
  form: {
    action: 'grant',
    email: `${SUFFIX}-reader@example.invalid`,
    holder: 'Round 361 Probe Institute',
    instrument: 'Probe agreement of 5 October 2026',
    terms: 'Consultation on the scratch cluster only.',
  },
});
ok('the proprietor grants reading access by agreement', /saved/.test(grantPost.location ?? ''),
  `${grantPost.status} -> ${decodeURIComponent(grantPost.location ?? '')}`);

const afterGrant = await request('reader after the grant', `/${SLUG}/`, { jar: readerSession.jar });
ok('the reader can now read the record', afterGrant.status === 200 &&
  afterGrant.body.includes('must not be readable by a caller without an agreement'), String(afterGrant.status));

const adminScreen = await request('the grant screen', '/admin/access/', { jar: ownerSession.jar });
ok('the screen opens for the proprietor', adminScreen.status === 200, String(adminScreen.status));
const screenText = visibleText(adminScreen.body);
const stands = screenText.split('\n').find((l) => /agreement/.test(l) && /record/.test(l) && /published/.test(l));
say(`     the screen's own measurement: ${stands ?? '(not found)'}`);
const screenAsAdmin = await request('screen as dictionary admin', '/admin/access/', { jar: dictAdminSession.jar });
ok('the dictionary administrator is refused the screen', screenAsAdmin.status !== 200, String(screenAsAdmin.status));

const grantId = Number(/name="id" value="(\d+)"/.exec(adminScreen.body)?.[1] ?? 0);
ok('the screen hands the operator the reference the endpoint takes', grantId > 0, `grant id ${grantId}`);

const revokePost = await request('revoke', '/api/admin/access', {
  method: 'POST',
  jar: ownerSession.jar,
  form: { action: 'revoke', id: String(grantId), reason: 'The probe agreement has run its term.' },
});
ok('the proprietor withdraws it', /saved/.test(revokePost.location ?? ''), `${revokePost.status}`);

const afterRevoke = await request('reader after the withdrawal', `/${SLUG}/`, { jar: readerSession.jar });
ok('the reader is refused again', afterRevoke.status === 403, String(afterRevoke.status));
ok('and the refusal tells them the agreement was withdrawn rather than that the record vanished',
  afterRevoke.body.includes('has been withdrawn') && afterRevoke.body.includes('The probe agreement has run its term.'));
say('\n   WHAT THE PERSON WHO LOST ACCESS IS TOLD:');
const withdrawnText = visibleText(afterRevoke.body);
const start = withdrawnText.indexOf('An agreement you held has been withdrawn');
say(withdrawnText.slice(start, start + 460).split('\n').map((l) => `     ${l}`).join('\n'));

say('\n4. THE OTHER READ PATHS, MEASURED');

const ask = await request('ask', '/api/ask?q=agreement&lang=ibo', { method: 'GET' });
const search = await request('search', `/search?q=${encodeURIComponent('held by agreement')}`);
const sitemap = await request('sitemap', '/sitemap.xml');
ok('the search page answers, so the assertion below is about filtering and not about a 500',
  search.status === 200, `status ${search.status}`);
ok('a record held by agreement is not in its results', search.status === 200 && !search.body.includes(SLUG),
  `status ${search.status}`);
ok('the sitemap answers', sitemap.status === 200, `status ${sitemap.status}`);
ok('and the record is not in it', sitemap.status === 200 && !sitemap.body.includes(SLUG), `status ${sitemap.status}`);
ok('the ask endpoint answers', ask.status === 200, `status ${ask.status}`);
ok('and the knowledge corpus does not hold the gated words',
  ask.status === 200 && !ask.body.includes('must not be readable by a caller without an agreement'),
  `status ${ask.status}`);
say(`     /search -> ${search.status}, contains the gated slug: ${search.body.includes(SLUG)}`);
say(`     /sitemap.xml -> ${sitemap.status}, contains the gated slug: ${sitemap.body.includes(SLUG)}`);
say(`     /api/ask -> ${ask.status}, contains the gated body: ${ask.body.includes('must not be readable by a caller without an agreement')}`);

// ---------------------------------------------------------------------------
// Phase 4 — stop the server, then read the trail back out of the cluster.
// ---------------------------------------------------------------------------

say('\n5. THE TRAIL, READ BACK OUT OF THE CLUSTER AFTER THE SERVER HAS STOPPED');
await stopServer();
ok('the test server has left the cluster', server.exitCode !== null || server.killed, `exit=${server.exitCode}`);

const db2 = await getDb();
const stillThere = await db2.one(
  `select granted_at, granted_by, terms, revoked_at, revoked_by, revocation_reason
     from ozikoro_institutional_access where id = $1`,
  [grantId]
);
ok('the grant survives the withdrawal, with its date, its actor and its terms',
  stillThere !== null && stillThere.granted_at !== null && Number(stillThere.granted_by) === owner.id &&
    stillThere.terms === 'Consultation on the scratch cluster only.' && stillThere.revoked_at !== null,
  stillThere ? `revoked_by=${stillThere.revoked_by} reason="${stillThere.revocation_reason}"` : 'the row is gone');

const audit = await db2.rows(
  `select action, actor_id, before, after, note, created_at from ozikoro_audit
    where entity_type = 'ozikoro_institutional_access' and entity_id = $1 order by id`,
  [grantId]
);
say('\n   BOTH AUDIT ROWS, QUOTED:');
for (const row of audit) {
  say(`     ${new Date(row.created_at).toISOString()}  ${row.action}  actor=${row.actor_id}`);
  say(`       before ${JSON.stringify(row.before)}`);
  say(`       after  ${JSON.stringify(row.after)}`);
  say(`       note   ${row.note}`);
}
ok('the grant and the withdrawal are two audit rows, and neither erases the other',
  audit.length === 2 && audit.some((a) => a.action === 'grant_institutional_access') &&
    audit.some((a) => a.action === 'revoke_institutional_access'));

const tierAudit = await db2.rows(
  `select action, before, after from ozikoro_audit where entity_type = 'ozikoro_article' and entity_id = $1 order by id`,
  [Number(article.id)]
);
ok('placing the record in a tier is its own audit row',
  tierAudit.length === 1 && tierAudit[0].action === 'set_access_tier' &&
    JSON.stringify(tierAudit[0].after).includes('by_agreement'),
  JSON.stringify(tierAudit[0] ?? null));

say('\n6. HOW MANY RECORDS ARE HELD BY AGREEMENT');
const counts = await db2.one(
  `select count(*) filter (where access_tier = 'by_agreement')::int as gated,
          count(*) filter (where access_tier = 'by_agreement' and slug not like '${SUFFIX}-%')::int as gated_not_fixture,
          count(*) filter (where status = 'published' and not is_page)::int as published
     from ozikoro_article`
);
say(`     this scratch cluster: ${counts.gated} held by agreement of ${counts.published} published` +
  ` (of which ${counts.gated_not_fixture} are not this instrument's fixture)`);
ok('the only record held by agreement on this cluster is the instrument\'s own fixture', counts.gated_not_fixture === 0);

await cleanup(db2);
await closeDb();

// ---------------------------------------------------------------------------
// Phase 5 — the design deliverable, byte for byte.
// ---------------------------------------------------------------------------

say('\n7. THE DESIGN PARITY');
const source = 'design/calm-comfort-construct/public/design';
const served = 'apps/ozikoro/public/design';
let identical = 0, differing = 0, missing = 0;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
);
for (const file of walk(source)) {
  const counterpart = join(served, relative(source, file));
  if (!existsSync(counterpart)) missing += 1;
  else if (createHash('sha256').update(readFileSync(file)).digest('hex') ===
    createHash('sha256').update(readFileSync(counterpart)).digest('hex')) identical += 1;
  else differing += 1;
}
say(`     identical ${identical} differing ${differing} missing ${missing}`);
ok('the design deliverable is untouched', identical === 63 && differing === 0 && missing === 0);

say(`\n${failures === 0 ? '  PROBLEMS: 0' : `  PROBLEMS: ${failures}`}\n`);
process.exit(failures === 0 ? 0 : 1);
