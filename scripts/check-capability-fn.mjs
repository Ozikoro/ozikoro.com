import { getDb, closeDb } from '@ozituma/db/client';
const db = await getDb();

/*
 * TWO ROLE SYSTEMS, AND THEY ARE NOT THE SAME ONE.
 *
 * `account.role` is the platform enum — contributor, editor, owner, admin, learner, linguist,
 * native_reviewer, content_editor — and it governs the whole estate, including the dictionary and the
 * academy. `ozikoro_member_role.role` is the archive's own set: reader, student, teacher, researcher,
 * independent_researcher, community_knowledge_holder, editor, expert_reviewer, moderator, admin.
 *
 * The first probe used archive role names as account roles and Postgres refused them. That error was the
 * schema telling me the two are distinct, which is worth keeping in the test.
 */
const ARCHIVE_ROLES = ['reader','student','teacher','researcher','independent_researcher',
  'community_knowledge_holder','editor','expert_reviewer','moderator','admin'];
const ACCOUNT_ROLES  = ['learner','contributor','editor','linguist','native_reviewer','content_editor','admin','owner'];

/*
 * THE SECOND COPY OF THE RULE, AND WHY IT IS STILL HERE.
 *
 * This query is a copy of `ozikoro_capabilities` written in the script rather than in the application, and its
 * only job is to be compared against the function so that a rule changed in one place and not the other fails
 * loudly. **Since migration 0057 the rule has one more clause and one more union**, so this copy has them too:
 *
 *   * `c.role = 'owner'` for an account whose PLATFORM role is `owner` — the binding that makes
 *     `grant_institutional_access` resolve for the proprietor's own account. It is additive: an owner already
 *     resolved the admin rows through the clause above.
 *   * `read_restricted` from a live row in `ozikoro_institutional_access` — the reading right a grant carries,
 *     and nothing else.
 *
 * **The two institutional capabilities are on the `owner` role and NOT on `admin`, which is what keeps a
 * dictionary administrator out of the tier** — the two applications share one `account` table, so the admin
 * clause would have handed it to every one of them. The probes below measure that (the archive roles are
 * combined with every platform role), and `packages/ozikoro/src/test-institutional-access.ts` asserts it by
 * name.
 */
const TS_QUERY = `
  select distinct c.capability
    from ozikoro_role_capability c
   where c.role = 'reader'
      or c.role in (select role from ozikoro_member_role where account_id = $1)
      or (c.role = 'admin' and exists (
            select 1 from account a where a.id = $1 and a.role::text in ('admin','owner')
          ))
      or (c.role = 'owner' and exists (
            select 1 from account a where a.id = $1 and a.role::text = 'owner'
          ))
   union
  select 'read_restricted'
    from ozikoro_institutional_access
   where account_id = $1 and revoked_at is null`;

let mismatches = 0, checked = 0, grants = 0;

/** One case: an archive role held by an account whose platform role is `accountRole`. */
async function probe(label, accountRole, archiveRole) {
  const acct = await db.one(
    `insert into account (email, display_name, role) values ($1,$2,$3::account_role) returning id`,
    [`zzcapfn-${label}@example.org`, `probe ${label}`, accountRole]
  );
  const id = acct.id;
  if (archiveRole && archiveRole !== 'reader') {
    await db.query(`insert into ozikoro_member_role (account_id, role) values ($1,$2)`, [id, archiveRole]);
    grants += 1;
  }

  const ts = new Set((await db.rows(TS_QUERY, [id])).map((r) => r.capability));
  ts.add('read');
  const fn = new Set((await db.rows(`select ozikoro_capabilities($1) as capability`, [id])).map((r) => r.capability));

  const same = ts.size === fn.size && [...ts].every((c) => fn.has(c));
  if (!same) {
    mismatches += 1;
    console.log(`  MISMATCH ${label}: ts-only=${[...ts].filter(c=>!fn.has(c))} fn-only=${[...fn].filter(c=>!ts.has(c))}`);
  } else {
    console.log(`  ok  ${label.padEnd(40)} ${String(fn.size).padStart(2)} caps`);
  }
  for (const cap of ['read','publish','manage_roles','expert_review','contribute_oral_history']) {
    const has = (await db.one(`select ozikoro_has_capability($1,$2) as b`, [id, cap])).b;
    if (has !== fn.has(cap)) { console.log(`  MISMATCH has_capability(${label},${cap})`); mismatches += 1; }
  }
  checked += 1;
  await db.query(`delete from ozikoro_member_role where account_id=$1`, [id]);
  await db.query(`delete from account where id=$1`, [id]);
}

// Every archive role, on a plain learner account.
for (const r of ARCHIVE_ROLES) await probe(`learner + ${r}`, 'learner', r);
// No granted role at all.
await probe('learner, no granted role', 'learner', null);
// The account-level administration path, which needs no granted role.
await probe('ACCOUNT admin, no granted role', 'admin', null);
await probe('ACCOUNT owner, no granted role', 'owner', null);
// Every platform role, to prove none of them grants archive capability by itself.
for (const a of ACCOUNT_ROLES) await probe(`platform ${a} alone`, a, null);

console.log(`\n  cases ${checked}, role grants exercised ${grants}, mismatches ${mismatches}`);
/*
 * THE PROPERTIES COME FROM pg_proc, NOT FROM THE DEFINITION TEXT.
 *
 * An earlier version of this check parsed `pg_get_functiondef` and reported search_path as unset, because
 * that function does not render the SET clause at all. The setting was present the whole time — `proconfig`
 * is where Postgres records it — so the check was wrong and the function was right. Reading the catalogue
 * column is reading the authority; parsing a pretty-printed definition is reading a rendering of it.
 */
const props = await db.rows(
  `select proname, proconfig, prosecdef, provolatile,
          pg_get_userbyid(proowner) as owner
     from pg_proc where proname in ('ozikoro_capabilities','ozikoro_has_capability')`
);
let secFail = 0;
for (const f of props) {
  const cfg = Array.isArray(f.proconfig) ? f.proconfig : [];
  const pinned = cfg.some((c) => /^search_path=public,\s*pg_temp$/.test(String(c).trim()));
  const ok = f.prosecdef === true && pinned && f.provolatile === 's';
  if (!ok) secFail += 1;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${String(f.proname).padEnd(24)}` +
      ` security definer=${f.prosecdef} stable=${f.provolatile === 's'} search_path=${pinned ? 'pinned' : 'NOT PINNED'}`
  );
}
if (secFail > 0) mismatches += secFail;
await closeDb();
