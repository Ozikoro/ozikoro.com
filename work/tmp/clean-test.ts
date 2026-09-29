import { closeDb, getDb } from '../../packages/db/src/client.ts';
const db = await getDb();
await db.query(`delete from account where email in ('zztest-admin@example.com','zztest-editor@example.com')`);
await db.query(`update clan set name = 'Ohaffia', slug = 'ohaffia' where id = 180`);
await closeDb();
