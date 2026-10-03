/**
 * Build the archive's knowledge graph from the dictionary's own clans and towns, from the command line.
 *
 *   node scripts/build-town-entities.ts [--dry-run] [--actor <email>]
 *
 * The work itself lives in `buildEntityGraph` in `@ozikoro/platform`, not here. **This file is a
 * command line around it and holds no second copy of the rules**, because the back office runs the
 * same function with the signed-in owner as the actor and two implementations would drift the first
 * time one of them changed.
 *
 * THE ACTOR IS REQUIRED AND IS NAMED
 *
 * Every entity the run creates and every article it links writes an `ozikoro_audit` row naming who
 * did it, so the run needs a real account. `--actor` names one by address; with no flag the single
 * owner account is used and the script refuses if there is not exactly one candidate, rather than
 * picking somebody.
 *
 * WHAT IT DOES AND DELIBERATELY DOES NOT DO
 *
 * It moves what the dictionary already records into the graph where the archive can query it — the
 * names, aliases, kinds and ethnic group of the 188 published clans. It writes **no coordinates**
 * (the brief forbids inventing them and the clan records carry none), no periods and no sources:
 * those need a human reading the record, which is what `/admin/archive` is for.
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { buildEntityGraph, getEntityGraphState } from '@ozikoro/platform';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const actorFlagAt = argv.indexOf('--actor');
const actorEmail = actorFlagAt >= 0 ? argv[actorFlagAt + 1] : null;

const db = await getDb();

const actor = actorEmail
  ? await db.one<{ id: string; email: string }>(`select id, email from account where lower(email) = lower($1)`, [actorEmail])
  : await db.one<{ id: string; email: string; n: number }>(
      `select id, email, (select count(*)::int from account) as n from account order by id limit 1`
    );

if (!actor) {
  console.error(
    actorEmail
      ? `  no account with the address ${actorEmail}`
      : '  no account exists to attribute the run to. Create one first: npm run account:create <email>'
  );
  await closeDb();
  process.exit(1);
}
if (!actorEmail && Number((actor as unknown as { n: number }).n) > 1) {
  console.error(
    `  ${(actor as unknown as { n: number }).n} accounts exist, so the actor is ambiguous. ` +
      'Name one: --actor <email>'
  );
  await closeDb();
  process.exit(1);
}

console.log(`  actor: ${actor.email} (account ${actor.id})${dryRun ? '  [DRY RUN — nothing will be written]' : ''}`);

const before = await getEntityGraphState(db);
console.log(
  `  before: ${before.entities} entities · ${before.articleLinks} links · ${before.articlesWithAPlace} records linked to a place`
);

const report = await buildEntityGraph(db, { actorId: Number(actor.id), dryRun });

console.log(`  ${report.entitiesCreated} entities created, ${report.entitiesAlreadyPresent} already present (of ${report.considered} published dictionary rows)`);
if (report.skipped.length > 0) {
  console.log(`  ${report.skipped.length} rows deliberately not made entities (a colonial section or an administrative grouping is not a place anybody names):`);
  for (const s of report.skipped.slice(0, 10)) console.log(`      ${s.name} — ${s.kind}`);
  if (report.skipped.length > 10) console.log(`      … and ${report.skipped.length - 10} more`);
}
console.log(`  ${report.linksCreated} article-to-place links across ${report.articlesLinked} records`);
console.log('  matched on TITLE only — a body search would link far more and claim far less');
console.log('  coordinates written: 0 — the clan records carry none and the brief forbids inventing them');
if (report.sampleEntities.length > 0) {
  console.log(`  examples: ${report.sampleEntities.slice(0, 5).join(', ')}`);
}

const after = await getEntityGraphState(db);
console.log(
  `  now: ${after.entities} entities (${after.byKind.map((k) => `${k.n} ${k.kind}`).join(', ') || 'none'}) · ` +
    `${after.articleLinks} links · ${after.articlesWithAPlace} of ${after.records} records linked to a place`
);
if (dryRun) console.log('  nothing was written. Drop --dry-run to apply.');

await closeDb();
