import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const rows = await db.rows<{ table_name: string }>(
  `select table_name from information_schema.tables where table_schema='public' and table_name like '%town%' or table_name like '%clan%' order by table_name`
);
console.log(rows.map((r) => r.table_name).join(', '));
await closeDb();
