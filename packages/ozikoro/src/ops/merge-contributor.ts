/**
 * Merging one contributor's byline into another: reassign, record, then delete.
 *
 * WHY THIS EXISTS
 *
 * The owner asked, of the byline `ozikoro` ("Ozi Ikoro", the company's name): *"move all its files to
 * idenze ezeme and delete it after moving them, including posts"*. That is four operations against
 * production data — find every row that points at the contributor, repoint the byline, write down what
 * the byline was before, and delete the row — and doing it by hand once is how the fourth step gets
 * skipped or the second one misses a table nobody remembered.
 *
 * So it runs as a script, it is idempotent in the only sense that matters (a dry run changes nothing),
 * and it is the same code whether it is rehearsing or applying.
 *
 * WHAT IT REFUSES TO DO, AND WHY THAT IS THE SAFETY NET
 *
 * `ozikoro_contributor` is referenced by more than the article byline, and the referencing tables do not
 * all behave the same way on delete:
 *
 *   ozikoro_article.author_id                 on delete set null   the byline; reassigned
 *   ozikoro_media.contributor_id              on delete set null   the media attribution; reassigned
 *   ozikoro_contributor_claim.contributor_id  on delete CASCADE    a claim to the byline
 *
 * That last one is the trap. A `delete from ozikoro_contributor` would **not** fail on it — Postgres
 * would silently delete the claims with the row, because the foreign key says `cascade`. A merge that
 * quietly destroys a pending identity claim is exactly the silent data loss this archive's audit rule
 * exists to prevent, so the script reads `pg_constraint` and refuses outright when any cascade-referencing
 * row points at the contributor being removed. It does not disable the constraint, it does not delete the
 * referring rows, and it does not proceed.
 *
 * The same rule applies to any table it does not recognise: it reassigns the two it knows (`author_id`,
 * `contributor_id`) and **stops** on anything else that still points at the row, rather than deleting a
 * row something else is using.
 *
 * THE AUDIT IS THE POINT, NOT A FORMALITY
 *
 * The archive's position is that the record says what happened, so the deleted byline is recorded rather
 * than merely removed:
 *
 *   - one `ozikoro_audit` row per affected article, action `reassign_byline`, whose `before` names the
 *     old byline (`author_id`, `author_slug`, `author_name`) and whose `after` names the new one. A row
 *     that said only "Idenze Ezeme" would have lost the fact.
 *   - one row for the contributor itself, action `merge_contributor`, whose `before` carries the whole
 *     row being deleted and the counts attributed to it, and whose `after` records what moved and where
 *     the files landed — because for `ozikoro` **the largest consequence of the merge is the 791 media
 *     rows, and a record that named only the byline would omit the thing that mattered most.**
 *
 * Usage (dry run is the default; nothing is written without `--apply`):
 *   node src/ops/merge-contributor.ts --from ozikoro --to nze
 *   node src/ops/merge-contributor.ts --from ozikoro --to nze --actor 199 --apply
 *   node src/ops/merge-contributor.ts --from ozikoro --to nze --expect-articles 7 --expect-media 791 --actor 199 --apply
 *
 * `--expect-articles N` and `--expect-media N` are the shape check: if either count differs from the
 * measurement, the script refuses before writing anything. It exists because the number in the brief and
 * the number in the data are two different things. **`ozikoro` was described as three articles and no
 * files; measured, it is seven article rows and 791 media rows** — and because
 * `ozikoro_media.contributor_id` is `on delete set null`, the files would have been nulled silently by the
 * delete rather than raising anything. The guard was right; only the brief's number was wrong, so the
 * number it checks is the measured one.
 */
import { getDb, closeDb, type Db } from '@ozituma/db/client';

interface Args {
  from: string;
  to: string;
  actor: number | null;
  apply: boolean;
  expectArticles: number | null;
  expectMedia: number | null;
}

function parseArgs(argv: string[]): Args {
  let from: string | null = null;
  let to: string | null = null;
  let actor: number | null = null;
  let expectArticles: number | null = null;
  let expectMedia: number | null = null;
  let apply = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') from = argv[++i] ?? null;
    else if (arg === '--to') to = argv[++i] ?? null;
    else if (arg === '--actor') actor = Number(argv[++i]);
    else if (arg === '--expect-articles') expectArticles = Number(argv[++i]);
    else if (arg === '--expect-media') expectMedia = Number(argv[++i]);
    else if (arg === '--apply') apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node src/ops/merge-contributor.ts --from <slug> --to <slug> [--actor <id> --apply]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!from || !to) throw new Error('--from and --to are both required');
  if (from === to) throw new Error('--from and --to are the same slug; there is nothing to merge');
  return { from, to, actor, apply, expectArticles, expectMedia };
}

interface Contributor {
  id: number;
  slug: string;
  display_name: string;
  wp_user_id: number | null;
  account_id: number | null;
  bio: string | null;
}

async function contributor(db: Db, slug: string): Promise<Contributor | null> {
  const row = await db.one<Record<string, unknown>>(
    `select id, slug, display_name, wp_user_id, account_id, bio from ozikoro_contributor where slug = $1`,
    [slug]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: String(row.slug),
    display_name: String(row.display_name),
    wp_user_id: row.wp_user_id === null || row.wp_user_id === undefined ? null : Number(row.wp_user_id),
    account_id: row.account_id === null || row.account_id === undefined ? null : Number(row.account_id),
    bio: row.bio === null || row.bio === undefined ? null : String(row.bio),
  };
}

/**
 * Every foreign key pointing at `ozikoro_contributor`, read from the live catalog rather than assumed
 * from the migrations. A migration that added a referencing column and a migration that did not are
 * indistinguishable in a list of files; `pg_constraint` is the database's own answer.
 */
interface Reference {
  table: string;
  column: string;
  onDelete: string;
  /** The constraint's own name, so a refusal can quote it. */
  constraint: string;
}

const ON_DELETE: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

async function referencesToContributor(db: Db): Promise<Reference[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select c.conname, t.relname as table_name, a.attname as column_name, c.confdeltype::text as on_delete
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace nsp on nsp.oid = t.relnamespace
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       join pg_class rt on rt.oid = c.confrelid
      where c.contype = 'f'
        and rt.relname = 'ozikoro_contributor'
        and nsp.nspname = 'public'
      order by t.relname, a.attname`
  );
  return rows.map((r) => ({
    table: String(r.table_name),
    column: String(r.column_name),
    onDelete: ON_DELETE[String(r.on_delete)] ?? String(r.on_delete),
    constraint: String(r.conname),
  }));
}

async function countPointing(db: Db, ref: Reference, contributorId: number): Promise<number> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from "${ref.table}" where "${ref.column}" = $1`,
    [contributorId]
  );
  return Number(row?.n ?? 0);
}

/** How many media records are attributed to a contributor. The "files" half of the merge. */
async function mediaCount(db: Db, contributorId: number): Promise<number> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_media where contributor_id = $1`,
    [contributorId]
  );
  return Number(row?.n ?? 0);
}

/** The two references a merge knows how to repoint. Anything else is a stop, not a guess. */
const REASSIGNABLE: Record<string, string[]> = {
  ozikoro_article: ['author_id'],
  ozikoro_media: ['contributor_id'],
};

interface ArticleRow {
  id: number;
  slug: string;
  title: string;
  status: string;
  is_page: boolean;
  published_at: string | null;
}

async function articlesFor(db: Db, contributorId: number): Promise<ArticleRow[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, slug, title, status, is_page, published_at
       from ozikoro_article where author_id = $1
      order by is_page, published_at nulls last, id`,
    [contributorId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    title: String(r.title),
    status: String(r.status),
    is_page: Boolean(r.is_page),
    published_at: r.published_at === null || r.published_at === undefined ? null : String(r.published_at),
  }));
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = await getDb();

  try {
    const from = await contributor(db, args.from);
    const to = await contributor(db, args.to);

    console.log(`\n  ${args.apply ? 'APPLYING' : 'DRY RUN'} — merge contributor byline\n`);

    if (!from) throw new Error(`no ozikoro_contributor with slug "${args.from}"`);
    if (!to) throw new Error(`no ozikoro_contributor with slug "${args.to}"`);

    console.log(`  from: #${from.id}  slug=${from.slug}  display_name="${from.display_name}"  account_id=${from.account_id ?? 'null'}`);
    console.log(`  to:   #${to.id}  slug=${to.slug}  display_name="${to.display_name}"  account_id=${to.account_id ?? 'null'}`);

    const refs = await referencesToContributor(db);
    console.log(`\n  Foreign keys referencing ozikoro_contributor (read from pg_constraint):`);
    const pointing: { ref: Reference; n: number }[] = [];
    for (const ref of refs) {
      const n = await countPointing(db, ref, from.id);
      pointing.push({ ref, n });
      const known = (REASSIGNABLE[ref.table] ?? []).includes(ref.column);
      console.log(
        `    ${(ref.table + '.' + ref.column).padEnd(42)} on delete ${ref.onDelete.padEnd(10)} ${String(n).padStart(4)} row(s)` +
          (known ? '  [reassigned]' : n > 0 ? '  [UNKNOWN — STOP]' : '')
      );
    }

    const articles = await articlesFor(db, from.id);
    const mediaFrom = await mediaCount(db, from.id);
    const mediaTo = await mediaCount(db, to.id);
    console.log(`\n  Rows that would change — ozikoro_article.author_id: #${from.id} -> #${to.id}\n`);
    if (articles.length === 0) console.log('    (none)');
    for (const a of articles) {
      console.log(`    #${a.id}  ${a.status.padEnd(9)} is_page=${String(a.is_page).padEnd(5)}  "${a.title}"`);
    }

    console.log(`\n  Files that would change — ozikoro_media.contributor_id: #${from.id} -> #${to.id}\n`);
    console.log(`    ${mediaFrom} media row(s) attributed to "${from.slug}" would move to "${to.slug}"`);
    console.log(`    "${to.slug}" holds ${mediaTo} today, so it would hold ${mediaTo + mediaFrom} after`);

    console.log(`\n  Rows that would be deleted\n`);
    console.log(`    ozikoro_contributor #${from.id}  slug=${from.slug}  display_name="${from.display_name}"`);

    const unhandled = pointing.filter(
      (p) => p.n > 0 && !(REASSIGNABLE[p.ref.table] ?? []).includes(p.ref.column)
    );
    const cascades = unhandled.filter((p) => p.ref.onDelete === 'cascade');

    console.log(`\n  Counts to check`);
    console.log(`    articles attributed to "${from.slug}": ${articles.length}` +
      (args.expectArticles === null ? '' : ` (expected ${args.expectArticles})`));
    console.log(`    media rows attributed to "${from.slug}": ${mediaFrom}` +
      (args.expectMedia === null ? '' : ` (expected ${args.expectMedia})`));
    console.log(`    contributor rows to delete: 1`);
    console.log(`    unrecognised references still pointing at it: ${unhandled.length}`);

    if (unhandled.length > 0) {
      console.log('');
      for (const p of unhandled) {
        console.log(`    STOP: ${p.ref.table}.${p.ref.column} (${p.ref.constraint}) has ${p.n} row(s) pointing at #${from.id}, on delete ${p.ref.onDelete}`);
      }
      throw new Error(
        cascades.length > 0
          ? 'a cascade-referencing row exists; deleting the contributor would destroy it silently. Refusing.'
          : 'a reference this script does not know how to reassign exists. Refusing rather than guessing.'
      );
    }

    /*
     * The shape check. It exists because the number in the brief and the number in the data are two
     * different things, and a merge measured at a shape other than the one it was described as is a
     * merge to stop and ask about rather than to run. `ozikoro` was described as three articles and no
     * files; measured, it is seven rows and 791 files.
     */
    if (args.expectArticles !== null && articles.length !== args.expectArticles) {
      throw new Error(`measured ${articles.length} article(s), expected ${args.expectArticles}. Refusing.`);
    }
    if (args.expectMedia !== null && mediaFrom !== args.expectMedia) {
      throw new Error(`measured ${mediaFrom} media row(s), expected ${args.expectMedia}. Refusing.`);
    }

    if (!args.apply) {
      console.log(`\n  Nothing was written. Re-run with --actor <id> --apply to make the change.\n`);
      return;
    }

    if (args.actor === null || !Number.isFinite(args.actor)) throw new Error('--actor <account id> is required with --apply');
    const actor = await db.one<Record<string, unknown>>(
      `select id, email, role from account where id = $1`,
      [args.actor]
    );
    if (!actor) throw new Error(`no account with id ${args.actor}`);
    console.log(`\n  actor: #${Number(actor.id)}  ${String(actor.email)}  role=${String(actor.role)}`);

    const note = `Merge of contributor "${from.display_name}" (slug ${from.slug}, #${from.id}) into ` +
      `"${to.display_name}" (slug ${to.slug}, #${to.id}).`;

    await db.query('begin');
    try {
      /*
       * The byline change, one row and one audit row at a time, so `before` is read from the row's own
       * state rather than from an assumption about what it held.
       */
      for (const a of articles) {
        await db.query(
          `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
           values ('ozikoro_article', $1, 'reassign_byline', $2::jsonb, $3::jsonb, $4, $5)`,
          [
            a.id,
            json({ author_id: from.id, author_slug: from.slug, author_name: from.display_name }),
            json({ author_id: to.id, author_slug: to.slug, author_name: to.display_name }),
            args.actor,
            `${note} Byline "${from.display_name}" -> "${to.display_name}" on record "${a.title}" (${a.slug}).`,
          ]
        );
      }

      const changed = await db.query(
        `update ozikoro_article set author_id = $1, updated_at = now() where author_id = $2`,
        [to.id, from.id]
      );
      if (changed.rowCount !== articles.length) {
        throw new Error(`reassigned ${changed.rowCount} article(s) but measured ${articles.length} before the update`);
      }

      /*
       * The files. `ozikoro_media.contributor_id` is `on delete set null`, so leaving these behind would
       * not have failed — the delete would have silently erased the attribution on every one of them.
       * Moving them is the instruction ("move all its files") and the only outcome that keeps the record.
       */
      let mediaMoved = 0;
      for (const [table, columns] of Object.entries(REASSIGNABLE)) {
        if (table === 'ozikoro_article') continue;
        for (const column of columns) {
          const moved = await db.query(
            `update "${table}" set "${column}" = $1 where "${column}" = $2`,
            [to.id, from.id]
          );
          if (moved.rowCount > 0) {
            mediaMoved += moved.rowCount;
            console.log(`  moved ${moved.rowCount} row(s) in ${table}.${column}`);
          }
        }
      }
      if (mediaMoved !== mediaFrom) {
        throw new Error(`moved ${mediaMoved} file(s) but measured ${mediaFrom} before the update`);
      }
      const mediaToAfter = await mediaCount(db, to.id);

      await db.query(
        `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
         values ('ozikoro_contributor', $1, 'merge_contributor', $2::jsonb, $3::jsonb, $4, $5)`,
        [
          from.id,
          json({
            id: from.id,
            slug: from.slug,
            display_name: from.display_name,
            wp_user_id: from.wp_user_id,
            account_id: from.account_id,
            bio: from.bio,
            articles_attributed: articles.length,
            files_attributed: mediaFrom,
            merged_into: { id: to.id, slug: to.slug, display_name: to.display_name },
          }),
          json({
            articles_reassigned: articles.length,
            files_reassigned: mediaMoved,
            byline_before: { id: from.id, slug: from.slug, display_name: from.display_name },
            byline_after: { id: to.id, slug: to.slug, display_name: to.display_name },
            files_attributed_before: { [from.slug]: mediaFrom, [to.slug]: mediaTo },
            files_attributed_after: { [to.slug]: mediaToAfter },
          }),
          args.actor,
          `${note} ${articles.length} record(s) and ${mediaMoved} file(s) moved from ` +
            `"${from.display_name}" to "${to.display_name}", then the contributor row deleted.`,
        ]
      );

      /*
       * The delete is deliberately plain. No cascade is written here, and no constraint is disabled: if
       * anything still points at this row the statement fails and the transaction rolls back, which is
       * the outcome that keeps the record honest.
       */
      const deleted = await db.query(`delete from ozikoro_contributor where id = $1`, [from.id]);
      if (deleted.rowCount !== 1) throw new Error(`expected to delete 1 contributor row, deleted ${deleted.rowCount}`);

      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }

    // After the commit, prove the state rather than assuming it.
    const left = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article where author_id = $1`, [from.id]);
    const gone = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_contributor where id = $1`, [from.id]);
    const moved = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article where author_id = $1`, [to.id]);
    const filesLeft = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_media where contributor_id = $1`, [from.id]);
    const filesNow = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_media where contributor_id = $1`, [to.id]);
    console.log(`\n  Applied.`);
    console.log(`    articles still attributed to #${from.id}: ${Number(left?.n ?? -1)}`);
    console.log(`    contributor rows with id #${from.id}: ${Number(gone?.n ?? -1)}`);
    console.log(`    articles now attributed to #${to.id}: ${Number(moved?.n ?? -1)}`);
    console.log(`    files still attributed to #${from.id}: ${Number(filesLeft?.n ?? -1)}`);
    console.log(`    files now attributed to #${to.id}: ${Number(filesNow?.n ?? -1)}`);
    console.log(`    audit rows written: ${articles.length + 1}\n`);
  } finally {
    await closeDb();
  }
}

await main();
