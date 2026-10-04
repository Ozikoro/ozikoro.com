import { closeDb, getDb } from '@ozituma/db/client';
const db = await getDb();
const q = async (label: string, sql: string) => {
  try {
    const r = await db.query<Record<string, unknown>>(sql);
    console.log(`\n--- ${label} (${r.rows.length} rows)`);
    return r.rows;
  } catch (e) { console.log(`\n--- ${label}: ERROR ${(e as Error).message}`); return []; }
};

const eps = await q('episodes', `select id, slug, title, status, storage_key, mime_type, byte_size,
  duration_seconds, char_count, estimated_credits, voice_choice, narrator_kind, generator,
  generator_model, voice_settings, created_at, updated_at, proposed_at, decided_at, published_at
  from ozikoro_episode order by id`);
for (const r of eps) {
  console.log('='.repeat(100));
  for (const [k, v] of Object.entries(r)) if (k !== 'voice_settings') console.log(`  ${k.padEnd(20)} ${String(v)}`);
  console.log(`  voice_settings       ${JSON.stringify(r.voice_settings)}`);
}

const revs = await q('revisions', `select * from ozikoro_episode_revision order by id`);
for (const r of revs) {
  const { script, transcript, ...rest } = r as Record<string, unknown>;
  console.log('  ', JSON.stringify(rest));
  console.log('     script words:', String(script ?? '').split(/\s+/).filter(Boolean).length,
              'chars:', String(script ?? '').length);
}

await q('transitions', `select * from ozikoro_episode_transition order by id`);
await q('applied migrations', `select * from schema_migration order by 1`);
await closeDb();
