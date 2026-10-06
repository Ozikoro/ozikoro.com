/**
 * The site-verification tokens: the tag on every page, the empty case, the escaping, and who may set one.
 *
 * ── WHY THIS FILE EXISTS, AND WHAT IT IS WRITTEN TO CATCH ────────────────────────────────────────────
 *
 * The owner asked for Yoast's site-verification tab, which is one feature with four ways to get it wrong and
 * each of them was worth writing down:
 *
 *   1. **A TOKEN THAT REACHES SOME PAGES AND NOT OTHERS.** `seoHead` has more than one caller — the fifty-two
 *      design screens, the record route, the transcript route and the institutional-access refusal — and a
 *      feature added to one caller is a feature that works on the page it was tested on. So the head is built
 *      here for FOUR page kinds, and a fifth test reads the application's own source to prove every caller
 *      hands the tokens over.
 *   2. **AN EMPTY `<meta content="">` TAG.** A verification tag with no content is worse than none: it claims
 *      a verification that cannot succeed. Asserted twice, because there are two ways to reach it — a token
 *      that is absent, and a token that is present but blank.
 *   3. **AN OWNER-SUPPLIED VALUE IN AN HTML ATTRIBUTE.** A token is text a person pastes, so `"><script>` is
 *      a paste that will eventually be tried. Two layers answer it and both are asserted: the shape check
 *      REFUSES such a value, and the emitter ESCAPES whatever it is given.
 *   4. **A GATE ON NOTHING.** The screen and its endpoint ask for `manage_design`; the test proves that a
 *      plain reader does not hold it and the owner does, by asking the database rather than by reading the
 *      table.
 *
 * ── WHAT IS PURE AND WHAT NEEDS A DATABASE ───────────────────────────────────────────────────────────
 *
 * The tag, the paste reader, the escaping and the empty case are pure and run anywhere. The gate and the
 * stored row need Postgres, so they are exercised against the same local cluster every other
 * `test-*.ts` script in this package uses — **point it at a scratch cluster with `OZITUMA_DB_PATH` and it
 * touches nothing that matters** (`accounts.ts` reads that variable for the same reason).
 *
 * Run with: npm -w @ozikoro/platform run test:seo-verification
 * It is also picked up by `npm -w @ozikoro/platform run test` (`node --test src/*.test.ts`), which is part of
 * `npm run test:ozikoro`. The database half skips itself, by name, when the review server holds the cluster.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '@ozituma/db/client';
import { seoHead } from './seo-head.ts';
import {
  OTHER_ENGINE_ID,
  VERIFY_ENGINES,
  VERIFY_KEY_PREFIX,
  engineById,
  loadSeoVerification,
  readPastedToken,
  resolveMetaName,
  setSeoVerification,
  tokenProblem,
  verificationTags,
  verifyKey,
  type SiteVerification,
} from './seo-verification.ts';

/* ================================================================================================
 * 1. THE TAG, ON FOUR KINDS OF PAGE
 * ============================================================================================== */

/**
 * THE FOUR ENGINES THE OWNER NAMED, with obviously-synthetic tokens.
 *
 * **These are not, and must never be, real tokens.** They are the shape of a token — a 43-character base64ish
 * string for Google, a 32-character GUID for Bing — with `TESTONLY` in them, so a reader of a served page or
 * of this file can tell in one glance that nothing here is a credential. A verification token that is real is
 * a credential: anybody holding it can claim this site to the search engine that issued it.
 */
const FOUR: SiteVerification[] = [
  {
    engineId: 'google',
    metaName: 'google-site-verification',
    token: 'TESTONLY-not-a-real-google-token-000000000000',
    label: null, actorId: null, actorName: null, updatedAt: null,
  },
  {
    engineId: 'bing',
    metaName: 'msvalidate.01',
    token: 'TESTONLY0000000000000000000000000',
    label: null, actorId: null, actorName: null, updatedAt: null,
  },
  {
    engineId: 'yandex',
    metaName: 'yandex-verification',
    token: 'TESTONLY0000000000',
    label: null, actorId: null, actorName: null, updatedAt: null,
  },
  {
    engineId: 'baidu',
    metaName: 'baidu-site-verification',
    token: 'TESTONLYcode-0000000000000000',
    label: null, actorId: null, actorName: null, updatedAt: null,
  },
];

/** The four page kinds the archive actually serves, each with the record the head is built from. */
const PAGE_KINDS = [
  { what: 'the front page', record: { path: '/', title: 'Ozikoro — the archive of Igbo and African histories', description: null, kind: 'page' as const } },
  { what: 'a record', record: { path: '/ute-okpu/', title: 'Ute-Okpu', description: 'A history held by the archive.', kind: 'article' as const, author: 'A contributor', reference: 'OZ-H-0001' } },
  { what: 'a topic', record: { path: '/topics/warfare/', title: 'Warfare', description: null, kind: 'list' as const } },
  { what: 'a documents page', record: { path: '/documents/', title: 'Documents', description: null, kind: 'page' as const } },
];

test('every engine’s tag is emitted on every kind of page the archive serves', () => {
  for (const { what, record } of PAGE_KINDS) {
    const head = seoHead(record, ['/design/styles/main.css'], FOUR);
    for (const entry of FOUR) {
      assert.ok(
        head.includes(`<meta name="${entry.metaName}" content="${entry.token}">`),
        `${what} did not carry ${entry.metaName}; a token that reaches some pages and not others is the fault this test exists for`
      );
    }
    assert.equal(
      (head.match(/<meta name="(google-site-verification|msvalidate\.01|yandex-verification|baidu-site-verification)"/g) ?? []).length,
      4,
      `${what} did not carry exactly the four tags`
    );
  }
});

test('the token sits in the head, beside robots and before the social tags', () => {
  const head = seoHead(PAGE_KINDS[0]!.record, [], FOUR);
  const robots = head.indexOf('<meta name="robots"');
  const verify = head.indexOf('<meta name="google-site-verification"');
  const og = head.indexOf('<meta property="og:site_name"');
  assert.ok(robots > -1 && verify > robots, 'the verification tags come before robots, where a crawler reads least');
  assert.ok(og > verify, 'the verification tags come after the social tags, further from the top of the head');
});

/* ================================================================================================
 * 2. AN EMPTY SETTING IS A REAL SETTING
 * ============================================================================================== */

test('nothing is emitted when nothing is stored — and no empty tag can be produced', () => {
  const head = seoHead(PAGE_KINDS[0]!.record, []);
  assert.doesNotMatch(head, /google-site-verification|msvalidate|yandex-verification|baidu-site-verification|p:domain_verify|facebook-domain-verification|naver-site-verification|ahrefs-site-verification/);
  assert.doesNotMatch(head, /content=""/, 'an empty content attribute was emitted');

  assert.deepEqual(verificationTags([]), []);

  /*
   * A STORED ROW THAT IS HALF-WRITTEN IS ALSO NOTHING. A row with a blank token, or with no name, is skipped
   * rather than turned into `<meta name="" content="">` — which is what a hand-written SQL insert, or a
   * future migration, could leave behind.
   */
  const blanks: SiteVerification[] = [
    { engineId: 'google', metaName: 'google-site-verification', token: '', label: null, actorId: null, actorName: null, updatedAt: null },
    { engineId: 'bing', metaName: 'msvalidate.01', token: '   ', label: null, actorId: null, actorName: null, updatedAt: null },
    { engineId: 'yandex', metaName: '', token: 'TESTONLY0000', label: null, actorId: null, actorName: null, updatedAt: null },
    { engineId: 'baidu', metaName: '   ', token: 'TESTONLY0000', label: null, actorId: null, actorName: null, updatedAt: null },
  ];
  assert.deepEqual(verificationTags(blanks), [], 'a half-written row produced a tag');
  const blankHead = seoHead(PAGE_KINDS[1]!.record, [], blanks);
  assert.doesNotMatch(blankHead, /site-verification|msvalidate/, 'a half-written row reached a served head');
  assert.doesNotMatch(blankHead, /content=""/);
});

test('a blank paste is refused rather than stored as an empty token', () => {
  for (const pasted of ['', '   ', '\n\t ']) {
    const read = readPastedToken(pasted);
    assert.equal(read.token, '', `"${pasted}" produced a token`);
    assert.ok(read.problem, 'a blank paste was accepted without a reason');
  }
  assert.ok(tokenProblem(''), 'an empty token passed the shape check');
});

/* ================================================================================================
 * 3. WHAT THE OWNER PASTES — THE TAG, THE TOKEN, AND THE HOSTILE VALUE
 * ============================================================================================== */

test('a pasted meta tag is read for its token, and the engine it names is recognised', () => {
  const google = readPastedToken('<meta name="google-site-verification" content="TESTONLY-abc_123-000" />');
  assert.equal(google.token, 'TESTONLY-abc_123-000');
  assert.equal(google.fromTag, true);
  assert.equal(google.detected?.id, 'google');
  assert.equal(google.problem, null);

  const bing = readPastedToken('<meta name="msvalidate.01" content="TESTONLY0000000000000000000000000">');
  assert.equal(bing.token, 'TESTONLY0000000000000000000000000');
  assert.equal(bing.detected?.id, 'bing');

  // Single quotes, a bare content attribute, and the value on its own all arrive from real screens.
  assert.equal(readPastedToken("<meta name='yandex-verification' content='TESTONLY0000'>").token, 'TESTONLY0000');
  assert.equal(readPastedToken('content="TESTONLY0000"').token, 'TESTONLY0000');
  assert.equal(readPastedToken('TESTONLY0000').token, 'TESTONLY0000');
  assert.equal(readPastedToken('  "TESTONLY0000"  ').token, 'TESTONLY0000');
  assert.equal(readPastedToken('TESTONLY0000').fromTag, false);

  // The trailing space a copy from a browser's page brings along is the commonest silent failure, so it goes.
  assert.equal(readPastedToken('<meta name="google-site-verification" content="TESTONLY0000 ">').token, 'TESTONLY0000');
  assert.equal(readPastedToken('  TESTONLY0000\n').token, 'TESTONLY0000');

  // A tag with no content attribute yields nothing AND says why, rather than being stored as a "token".
  const empty = readPastedToken('<meta name="google-site-verification">');
  assert.equal(empty.token, '');
  assert.ok(empty.problem && /content/.test(empty.problem), 'a contentless tag was accepted');
});

test('an entity-encoded token is decoded once, and never twice', () => {
  // The one that matters in practice: a token carrying a query string arrives with `&amp;` in it, and the
  // stored value — and therefore the emitted attribute — must hold a single `&`, which the emitter escapes.
  const queryToken = readPastedToken('<meta name="x" content="abc&amp;key=def">');
  assert.equal(queryToken.token, 'abc&key=def');
  assert.equal(queryToken.problem, null);
  assert.equal(verificationTags([{ engineId: 'x', metaName: 'x', token: queryToken.token, label: null, actorId: null, actorName: null, updatedAt: null }])[0], '<meta name="x" content="abc&amp;key=def">');

  /*
   * AND THE DECODE CANNOT BE WALKED TWICE. `&amp;lt;` is the literal text `&lt;`; a second pass would make it
   * a real `<` and this is the assertion that would fail if one were ever added. The intermediate value is
   * refused by the shape check as well, which is the second half of the same answer.
   */
  const doubleEncoded = readPastedToken('<meta name="x" content="a&amp;lt;b">');
  assert.equal(doubleEncoded.token, '');
  assert.ok(doubleEncoded.problem, 'a value that decodes to markup was accepted');
  assert.doesNotMatch(String(doubleEncoded.token), /</);
});

test('a hostile value is refused by the shape check, and escaped by the emitter', () => {
  const hostile = [
    '"><script>alert(1)</script>',
    '" onload="alert(1)',
    "'><img src=x onerror=alert(1)>",
    'abc"def',
    'abc<def',
    'abc>def',
    'abc`def',
    'abc def',
    `abc${'x'.repeat(300)}`,
  ];
  for (const value of hostile) {
    assert.ok(tokenProblem(value), `the shape check accepted ${JSON.stringify(value.slice(0, 40))}`);
  }

  /*
   * AND THE SECOND LAYER, TESTED WITHOUT THE FIRST. `verificationTags` is handed a value that got past a
   * hypothetical future reader, and it must still not be able to leave the attribute. This is the assertion
   * that survives somebody later loosening `tokenProblem`.
   */
  const dangerous: SiteVerification[] = [
    { engineId: 'evil', metaName: 'evil', token: '"><script>alert(1)</script>', label: null, actorId: null, actorName: null, updatedAt: null },
    { engineId: 'evil2', metaName: 'ev"il', token: 'ok-token', label: null, actorId: null, actorName: null, updatedAt: null },
  ];
  const tags = verificationTags(dangerous);
  assert.equal(tags.length, 1, 'a name that is not a meta name was emitted');
  assert.doesNotMatch(tags[0]!, /<script/i, 'a script tag was emitted into the head');
  assert.equal(tags[0], '<meta name="evil" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">');

  // And in a real head, so the escaping is asserted where it is actually used.
  const head = seoHead(PAGE_KINDS[0]!.record, [], dangerous);
  const line = head.split('\n').find((row) => row.includes('name="evil"')) ?? '';
  assert.ok(line.length > 0, 'the tag is missing from the head');
  assert.doesNotMatch(head.split('<script type="application/ld+json">')[0]!, /<script>alert/, 'a raw script reached the head');
  assert.ok(line.endsWith('">'), 'the attribute was not closed by the emitter');
});

test('a pasted tag whose content is hostile extracts nothing', () => {
  const read = readPastedToken('<meta name="google-site-verification" content=""><script>alert(1)</script>">');
  assert.equal(read.token, '');
  assert.ok(read.problem);
});

test('a custom engine still needs a usable name, or nothing is emitted', () => {
  assert.equal(engineById(OTHER_ENGINE_ID)?.id, OTHER_ENGINE_ID);
  assert.equal(engineById('google')?.metaName, 'google-site-verification');
  assert.equal(engineById('nope'), null);

  const noName = resolveMetaName({ engineId: OTHER_ENGINE_ID, detected: null, pastedMetaName: null, customName: '' });
  assert.ok(noName.problem && noName.metaName === null, 'a nameless custom engine was accepted');

  const badName = resolveMetaName({ engineId: OTHER_ENGINE_ID, detected: null, pastedMetaName: null, customName: 'a"b' });
  assert.ok(badName.problem && badName.metaName === null);

  const good = resolveMetaName({ engineId: OTHER_ENGINE_ID, detected: null, pastedMetaName: null, customName: 'example-site-verification' });
  assert.equal(good.metaName, 'example-site-verification');

  // A pasted tag's own name wins even for an engine the catalogue does not know.
  const fromTag = resolveMetaName({ engineId: OTHER_ENGINE_ID, detected: null, pastedMetaName: 'some-new-engine-verification', customName: null });
  assert.equal(fromTag.metaName, 'some-new-engine-verification');
});

test('every catalogue engine has a key, a label and a real meta name', () => {
  for (const engine of VERIFY_ENGINES) {
    assert.ok(/^[a-z0-9-]+$/.test(engine.id), `${engine.id} is not usable as a setting key`);
    assert.ok(/^[A-Za-z0-9._:-]+$/.test(engine.metaName), `${engine.id} has no usable meta name`);
    assert.ok(engine.label.length > 0 && engine.note.length > 0, `${engine.id} is missing its words`);
    assert.equal(verifyKey(engine.id), `${VERIFY_KEY_PREFIX}${engine.id}`);
  }
  // The keys the catalogue writes are unique, or one engine's token would overwrite another's.
  assert.equal(new Set(VERIFY_ENGINES.map((engine) => verifyKey(engine.id))).size, VERIFY_ENGINES.length);
});

/* ================================================================================================
 * 4. EVERY CALLER HANDS THE TOKENS OVER
 * ============================================================================================== */

/**
 * The application's own directory, and the workspace root, resolved from THIS file rather than from the
 * working directory: npm workspaces run a package's scripts with the package as `cwd`, so a relative path
 * would look for `apps/ozikoro` inside `packages/ozikoro`.
 */
const APP_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'apps', 'ozikoro');
const WORKSPACE = join(APP_DIR, '..', '..');

test('every head builder in the app is given the verification tokens', async () => {
  /*
   * WHY THIS READS THE SOURCE.
   *
   * `seoHead` is where a token reaches a page, and it is passed in rather than fetched because the builder is
   * synchronous and pure. **The cost of that design is that a new caller can forget the third argument**, and
   * the symptom would be a token on the front page and not on the 1,051 records — invisible in every test
   * that only builds a head. So each file that builds a head must also name `loadSeoVerification` (or be
   * handed it), and this fails by name if one does not.
   *
   * ── ⚠️ THIS MATCHES A CALL, NOT A MENTION, AND IT USED TO MATCH A MENTION ──────────────────────────
   *
   * The check was `source.includes('seoHead(')`, which is true of **a comment or a double-quoted read note that
   * names the function** as well as of a call to it. That is fine until a screen documents where a value is read
   * — `app/admin/seo/titles/` says *"packages/ozikoro/src/seo-head.ts — seoHead(), through resolveTitle()"* in a
   * field's read note — and then a file that builds no head at all is reported as one that serves no
   * verification tag. **A guard that fires on documentation is a guard that gets weakened the next time it is
   * inconvenient**, so comments AND string literals are removed before the call pattern is tested. What is left
   * is the code, and the three real call sites are still there.
   *
   * THE SCANNER IS DELIBERATELY SMALL. A regex cannot strip a string that contains a comment marker, which is
   * exactly the shape this repository writes — `'compiled to ^(?:\\/([^\\/#\\?]+?))…'` — so this walks the
   * characters once, tracking one quote at a time and honouring backslash escapes. It is not a parser; it is
   * enough to tell a call from a sentence, and it errs by removing too much rather than too little, which is the
   * safe direction for a guard that only ever reports a MISSING argument.
   */
  const codeOnly = (source: string): string => {
    let out = '';
    let index = 0;
    /** The quote character currently open, or null. */
    let quote: string | null = null;
    while (index < source.length) {
      const here = source[index]!;
      const next = source[index + 1];
      if (quote) {
        if (here === '\\') {
          out += ' ';
          index += 2;
          continue;
        }
        if (here === quote) quote = null;
        out += here === '\n' ? '\n' : ' ';
        index += 1;
        continue;
      }
      if (here === '/' && next === '/') {
        while (index < source.length && source[index] !== '\n') index += 1;
        continue;
      }
      if (here === '/' && next === '*') {
        index += 2;
        while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
        index += 2;
        continue;
      }
      if (here === '"' || here === "'" || here === '`') {
        quote = here;
        out += ' ';
        index += 1;
        continue;
      }
      out += here;
      index += 1;
    }
    return out;
  };

  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.next') || entry.name === 'public') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  await walk(APP_DIR);

  /**
   * The head-building FUNCTIONS, and anything that takes a head. A picture of the call rather than of the
   * word: `seoHead(` with a whitespace-tolerant run-up to the parenthesis, which is how every real call in this
   * application is written.
   */
  const HEAD_CALL = /\b(seoHead|agreementRefusalDocument|withSeoHead)\s*\(/;
  const builders = files.filter((file) => HEAD_CALL.test(codeOnly(readFileSync(file, 'utf8'))));
  assert.ok(
    builders.length >= 3,
    `expected several callers of seoHead, found ${builders.length} — the call pattern may have stopped matching real call sites`
  );
  for (const file of builders) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      source.includes('loadSeoVerification') || source.includes('verification:') || source.includes('verification ??'),
      `${file.slice(APP_DIR.length + 1)} builds a head without the verification tokens — that page would serve no verification tag`
    );
  }
});

/* ================================================================================================
 * 5. THE GATE — WHO MAY SET ONE. THIS ONE ASKS THE REAL DATABASE.
 * ============================================================================================== */

/**
 * The gate is `manage_design`, and it is asserted against the database rather than read out of this file.
 *
 * The page and the endpoint both call `requireCapabilityOrRedirect('manage_design', …)` /
 * `guardNarration(input, 'manage_design')`. What this test proves is the part those two depend on: **the
 * owner's own account holds the capability by the role the database resolves, and a plain reader does not** —
 * so a non-owner is refused by the very rule the guard asks, and not only by a hidden link.
 *
 * It also proves the rows are real rows: a token saved through the write path comes back out of
 * `loadSeoVerification` with its meta name, and clearing it removes it rather than leaving a blank one.
 */
/**
 * The process holding a cluster's lock, or null when it is free.
 *
 * `packages/db/src/cluster-lock.ts` writes `<dataDir>.lock` holding the holder's pid, its start time and its
 * argv, and reclaims it automatically when that pid is gone. This reads the same record for the same reason
 * a person reads the refusal: to find out BEFORE opening the cluster whether somebody else has it.
 */
function holderOf(dataDir: string): { pid: number; argv: string[] } | null {
  try {
    const parsed = JSON.parse(readFileSync(`${join(resolve(dataDir))}.lock`, 'utf8')) as { pid?: number; argv?: string[] };
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    try {
      process.kill(parsed.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') return null;
    }
    return { pid: parsed.pid, argv: Array.isArray(parsed.argv) ? parsed.argv.filter((a): a is string => typeof a === 'string') : [] };
  } catch {
    return null;
  }
}

test('the owner holds the gate and a reader does not; a token round-trips and clears', async (t) => {
  /*
   * IF ANOTHER PROCESS HOLDS THE CLUSTER, THIS SKIPS RATHER THAN FAILS.
   *
   * PGlite is single-process and `getDb` REFUSES BY EXITING when the lock is held — which is the right
   * behaviour for a script and a hard failure for a test runner. The review server holds `.data/pg` for as
   * long as it runs, so a suite that opened it anyway would report a red test for a database that is
   * perfectly healthy and simply busy. So the lock is asked about FIRST, by name, and the skip says which
   * process holds it. The pure tests above need no database and always run.
   */
  /*
   * THE DIRECTORY IS RESOLVED THE WAY `getDb` RESOLVES IT — including `OZITUMA_DB_PATH`, which is how this
   * suite is pointed at a cluster of its own — or the guard would check the wrong lock: against a scratch
   * cluster it would see the review server's lock and skip a database that is sitting right there. A
   * connection string is not locked at all (a real Postgres handles its own concurrency), so that case goes
   * straight through.
   *
   * READ HERE RATHER THAN THROUGH THE DATABASE PACKAGE ON PURPOSE. The lock file is a documented one-line
   * JSON record beside the cluster (`<dir>.lock`), and reading it costs six lines; adding an export to
   * `@ozituma/db` for it would mean committing a shared file that another agent is editing tonight.
   */
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) {
    const dataDir = process.env.OZITUMA_DB_PATH || join(WORKSPACE, '.data', 'pg');
    const held = dataDir.includes('://') ? null : holderOf(dataDir);
    if (held) {
      t.skip(`the database is held by pid ${held.pid} (${held.argv[held.argv.length - 1] ?? 'unknown command'}), so this test cannot open it`);
      return;
    }
  }

  let db: Db;
  try {
    const { getDb } = await import('@ozituma/db/client');
    db = await getDb();
  } catch (error) {
    t.skip(`no database available: ${String(error).slice(0, 120)}`);
    return;
  }

  const SUFFIX = 'zztest-seo-verification';
  const { can } = await import('./members.ts');
  /*
   * THE OWNER, MADE IF THE CLUSTER HAS NONE.
   *
   * The archive holds exactly one `account.role = 'owner'` account in production and the guard is gated so
   * that ONLY it (and the administrator) can set a verification token. A scratch cluster replayed from the
   * migrations holds no accounts at all — so a test that required one would only ever run against the live
   * database, which is the wrong place for it. This makes a probe owner instead, which measures the SAME
   * rule: an account whose `account.role` is `owner` resolves the admin and owner capability rows through
   * `ozikoro_capabilities`, and that is the fact the guard depends on.
   */
  const probe = await db.one<{ id: number }>(`select id from account where email = $1`, [`${SUFFIX}-owner@example.invalid`]);
  const ownerId = probe
    ? Number(probe.id)
    : Number((await db.one<{ id: number }>(
        `insert into account (email, display_name, role) values ($1, $2, 'owner') returning id`,
        [`${SUFFIX}-owner@example.invalid`, 'probe owner']
      ))!.id);
  const owner = { id: ownerId };

  try {
    assert.ok(owner, 'this database has no owner account, so the gate cannot be measured');
    assert.equal(await can(db, ownerId, 'manage_design'), true, 'the owner does not hold manage_design, so the only owner could not open the screen');

    // A plain account, made for this test and removed by it. `registerAccount` cannot make an owner, and
    // this must NOT be one: the point is that a non-owner is refused. `contributor` is the platform's own
    // lowest role (migration 0001) and holds no Ozikoro capability at all.
    const existing = await db.one<{ id: number }>(`select id from account where email = $1`, [`${SUFFIX}@example.invalid`]);
    const readerId = existing
      ? Number(existing.id)
      : Number((await db.one<{ id: number }>(
          `insert into account (email, display_name, role) values ($1, $2, 'contributor') returning id`,
          [`${SUFFIX}@example.invalid`, 'probe non-owner']
        ))!.id);
    assert.equal(await can(db, readerId, 'manage_design'), false, 'a plain account holds manage_design, so a non-owner could set a verification token');

    // The round trip: one engine, saved, read back, and cleared.
    const saved = await setSeoVerification(db, {
      engineId: 'google',
      metaName: 'google-site-verification',
      token: 'TESTONLY-roundtrip-000000000000000000',
      actorId: ownerId,
    });
    assert.equal(saved.cleared, false);
    assert.equal(saved.stored?.metaName, 'google-site-verification');

    const inForce = await loadSeoVerification(db);
    const google = inForce.find((entry) => entry.engineId === 'google');
    assert.equal(google?.token, 'TESTONLY-roundtrip-000000000000000000');
    assert.equal(verificationTags(inForce).length >= 1, true);

    // The audit row exists, names the engine, and does NOT carry the token.
    const audit = await db.rows<{ action: string; note: string | null; after: unknown }>(
      `select action, note, after from ozikoro_audit
        where entity_type = 'site_verification_token' and actor_id = $1
        order by id desc limit 1`,
      [ownerId]
    );
    assert.ok(audit.length === 1, 'the save wrote no audit row');
    assert.match(String(audit[0]!.note ?? ''), /google/, 'the audit row does not name the engine');
    assert.doesNotMatch(JSON.stringify(audit[0]!.after ?? {}), /TESTONLY-roundtrip/, 'the token was written into the audit trail');

    // Clearing removes the row, so no tag is emitted for it. This is the "empty setting is a real setting"
    // rule at the write end: a clear is a DELETE, not a row holding an empty string.
    const cleared = await setSeoVerification(db, {
      engineId: 'google',
      metaName: 'google-site-verification',
      token: null,
      actorId: ownerId,
    });
    assert.equal(cleared.cleared, true);
    assert.equal((await loadSeoVerification(db)).find((entry) => entry.engineId === 'google'), undefined, 'the cleared token is still in force');
    assert.deepEqual(verificationTags(await loadSeoVerification(db)).filter((tag) => tag.includes('google-site-verification')), []);
  } finally {
    // The test's own rows, and nothing else. Scoped by the probe addresses and by the key prefix.
    await db.query(`delete from site_setting where key = $1`, [verifyKey('google')]).catch(() => {});
    await db.query(`delete from ozikoro_audit where entity_type = 'site_verification_token' and actor_id = $1`, [ownerId]).catch(() => {});
    await db.query(`delete from account where email = $1 or email = $2`, [`${SUFFIX}@example.invalid`, `${SUFFIX}-owner@example.invalid`]).catch(() => {});
  }
});
