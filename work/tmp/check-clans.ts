import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const rows = await db.rows<{ name: string; clans: number }>(
  `select t.name, count(c.id)::int as clans
     from tribe t left join clan c on c.tribe_id = t.id and c.published
    group by t.name order by t.name`
);
console.log('the grouping the clans page offers (published clans only):');
for (const r of rows) console.log(`  ${String(r.clans).padStart(4)}  ${r.name}`);
const total = await db.one<{ n: number }>(`select count(*)::int as n from clan where published`);
const held = await db.one<{ n: number }>(`select count(*)::int as n from clan where not published`);
console.log(`\npublished clans: ${total?.n}, held back: ${held?.n}`);
const isu = await db.one<{ n: number }>(
  `select count(*)::int as n from clan c join tribe t on t.id = c.tribe_id
    where t.name like 'Southern Igbo%' and c.name ilike '%isu%'`
);
console.log('Isu-named clans inside Southern Igbo (published + held):', isu?.n);
await closeDb();
