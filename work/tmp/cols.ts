import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const rows = await db.rows<{ column_name: string }>(
  `select column_name from information_schema.columns where table_name = 'clan' order by ordinal_position`
);
console.log(rows.map((r) => r.column_name).join(', '));
await closeDb();
