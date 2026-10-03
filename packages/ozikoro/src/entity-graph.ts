/**
 * The knowledge graph's first residents: the dictionary's own clans and towns.
 *
 * THE PROBLEM THIS SOLVES
 *
 * `ozikoro_entity` holds zero rows and `ozikoro_entity_relation` holds zero rows, so the archive's
 * filter rail can offer no clan, no town and no ethnic group, and `/admin/archive` cannot report on
 * records that name a place. **The 188 published clans and their 995 towns already exist in the
 * dictionary**, migrated and sourced, with names, aliases, an ethnic group, a region and the state
 * each one is in today. Nothing needs inventing; the graph node simply has to be made to point at
 * the record that is already there.
 *
 * WHY THIS IS IDEMPOTENT AND WHY THAT MATTERS
 *
 * It is run more than once. A clan published after today must be picked up by a second run, and a
 * second run must not create a duplicate of a clan it already made. So identity is the dictionary
 * row — `ozikoro_entity.clan_id` — and never the name: two towns genuinely share a name in this
 * record, and matching on text would merge them.
 *
 * WHAT IT REFUSES TO DO
 *
 * It writes no coordinates. `latitude` and `longitude` are columns the schema offers and the clan
 * records hold no values for, and **the brief forbids inventing them** — a plausible-looking dot on
 * a map is a fabricated fact with a picture around it. It also writes no periods and no sources:
 * those need a human reading the record, and this module's whole discipline is that it only moves
 * something that is already recorded into a place where it can be queried.
 *
 * ARTICLE LINKS ARE TITLE-BASED, WHICH IS A REAL LIMIT
 *
 * An article is linked to a town whose name appears in its TITLE — not its body. A title match is
 * evidence the record is about the place; a body match is evidence the place was mentioned, which
 * is a far weaker claim and would attach nearly every record to nearly every town. **So this links
 * fewer records than a body search would and every link it makes is defensible.** The rest are
 * editorial work, which is why the queue exists.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';

/** What one run did, in numbers a screen can print without interpreting them. */
export interface EntityGraphReport {
  /** True when nothing was written and this was a rehearsal. */
  dryRun: boolean;
  /** The dictionary's published rows that were considered. */
  considered: number;
  entitiesCreated: number;
  entitiesAlreadyPresent: number;
  /**
   * Published rows deliberately skipped, with the reason.
   *
   * A colonial section or an administrative grouping is not a clan and not a town, and calling one
   * either would be the mistake `clan.kind` was added to correct. They are counted and named rather
   * than silently dropped, because a number a reader cannot explain is a number they cannot trust.
   */
  skipped: { name: string; kind: string }[];
  linksCreated: number;
  articlesLinked: number;
  /** A few examples, so the screen can show what happened rather than only how much. */
  sampleEntities: string[];
  sampleLinks: { article: string; entity: string }[];
  /** Named because their absence is the point, not an oversight. */
  coordinatesWritten: 0;
}

/**
 * Which `ozikoro_entity.kind` a dictionary row becomes.
 *
 * `clan`, `town` and `kingdom` have exact counterparts in the entity vocabulary, and `confederation`
 * is a `people` — a named grouping of clans is a people in the archive's sense, not a polity.
 * `section` is the colonial administrative division that migration 0019 exists to stop presenting
 * as a clan, and `other` is an administrative grouping: neither is a place anybody names, so
 * neither becomes an entity. **Returning null here is the correction, not a gap.**
 */
const KIND_MAP: Record<string, string | null> = {
  clan: 'clan',
  town: 'town',
  kingdom: 'kingdom',
  confederation: 'people',
  section: null,
  other: null,
};

/** Word-boundary match, so "Owa" does not match "Owan". */
function namesTown(title: string, town: string): boolean {
  const escaped = town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, 'i').test(title);
}

/** Shortest name that is still evidence. Three letters matches too much to mean anything. */
const MIN_NAME = 4;

interface ClanRow {
  id: number;
  slug: string;
  name: string;
  kind: string | null;
  region: string | null;
  ethnic_group: string | null;
  origin_summary: string | null;
  aliases: string[] | null;
  published: boolean;
}

/**
 * Build the graph from the dictionary.
 *
 * `actorId` is required and not optional: this writes `ozikoro_audit` rows, and an audit row that
 * cannot name the person who made the change is the one kind of row an audit must never contain.
 * A script that runs headless passes a real operator's account id — which is what the CLI below
 * does, and what the back office does when the owner presses the button.
 */
export async function buildEntityGraph(
  db: Db,
  options: { actorId: number; dryRun?: boolean } = { actorId: 0 }
): Promise<EntityGraphReport> {
  const dryRun = Boolean(options.dryRun);

  const actor = await db.one<{ n: number }>(`select count(*)::int as n from account where id = $1`, [options.actorId]);
  if (Number(actor?.n ?? 0) === 0) {
    throw new MemberError(
      'no_actor',
      'Building the graph writes an audit row naming who did it, so it needs a real account. That account does not exist.'
    );
  }

  /*
   * PUBLISHED ROWS ONLY. An unpublished clan is one the dictionary has decided not to show, and
   * moving it into the archive's graph would publish it here by the side door.
   */
  const clans = await db.rows<ClanRow>(
    `select id, slug, name, kind, region, ethnic_group, origin_summary, aliases, published
       from clan where published = true order by id`
  );

  const report: EntityGraphReport = {
    dryRun,
    considered: clans.length,
    entitiesCreated: 0,
    entitiesAlreadyPresent: 0,
    skipped: [],
    linksCreated: 0,
    articlesLinked: 0,
    sampleEntities: [],
    sampleLinks: [],
    coordinatesWritten: 0,
  };

  // --- 1. one entity per dictionary row, identified by the dictionary row ---------------
  for (const clan of clans) {
    const kind = KIND_MAP[clan.kind ?? 'clan'] ?? 'clan';
    if (kind === null) {
      report.skipped.push({ name: clan.name, kind: clan.kind ?? 'unknown' });
      continue;
    }

    const existing = await db.one<{ id: string }>(`select id from ozikoro_entity where clan_id = $1`, [clan.id]);
    if (existing) {
      report.entitiesAlreadyPresent += 1;
      continue;
    }

    if (dryRun) {
      report.entitiesCreated += 1;
      if (report.sampleEntities.length < 8) report.sampleEntities.push(`${clan.name} (${kind})`);
      continue;
    }

    /*
     * THE SLUG IS THE DICTIONARY'S OWN. `/entities/<slug>` therefore answers at the same address
     * the dictionary uses for the same place, which is what makes the two sites one institution
     * rather than two directories of the same towns. A collision is possible in principle — an
     * entity kind the dictionary does not have could take the slug first — so the insert falls
     * back to a numbered suffix rather than failing the whole run.
     */
    let slug = clan.slug;
    for (let n = 2; n < 200; n += 1) {
      const taken = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_entity where slug = $1`, [slug]);
      if (Number(taken?.n ?? 0) === 0) break;
      slug = `${clan.slug}-${n}`;
    }

    /*
     * NO `on conflict` HERE, AND THAT IS DELIBERATE.
     *
     * The uniqueness that stops a second entity for the same clan is a PARTIAL unique index
     * (`where clan_id is not null`, migration 0048), and Postgres cannot infer a partial index as
     * an `on conflict` arbiter unless the statement repeats the predicate:
     *
     *     on conflict (clan_id) where clan_id is not null do nothing
     *
     * Getting that wrong is not a silent no-op — it fails the whole run with
     * `there is no unique or exclusion constraint matching the ON CONFLICT specification`, which is
     * how this line was found. The existence check above is the guard the loop actually needs, and
     * the index is the guard the DATABASE holds; the insert is left plain so the failure of a
     * duplicate would be loud rather than swallowed.
     */
    const inserted = await db.one<{ id: string }>(
      `insert into ozikoro_entity (kind, slug, name, aliases, summary, clan_id)
       values ($1,$2,$3,$4,$5,$6)
       returning id`,
      [kind, slug, clan.name, clan.aliases ?? [], clan.origin_summary, clan.id]
    );

    if (!inserted) {
      // Defensive only: the statement above either returns a row or throws. Counted rather than
      // ignored, because a run that quietly did nothing must never look like a run that succeeded.
      report.entitiesAlreadyPresent += 1;
      continue;
    }

    report.entitiesCreated += 1;
    if (report.sampleEntities.length < 8) report.sampleEntities.push(`${clan.name} (${kind})`);
    await audit(db, {
      entityType: 'ozikoro_entity',
      entityId: Number(inserted.id),
      action: 'create_from_dictionary',
      after: { name: clan.name, kind, slug, clanId: clan.id },
      actorId: options.actorId,
    });
  }

  // --- 2. link the records whose title names a place -----------------------------------
  /*
   * THE ROLE IS THE ENTITY'S KIND, NOT A CONSTANT.
   *
   * `ozikoro_article_entity.role` is what the filter rail groups by: an article is "about a clan"
   * or "about a town", and the two are different filters. Writing `'town'` for every link — which
   * the first version of this did — put 142 clans into the town group and left the clan group
   * **provably empty while 146 records were linked to clans**, so the rail offered a filter that
   * matched nothing and a count that disagreed with the data. The role is read from the entity.
   */
  const ROLE_FOR_ENTITY_KIND: Record<string, string> = {
    clan: 'clan',
    town: 'town',
    people: 'ethnic_group',
    kingdom: 'place',
  };

  const entities = await db.rows<{ id: number; name: string; kind: string }>(
    `select id, name, kind from ozikoro_entity
      where clan_id is not null and length(name) >= ${MIN_NAME}`
  );
  const articles = await db.rows<{ id: number; title: string }>(
    `select id, title from ozikoro_article where is_page = false and status = 'published'`
  );

  const linked = new Set<number>();
  for (const article of articles) {
    for (const entity of entities) {
      if (!namesTown(article.title, entity.name)) continue;

      const role = ROLE_FOR_ENTITY_KIND[entity.kind] ?? 'place';
      const already = await db.one<{ n: number }>(
        `select count(*)::int as n from ozikoro_article_entity where article_id = $1 and entity_id = $2 and role = $3`,
        [article.id, entity.id, role]
      );
      const isNew = Number(already?.n ?? 0) === 0;
      if (isNew) report.linksCreated += 1;
      linked.add(article.id);
      if (report.sampleLinks.length < 8) report.sampleLinks.push({ article: article.title, entity: entity.name });

      if (dryRun || !isNew) continue;
      await db.query(
        `insert into ozikoro_article_entity (article_id, entity_id, role) values ($1,$2,$3)
         on conflict do nothing`,
        [article.id, entity.id, role]
      );
      await audit(db, {
        entityType: 'ozikoro_article',
        entityId: article.id,
        action: 'link_entity_from_title',
        after: { entityId: entity.id, entityName: entity.name, role },
        actorId: options.actorId,
      });
    }
  }
  report.articlesLinked = linked.size;

  /*
   * One summary row, so the trail answers "when was the graph built, and by whom" without a reader
   * having to count several hundred rows. The per-entity rows above stay: they are what makes a
   * single wrong entity traceable back to the run that made it.
   */
  if (!dryRun) {
    await audit(db, {
      entityType: 'ozikoro_entity_graph',
      entityId: 0,
      action: 'build_from_dictionary',
      after: {
        considered: report.considered,
        entitiesCreated: report.entitiesCreated,
        entitiesAlreadyPresent: report.entitiesAlreadyPresent,
        linksCreated: report.linksCreated,
        articlesLinked: report.articlesLinked,
        skipped: report.skipped.length,
      },
      actorId: options.actorId,
    });
  }

  return report;
}

/**
 * The audit write, local rather than imported from `members.ts`.
 *
 * `members.ts` keeps its own private copy for the same reason: this is the one write that must
 * never be the reason an action fails, and a shared helper would make the failure mode of both
 * paths one decision. **The `catch` is deliberate** — a missing audit row is bad, and a graph that
 * half-built because the audit table was unavailable is worse.
 */
async function audit(
  db: Db,
  event: {
    entityType: string;
    entityId: number;
    action: string;
    before?: unknown;
    after?: unknown;
    actorId: number;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        event.entityType,
        event.entityId,
        event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId,
        null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/entity-graph] could not record an audit event:', String(error).slice(0, 160));
  }
}

/**
 * What the graph holds now, for the screen that offers to build it.
 *
 * Separate from `buildEntityGraph` because a page must be able to describe the graph without
 * running anything, and a "preview" that ran the build and rolled back would lock rows for the
 * length of the request.
 */
export async function getEntityGraphState(db: Db): Promise<{
  entities: number;
  withCoordinates: number;
  byKind: { kind: string; n: number }[];
  relations: number;
  articleLinks: number;
  articlesWithAPlace: number;
  records: number;
  /** Published dictionary rows the builder would consider, so the preview can promise a number. */
  dictionaryPublished: number;
  /** Published rows it would deliberately not turn into entities — sections and 'other'. */
  dictionaryNotPlaces: number;
}> {
  const [counts, byKind, dict] = await Promise.all([
    db.one<Record<string, unknown>>(`
      select (select count(*)::int from ozikoro_entity) as entities,
             (select count(*)::int from ozikoro_entity where latitude is not null or longitude is not null) as with_coords,
             (select count(*)::int from ozikoro_entity_relation) as relations,
             (select count(*)::int from ozikoro_article_entity) as article_links,
             (select count(distinct article_id)::int from ozikoro_article_entity) as articles_with_a_place,
             (select count(*)::int from ozikoro_article where status='published' and is_page=false) as records
    `),
    db.rows<{ kind: string; n: number }>(
      `select kind, count(*)::int as n from ozikoro_entity group by kind order by n desc, kind`
    ),
    db.one<{ published: number; not_places: number }>(
      `select count(*)::int as published,
              count(*) filter (where kind in ('section','other'))::int as not_places
         from clan where published = true`
    ),
  ]);

  return {
    entities: Number(counts?.entities ?? 0),
    withCoordinates: Number(counts?.with_coords ?? 0),
    byKind: byKind.map((r) => ({ kind: r.kind, n: Number(r.n) })),
    relations: Number(counts?.relations ?? 0),
    articleLinks: Number(counts?.article_links ?? 0),
    articlesWithAPlace: Number(counts?.articles_with_a_place ?? 0),
    records: Number(counts?.records ?? 0),
    dictionaryPublished: Number(dict?.published ?? 0),
    dictionaryNotPlaces: Number(dict?.not_places ?? 0),
  };
}
