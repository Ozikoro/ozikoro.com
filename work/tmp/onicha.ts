import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const rows = await db.rows<Record<string, unknown>>(
  `select id, slug, name, published, tribe_id from clan where name ilike 'onicha%' or slug ilike 'onicha%' order by id`);
for (const r of rows) console.log(r.id, '|', r.slug, '|', r.name, '| published', r.published, '| tribe', r.tribe_id);
await closeDb();
