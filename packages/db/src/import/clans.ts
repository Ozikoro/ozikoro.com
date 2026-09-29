/**
 * The clan registry, from the curated file.
 *
 *   node packages/db/src/import/clans.ts            # report only
 *   node packages/db/src/import/clans.ts --apply
 *
 * `data/clans/clans.json` is tracked in git, like the curated name knowledge and
 * the proverb renderings, because it is OUR reading of the sources rather than a
 * corpus: every clan in it was assembled by hand from the books named in its
 * `source` field, and a clan that is wrong should be correctable by editing one
 * line and re-running this.
 *
 * The import is idempotent and additive. A clan already present is updated in
 * place; a clan that disappears from the file is NOT deleted, because its page
 * may be linked from elsewhere and dropping a row silently is the failure mode
 * that costs a reader a page with no explanation. Use --prune to remove clans
 * the file no longer lists, and read the report first.
 *
 * `source` is written to the database and never rendered: the site does not
 * publish where its material came from, and the repository still needs to know.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb } from '../client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CLAN_FILE = resolve(HERE, '..', '..', '..', '..', 'data', 'clans', 'clans.json');

/**
 * A division — the level above the clan.
 *
 * Named `TribeEntry` because it is written to the `tribe` table, and named
 * `divisions` in the file because that is what the level actually is: the six
 * regional divisions of Igboland, each of which holds several tribes, and each of
 * those tribes a set of clans. The file used to call this list `tribes` and had
 * Isu in it as a peer of the divisions, which is wrong on the owner's own
 * classification — Isu is a tribe of Southern Igbo. The old key is still read so
 * an older copy of the file imports, and the new one wins.
 */
interface TribeEntry {
  name: string;
  slug?: string;
  note?: string;
  source?: string;
  /** The tribes of this division, as the classification sets them out. */
  tribes?: string[];
  /** The places the division is known by. */
  keyAreas?: string[];
}

interface ClanEntry {
  name: string;
  /** clan | town | section | confederation | kingdom | other. */
  kind?: string;
  /** The nation this people belongs to. Defaults to Igbo. */
  ethnicGroup?: string;
  /** The entry this one belongs to: a town's clan, a clan's confederation. */
  parent?: string;
  /** Other names the sources give for the same clan — the town that leads it, often. */
  aliases?: string[];
  slug?: string;
  /** The division the clan belongs to. */
  tribe?: string;
  /**
   * The tribe within the division, where a source names one — the article's own
   * tribe name, or Forde & Jones's group name. Empty means not yet established,
   * which is the honest state for most of the registry: the sources it rests on
   * divide by region and by table, not by tribe.
   */
  subgroup?: string;
  region?: string;
  /** The Nigerian state(s) the group is in today. Empty means not yet researched. */
  states?: string[];
  /** The local government area(s) it falls under today. */
  lgas?: string[];
  origin_summary?: string;
  description?: string[];
  towns?: (string | { name: string; head?: boolean })[];
  source?: string;
}

interface ClanFile {
  /** The six divisions. `tribes` is the old name for this key and is still read. */
  divisions?: TribeEntry[];
  tribes?: TribeEntry[];
  clans?: ClanEntry[];
}

export interface ClanImportReport {
  tribes: number;
  clans: number;
  towns: number;
  updated: number;
  pruned: number;
  missingTribe: string[];
  dryRun: boolean;
}

/** A URL-safe slug. The curated file may give one; this is the fallback. */
function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function importClans(
  options: { file?: string; apply?: boolean; prune?: boolean; log?: (m: string) => void } = {}
): Promise<ClanImportReport> {
  const log = options.log ?? ((m: string) => console.log(m));
  const path = options.file ?? process.env.OZITUMA_CLAN_FILE ?? DEFAULT_CLAN_FILE;
  const doc = JSON.parse(await readFile(path, 'utf8')) as ClanFile;
  const tribes = doc.divisions ?? doc.tribes ?? [];
  const clans = doc.clans ?? [];
  const db = await getDb();

  log(`  reading ${path}`);
  log(
    `  ${tribes.length} divisions, ${clans.length} clans in the file` +
      ` (${clans.filter((c) => c.subgroup).length} with a tribe recorded)`
  );

  /*
   * Two entries with one slug would be written to the same row, and the second
   * would overwrite the first without a word: `on conflict (slug) do update` does
   * exactly what it says. That is how the registry came to hold 261 clans while
   * the file held 262 — two entries named Onicha, and one of them was gone. A
   * silent loss of an entry is the one failure this importer must never have, so
   * the file is checked here and the import refuses rather than losing it.
   */
  const slugCounts = new Map<string, string[]>();
  for (const clan of clans) {
    const slug = clan.slug ?? slugify(clan.name);
    slugCounts.set(slug, [...(slugCounts.get(slug) ?? []), clan.name]);
  }
  const collisions = [...slugCounts.entries()].filter(([, names]) => names.length > 1);
  if (collisions.length > 0) {
    const detail = collisions
      .map(([slug, names]) => `${slug} <- ${names.join(', ')}`)
      .join('; ');
    throw new Error(
      `two clan entries share one slug, so importing would silently drop one: ${detail}. ` +
        'Qualify one of the names — the file does this for the two Abajas, the two Uburus ' +
        'and the two Isus — and import again.'
    );
  }

  const missingTribe: string[] = [];
  const tribeNames = new Set(tribes.map((t) => t.name));
  for (const clan of clans) {
    if (clan.tribe && !tribeNames.has(clan.tribe)) missingTribe.push(`${clan.name} -> ${clan.tribe}`);
  }
  if (missingTribe.length > 0) {
    log(`  ! ${missingTribe.length} clans name a division the file does not define: ${missingTribe.slice(0, 3).join(', ')}`);
  }

  if (!options.apply) {
    const towns = clans.reduce((sum, c) => sum + (c.towns?.length ?? 0), 0);
    return {
      tribes: tribes.length,
      clans: clans.length,
      towns,
      updated: 0,
      pruned: 0,
      missingTribe,
      dryRun: true,
    };
  }

  // Tribes first: a clan's tribe_id needs them to exist.
  const tribeId = new Map<string, number>();
  for (const [index, tribe] of tribes.entries()) {
    const row = await db.one<{ id: string }>(
      `insert into tribe (slug, name, note, source, position)
       values ($1, $2, $3, $4, $5)
       on conflict (slug) do update
         set name = excluded.name, note = excluded.note,
             source = excluded.source, position = excluded.position
       returning id`,
      [tribe.slug ?? slugify(tribe.name), tribe.name, tribe.note ?? null, tribe.source ?? null, index]
    );
    tribeId.set(tribe.name, Number(row?.id ?? 0));
  }

  let updated = 0;
  let townCount = 0;
  for (const [index, clan] of clans.entries()) {
    const slug = clan.slug ?? slugify(clan.name);
    const row = await db.one<{ id: string }>(
      /*
       * `published` is set from the same rule migration 0022 used: the Igbo entries are the ones with
       * sourced material behind them, and the rest are held back until they are researched.
       *
       * It has to be written here rather than left to the column default. A rename changes the slug, so
       * the import inserts a NEW row — and a new row defaulted to unpublished, which meant every
       * correction to a name produced an entry that existed in the database and 404'd on the site.
       * That is how Arondizuogu and Ezangbo went missing the moment they were spelled correctly.
       */
      `insert into clan (slug, name, aliases, kind, ethnic_group, tribe_id, region, states, lgas, origin_summary, description, source, position, published, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
       on conflict (slug) do update
         set name = excluded.name,
             aliases = excluded.aliases,
             kind = excluded.kind,
             ethnic_group = excluded.ethnic_group,
             tribe_id = excluded.tribe_id,
             region = excluded.region,
             states = excluded.states,
             lgas = excluded.lgas,
             origin_summary = excluded.origin_summary,
             description = excluded.description,
             source = excluded.source,
             position = excluded.position,
             published = excluded.published,
             updated_at = now()
       returning id`,
      [
        slug,
        clan.name,
        clan.aliases ?? [],
        clan.kind ?? 'clan',
        clan.ethnicGroup ?? 'Igbo',
        clan.tribe ? (tribeId.get(clan.tribe) ?? null) : null,
        clan.region ?? null,
        clan.states ?? [],
        clan.lgas ?? [],
        clan.origin_summary ?? null,
        clan.description ?? [],
        clan.source ?? null,
        index,
        (clan.ethnicGroup ?? 'Igbo') === 'Igbo',
      ]
    );
    const id = Number(row?.id ?? 0);
    if (!id) continue;
    updated += 1;

    for (const town of clan.towns ?? []) {
      const name = typeof town === 'string' ? town : town.name;
      const head = typeof town === 'string' ? false : Boolean(town.head);
      await db.query(
        `insert into clan_town (clan_id, name, is_head, source)
         values ($1, $2, $3, $4)
         on conflict (clan_id, name) do update set is_head = excluded.is_head`,
        [id, name, head, clan.source ?? null]
      );
      townCount += 1;
    }
  }

  /*
   * Parents second, because a parent may be written after its child in the file.
   * A parent naming an entry that does not exist is reported rather than dropped:
   * it means the file and the database disagree about what exists.
   */
  /*
   * Clear every parent first. A parent removed from the file must actually go:
   * the loop below only ever SETS one, so a link deleted here would otherwise
   * survive in the database — which is how two entries stayed pointing at each
   * other after the file had stopped saying so.
   */
  const slugs = clans.map((c) => c.slug ?? slugify(c.name));
  if (slugs.length > 0) {
    await db.query(`update clan set parent_id = null where slug = any($1::text[])`, [slugs]);
  }

  let linked = 0;
  const unresolved: string[] = [];
  for (const clan of clans) {
    if (!clan.parent) continue;
    const slug = clan.slug ?? slugify(clan.name);
    const parentSlug = slugify(clan.parent);
    /*
     * A parent is named in the file the way a person would write it — "Umu-Eri
     * (Eri)" — which is not its slug, so matching on the slug alone silently
     * failed for every parent whose name carries a parenthesis. The match is on
     * the slug, the name, or an alias, whichever the file happens to use.
     */
    const result = await db.query(
      `update clan c set parent_id = p.id
         from clan p
        where c.slug = $1
          and c.id <> p.id
          and (p.slug = $2
               or lower(p.name) = lower($3)
               or lower($3) = any(select lower(a) from unnest(p.aliases) as a))`,
      [slug, parentSlug, clan.parent]
    );
    if ((result.rowCount ?? 0) > 0) linked += 1;
    else unresolved.push(`${clan.name} -> ${clan.parent}`);
  }
  if (linked > 0) log(`  linked ${linked} entries to a parent entry`);
  if (unresolved.length > 0) {
    log(`  ! ${unresolved.length} parents are not entries in the file: ${unresolved.slice(0, 4).join(', ')}`);
  }

  let pruned = 0;
  if (options.prune) {
    const slugs = clans.map((c) => c.slug ?? slugify(c.name));
    const result = await db.query(`delete from clan where not (slug = any($1::text[]))`, [slugs]);
    pruned = result.rowCount ?? 0;
  }

  /*
   * Divisions the file no longer lists, and that hold nothing.
   *
   * A division's row survives the file that renamed it, because the importer never
   * deletes anything a reader might have linked to. So renaming the level — as the
   * owner did when he moved Isu out of the divisions and into Southern Igbo — left
   * the old names behind as empty shells, and one of them was Isu itself: a
   * division in the registry with nothing in it, which is exactly the thing he
   * asked to have removed.
   *
   * The rule is narrow on purpose. A division is deleted only when the file does
   * not name it AND no clan anywhere points at it. Anything holding an entry stays,
   * however the file has changed, because a clan filed under a name the file has
   * dropped is a question for a person, not for an import.
   */
  const fileNames = tribes.map((tribe) => tribe.name);
  const emptied = await db.rows<{ name: string }>(
    `delete from tribe t
      where not (t.name = any($1::text[]))
        and not exists (select 1 from clan c where c.tribe_id = t.id)
      returning t.name`,
    [fileNames]
  );

  log(`  wrote ${tribeId.size} tribes, ${updated} clans, ${townCount} town rows`);
  if (emptied.length > 0) {
    log(`  removed ${emptied.length} empty divisions the file no longer names: ${emptied.map((r) => r.name).join(', ')}`);
  }
  if (options.prune) log(`  pruned ${pruned} clans the file no longer lists`);

  return {
    tribes: tribeId.size,
    clans: updated,
    towns: townCount,
    updated,
    pruned,
    missingTribe,
    dryRun: false,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`Clan registry${apply ? '' : ' (dry run)'}\n`);
  const report = await importClans({ apply, prune: process.argv.includes('--prune') });
  if (report.dryRun) console.log('\n  Re-run with --apply to write these rows.');
  await closeDb();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
