
import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const rows = await db.rows<Record<string, unknown>>(
  `select c.name, c.origin_summary as origin, c.description,
          coalesce((select array_agg(ct.name) from clan_town ct where ct.clan_id = c.id), '{}') as towns
     from clan c order by c.name`);
console.log(JSON.stringify(rows));
await closeDb();
