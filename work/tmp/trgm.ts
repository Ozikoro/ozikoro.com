import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
const r = await db.one<{ n: number }>(`select count(*)::int as n from pg_extension where extname = 'pg_trgm'`);
console.log('pg_trgm installed:', r?.n === 1);
try {
  const s = await db.one<{ v: number }>(`select similarity('umuleru','umuleri')::numeric(4,3) as v`);
  console.log('similarity(umuleru, umuleri) =', s?.v);
  const t = await db.one<{ v: number }>(`select similarity('ogburike','ogbunike')::numeric(4,3) as v`);
  console.log('similarity(ogburike, ogbunike) =', t?.v);
} catch (e) { console.log('similarity not available:', String(e).slice(0, 80)); }
await closeDb();
