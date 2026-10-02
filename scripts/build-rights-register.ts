/**
 * Phase 6: a rights record for every media item, stating what is KNOWN and what is not.
 *
 * THE PROBLEM THIS ADDRESSES
 *
 * 3,437 media files are held and served. `ozikoro_media_rights` held zero rows, so **not one of them had a
 * recorded rights decision** — which the audit called a licence risk rather than a gap, and it is right.
 * Serving a file is a decision whether or not anyone wrote it down.
 *
 * WHAT THIS CANNOT DO, AND DOES NOT PRETEND TO
 *
 * **It cannot establish permission.** Nobody can, from inside the database: the migration carried the
 * WordPress library and WordPress records no rights fields at all. So every record created here says exactly
 * that.
 *
 * THE FOUR BOOLEANS, WHICH ARE NOT NULL AND THEREFORE HAVE TO BE ANSWERED
 *
 * `allows_publication`, `allows_derivative`, `allows_commercial` and `restricted` are all NOT NULL, so
 * "unassessed" is not available for them and a value has to be chosen. The choice is made in the direction
 * that claims the LEAST:
 *
 *   allows_publication = true    a fact, not an inference: the archive is serving these files now, and a
 *                                record saying otherwise would be false about the present
 *   allows_derivative = false    no permission to reuse or adapt has been established, so none is granted
 *   allows_commercial = false    likewise
 *   restricted        = false    nothing here is under an access restriction; these are public records
 *
 * **So the register permits what is already happening and grants nothing further.** A false on derivative or
 * commercial is not an assertion that reuse is forbidden — it is the absence of a permission that was never
 * given, which is the accurate description.
 *
 * AND THE FIELDS THAT CARRY THE HONESTY
 *
 *   permission_basis = 'unknown'   the schema allows it, and it is the truth
 *   subject_consent  = 'not_sought' for images, because no living person's consent was sought in a migration
 *                                   that had no mechanism for seeking it
 *   permission_note                says all of the above in words, per record
 *
 * AN ORPHAN WORK IS NOT A LICENCE
 *
 * `permission_basis` offers 'orphan_work' and this does not use it. **An orphan work is a determination that
 * a rights holder could not be found after a diligent search**, and no such search has been made for these
 * files. Recording them as orphaned would be inventing the outcome of a process nobody ran.
 */
import { getDb, closeDb } from '@ozituma/db/client';

const db = await getDb();

const NOTE =
  'Migrated from the previous WordPress library, which records no rights information. Publication is ' +
  'recorded because the archive serves the file; no permission for reuse or adaptation has been ' +
  'established, and none is granted. This is an absence of permission rather than a refusal of it.';

const media = await db.rows<{ id: number; subject_is_living_possible: boolean }>(
  `select m.id, false as subject_is_living_possible
     from ozikoro_media m
    where not exists (select 1 from ozikoro_media_rights r where r.media_id = m.id)`
);

console.log(`  media items with no rights record: ${media.length}`);

let made = 0;
for (const m of media) {
  await db.query(
    `insert into ozikoro_media_rights
       (media_id, allows_publication, allows_derivative, allows_commercial, restricted,
        permission_basis, subject_consent, permission_note)
     values ($1, true, false, false, false, 'unknown', 'not_sought', $2)
     on conflict (media_id) do nothing`,
    [m.id, NOTE]
  );
  made += 1;
  if (made % 500 === 0) process.stdout.write(`\r  written ${made}   `);
}
console.log('');

const s = await db.one<{ n: number; pub: number; deriv: number; comm: number; unknown: number; consent: number }>(
  `select count(*)::int n,
          count(*) filter (where allows_publication)::int pub,
          count(*) filter (where allows_derivative)::int deriv,
          count(*) filter (where allows_commercial)::int comm,
          count(*) filter (where permission_basis = 'unknown')::int unknown,
          count(*) filter (where subject_consent = 'not_sought')::int consent
     from ozikoro_media_rights`
);
console.log(`  rights records      ${s?.n}`);
console.log(`    publication       ${s?.pub}   (a fact: the archive serves them)`);
console.log(`    derivative        ${s?.deriv}   (none permitted)`);
console.log(`    commercial        ${s?.comm}   (none permitted)`);
console.log(`    basis unknown     ${s?.unknown}`);
console.log(`    consent not sought ${s?.consent}`);
await closeDb();
