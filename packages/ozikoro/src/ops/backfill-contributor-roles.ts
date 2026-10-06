/**
 * The WordPress role each byline held, read back out of the dump the REST import could not carry.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────────
 *
 * The owner's report: *"i did not see the wordpress 15 users."* All fifteen have been in
 * `ozikoro_contributor` since the import ran; what the archive could not say was **what each of them was**
 * — author, editor, contributor, administrator. The WordPress users endpoint returns that as a `roles`
 * array, `normaliseUser` in `src/import/wordpress.ts` did not map it, and `ozikoro_contributor` had no
 * column for it anyway. Migration 0059 adds the column; this script is what fills it for rows that were
 * imported before the column existed.
 *
 * ── WHY THE DUMP AND NOT THE REST EXPORT ─────────────────────────────────────────────────────────────
 *
 * There are two artefacts on disk that know the answer, and this is the same choice
 * `backfill-author-portraits.ts` made for the same reason:
 *
 *   data/ozikoro-wp/users.json       the NORMALISED export — the roles were dropped here, so it has none
 *   data/ozikoro-wp/cms/users.json   the raw REST response — it has them, but it is a scratch artefact
 *   data/ozikoro-wp/dbdump/sql/…     **the dump** — `wpc9_usermeta` holds `wpc9_capabilities` for all
 *                                    fifteen users, and it is the source the portraits backfill already
 *                                    reads. Measured on this dump: 15 `wpc9_capabilities` rows.
 *
 * ⚠️ **`wpc9_capabilities` IS NOT A ROLE.** It is a serialised map of capabilities, and for most users it
 * carries capability keys as well as the role — measured, Idenze Ezeme's is
 * `a:3:{s:13:"administrator";b:1;s:15:"view_give_forms";b:1;s:18:"view_give_payments";b:1;}`. So the role is
 * read as **the key that is one of WordPress's five built-in role names**, never as "the first key". A
 * script that took the first key would have called a plugin capability a role.
 *
 * ── WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE ──────────────────────────────────────────────────────
 *
 *   - One `wp_role` per contributor whose `wp_user_id` appears in the dump's usermeta, from the five
 *     built-in roles. `subscriber` is in the vocabulary because WordPress has it; no row here holds it.
 *   - **Nothing is invented.** A byline whose WordPress user has no `wpc9_capabilities` row, or whose row
 *     names no built-in role, is left NULL and reported — the screen prints "not recorded" for it rather
 *     than a role nobody measured.
 *   - No account, no session, no password and no capability. This column records what the old site said
 *     about the person. It grants nothing, and this script has no code path that could.
 *
 * Usage (dry run is the default; nothing is written without `--apply`):
 *   node packages/ozikoro/src/ops/backfill-contributor-roles.ts
 *   node packages/ozikoro/src/ops/backfill-contributor-roles.ts --apply --actor 1
 *   node packages/ozikoro/src/ops/backfill-contributor-roles.ts --apply --actor 1 --expect-roles 14
 *
 * `--expect-roles N` is the shape check `backfill-author-portraits.ts` established: if the number of
 * resolvable roles differs from the measurement, the script refuses before writing anything. It exists
 * because a migration that silently finds nothing looks exactly like a site that has nothing to find.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from '@ozituma/db/client';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const DUMP = resolve(REPO_ROOT, 'data', 'ozikoro-wp', 'dbdump', 'sql', 'ozikbfpe_ozikoro.sql');

/** WordPress's five built-in roles, most senior first. The order is the tie-break if a map names two. */
const WP_ROLES = ['administrator', 'editor', 'author', 'contributor', 'subscriber'] as const;

const META_ROW = /^\((\d+), (\d+), '((?:[^'\\]|\\.)*)', '(.*)'\),?;?$/;

interface Args {
  apply: boolean;
  actor: number | null;
  expectRoles: number | null;
  dump: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, actor: null, expectRoles: null, dump: DUMP };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--actor') args.actor = Number(argv[++i]);
    else if (a === '--expect-roles') args.expectRoles = Number(argv[++i]);
    else if (a === '--dump') args.dump = resolve(argv[++i] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log('usage: backfill-contributor-roles.ts [--apply] [--actor <account id>] [--expect-roles N] [--dump <file>]');
      process.exit(0);
    }
  }
  return args;
}

/**
 * Read only the `wpc9_usermeta` block, line by line, and keep the `wpc9_capabilities` value per user.
 *
 * The dump is 116 MB and the usermeta block is a few hundred lines of it, so it is streamed and abandoned
 * at the next `CREATE TABLE` rather than read whole. Rows are one per line and the terminator is `,`
 * between them and `);` on the last, so a pattern that accepts only a comma drops exactly one row per
 * statement — which is why `,?;?` is here rather than `,`.
 */
async function readCapabilities(path: string): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let inTable = false;
  for await (const line of rl) {
    if (!inTable) {
      if (line.startsWith('CREATE TABLE `wpc9_usermeta`')) inTable = true;
      continue;
    }
    if (line.startsWith('CREATE TABLE ')) break;
    const m = META_ROW.exec(line.trim());
    if (!m) continue;
    const key = (m[3] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (key !== 'wpc9_capabilities') continue;
    /*
     * MySQL escapes `"` inside a single-quoted string as `\"`, and the serialised PHP array is full of
     * them. Unescaping both quote forms is what makes the `s:<len>:"<role>"` test below an exact match
     * rather than a substring guess.
     */
    const value = (m[4] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const userId = Number(m[2]);
    if (!out.has(userId)) out.set(userId, value);
  }
  rl.close();
  if (!inTable) throw new Error(`no wpc9_usermeta table in ${path} — is this the Ozikoro dump?`);
  return out;
}

/**
 * The role out of a serialised capability map, or null.
 *
 * Exact, not substring: a serialised PHP string key is `s:<length>:"<value>"`, so matching the length as
 * well as the text is what stops `author` matching inside `aioseo_author` or a future `co-author` key.
 */
function roleFromCapabilities(serialised: string): string | null {
  for (const role of WP_ROLES) {
    if (serialised.includes(`s:${role.length}:"${role}"`)) return role;
  }
  return null;
}

interface Contributor {
  id: string;
  wp_user_id: number | null;
  slug: string;
  display_name: string;
  wp_role: string | null;
  records: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('\n  WordPress roles, backfilled from the dump\'s wpc9_usermeta table');
  console.log(`  Dump: ${args.dump}\n`);
  if (!existsSync(args.dump)) throw new Error(`dump not found: ${args.dump}`);

  const capabilities = await readCapabilities(args.dump);
  console.log(`  wpc9_capabilities rows in the dump: ${capabilities.size}`);

  const byUser = new Map<number, string>();
  const unknown: number[] = [];
  for (const [userId, serialised] of capabilities) {
    const role = roleFromCapabilities(serialised);
    if (role) byUser.set(userId, role);
    else unknown.push(userId);
  }
  console.log(`    of those, naming a built-in role: ${byUser.size}`);
  if (unknown.length > 0) {
    console.log(`    naming no built-in role (left alone): ${unknown.join(', ')}`);
  }

  const db = await getDb();
  const contributors = await db.rows<Contributor>(
    `select c.id::text, c.wp_user_id, c.slug, c.display_name, c.wp_role,
            (select count(*)::int from ozikoro_article a where a.author_id = c.id) as records
       from ozikoro_contributor c
      order by records desc, lower(c.display_name)`
  );

  const resolved = contributors
    .map((c) => ({ c, role: c.wp_user_id === null ? null : (byUser.get(Number(c.wp_user_id)) ?? null) }))
    .filter((r) => r.role !== null);

  console.log(`  contributor rows: ${contributors.length}`);
  console.log(`    with a WordPress role to record: ${resolved.length}\n`);

  const width = Math.max(...contributors.map((c) => c.display_name.length), 16);
  console.log('  WHO WAS WHAT ON WORDPRESS');
  for (const c of contributors) {
    const role = c.wp_user_id === null ? null : (byUser.get(Number(c.wp_user_id)) ?? null);
    const now = c.wp_role ?? '—';
    console.log(
      `    ${c.display_name.padEnd(width)}  wp=${String(c.wp_user_id ?? 'none').padStart(4)}  ` +
        `${role ? role.padEnd(14) : 'not recorded  '}  records ${String(c.records).padStart(4)}  (was ${now})`
    );
  }

  const unmatched = contributors.filter((c) => c.wp_user_id === null);
  if (unmatched.length > 0) {
    console.log(
      `\n  bylines with no WordPress user id (no role can be read for them): ` +
        unmatched.map((c) => c.display_name).join(', ')
    );
  }

  if (args.expectRoles !== null && args.expectRoles !== resolved.length) {
    throw new Error(
      `expected ${args.expectRoles} contributors with a resolvable WordPress role, measured ${resolved.length}. ` +
        'Refusing to write: the shape check exists because a migration that finds nothing looks like a site that has nothing.'
    );
  }

  if (!args.apply) {
    console.log('\n  DRY RUN — nothing written. Add --apply to record these.\n');
    await closeDb();
    return;
  }

  let written = 0;
  for (const { c, role } of resolved) {
    if (c.wp_role === role) continue;
    await db.query(`update ozikoro_contributor set wp_role = $1, updated_at = now() where id = $2::bigint`, [
      role,
      c.id,
    ]);
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_contributor', $1::bigint, 'backfill_wp_role', $2::jsonb, $3::jsonb, $4, $5)`,
      [
        c.id,
        JSON.stringify({ wp_role: c.wp_role }),
        JSON.stringify({ wp_role: role, source: 'wordpress wpc9_usermeta.wpc9_capabilities' }),
        args.actor,
        `The WordPress role "${role}" recorded for "${c.display_name}" (wp_user_id ${c.wp_user_id}) from the ` +
          `dump's wpc9_capabilities. This is a fact about ozikoro.com; it grants no account and no capability.`,
      ]
    );
    written += 1;
  }

  const after = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_contributor where wp_role is not null`
  );
  const accountsLinked = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_contributor where account_id is not null`
  );
  console.log(`  applied: ${written} role(s) recorded and audited`);
  console.log(`  contributor rows with a WordPress role now: ${Number(after?.n ?? 0)} of ${contributors.length}`);
  console.log(
    `  contributor rows linked to a login account: ${Number(accountsLinked?.n ?? 0)} ` +
      '— recording a role creates no account and signs nobody in\n'
  );

  await closeDb();
}

if (process.argv[1] && process.argv[1].endsWith('backfill-contributor-roles.ts')) {
  main().catch(async (error) => {
    console.error(`\n  Failed: ${String(error).slice(0, 600)}\n`);
    await closeDb().catch(() => {});
    process.exitCode = 1;
  });
}
