import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const rows = await db.rows<{ name: string; clans: number }>(
  `select t.name, count(c.id)::int as clans from tribe t left join clan c on c.tribe_id = t.id
    group by t.name order by t.name`
);
console.log('divisions the registry now offers:');
for (const r of rows) console.log(`  ${String(r.clans).padStart(4)}  ${r.name}`);
await closeDb();
