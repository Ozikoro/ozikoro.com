import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const cols = await db.rows<{ column_name: string }>(
  `select column_name from information_schema.columns where table_name='example' order by ordinal_position`);
console.log(cols.map((c) => c.column_name).join(', '));
await closeDb();
