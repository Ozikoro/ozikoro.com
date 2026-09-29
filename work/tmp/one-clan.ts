import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
for (const name of ['Idemili', 'Nkalu', 'Oru']) {
  const row = await db.one<Record<string, unknown>>(
    `select c.id, c.name, c.origin_summary, c.description, c.updated_at,
            coalesce((select array_agg(ct.name order by ct.name) from clan_town ct where ct.clan_id = c.id), '{}') as towns
       from clan c where c.name = $1`, [name]);
  console.log('===', name, '| id', row?.id, '| updated', row?.updated_at);
  console.log('   origin:', String(row?.origin_summary).slice(0, 90));
  console.log('   desc[0]:', String((row?.description as string[])?.[0]).slice(0, 110));
  console.log('   towns:', JSON.stringify(row?.towns));
}
await closeDb();
