/**
 * The user table, tested for the one distinction it exists to keep: **a login is not a byline.**
 *
 * ── WHY THIS TEST IS ABOUT A REFUSAL AS MUCH AS ABOUT A LIST ──────────────────────────────────────────
 *
 * The owner's report was *"i did not see the wordpress 15 users."* The bylines were in
 * `ozikoro_contributor` the whole time and the accounts that can sign in were in `account`, and the fault was
 * a screen that led with the second and named nothing about the first. **The repair must not be to move the
 * bylines into the accounts**: WordPress exposed no password hash, so an account created for one of them would
 * be access invented for somebody who never had it, which is a security decision and not a display one.
 *
 * So what is asserted here is that the two tables stay two: every byline carries how much it wrote and the
 * WordPress role it held, a byline is attached to an account **only** through `ozikoro_contributor.account_id`,
 * and a byline with no account is reported as a byline with no account. The last test reads the screen's own
 * source, because "the page must not present a contributor as a login account" is a claim about the page.
 *
 * ⚠️ **IT NEEDS THE PGLITE CLUSTER, SO THE REVIEW SERVER MUST BE STOPPED.** PGlite is single-process; this is
 * the same rule `test-knowledge.ts` and the `test-*.ts` scripts in this package follow.
 *
 * ⚠️ **AND THAT IS WHY IT IS `test-*.ts` AND NOT `*.test.ts`, WHICH IT WAS.** The `*.test.ts` glob is what
 * the root `test:unit` script gives to `node --test`, so CI ran this under a job named *"Typecheck and
 * database-free suites"* — where it failed for two separate reasons, neither of them the code under test:
 * the runner has no `.data/pg` at all, and on a developer's machine the review server holds the single-process
 * cluster (measured: *"REFUSING TO OPEN THE PGLITE CLUSTER: ANOTHER PROCESS HOLDS IT"*). Even with a cluster
 * present it asserts on data — *"the archive credits no contributors at all"* is what a freshly migrated,
 * empty one answers — because the bylines come from the WordPress import, which is not committed. It now runs
 * with the rest of the real-archive suites in `test:ozikoro-data`.
 *
 * Run with: npm -w @ozikoro/platform run test:users
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from '@ozituma/db/client';
import { getUserOverview, listContributors, listUserAccounts } from './users.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const USERS_PAGE = resolve(REPO_ROOT, 'apps', 'ozikoro', 'app', 'admin', 'users', 'page.tsx');

/** WordPress's five built-in roles. A `wp_role` outside this set would be one the archive cannot explain. */
const WP_ROLES = ['administrator', 'editor', 'author', 'contributor', 'subscriber'];

const db = await getDb();
after(async () => {
  await closeDb();
});

test('every byline is listed, with the record count a direct count(*) gives', async () => {
  const overview = await getUserOverview(db);
  const { contributors, total } = await listContributors(db, { limit: 200 });

  assert.ok(overview.contributors > 0, 'the archive credits no contributors at all');
  assert.equal(total, overview.contributors, 'the list is a page of the table rather than the table');
  assert.equal(contributors.length, total, 'not every byline is returned at limit 200');
  assert.ok(
    contributors.every((c) => c.displayName.trim().length > 0),
    'a byline was listed with no name'
  );

  /*
   * THE COUNTS, CHECKED AGAINST A SECOND QUERY RATHER THAN AGAINST THEMSELVES.
   *
   * The screen's rule is that no number on it is invented, so the count it prints is compared here with a
   * `count(*)` written independently in this file. A test that re-used the library's own subquery would pass
   * whatever the library got wrong.
   */
  const direct = new Map<number, number>();
  for (const row of await db.rows<{ id: string; n: number }>(
    `select k.id::text as id, (select count(*)::int from ozikoro_article a where a.author_id = k.id) as n
       from ozikoro_contributor k`
  )) {
    direct.set(Number(row.id), Number(row.n));
  }
  assert.equal(direct.size, contributors.length, 'the count query and the list disagree about who exists');
  for (const c of contributors) {
    assert.equal(c.articles, direct.get(c.id), `${c.displayName}: the screen would print the wrong count`);
  }
});

test('the WordPress roles are recorded, and the bucket with none is reported rather than dropped', async () => {
  const overview = await getUserOverview(db);
  const { contributors } = await listContributors(db, { limit: 200 });

  for (const c of contributors) {
    assert.ok(
      c.wpRole === null || WP_ROLES.includes(c.wpRole),
      `${c.displayName} holds a role outside WordPress's five: ${c.wpRole}`
    );
  }

  const bucketed = overview.wpRoles.reduce((sum, entry) => sum + entry.contributors, 0);
  assert.equal(bucketed, overview.contributors, 'the role breakdown does not account for every byline');

  /*
   * The records in the buckets are compared with the records that have a byline at all. A record with
   * `author_id is null` belongs to no bucket and to no byline, and a breakdown that claimed it would be
   * crediting somebody with something nobody is credited for.
   */
  const authored = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_article where author_id is not null`
  );
  const bucketedArticles = overview.wpRoles.reduce((sum, entry) => sum + entry.articles, 0);
  assert.equal(bucketedArticles, Number(authored?.n ?? -1), 'the breakdown double-counts or loses records');

  assert.ok(
    overview.wpRoles.some((entry) => entry.contributors > 0),
    'the breakdown is empty, so the page would say nothing about what the bylines were'
  );
});

test('a byline with no account is not presented as a login', async () => {
  const overview = await getUserOverview(db);
  const { contributors } = await listContributors(db, { limit: 200 });

  assert.equal(
    overview.contributorsWithAccount + overview.contributorsWithoutAccount,
    overview.contributors,
    'signed-in and not-signed-in bylines do not add up to the whole table'
  );

  const dangling = await db.rows<{ id: string }>(
    `select k.id::text as id from ozikoro_contributor k
      where k.account_id is not null
        and not exists (select 1 from account a where a.id = k.account_id)`
  );
  assert.equal(dangling.length, 0, 'a byline is linked to an account that does not exist');

  const unlinked = contributors.filter((c) => c.accountId === null);
  assert.ok(unlinked.length > 0, 'every byline has an account, so this archive cannot show the distinction');
  assert.ok(
    unlinked.every((c) => c.accountEmail === null),
    'a byline with no account was given an address to sign in with'
  );

  const filtered = await listContributors(db, { owner: 'unlinked', limit: 200 });
  assert.ok(
    filtered.contributors.every((c) => c.accountId === null),
    'the "No account" filter returned a byline that has one'
  );
  assert.equal(filtered.total, overview.contributorsWithoutAccount, 'the filter and the count disagree');
});

test('the accounts list is the account table, and no byline has been added to it', async () => {
  const accounts = await listUserAccounts(db, { limit: 200 });
  const rows = await db.one<{ n: number }>(`select count(*)::int as n from account`);

  assert.equal(accounts.total, Number(rows?.n ?? -1), 'the screen lists something other than the accounts');
  assert.ok(
    accounts.accounts.every((a) => a.email.includes('@')),
    'an account row is a byline in disguise: it has no address and cannot sign in'
  );
});

test('the screen keeps the two lists apart and offers no way to create an account', async () => {
  /*
   * ⚠️ THIS IS A DRIFT GUARD AND IS NARROWER THAN THE TESTS ABOVE. It cannot render a React server component
   * without a request, so it asserts the shape of the markup: the contributors table carries the record count
   * and the WordPress role and a column that answers "can sign in", the byline list is the one the page opens
   * on, and the page has no code path that could create an account. **The rendered page was verified
   * separately, over HTTP, against a running server** — see the round's report.
   */
  const page = readFileSync(USERS_PAGE, 'utf8');

  assert.ok(page.includes('<th scope="col">Records</th>'), 'the contributors table does not show what they wrote');
  assert.ok(page.includes('<th scope="col">On WordPress</th>'), 'the contributors table does not show the role');
  assert.ok(
    page.includes('<th scope="col">Can sign in</th>') && page.includes('No account — cannot sign in'),
    'the screen does not answer whether anybody behind a byline can sign in'
  );
  assert.ok(
    page.indexOf("value: 'contributors'") < page.indexOf("value: 'accounts'"),
    'the screen does not open on the bylines'
  );
  assert.ok(
    page.includes('a record and not an access level'),
    'the WordPress role is not described as a record rather than an access level'
  );

  /*
   * A screen that could create an account would be the one place a mis-click mails a stranger a password, and
   * it is exactly the repair this round must NOT make. These are the call shapes that would do it.
   */
  const creators = ['registerAccount', 'createAccount', 'insert into account', 'createOwner'];
  const found = creators.filter((needle) => page.includes(needle));
  assert.deepEqual(found, [], `the screen has a path that could create an account: ${found.join(', ')}`);
});
