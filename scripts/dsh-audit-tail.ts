/**
 * Read one audit trail, and nothing else.
 *
 *   node scripts/dsh-audit-tail.ts <entity_type> [limit]
 *
 * A verification helper: the design editor's promise is that **every write is audited**, and the only honest
 * way to check a promise about a database is to read the database. This reads `ozikoro_audit` and prints the
 * rows — the entity, the action, who did it and the note — and it writes nothing.
 *
 * Stop the server first: PGlite is single-process.
 */
import { getDb, closeDb } from '@ozituma/db/client';

const entityType = process.argv[2]?.trim();
const limit = Math.max(1, Math.min(50, Number.parseInt(process.argv[3] ?? '10', 10) || 10));

if (!entityType) {
  console.error('usage: node scripts/dsh-audit-tail.ts <entity_type> [limit]');
  process.exit(2);
}

const db = await getDb();
const rows = await db.rows<{
  id: number; entity_type: string; entity_id: number; action: string;
  before: unknown; after: unknown; actor_id: number | null; note: string | null; created_at: Date;
}>(
  `select id, entity_type, entity_id, action, before, after, actor_id, note, created_at
     from ozikoro_audit
    where entity_type = $1
    order by id desc
    limit $2`,
  [entityType, limit]
);

console.log(`${rows.length} row(s) for entity_type = ${entityType}`);
for (const row of rows) {
  const before = row.before ? JSON.stringify(row.before) : '—';
  const after = row.after ? JSON.stringify(row.after) : '—';
  console.log(
    `#${row.id}  ${row.action}  actor=${row.actor_id ?? '—'}  ${new Date(row.created_at).toISOString()}\n` +
      `      before ${before}\n      after  ${after}\n      note   ${row.note ?? '—'}`
  );
}

await closeDb();
