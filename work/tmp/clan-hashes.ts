/** Print name + hash of what each clan entry actually holds, for comparing two copies. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { closeDb, getDb } from '../../packages/db/src/client.ts';

const h = (parts: unknown[]) => createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);

const fromFile = process.argv.includes('--file');
if (fromFile) {
  const doc = JSON.parse(await readFile('data/clans/clans.json', 'utf8'));
  for (const c of doc.clans) {
    console.log([c.name, h([c.origin_summary ?? null, c.description ?? [], (c.towns ?? []).map((t: unknown) => (typeof t === 'string' ? t : (t as { name: string }).name))])].join('\t'));
  }
} else {
  const db = await getDb();
  const rows = await db.rows<Record<string, unknown>>(
    `select c.name, c.origin_summary as origin, c.description,
            coalesce((select array_agg(ct.name order by ct.name) from clan_town ct where ct.clan_id = c.id), '{}') as towns
       from clan c order by c.name`
  );
  for (const r of rows) {
    console.log([String(r.name), h([r.origin ?? null, r.description ?? [], r.towns ?? []])].join('\t'));
  }
  await closeDb();
}
