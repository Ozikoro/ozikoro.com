import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
for (const [t, cols] of Object.entries({
  word: ['language_id', 'headword', 'exact_form', 'slug', 'status'],
  person_name: ['origins', 'status'],
  example_word: ['word_id', 'example_id'],
  definition: ['word_id', 'position'],
  language: ['id', 'code'],
})) {
  const rows = await db.rows<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = $1`, [t]);
  const have = new Set(rows.map((r) => r.column_name));
  const missing = cols.filter((c) => !have.has(c));
  console.log(`${t}: ${missing.length ? 'MISSING ' + missing.join(', ') : 'ok'}`);
}
await closeDb();
