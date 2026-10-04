import { closeDb, getDb } from '@ozituma/db/client';
const db = await getDb();
const q = async (label: string, sql: string) => {
  try { const r = await db.query<Record<string, unknown>>(sql);
    console.log(`\n--- ${label} (${r.rows.length})`);
    for (const row of r.rows) console.log('  ', JSON.stringify(row));
  } catch (e) { console.log(`\n--- ${label}: ERROR ${(e as Error).message}`); }
};
await q('transitions', `select id, episode_id, from_status, to_status, actor_account_id, note, created_at from ozikoro_episode_transition order by id`);
await q('last migrations', `select * from schema_migration order by 1 desc limit 6`);
await q('migration cols', `select column_name from information_schema.columns where table_name='schema_migration' order by ordinal_position`);
await q('counts', `select
   (select count(*) from ozikoro_episode) episodes,
   (select count(*) from ozikoro_episode_revision) revisions`);
await q('account 199', `select id, email, role from account where id = 199`);
await closeDb();
