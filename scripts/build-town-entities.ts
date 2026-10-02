/**
 * Phase 5, the part that can be done honestly: entities for the towns the archive already holds.
 *
 * WHAT THIS DOES AND WHAT IT DELIBERATELY DOES NOT
 *
 * `ozikoro_entity` holds zero rows. The audit's Phase 5 asks for entities to be populated and for articles to
 * be attached to places, periods and sources — **and most of that is editorial work**: attaching a period to a
 * history means reading it, and attaching a source means knowing where it came from. This script does the part
 * that is mechanical and grounded instead.
 *
 * **188 published clans already exist, with real names, regions, ethnic groups and origin summaries.** An
 * entity is created for each, with `clan_id` pointing at the record it came from, so the graph node and the
 * clan row cannot drift apart. The summary is the clan's own `origin_summary` where one was recorded, and null
 * where none was — never a sentence this script wrote.
 *
 * COORDINATES ARE LEFT NULL, AND THAT IS THE POINT
 *
 * `latitude` and `longitude` are columns the schema offers and this script refuses to fill. **The brief is
 * explicit: do not create fake coordinates.** The clan records carry no coordinates, so the entities carry
 * none either, and every map surface in the archive must handle that rather than a plausible-looking dot.
 *
 * ARTICLE LINKS ARE TITLE-BASED, WHICH IS A REAL LIMIT
 *
 * `ozikoro_article_entity` is filled by matching a town's name in an article's TITLE — not its body. A title
 * match is evidence that the article is about the place; a body match is evidence that the place was mentioned,
 * which is a much weaker claim and would attach almost every article to almost every town. **So this links
 * fewer articles than a body search would and every link it makes is defensible.** The remaining links are
 * editorial work, not a bigger regex.
 */
import { getDb, closeDb } from '@ozituma/db/client';

const db = await getDb();

// --- 1. one entity per published clan --------------------------------------
const clans = await db.rows<{
  id: number; slug: string; name: string; kind: string | null; region: string | null;
  ethnic_group: string | null; origin_summary: string | null; aliases: string[] | null;
}>(
  `select id, slug, name, kind, region, ethnic_group, origin_summary, aliases
     from clan where published = true order by id`
);

let made = 0, kept = 0;
for (const c of clans) {
  const existing = await db.one<{ id: number }>(
    `select id from ozikoro_entity where clan_id = $1`, [c.id]
  );
  if (existing) { kept += 1; continue; }
  await db.query(
    `insert into ozikoro_entity (kind, slug, name, aliases, summary, clan_id)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (slug) do nothing`,
    [
      c.kind === 'town' ? 'town' : 'clan',
      c.slug,
      c.name,
      c.aliases ?? [],
      // The clan's own words where it has them, and null where it does not.
      c.origin_summary,
      c.id,
    ]
  );
  made += 1;
}
console.log(`  entities: ${made} created, ${kept} already present (from ${clans.length} published clans)`);
console.log(`  coordinates left null on every one: the clan records carry none, and the brief forbids inventing them`);

// --- 2. link articles whose TITLE names a town ------------------------------
const entities = await db.rows<{ id: number; name: string }>(
  `select id, name from ozikoro_entity where clan_id is not null`
);
const articles = await db.rows<{ id: number; title: string }>(
  `select id, title from ozikoro_article where is_page = false`
);

/** Word-boundary match on the town's name, so "Owa" does not match "Owan". */
function namesTown(title: string, town: string): boolean {
  const escaped = town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, 'i').test(title);
}

let links = 0, matchedArticles = new Set<number>();
for (const a of articles) {
  for (const e of entities) {
    if (e.name.length < 4) continue; // a three-letter name matches too much to be evidence
    if (!namesTown(a.title, e.name)) continue;
    await db.query(
      `insert into ozikoro_article_entity (article_id, entity_id, role)
       values ($1,$2,'town') on conflict do nothing`,
      [a.id, e.id]
    );
    links += 1;
    matchedArticles.add(a.id);
  }
}
console.log(`  links: ${links} article-to-town, across ${matchedArticles.size} articles`);
console.log(`  matched on TITLE only — a body search would link far more and claim far less`);

const stats = await db.rows(`select
  (select count(*)::int from ozikoro_entity) as entities,
  (select count(*)::int from ozikoro_entity where latitude is not null) as with_coords,
  (select count(*)::int from ozikoro_article_entity) as links`);
console.log(`  now: ${stats[0].entities} entities · ${stats[0].with_coords} with coordinates · ${stats[0].links} links`);
await closeDb();
