import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const cols = await db.rows<{ column_name: string }>(
  `select column_name from information_schema.columns where table_name='word_script' order by ordinal_position`);
console.log('word_script:', cols.map((c) => c.column_name).join(', '));
const counts = await db.rows(`select script_code, count(*)::int as n from word_script group by 1`);
console.log('rows by script:', JSON.stringify(counts));
const sample = await db.rows(
  `select ws.value, w.headword from word_script ws join word w on w.id = ws.word_id
    where ws.script_code = 'Ndebe' limit 5`);
console.log('samples:', JSON.stringify(sample, null, 1));
await closeDb();
