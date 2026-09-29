/**
 * Clans and tribes, read as the section reads them.
 *
 * The shape is two levels and shallow on purpose — tribe, clan, town — because
 * that is what the sources support and nothing more. See 0015_clans.sql for why
 * the level the books call a "sub-tribe" is a clan here and the level above it
 * is a tribe.
 *
 * `clan.source` is never returned by anything in this file. It records the book
 * and page a row rests on so the repository can check a claim; the site does not
 * publish where its material came from.
 */
import type { Db } from './client.ts';

export interface TribeSummary {
  id: number;
  slug: string;
  name: string;
  note: string | null;
  clanCount: number;
}

export interface ClanSummary {
  id: number;
  slug: string;
  name: string;
  /** clan | town | section | confederation | kingdom | other. */
  kind: string;
  /** The entry this one belongs to, when it belongs to one. */
  parent: { slug: string; name: string } | null;
  /** Other names the sources give for this clan, e.g. the town that leads it. */
  aliases: string[];
  ethnicGroup: string;
  tribe: string | null;
  region: string | null;
  originSummary: string | null;
  /**
   * The town that matched the search, when a town is what matched.
   *
   * A reader who types "Nkpor" and is shown a card headed "Idemili" would
   * reasonably think the search had ignored them. Naming the town on the card is
   * the whole difference between a working search and one that looks broken.
   */
  matchedTown?: string | null;
}

export interface ClanDetail extends ClanSummary {
  description: string[];
  /** Entries that name this one as their parent — a confederation's clans. */
  members: { slug: string; name: string; kind: string }[];
  towns: { name: string; isHead: boolean }[];
  /** Names whose documented origins include this clan's name. */
  names: { id: number; name: string; slug: string; meaning: string | null }[];  /** The Nigerian state(s) the group is in today. Empty means not yet researched. */
  states: string[];
  /** The local government area(s) it falls under today. */
  lgas: string[];
}

export async function listTribes(db: Db): Promise<TribeSummary[]> {
  /*
   * Only the divisions that actually hold a clan.
   *
   * A tribe row survives the file that named it — the importer never deletes one,
   * because a row that vanishes silently takes its page with it — so renaming the
   * level left the old names behind as empty chips reading "0". A division with
   * nothing in it is a dead end for a reader, so the query leaves it out and the
   * chip disappears on its own the moment the material is filed elsewhere.
   */
  const rows = await db.rows<Record<string, unknown>>(
    `select t.id, t.slug, t.name, t.note,
            (select count(*) from clan c where c.tribe_id = t.id and c.published)::int as clan_count
       from tribe t
      where exists (select 1 from clan c where c.tribe_id = t.id and c.published)
      order by t.position, t.name`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    note: (row.note as string | null) ?? null,
    clanCount: Number(row.clan_count ?? 0),
  }));
}

/**
 * The peoples whose entries are ready to be shown, with how many each holds.
 *
 * Read from the data rather than listed in the page. The page held fifteen names in an
 * array — Igbo, Yoruba, Ijaw, Edo and eleven more — which both offered a reader thirteen
 * peoples that are not researched yet and had to be edited by hand every time one of them
 * became ready. Migration 0022 made readiness a column, and this reads it.
 */
export async function listEthnicGroups(
  db: Db
): Promise<Array<{ ethnicGroup: string; count: number }>> {
  const rows = await db.rows<Record<string, unknown>>(
    `select c.ethnic_group, count(*)::int as n
       from clan c
      where c.published
      group by c.ethnic_group
      order by (c.ethnic_group = 'Igbo') desc, n desc, c.ethnic_group`
  );
  return rows.map((row) => ({
    ethnicGroup: String(row.ethnic_group),
    states: (row.states as string[] | null) ?? [],
    lgas: (row.lgas as string[] | null) ?? [],
    count: Number(row.n ?? 0),
  }));
}

export async function listClans(
  db: Db,
  params: { tribe?: string; kind?: string; ethnicGroup?: string; query?: string } = {}
): Promise<{ data: ClanSummary[]; total: number }> {
  /*
   * Only what is ready is listed. `published` is the flag migration 0022 added, and it is
   * the whole of the rule: the thirteen peoples whose entries are still model-proposed are
   * held back until they have been researched, and they appear by flipping the flag rather
   * than by changing a query.
   */
  const clauses: string[] = ['c.published'];
  const values: unknown[] = [];
  if (params.tribe) {
    values.push(params.tribe);
    clauses.push(`t.slug = $${values.length}`);
  }
  if (params.kind) {
    values.push(params.kind);
    clauses.push(`c.kind = $${values.length}`);
  }
  if (params.ethnicGroup) {
    values.push(params.ethnicGroup);
    clauses.push(`c.ethnic_group = $${values.length}`);
  }
  /*
   * Free text over EVERYTHING in the section, which is what the owner asked for:
   * "let the search be able to search and find everything in the clan section,
   * including towns."
   *
   * A reader arrives with whatever they happen to know — the name of their town,
   * the clan it belongs to, the group above that, the state, a word from what they
   * were told about their origins ("blacksmith", "Nri's daughter"), or the name of
   * the larger entry this one sits under. Any of those has to find the entry, and
   * the card says which of them it was.
   *
   * Two things are deliberately searched that were not before:
   *
   *  - the description and the origins, so a reader who knows a fact but not a
   *    name can still get there;
   *  - the parent entry's name and the division's name, so searching "Umu-Eri"
   *    finds the groups inside it and searching "Northern Igbo" is not a dead end.
   */
  const query = (params.query ?? '').trim();
  /** The placeholder holding the search pattern, once it has been pushed. */
  let patternAt = "''";
  if (query.length > 0) {
    const pattern = `%${query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
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
  const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';

  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.slug, c.name, c.aliases, c.kind, c.ethnic_group, c.region, c.origin_summary,
            c.states, c.lgas,
            (select ct.name from clan_town ct
              where ct.clan_id = c.id and ct.name ilike ${patternAt}
              order by ct.is_head desc, ct.name limit 1) as matched_town,
            t.name as tribe, p.slug as parent_slug, p.name as parent_name
       from clan c
       left join tribe t on t.id = c.tribe_id
       left join clan p on p.id = c.parent_id
       ${where}
      order by t.position nulls last, c.position, c.name`,
    // The filter's value has to reach both queries: the count and the rows. It
    // reached only the count, which is how "filter the registry" became a 500.
    values
  );
  /*
   * The count has to carry EVERY join the filter can mention. The search now
   * matches the parent entry's name, so a count without the parent join fails
   * with `missing FROM-clause entry for table "p"` — which is not a wrong number
   * but a 500, on the whole registry, from any search at all. That is what
   * happened when this filter was widened, and it is why the joins here are the
   * same three as in the query above them.
   */
  const total = await db.one<{ n: number }>(
    `select count(*)::int as n
       from clan c
       left join tribe t on t.id = c.tribe_id
       left join clan p on p.id = c.parent_id
       ${where}`,
    values
  );

  return { data: rows.map(toClanSummary), total: Number(total?.n ?? 0) };
}

function toClanSummary(row: Record<string, unknown>): ClanSummary {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    kind: String(row.kind ?? 'clan'),
    parent:
      row.parent_slug && row.parent_name
        ? { slug: String(row.parent_slug), name: String(row.parent_name) }
        : null,
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    ethnicGroup: String(row.ethnic_group),
    tribe: (row.tribe as string | null) ?? null,
    region: (row.region as string | null) ?? null,
    originSummary: (row.origin_summary as string | null) ?? null,
    matchedTown: (row.matched_town as string | null) ?? null,
  };
}

export async function getClan(db: Db, slug: string): Promise<ClanDetail | null> {
  const row = await db.one<Record<string, unknown>>(
    `select c.id, c.slug, c.name, c.aliases, c.kind, c.ethnic_group, c.region, c.states, c.lgas,
            c.origin_summary, c.description,
            t.name as tribe, p.slug as parent_slug, p.name as parent_name
       from clan c
       left join tribe t on t.id = c.tribe_id
       left join clan p on p.id = c.parent_id
      where c.slug = $1 and c.published`,
    [slug]
  );
  if (!row) return null;
  const id = Number(row.id);

  const [towns, names, members] = await Promise.all([
    db.rows<Record<string, unknown>>(
      `select name, is_head from clan_town where clan_id = $1 order by is_head desc, name`,
      [id]
    ),
    /*
     * Names are attached by their documented origins, which are the places a
     * name is borne rather than the places it is used. The match is exact on a
     * whole element of the array, so "Nri" does not claim every name whose
     * origin mentions Nri in passing.
     */
    db.rows<Record<string, unknown>>(
      `select n.id, n.name, n.slug, n.meaning
         from person_name n
        where n.status = 'published'
          and n.origins @> array[$1]::text[]
        order by n.name
        limit 40`,
      [String(row.name)]
    ),
    db.rows<Record<string, unknown>>(
      `select slug, name, kind from clan where parent_id = $1 order by kind, name`,
      [id]
    ),
  ]);

  return {
    ...toClanSummary(row),
    // Read off the row rather than derived: the state and the local government areas are facts a
    // source states, not something the name of the group can be made to yield.
    states: (row.states as string[] | null) ?? [],
    lgas: (row.lgas as string[] | null) ?? [],
    members: members.map((m) => ({
      slug: String(m.slug),
      name: String(m.name),
      kind: String(m.kind ?? 'clan'),
    })),
    description: Array.isArray(row.description) ? (row.description as string[]) : [],
    towns: towns.map((town) => ({
      name: String(town.name),
      isHead: Boolean(town.is_head),
    })),
    names: names.map((name) => ({
      id: Number(name.id),
      name: String(name.name),
      slug: String(name.slug),
      meaning: (name.meaning as string | null) ?? null,
    })),
  };
}

/**
 * Names close to what was typed, for when the exact search found nothing.
 *
 * The registry is full of pairs that differ by a letter or two, and they are not
 * typos: the survey printed Ogburike, Umuleru and Nnando, and the towns write
 * Ogbunike, Umuleri and Nando. A reader who knows the modern name and finds
 * nothing concludes the registry is wrong about their town, which is the worst
 * possible outcome for a section that is asking them to correct it.
 *
 * So when a search returns nothing, every clan name and every town name is
 * compared with what was typed and the closest few are offered. Distances are
 * computed here rather than in SQL because `pg_trgm` and `fuzzystrmatch` are not
 * guaranteed to be installed — see 0002, where the trigram work is conditional —
 * and there are only a few hundred names to compare.
 */
export async function suggestClanNames(
  db: Db,
  query: string,
  limit = 5
): Promise<{ kind: 'clan' | 'town'; name: string; slug: string; clanName: string }[]> {
  const term = normaliseForComparison(query);
  if (term.length < 3) return [];

  const [clans, towns] = await Promise.all([
    db.rows<Record<string, unknown>>(
      // Aliases are in the pool as well as names: the registry keeps the older
      // spelling a source printed as an alias, so a reader who types that spelling
      // should be offered the entry rather than told there is nothing.
      `select slug, name, aliases from clan where published`
    ),
    db.rows<Record<string, unknown>>(
      `select ct.name, c.slug, c.name as clan_name
         from clan_town ct join clan c on c.id = ct.clan_id
        where c.published`
    ),
  ]);

  const scored: { score: number; kind: 'clan' | 'town'; name: string; slug: string; clanName: string }[] = [];
  for (const row of clans) {
    const name = String(row.name);
    const slug = String(row.slug);
    const spellings = [name, ...(Array.isArray(row.aliases) ? (row.aliases as string[]) : [])];
    for (const spelling of spellings) {
      const score = editDistance(term, normaliseForComparison(spelling));
      if (score <= Math.max(2, Math.floor(term.length / 3))) {
        scored.push({ score, kind: 'clan', name: spelling, slug, clanName: name });
        break;
      }
    }
  }
  for (const row of towns) {
    const name = String(row.name);
    const score = editDistance(term, normaliseForComparison(name));
    if (score <= Math.max(2, Math.floor(term.length / 3))) {
      scored.push({
        score,
        kind: 'town',
        name,
        slug: String(row.slug),
        clanName: String(row.clan_name),
      });
    }
  }

  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  // One suggestion per entry, so five slots are five places to look rather than
  // one clan offered five ways.
  const seen = new Set<string>();
  const out: typeof scored = [];
  for (const hit of scored) {
    const key = `${hit.kind}:${hit.slug}:${hit.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out.map(({ score: _score, ...rest }) => rest);
}

/** Lower-case, no diacritics, no punctuation — so Nkọ́ and Nko compare equal. */
function normaliseForComparison(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Levenshtein distance, written out rather than pulled from an extension. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}
