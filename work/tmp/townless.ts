import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const rows = await db.rows<Record<string, unknown>>(
  `select c.id, c.slug, c.name, c.kind, t.name as division, c.states, c.lgas, c.origin_summary,
          coalesce((select count(*) from clan_town ct where ct.clan_id = c.id), 0)::int as towns
     from clan c left join tribe t on t.id = c.tribe_id
    where c.published order by c.name`);
const noTowns = rows.filter((r) => Number(r.towns) === 0);
console.log('published entries:', rows.length);
console.log('with no towns at all:', noTowns.length);
console.log('  of those, with a state recorded:', noTowns.filter((r) => (r.states as string[])?.length).length);
console.log('  of those, with neither a town nor a state:', noTowns.filter((r) => !(r.states as string[])?.length).length);
console.log('\nthe ones with neither:');
for (const r of noTowns.filter((x) => !(x.states as string[])?.length)) {
  console.log(`   ${String(r.name).padEnd(22)} ${String(r.division ?? '—').padEnd(18)} ${r.kind}`);
}
await closeDb();
