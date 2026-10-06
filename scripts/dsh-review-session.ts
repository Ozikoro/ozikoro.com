/**
 * Mint a LOCAL review session for the account that holds `manage_design`.
 *
 * WHY THIS EXISTS: every admin screen on this site is behind a capability, and the design editor's gate is
 * `manage_design`. Reviewing it therefore needs a real session cookie, and minting one by signing in through
 * the browser needs the account's password, which nobody has written down here.
 *
 * IT DOES NOT CREATE OR MODIFY AN ACCOUNT. It reads the account that already holds the capability out of the
 * database and writes one `auth_session` row for it — the same row `signin` writes — then prints the cookie.
 * **The database it touches is `.data/pg`, the local PGlite cluster, and never a host.**
 *
 * Stop the server before running it: PGlite is single-process.
 *
 *   node scripts/dsh-review-session.ts              # the first account that holds manage_design
 *   node scripts/dsh-review-session.ts <email>      # a named one
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { SESSION_COOKIE, createSession } from '@ozituma/db/accounts';

const wanted = process.argv[2]?.trim().toLowerCase() ?? null;

const db = await getDb();

/*
 * THE CAPABILITY IS ASKED OF THE DATABASE, NOT ASSUMED FROM A ROLE NAME.
 *
 * `ozikoro_capabilities(account_id)` is what `can()` reads, so asking it here means this script cannot mint a
 * session for an account the screens would then refuse. The owner holds `manage_design` through `owner`;
 * migration 0055 grants it to `editor` as well.
 *
 * IT IS CALLED PER ACCOUNT RATHER THAN FILTERED IN SQL, AND THAT IS NOT AN OVERSIGHT. Postgres refuses a
 * set-returning function in a `WHERE` clause — measured, verbatim: *"set-returning functions are not allowed
 * in WHERE / routine: check_srf_call_placement"* — so the filter is applied to the answer rather than to the
 * query. The table holds a handful of accounts; the whole set is read and each one's capabilities resolved.
 */
const accounts = await db.rows<{ id: number; email: string; role: string | null }>(
  `select a.id, a.email, a.role from account a where ($1::text is null or lower(a.email) = $1) order by a.id`,
  [wanted]
);

const rows: { id: number; email: string; role: string | null }[] = [];
for (const candidate of accounts) {
  const capabilities = await db.rows<{ capability: string }>(`select ozikoro_capabilities($1) as capability`, [candidate.id]);
  if (capabilities.some((row) => row.capability === 'manage_design')) rows.push(candidate);
}

if (rows.length === 0) {
  console.error(
    wanted
      ? `No account ${wanted} holds manage_design on this database, so there is nothing to sign in as.`
      : 'No account on this database holds manage_design. Run `npm run check:capabilities` to see who holds what.'
  );
  await closeDb();
  process.exit(1);
}

const account = rows[0]!;
const { token, expiresAt } = await createSession(db, account.id, {
  userAgent: 'dsh-review-session',
  ipAddress: '127.0.0.1',
});

console.log(`account   ${account.id}  ${account.email}  role=${account.role ?? '—'}`);
console.log(`expires   ${expiresAt.toISOString()}`);
console.log(`cookie    ${SESSION_COOKIE}=${token}`);

await closeDb();
