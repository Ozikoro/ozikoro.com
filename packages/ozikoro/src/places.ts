/**
 * Places: the clan register, and the towns, sections and confederations filed with it.
 *
 * WHY THIS MODULE EXISTS
 *
 * "app/towns" and "app/town/[slug]" read "clan" with SQL written inline in the page. They are the only
 * data-driven pages in this app that do — every other one calls a query function here. That was a gap
 * before the register arrived and it is a trap now, because the register is read by four routes (the
 * index, one entry, the divisions and the regions) and four copies of the same query is four places for
 * "published = true" to be forgotten.
 *
 * WHY IT READS OZIKORO'S OWN DATABASE AND NOT THE DICTIONARY'S
 *
 * Production is ONE Postgres database shared by ozituma.com and ozikoro.com —
 * "docker/docker-compose.prod.yml" gives both the same "DATABASE_URL", and "entities.ts" records
 * that as the thing which makes the two sites one platform rather than two databases sharing a
 * server. (It was three until the courses host was retired on 2026-10-04.) So the register is already here. Nothing is copied and nothing is imported; this module reads
 * the same "clan", "clan_town" and "tribe" rows the dictionary reads, and it never writes to them.
 *
 * THE COLUMN THIS WHOLE SECTION TURNS ON
 *
 * "clan" is not a table of clans. Migration 0019 records why: the registry was built from Forde & Jones
 * (1950), a colonial survey that tabulated the units a division was administered through, and of the 203
 * entries it then held only 120 were clans — 37 were single towns, 27 administrative sections, 12
 * confederations. Nothing was deleted; every entry was re-labelled. Of the 228 rows today, 188 are
 * published, and of those 188 only 124 are "kind = 'clan'": 37 are towns, 17 sections, 7 confederations,
 * 2 kingdoms and 1 an "other grouping". Presenting 188 clans would be wrong about 64 of them.
 *
 * WHAT IS DELIBERATELY NEVER DONE HERE
 *
 *   * No row is invented. "region", "states", "lgas", "origin_summary" and "aliases" are all nullable,
 *     and this module returns null rather than a guess.
 *   * An entry with no towns is not given any. "0015_clans.sql" says it plainly: "an empty "clan_town"
 *     set means the sources did not enumerate its towns, not that it has none." 47 of the 228 rows have
 *     no towns at all.
 *   * "published = false" is the whole of the visibility rule. 40 rows are held back — every non-Igbo
 *     entry and four Igbo ones — until their material is checked against a source.
 *   * No ethnic group is asserted for a name. "ethnic_group" defaults to 'Igbo' in the schema, so it is
 *     read from the row and shown, never inferred from a name or a state.
 *
 * THE SOURCE COLUMN
 *
 * "clan.source" holds the book, page and reading a row rests on. The module header in
 * "packages/db/src/clans.ts" records that it was internal for a long time and that the owner reversed
 * that for this section: "list the name of the books and authors when you mention about source". It is
 * returned here and rendered, because provenance is what makes the claim checkable.
 *
 * THE FOUR-STEP FINDER, AND WHY IT IS A FUNCTION HERE
 *
 * "/towns" carries the register's own finder: ethnicity, then division, then tribe or clan, then town,
 * then a name search. Each step offers only what sits inside the step above it, and with JavaScript off
 * that has to be computed on the server from the selection in the address — which makes the four levels
 * four questions about the same register, and puts them beside the query that lists it rather than inline
 * in a page. "getRegisterCascade" reads the published register once and derives the four levels from that
 * one reading, so the levels, the checking of whatever the address asked for, and the list the page
 * renders cannot disagree with each other.
 *
 * Three filter fields are new with that finder — "ethnic", "town", and the entry "slug" — and they are
 * additions to the WHERE clause "listPlaces" already builds. The search, the kind, the division and the
 * region are untouched, so "/clans", "/clans/tribes" and "/clans/regions" behave exactly as they did.
 */
import type { Db } from '@ozituma/db/client';

/** What one kind of entry is called, in the plural and in the singular. */
export interface PlaceKindOption {
  key: string;
  /** The plural: a filter's label and a count's noun. */
  label: string;
  /** The singular: what one entry's own page calls itself. */
  singular: string;
}

/**
 * The kinds, in the order the register lists them.
 *
 * "kingdom" is here because the data has two ("0019"'s check constraint names it) — the dictionary's own
 * index omits it from its filter list and then labels both rows "entry" through its fallback, which is
 * the kind of silent mislabelling this section exists to avoid.
 */
export const PLACE_KINDS: readonly PlaceKindOption[] = [
  { key: 'clan', label: 'Clans', singular: 'clan' },
  { key: 'town', label: 'Towns', singular: 'town' },
  { key: 'section', label: 'Sections', singular: 'section' },
  { key: 'confederation', label: 'Confederations', singular: 'confederation of clans' },
  { key: 'kingdom', label: 'Kingdoms', singular: 'kingdom' },
  { key: 'other', label: 'Other groupings', singular: 'grouping' },
];

/** The plural name of a kind, for a filter or a heading. */
export function placeKindLabel(kind: string | null | undefined): string {
  return PLACE_KINDS.find((k) => k.key === kind)?.label ?? 'Entries';
}

/**
 * The singular name of a kind, for one entry.
 *
 * Anything the schema does not name falls through to "entry" rather than to "clan", so a kind added
 * later cannot silently be presented as a clan.
 */
export function placeKindSingular(kind: string | null | undefined): string {
  return PLACE_KINDS.find((k) => k.key === kind)?.singular ?? 'entry';
}

/** One entry, as a card or a list needs it. */
export interface PlaceSummary {
  id: number;
  slug: string;
  name: string;
  /** clan | town | section | confederation | kingdom | other. */
  kind: string;
  aliases: string[];
  ethnicGroup: string;
  tribe: string | null;
  tribeSlug: string | null;
  region: string | null;
  originSummary: string | null;
  states: string[];
  /** How many settlements "clan_town" records inside this entry. Zero is a real answer. */
  townCount: number;
  /** The entry this one is filed under, when it is filed under one. */
  parent: { slug: string; name: string; kind: string } | null;
  /**
   * The town that matched a search, when a town is what matched.
   *
   * A reader who knows their town's name and is shown a card headed with the clan it belongs to will
   * reasonably think the search ignored them. Naming the town is the difference between a search that
   * works and one that looks broken.
   */
  matchedTown: string | null;
  /**
   * A photograph the archive links to this entry, as a storage key — or null.
   *
   * **The design's town card leads with a photograph** ("towns.html" draws
   * "<a href><img …><span><small><strong><em></span></a>") and the register's own cards were drawn
   * without one, which is the half of that card the owner could see was missing. The image is the
   * featured media of a published record linked to this entry through "ozikoro_article_entity" — the
   * same link the article cards are built from — so it is a photograph the archive already asserts
   * belongs to this place rather than a picture chosen to fill the slot.
   *
   * ── BUT ONLY WHEN THE RECORD'S TITLE NAMES THIS ENTRY AND NO OTHER ────────────────────────────────
   *
   * A record's featured media is its own photograph of its own subject, and one record can be linked to
   * several entries. **Drawing that picture on every linked entry's card is how the same photograph came
   * to stand for two different places, which is the one thing this card must not do** — measured, the
   * register holds TWO published entries called Igbodo (a section in Enugu, `igbodo`; the Ika town in
   * Delta, `igbodo-northern-ika`) and `/igbodo-a-community-formed-by-convergence/` is linked to both, so
   * its `11219-obi-of-igbodo.jpg` was drawn on the Enugu section's card as well as the Ika town's.
   *
   * So the record must NAME this entry in its own title, by the register's own name or one of its
   * aliases, with the same word boundary `titleNames` applies (`entity-graph.ts`) and a dash and a space
   * read alike, so `Ute-Okpu` matches the entry the register writes as `Ute Okpu`. **And the title must
   * name exactly ONE published entry**, so a record whose title names two places is a record whose
   * photograph is not evidence for either card.
   *
   * **Null is the honest answer where the archive holds no such photograph for this entry**, and the card
   * is then drawn without one rather than given a stand-in — the design's own empty state.
   * "renderTown" has made that call for the design screen since it was written; this is the same fact for
   * the app's own page.
   */
  imageKey: string | null;
}

/** One place: an entry, its towns, the names borne there, and where else it is recorded. */
export interface PlaceDetail extends PlaceSummary {
  lgas: string[];
  /** The narrative, one paragraph per element — the column is "text[]" and the paragraphs are separate. */
  description: string[];
  /** The books and pages the entry rests on. */
  source: string | null;
  towns: { name: string; isHead: boolean }[];
  /** Names whose documented origins name this entry. Empty until the name material is imported. */
  names: { id: number; name: string; slug: string; meaning: string | null }[];
  /** Entries that name this one as their parent — a confederation's clans. */
  members: { slug: string; name: string; kind: string }[];
  /** The archive's knowledge-graph record for this entry, when one exists. Same slug by construction. */
  entitySlug: string | null;
  /** A subject label of the same name, which is how the migrated records are filed. */
  labelSlug: string | null;
}

/** How the register is filtered. Every field is optional; a blank one is not a filter. */
export interface PlaceFilter {
  kind?: string | null;
  /** The "clan.ethnic_group" text exactly as the register holds it, e.g. "Igbo". */
  ethnic?: string | null;
  /** A "tribe.slug", not a name. */
  tribe?: string | null;
  /** The "region" text exactly as the register holds it, e.g. "Imo and Abia". */
  region?: string | null;
  /** One entry's own "clan.slug" — the finder's third step, which names a single entry. */
  slug?: string | null;
  /**
   * A town's name, exactly as "clan_town.name" holds it — the finder's fourth step.
   *
   * It is a name rather than an id because that is what a reader sees and what "clan_town" keys on
   * inside an entry. A name that is recorded inside more than one entry therefore matches more than one,
   * which is what the register holds rather than an error to be resolved here.
   */
  town?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

/** The register's own shape: what it holds, by kind, division and region. */
export interface PlaceFacets {
  total: number;
  kinds: { kind: string; count: number }[];
  tribes: { slug: string; name: string; note: string | null; count: number }[];
  regions: { region: string; count: number }[];
  /** Published entries whose region is not recorded. Shown rather than bucketed into a fake region. */
  regionsUnrecorded: number;
}

/**
 * Read a "text[]" column as a list of strings.
 *
 * The columns are "text[]" in Postgres, but the comment on the old town page says "jsonb arrays", and
 * "db.rows" returns whatever the driver parsed. A driver that hands back the literal "{a,b}" string
 * would otherwise render as one name. This is cheap and it cannot be wrong.
 */
export function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.startsWith('{')) {
    return value
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((s) => s.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  }
  return [];
}

function toSummary(row: Record<string, unknown>): PlaceSummary {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    kind: String(row.kind ?? 'clan'),
    aliases: listOf(row.aliases),
    ethnicGroup: String(row.ethnic_group ?? 'Igbo'),
    tribe: row.tribe == null ? null : String(row.tribe),
    tribeSlug: row.tribe_slug == null ? null : String(row.tribe_slug),
    region: row.region == null ? null : String(row.region),
    originSummary: row.origin_summary == null ? null : String(row.origin_summary),
    states: listOf(row.states),
    townCount: Number(row.town_count ?? 0),
    parent:
      row.parent_slug && row.parent_name
        ? {
            slug: String(row.parent_slug),
            name: String(row.parent_name),
            kind: String(row.parent_kind ?? 'clan'),
          }
        : null,
    matchedTown: row.matched_town == null ? null : String(row.matched_town),
    imageKey: row.image_key == null ? null : String(row.image_key),
  };
}

/**
 * The register, filtered and paged.
 *
 * The search is the dictionary's own, reproduced rather than approximated, because the owner asked for
 * exactly this behaviour there: "let the search be able to search and find everything in the clan
 * section, including towns." A reader arrives with whatever they know — a town's name, the clan it
 * belongs to, the division above that, the present-day state, a phrase from the origins, or the name of
 * the larger entry this one sits under — and any of them has to find the entry.
 */
export async function listPlaces(
  db: Db,
  filter: PlaceFilter = {}
): Promise<{ data: PlaceSummary[]; total: number }> {
  const clauses: string[] = ['c.published'];
  const values: unknown[] = [];

  if (filter.kind) {
    values.push(filter.kind);
    clauses.push(`c.kind = $${values.length}`);
  }
  if (filter.ethnic) {
    values.push(filter.ethnic);
    clauses.push(`c.ethnic_group = $${values.length}`);
  }
  if (filter.tribe) {
    values.push(filter.tribe);
    clauses.push(`t.slug = $${values.length}`);
  }
  if (filter.region) {
    values.push(filter.region);
    clauses.push(`c.region = $${values.length}`);
  }
  if (filter.slug) {
    values.push(filter.slug);
    clauses.push(`c.slug = $${values.length}`);
  }
  /*
   * The town step, matched on the whole name inside the entry's own "clan_town" rows.
   *
   * "ctf" rather than "ct" because the "matched_town" column below already uses "ct", and because
   * "packages/db/src/clans.ts" records what happens when a count and a select disagree about their joins.
   * This is an "exists" over one table, so it carries no join of its own into either query.
   */
  if (filter.town) {
    values.push(filter.town);
    clauses.push(
      `exists (select 1 from clan_town ctf where ctf.clan_id = c.id and ctf.name = $${values.length})`
    );
  }

  const search = (filter.search ?? '').trim();
  /**
   * The placeholder holding the search pattern, or the SQL literal "''" when there is no search.
   *
   * "matched_town" below needs the same pattern as the WHERE clause. When there is no search the literal
   * empty string matches nothing, which is exactly right: no search means no matched town.
   */
  let patternAt = "''";
  if (search.length > 0) {
    // `%` and `_` are wildcards in LIKE and a backslash escapes; a reader typing them means them
    // literally, so they are escaped rather than allowed to widen the search.
    const pattern = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    values.push(pattern);
    const at = `$${values.length}`;
    patternAt = at;
    clauses.push(
      `(c.name ilike ${at} or c.region ilike ${at} or c.slug ilike ${at}
        or exists (select 1 from unnest(c.aliases) a where a ilike ${at})
        or exists (select 1 from unnest(c.states) st where st ilike ${at})
        or exists (select 1 from unnest(c.lgas) lg where lg ilike ${at})
        or c.origin_summary ilike ${at}
        or exists (select 1 from unnest(c.description) d where d ilike ${at})
        or t.name ilike ${at}
        or p.name ilike ${at}
        or exists (select 1 from clan_town ct where ct.clan_id = c.id and ct.name ilike ${at}))`
    );
  }

  const limit = Math.min(Math.max(filter.limit ?? 60, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const where = `where ${clauses.join(' and ')}`;

  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.slug, c.name, c.kind, c.aliases, c.ethnic_group, c.region, c.states,
            c.origin_summary,
            t.name as tribe, t.slug as tribe_slug,
            p.slug as parent_slug, p.name as parent_name, p.kind as parent_kind,
            (select count(*)::int from clan_town ct where ct.clan_id = c.id) as town_count,
            (select ct.name from clan_town ct
              where ct.clan_id = c.id and ct.name ilike ${patternAt}
              order by ct.is_head desc, ct.name limit 1) as matched_town,
            /*
             * A PHOTOGRAPH THE ARCHIVE LINKS TO THIS ENTRY, OR NOTHING.
             *
             * The design's town card leads with an image and the register's cards carried none, so the
             * served page was missing a shape the design draws. The image is the featured media of a
             * published record linked to this entry — the same "ozikoro_article_entity" link the
             * article cards read — which is a photograph the archive already asserts belongs here.
             *
             * A LATERAL AND NOT A PLAIN JOIN, ON PURPOSE. "ozikoro_entity" can hold more than one row for
             * a "clan_id" — "getPlace" reads it with "limit 1" for exactly that reason — and a join would
             * multiply the register's rows, which is a wrong list rather than a missing picture. "order
             * by" makes the choice stable run to run rather than whatever the planner returns first, and
             * "limit 1" keeps it one value per entry.
             *
             * ── THE RECORD'S TITLE MUST NAME EXACTLY ONE PUBLISHED ENTRY, AND THIS ONE ────────────────
             *
             * A record's featured media is its own picture of its own subject, and one record can be
             * linked to several entries. **Drawing it on every linked card is how one photograph came to
             * stand for two places**: /igbodo-a-community-formed-by-convergence/ is linked to BOTH
             * Igbodos, and its 11219-obi-of-igbodo.jpg — the obi of the IKA town — was drawn on the
             * Enugu section's card as well.
             *
             * So a card is given a picture only when the record's title names **exactly one** published
             * entry, which is the entry the card is for. That drops the Igbodos entirely: the title
             * "Igbodo: A Community Formed by Convergence" names two published entries, so the record is
             * not evidence for either card and the obi is withheld rather than shown to one of them. An
             * entry left without a picture is drawn without one, which is the design's own empty state.
             *
             * The boundary and the dash/space equivalence are titleNames's ("entity-graph.ts"): a name is
             * matched whole, so Owa does not match Owan, and Ute-Okpu matches the entry the register
             * writes as Ute Okpu. "c.name" is the register's own name and "c.aliases" its other
             * spellings, with names under three characters refused ("MIN_NAME"); the claim read here is
             * "this record names this entry", not "this record belongs to this entity", so no name is
             * refused for being another entity's alias.
             */
            photo.storage_key as image_key
       from clan c
       left join tribe t on t.id = c.tribe_id
       left join clan p on p.id = c.parent_id
       left join lateral (
         select m.storage_key
           from ozikoro_article a
           join ozikoro_media m on m.id = a.featured_media_id
          where a.status = 'published' and a.is_page = false
            and a.id in (select ae.article_id from ozikoro_article_entity ae
                          where ae.entity_id in (select id from ozikoro_entity where clan_id = c.id))
            and (select count(*)::int
                   from clan c2
                  where c2.published
                    and exists (
                      select 1
                        from (
                          select regexp_replace(lower(c2.name), '[^a-z0-9]+', ' ', 'gi') as n
                          union all
                          select regexp_replace(lower(al.alias), '[^a-z0-9]+', ' ', 'gi')
                            from unnest(coalesce(c2.aliases, '{}'::text[])) as al(alias)
                        ) n2
                       where length(btrim(n2.n)) >= 3
                         and (btrim(n2.n) = regexp_replace(lower(a.title), '[^a-z0-9]+', ' ', 'gi')
                              or ' ' || regexp_replace(lower(a.title), '[^a-z0-9]+', ' ', 'gi') || ' '
                                 like '% ' || btrim(n2.n) || ' %')
                    )
                 ) = 1
          order by a.published_at desc nulls last, a.id desc
          limit 1
       ) photo on true
       ${where}
      order by t.position nulls last, c.position, c.name
      limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, limit, offset]
  );

  /**
   * The count carries every join the filter can mention.
   *
   * "packages/db/src/clans.ts" records what happens otherwise: a count without the parent join fails with
   * "missing FROM-clause entry for table "p"", which is not a wrong number but a 500 on the whole page,
   * from any search at all. The joins here are the same three as the query above them.
   */
  const total = await db.one<{ n: number }>(
    `select count(*)::int as n
       from clan c
       left join tribe t on t.id = c.tribe_id
       left join clan p on p.id = c.parent_id
       ${where}`,
    values
  );

  return { data: rows.map(toSummary), total: Number(total?.n ?? 0) };
}

/**
 * One entry, by slug.
 *
 * Slug matching is case-insensitive and only over published rows, so "/clans/Umunri/" finds Umunri and
 * an unpublished entry is a 404 rather than a page the dictionary was not ready to show.
 *
 * Four follow-up reads run in parallel. Three of them are wrapped: a missing "person_name" row, a
 * database without the "ozikoro_entity" table, or a label table that is not there must not take the whole
 * entry down. An absent related record is a null, and the page says so.
 */
export async function getPlace(db: Db, slug: string): Promise<PlaceDetail | null> {
  const row = await db.one<Record<string, unknown>>(
    `select c.id, c.slug, c.name, c.kind, c.aliases, c.ethnic_group, c.region, c.states, c.lgas,
            c.origin_summary, c.description, c.source,
            t.name as tribe, t.slug as tribe_slug,
            p.slug as parent_slug, p.name as parent_name, p.kind as parent_kind,
            (select count(*)::int from clan_town ct where ct.clan_id = c.id) as town_count
       from clan c
       left join tribe t on t.id = c.tribe_id
       left join clan p on p.id = c.parent_id
      where c.published and lower(c.slug) = lower($1)
      limit 1`,
    [slug]
  );
  if (!row) return null;

  const id = Number(row.id);
  const name = String(row.name);

  const [towns, names, members, entity, label] = await Promise.all([
    db.rows<Record<string, unknown>>(
      `select name, is_head from clan_town where clan_id = $1 order by is_head desc, name`,
      [id]
    ),
    /*
     * Names are attached by their documented ORIGINS — the places a name is borne — not by where it is
     * used. The match is exact on a whole element of the array, so an entry called "Nri" does not claim
     * every name whose origin happens to mention Nri in passing.
     */
    db
      .rows<Record<string, unknown>>(
        `select n.id, n.name, n.slug, n.meaning
           from person_name n
          where n.status = 'published'
            and n.origins @> array[$1]::text[]
          order by n.name
          limit 40`,
        [name]
      )
      .catch(() => [] as Record<string, unknown>[]),
    db.rows<Record<string, unknown>>(
      `select slug, name, kind from clan where published and parent_id = $1 order by kind, name`,
      [id]
    ),
    db
      .one<Record<string, unknown>>(`select slug from ozikoro_entity where clan_id = $1 limit 1`, [id])
      .catch(() => null),
    db
      .one<Record<string, unknown>>(
        `select slug from ozikoro_label where lower(slug) = lower($1) limit 1`,
        [String(row.slug)]
      )
      .catch(() => null),
  ]);

  return {
    ...toSummary(row),
    lgas: listOf(row.lgas),
    description: listOf(row.description),
    source: row.source == null ? null : String(row.source),
    towns: towns.map((t) => ({ name: String(t.name), isHead: Boolean(t.is_head) })),
    names: names.map((n) => ({
      id: Number(n.id),
      name: String(n.name),
      slug: String(n.slug),
      meaning: n.meaning == null ? null : String(n.meaning),
    })),
    members: members.map((m) => ({
      slug: String(m.slug),
      name: String(m.name),
      kind: String(m.kind ?? 'clan'),
    })),
    entitySlug: entity ? String(entity.slug) : null,
    labelSlug: label ? String(label.slug) : null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The writing the archive links to one place
 * ---------------------------------------------------------------------------------------------- */

/**
 * The published records the archive links to one place are read by "getEntityBySlug" in
 * "entities.ts", which already carries each link's role.
 *
 * ── WHY THIS NOTE IS HERE RATHER THAN A SECOND QUERY ────────────────────────────────────────────
 *
 * "/town/<slug>/" must show the writing the archive links to a community, and the first version of
 * this module added a "listPlaceArticles" beside "getPlace" to read it. **That was a sixth copy of a
 * read "entities.ts" already makes**, on the same table, with the same two predicates
 * ("a.status = 'published' and a.is_page = false") and the same join — and the place page already
 * holds the entity's slug, because "getPlace" reads it for "entitySlug". So the page calls
 * "getEntityBySlug(db, clan.entitySlug)" and takes "articles" from it, which is one read of
 * "ozikoro_article_entity" for an entity rather than two that can drift apart.
 *
 * The role each link carries is what the page's card shows in the design's "<small>", because
 * "igbodo-a-community-formed-by-convergence" links to the entity "igbodo" as a "clan" and to
 * "igbodo-northern-ika" as a "town" — both named "Igbodo" — and the role is the only thing that tells
 * the two links apart.
 */

/**
 * The register's shape, so an index can say what it holds rather than implying it is all clans.
 *
 * Five counts in parallel. A division with nothing published in it is left out rather than offered as a
 * filter that leads to an empty page — "listTribes" in the dictionary's own query layer does the same,
 * for the same reason.
 */
export async function getPlaceFacets(db: Db): Promise<PlaceFacets> {
  const [total, kinds, tribes, regions, unrecorded] = await Promise.all([
    db.one<{ n: number }>(`select count(*)::int as n from clan where published`),
    db.rows<Record<string, unknown>>(
      `select kind, count(*)::int as n from clan where published group by kind`
    ),
    db.rows<Record<string, unknown>>(
      `select t.slug, t.name, t.note,
              (select count(*)::int from clan c where c.tribe_id = t.id and c.published) as n
         from tribe t
        where exists (select 1 from clan c where c.tribe_id = t.id and c.published)
        order by t.position, t.name`
    ),
    db.rows<Record<string, unknown>>(
      `select region, count(*)::int as n
         from clan
        where published and region is not null and region <> ''
        group by region
        order by n desc, region`
    ),
    db.one<{ n: number }>(
      `select count(*)::int as n from clan where published and (region is null or region = '')`
    ),
  ]);

  const counts = new Map<string, number>();
  for (const row of kinds) counts.set(String(row.kind), Number(row.n ?? 0));

  return {
    total: Number(total?.n ?? 0),
    // Ordered by PLACE_KINDS and only the kinds that exist, so no filter leads to an empty page.
    kinds: PLACE_KINDS.map((k) => ({ kind: k.key, count: counts.get(k.key) ?? 0 })).filter(
      (k) => k.count > 0
    ),
    tribes: tribes.map((t) => ({
      slug: String(t.slug),
      name: String(t.name),
      note: t.note == null ? null : String(t.note),
      count: Number(t.n ?? 0),
    })),
    regions: regions.map((r) => ({ region: String(r.region), count: Number(r.n ?? 0) })),
    regionsUnrecorded: Number(unrecorded?.n ?? 0),
  };
}

/* ------------------------------------------------------------------------------------------------
 * The four-step finder
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a reader has asked the finder for, as it arrives in an address.
 *
 * Every field is the raw query-string value: a slug, a name, a group. Nothing here is trusted, and
 * nothing here is resolved — "getRegisterCascade" returns the resolved values in "selection".
 */
export interface RegisterSelection {
  ethnic?: string | null;
  division?: string | null;
  clan?: string | null;
  town?: string | null;
}

/** One level of the finder: what it offers, and — for a people or a division — how much it holds. */
export interface FinderOption {
  /** The value the form submits and the address carries. */
  value: string;
  /** What the reader reads. */
  label: string;
  /** Published entries behind this option. Zero is a real answer for a resolved selection. */
  count: number;
}

/**
 * The finder's four levels, the selection the register could resolve, and its own size.
 *
 * "selection" is the point of the shape: the page renders from it and filters by it, so the box the
 * reader sees selected and the list they are reading are the same fact and cannot drift apart.
 */
export interface RegisterCascade {
  /** Published entries in the whole register — the denominator in "N of M". */
  publishedTotal: number;
  selection: {
    ethnic: string;
    division: string;
    clan: string;
    town: string;
  };
  /** Step 1. The peoples the register has published entries for. */
  ethnicGroups: FinderOption[];
  /** Step 2. The divisions holding published entries of the selected people. */
  divisions: FinderOption[];
  /** Step 3. The entries inside the selections above. */
  clans: FinderOption[];
  /** Step 4. The towns recorded inside the selected entry. Empty until one is selected. */
  towns: FinderOption[];
}

/**
 * Read the register once and derive the finder's four levels from it.
 *
 * WHY ONE READING RATHER THAN FOUR QUERIES IN SEQUENCE
 *
 * Each level is scoped by the one above it, so a query per level would have to wait for the level above
 * to come back before it could be written — four round trips to answer one page. It would also put the
 * checking of the address in a different place from the building of the lists, and those two have to
 * agree: a value kept as a filter but missing from its own "<select>" renders a box that says "Any
 * division" while the page below it is filtered by a division. So the published register is read in
 * three statements that do not depend on each other, and every level is derived here, in one pass.
 *
 * WHAT IS DROPPED, AND WHY THAT IS THE REGISTER'S OWN RULE
 *
 * A value the register cannot resolve is dropped rather than passed through, exactly as "/clans" drops a
 * "kind" the register does not file, and for the reason recorded there: a filter that matches nothing
 * reads as "the register does not hold this" when the truth is "that is not one of the words the
 * register uses". Each level is resolved against the level above it, so:
 *
 *   * "?ethnic=Igbo" is kept; anything the register has published no entry for falls back to the first
 *     published people, which today is the same Igbo the design's own finder has selected when it opens.
 *   * "?division=northern-igbo" is kept only while that division holds published entries of the resolved
 *     people; a division holding none produces no option and is dropped with it.
 *   * "?clan=" is resolved inside both of those, so a clan the address places in a division that does not
 *     hold it is dropped and the narrower fact — the division — is kept.
 *   * "?town=" is resolved inside the resolved entry, because a town is recorded inside an entry and
 *     nothing else can place it. Asked for on its own — "?town=Abaja" with no clan — it is dropped here,
 *     and the name search is what answers that reader: "listPlaces" matches a town's name across the
 *     whole register, and "matchedTown" says which town answered.
 *
 * A resolved value that holds nothing published is a different case and is not reachable yet: every
 * option returned below is built from rows the register has published, so a value that resolves always
 * has the row that resolved it. When a non-Igbo entry is published it appears here on its own, with no
 * change to this function or to the page.
 */
export async function getRegisterCascade(
  db: Db,
  asked: RegisterSelection = {}
): Promise<RegisterCascade> {
  const raw = {
    ethnic: (asked.ethnic ?? '').trim(),
    division: (asked.division ?? '').trim(),
    clan: (asked.clan ?? '').trim(),
    town: (asked.town ?? '').trim(),
  };

  const [total, ethnicRows, divisionRows, entryRows, townRows] = await Promise.all([
    db.one<{ n: number }>(`select count(*)::int as n from clan where published`),
    /*
     * The peoples the register has published entries for. "getPlaceFacets" leaves a division with
     * nothing published in it out of its filter list for the same reason this leaves a people out: a
     * filter that can only lead to an empty page is a dead end. Today this returns exactly one row,
     * Igbo — 188 entries — and it gains a second the moment a non-Igbo entry is published.
     */
    db.rows<Record<string, unknown>>(
      `select ethnic_group, count(*)::int as n
         from clan
        where published
        group by ethnic_group
        order by (ethnic_group = 'Igbo') desc, n desc, ethnic_group`
    ),
    /*
     * Every division, with its published entries counted per people.
     *
     * "join", not "left join": a division with nothing published in it produces no row, which is what
     * makes it absent from the list. Counting per people rather than in total is what makes the step a
     * cascade — a division holding only Yoruba entries is not offered to a reader looking at Igbo.
     */
    db.rows<Record<string, unknown>>(
      `select t.slug, t.name, t.position, c.ethnic_group, count(*)::int as n
         from tribe t
         join clan c on c.tribe_id = t.id and c.published
        group by t.slug, t.name, t.position, c.ethnic_group
        order by t.position, t.name`
    ),
    /*
     * Every published entry, with the people and division it belongs to and how many towns are recorded
     * inside it. This is also the register the levels are checked against, which is why it is whole
     * rather than filtered in SQL: 188 rows is smaller than the four queries it replaces, and it lets
     * the filtering happen in one readable place.
     */
    db.rows<Record<string, unknown>>(
      `select c.slug, c.name, c.kind, c.position, c.ethnic_group,
              t.slug as division_slug, t.name as division_name, t.position as division_position,
              (select count(*)::int from clan_town ct where ct.clan_id = c.id) as town_count
         from clan c
         left join tribe t on t.id = c.tribe_id
        where c.published
        order by t.position nulls last, c.position, c.name`
    ),
    /*
     * Every town the register records, with the entry it sits in. Ordered head-town first, which is the
     * order the sources list them in and the order the fourth step offers them.
     */
    db.rows<Record<string, unknown>>(
      `select ct.clan_id, ct.name, ct.is_head, c.slug as clan_slug
         from clan_town ct
         join clan c on c.id = ct.clan_id
        where c.published
        order by ct.is_head desc, ct.name`
    ),
  ]);

  /* ---- step 1: the people -------------------------------------------------- */
  /*
   * THE DESIGN'S SEVEN, ALWAYS — not only the peoples that happen to have published rows.
   *
   * The owner asked for the finder to be copied WITH ITS FUNCTIONS, and this is the function he named:
   * 'it showed ethnicity selection, clan, town, etc'. The first attempt listed only Igbo, because only
   * Igbo is published today, and that is the one thing he told me not to do. The design's own select
   * offers seven — Igbo, Ijaw, Efik, Ibibio, Idoma, Yoruba, Edo — in that order, with no 'any people'
   * option, and it is the register's full list of peoples, published or not.
   *
   * A people with nothing published still appears, and selecting one shows an honest empty register
   * rather than hiding the choice: the entries are held back pending review, not absent, and a reader
   * asking for Efik should be told that rather than being unable to ask.
   */
  const DESIGN_PEOPLES = ['Igbo', 'Ijaw', 'Efik', 'Ibibio', 'Idoma', 'Yoruba', 'Edo'];
  const counts = new Map(ethnicRows.map((r) => [String(r.ethnic_group), Number(r.n ?? 0)]));
  const ethnicGroups: FinderOption[] = DESIGN_PEOPLES.map((label) => ({
    value: label,
    label,
    count: counts.get(label) ?? 0,
  }));
  // Any people the register holds that the design does not list are appended, so nothing is hidden.
  for (const [label, count] of counts) {
    if (!DESIGN_PEOPLES.includes(label)) ethnicGroups.push({ value: label, label, count });
  }
  const ethnic = ethnicGroups.some((g) => g.value === raw.ethnic)
    ? raw.ethnic
    : (ethnicGroups[0]?.value ?? '');

  /* ---- step 2: the divisions inside that people ---------------------------- */
  const divisions: FinderOption[] = divisionRows
    .filter((r) => String(r.ethnic_group) === ethnic)
    .map((r) => ({
      value: String(r.slug),
      label: String(r.name),
      count: Number(r.n ?? 0),
    }));
  const division = divisions.some((d) => d.value === raw.division) ? raw.division : '';

  /* ---- step 3: the entries inside those ------------------------------------ */
  const entries = entryRows.map((r) => ({
    value: String(r.slug),
    label: String(r.name),
    kind: String(r.kind ?? 'clan'),
    ethnic: String(r.ethnic_group ?? 'Igbo'),
    division: r.division_slug == null ? '' : String(r.division_slug),
    townCount: Number(r.town_count ?? 0),
  }));
  const clans: FinderOption[] = entries
    .filter((e) => e.ethnic === ethnic && (division === '' || e.division === division))
    .map((e) => ({ value: e.value, label: e.label, count: e.townCount }));
  const clan = clans.some((c) => c.value === raw.clan) ? raw.clan : '';

  /* ---- step 4: the towns inside that entry --------------------------------- */
  const towns: FinderOption[] = townRows
    .filter((r) => clan !== '' && String(r.clan_slug) === clan)
    .map((r) => ({ value: String(r.name), label: String(r.name), count: 0 }));
  const town = towns.some((t) => t.value === raw.town) ? raw.town : '';

  return {
    publishedTotal: Number(total?.n ?? 0),
    selection: { ethnic, division, clan, town },
    ethnicGroups,
    divisions,
    clans,
    towns,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The records that NAME a place
 * ---------------------------------------------------------------------------------------------- */

/*
 * `place-mentions.ts` is re-exported HERE rather than given its own line in `index.ts`.
 *
 * It is a module of its own because the claim it makes is a different one — the registers' rows are places,
 * and this reads the RECORDS that name them — and because its matching rules want a test that reads no
 * database. But it is reached through the export that already reaches this file, so the barrel needs no
 * new entry and `/town/<slug>/` imports it from `@ozikoro/platform` exactly as it imports `getPlace`.
 *
 * **The two claims stay two.** `getPlace` and `entities.ts` answer "what is catalogued under this place";
 * `listPlaceMentions` answers "which records' own words carry its name". A reader told "histories about
 * Ndizuogu" and shown a record that merely names it has been misled, which is why the place page renders
 * them under two headings and never merges them. See the module header for the matching rule, what it
 * refuses, and the measurement behind each decision.
 */
export * from './place-mentions.ts';
