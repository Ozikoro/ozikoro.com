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
}

export interface ClanDetail extends ClanSummary {
  description: string[];
  /** Entries that name this one as their parent — a confederation's clans. */
  members: { slug: string; name: string; kind: string }[];
  towns: { name: string; isHead: boolean }[];
  /** Names whose documented origins include this clan's name. */
  names: { id: number; name: string; slug: string; meaning: string | null }[];
}

export async function listTribes(db: Db): Promise<TribeSummary[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select t.id, t.slug, t.name, t.note,
            (select count(*) from clan c where c.tribe_id = t.id)::int as clan_count
       from tribe t
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

export async function listClans(
  db: Db,
  params: { tribe?: string; kind?: string } = {}
): Promise<{ data: ClanSummary[]; total: number }> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (params.tribe) {
    values.push(params.tribe);
    clauses.push(`t.slug = $${values.length}`);
  }
  if (params.kind) {
    values.push(params.kind);
    clauses.push(`c.kind = $${values.length}`);
  }
  const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';

  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.slug, c.name, c.aliases, c.kind, c.ethnic_group, c.region, c.origin_summary,
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
  const total = await db.one<{ n: number }>(`select count(*)::int as n from clan c left join tribe t on t.id = c.tribe_id ${where}`, values);

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
  };
}

export async function getClan(db: Db, slug: string): Promise<ClanDetail | null> {
  const row = await db.one<Record<string, unknown>>(
    `select c.id, c.slug, c.name, c.aliases, c.kind, c.ethnic_group, c.region, c.origin_summary, c.description,
            t.name as tribe, p.slug as parent_slug, p.name as parent_name
       from clan c
       left join tribe t on t.id = c.tribe_id
       left join clan p on p.id = c.parent_id
      where c.slug = $1`,
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
