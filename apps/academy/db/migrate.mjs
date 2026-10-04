/**
 * The Academy's migration runner.
 *
 *   DATABASE_URL=postgres://... node db/migrate.mjs            # apply pending
 *   DATABASE_URL=postgres://... node db/migrate.mjs --status   # report, change nothing
 *
 * WHY THE ACADEMY HAS ITS OWN RUNNER rather than using `packages/db/src/migrate.ts`
 *
 * The Academy shares the dictionary's database but not its migration chain, and that is a response
 * to what is actually deployed: production holds migrations 0001-0033 followed by
 * `0034_suggestion_drafts` and `0035_donation_recurring`, while this repository has 0001-0033
 * followed by `0034_spotify` through `0052_ozikoro_external_audio`. The lineages diverged. Running
 * this repository's chain against production would apply twenty migrations written for software the
 * host does not run, against the live dictionary.
 *
 * So the Academy keeps its own ledger, `academy_migration`, and applies only its own `academy_*`
 * statements. Nothing here reads or writes `schema_migration`, and nothing here drops or alters a
 * table the dictionary owns.
 *
 * A checksum is stored per migration and compared on every run. A file that has been edited after it
 * was applied is reported as a mismatch and refused, because the alternative — applying the new text
 * on a database that already has the old one — produces a schema that matches neither version.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "migrations");

function checksum(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

async function main() {
  const statusOnly = process.argv.includes("--status");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(2);
  }

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("no migrations found");
    return;
  }

  const client = new pg.Client({ connectionString, options: "-c timezone=UTC" });
  await client.connect();

  try {
    // The ledger is created here rather than by a migration, because it has to exist before the
    // first migration can be recorded in it.
    await client.query(`
      create table if not exists academy_migration (
        id          text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      )
    `);

    const { rows } = await client.query("select id, checksum from academy_migration");
    const applied = new Map(rows.map((r) => [r.id, r.checksum]));

    let pending = 0;
    for (const file of files) {
      const id = file.replace(/\.sql$/, "");
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const sum = checksum(sql);
      const previous = applied.get(id);

      if (previous === sum) {
        console.log(`  ok       ${id}`);
        continue;
      }
      if (previous !== undefined) {
        // Refuse rather than guess: the database holds one version of this migration and the file
        // holds another, so applying it would leave a schema matching neither.
        console.error(`  MISMATCH ${id}`);
        console.error(`           applied ${previous}, file ${sum}. Refusing to continue.`);
        console.error("           Write a new migration instead of editing an applied one.");
        process.exitCode = 1;
        return;
      }

      if (statusOnly) {
        console.log(`  pending  ${id}`);
        pending += 1;
        continue;
      }

      // Each migration is one transaction, so a failure leaves nothing half-applied. The Academy's
      // migrations are `create table if not exists` and are therefore safe to re-run, but the
      // transaction is what makes that a property of the runner rather than of each file.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("insert into academy_migration (id, checksum) values ($1, $2)", [id, sum]);
        await client.query("COMMIT");
        console.log(`  applied  ${id}`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`  FAILED   ${id}`);
        console.error(`           ${error.message}`);
        process.exitCode = 1;
        return;
      }
    }

    if (statusOnly && pending === 0) console.log("  (nothing pending)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
