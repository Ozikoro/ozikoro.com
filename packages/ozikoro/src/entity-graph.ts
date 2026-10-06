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
 * An article is linked to an entity whose own name or alias appears in its TITLE — not its body. A
 * title match is evidence the record is about the place; a body match is evidence the place was
 * mentioned, which is a far weaker claim and would attach nearly every record to nearly every town.
 * **So this links fewer records than a body search would and every link it makes is defensible.**
 * The rest are editorial work, which is why the queue exists.
 *
 * The token must be the entity's OWN name or one of its OWN aliases, at a word boundary, with a dash
 * joining a word and a multi-word name joining on a dash or a space — see `titleNames`. Where the
 * word alone is not evidence — `Oba` is a king before it is a clan — it is refused by name and
 * counted, in `NAME_IS_NOT_EVIDENCE`.
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
  /**
   * Matches REFUSED because the word alone is not evidence, with how many titles used it.
   *
   * Named rather than silently dropped, for the same reason `skipped` names the dictionary rows that
   * are not made entities: a refusal a reader cannot see is a refusal they cannot correct. The list
   * of refused words, and why each is refused, is `NAME_IS_NOT_EVIDENCE` below.
   */
  ambiguousNames: { token: string; titles: number }[];
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

/**
 * Does `title` name `token` as a whole word sequence?
 *
 * THREE FAULTS IN THE FIRST VERSION, ALL FOUND BY READING THE SERVED ARCHIVE (4 October 2026).
 *
 *   1. **A dash inside a name is a space.** The entity's own name is `Ute Okpu` while the record's
 *      title spells `Ute-Okpu`, so an exact comparison missed a record that names its place in its
 *      first two words. A run of spaces or dashes *inside* a multi-word name is one separator.
 *   2. **A dash at a boundary joins a word.** The first version treated any non-letter as a
 *      boundary, so `Owa` matched inside `Owa-Alero`. A dash is a word character here: `Owa` does not
 *      match `Owa-Alero` or `Owa-Oyibu`, and `Emu` does not match `Emu-Uno`.
 *   3. **ASCII is not the alphabet.** `[^A-Za-z]` is a boundary test that is wrong about the letter
 *      `ọ` in `Ọka` and the `ǹ` in `Ǹrì`, so a name ending in an Igbo letter could match inside a
 *      longer word or fail to match at all. The boundary is `\p{L}`/`\p{N}`, which is what the
 *      alphabet actually is.
 */
const WORD_CHAR = String.raw`[\p{L}\p{N}\u2010-\u2015_\-]`;
const INNER_SEPARATOR = String.raw`[\s\u2010-\u2015_\-]+`;

export function titleNames(title: string, token: string): boolean {
  return nameOccurrence(title, token) !== null;
}

/**
 * The occurrence `titleNames` accepts, with the text it actually matched — or null.
 *
 * `titleNames` is this function with the surface thrown away. It is separated out because the place page
 * needs the SURFACE: the archive's prose writes a place's name with a capital, and a lower-case occurrence
 * of a name that is also an ordinary word is the word. See `writtenAsName` in `place-mentions.ts` for the
 * measurement that made that a rule rather than a preference.
 */
export function nameOccurrence(text: string, token: string): { surface: string } | null {
  const parts = token.trim().split(/[\s\u2010-\u2015_\-]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const body = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(INNER_SEPARATOR);
  const match = new RegExp(`(?<!${WORD_CHAR})(${body})(?!${WORD_CHAR})`, 'iu').exec(text);
  const surface = match?.[1];
  return surface === undefined ? null : { surface };
}

/**
 * Shortest name that is still evidence.
 *
 * **Three, not four, and the protection is the word boundary rather than the length.** `Owa` is a
 * kingdom with a page and a record whose title begins with it, and a floor of four silently dropped
 * it; `Owan` and `Owa-Alero` are excluded by the boundary above, which is the rule that actually
 * does the work. The floor stays at three because a two-letter token is a syllable, not a name.
 */
export const MIN_NAME = 3;

/**
 * Names and aliases that are NOT evidence on their own, with the reason each was measured.
 *
 * **The matcher cannot tell a place from a word, so the words where it was measured to get it wrong
 * are named here rather than left to produce a wrong `Place` chip.** A chip is a claim with a record
 * behind it, and on a history page a wrong one is worse than a missing one. Each entry below is a
 * token the dictionary lists as a name or an alias whose bare appearance in a title was, on reading
 * the titles, about something else:
 *
 *   * `Oba` is the Benin royal title in four titles — *"at the Oba's Request"*, *"Oba Olua"*,
 *     *"Oba Ewuare the Great"*, *"the Oba of Benin"* — and none of them is about the clan named Oba.
 *   * `Osu` is the caste institution in three — *"The Osu Institution"*, *"the Osu/Diala Divide"*.
 *   * `Opi` is the ọpị instrument as often as the town (*"OPI/OKIKE"* under *Igbo Musical
 *     Instruments*), and nothing in the token says which.
 *   * `Isu` is carried by TWO entities (`isu-arochukwu`, `isu-afikpo`) and the one title that uses
 *     it names the people and the region, not either town.
 *   * `Ada` is `ụmụ ada` (daughters) and a common forename — *"Ada Priscilla Nzimiro"*.
 *   * `Izuogu` and `Ogbalu` are surnames — *"Ezekiel Izuogu"*, *"Mazi F. C. Ogbalu"*.
 *   * `Ekwe` is the slit drum, and a settlement inside a different clan.
 *   * `Okpala` is a surname (*"Chika Okpala"*) and the firstborn's title (*"the Okpala System"*,
 *     *"Okpala Nshi"*) in all three titles that use it — three false links that the round-305 run
 *     did make and that round 323 leaves in place rather than delete, because an existing link is
 *     not this module's to remove.
 *   * `Aro` is the people, the confederacy, Arochukwu's own alias, and the festival *Igu Aro* — one
 *     word with four meanings, so a bare `Aro` does not say which. A title that spells the meaning
 *     out (`Aro Confederacy`) still matches.
 *
 * A refused match is COUNTED and NAMED in `report.ambiguousNames`, never dropped in silence.
 *
 * **⚠️ AND THE LIST IS READ BY A SECOND CALLER, WHICH IS WHY IT IS EXPORTED.** `/town/<slug>/` lists the
 * records that MENTION a place as well as the records linked to it, and a mention is a weaker claim than
 * a link — but the WORDS that carry either claim are the same words. `evidenceNames` below is that shared
 * reading, and this table is the half of it that says which tokens are not evidence at all. The reasons
 * are quoted on the place page beside the counts, so a refusal is visible to the reader it affects rather
 * than only to the operator who ran the builder.
 */
export const NAME_IS_NOT_EVIDENCE: Record<string, string> = {
  oba: 'the Benin royal title',
  osu: 'the caste institution',
  opi: 'the ọpị musical instrument',
  isu: 'shared by two entities and used here for the people',
  ada: 'ụmụ ada and a forename',
  izuogu: 'a surname',
  ogbalu: 'a surname',
  okpala: 'a surname and the firstborn\'s title',
  ekwe: 'the slit drum and a different settlement',
  aro: 'the people, the confederacy, Arochukwu\'s alias, and the Igu Aro festival',
};

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
 * The names the archive will read for one place, and the names it will not — ONE rule with two callers.
 *
 * ── WHY THIS IS A FUNCTION RATHER THAN THE FILTER CHAIN IT REPLACES ─────────────────────────────────
 *
 * `buildEntityGraph` read this list inline: `[name, ...aliases]`, dropped anything shorter than
 * `MIN_NAME`, dropped anything in `NAME_IS_NOT_EVIDENCE`, and dropped an alias another entity already
 * owns as its own name. **`/town/<slug>/` now needs the same list for a different claim** — not "is this
 * record ABOUT the place" but "does this record's own words NAME the place" — and a second copy of those
 * four filters would drift from this one the first time either was edited. The two claims are different;
 * the words that carry them are not.
 *
 * ── WHAT EACH REFUSAL MEANS, AND WHY EVERY ONE IS RETURNED RATHER THAN DROPPED ──────────────────────
 *
 *   * `refused` — the token is in `NAME_IS_NOT_EVIDENCE`, with the archive's own measured reason. `Izuogu`
 *     is here: it is Ndizuogu's last alias and it is also a surname in this archive (*"Ezekiel Izuogu"*),
 *     and a matcher cannot tell which one a bare occurrence is. **The owner searched for `Izuogu` and
 *     found records; this is why the place page will not claim them all as mentions of Ndizuogu, and the
 *     reason is printed on the page rather than kept in this file.**
 *   * `ownedByAnother` — another entity already bears this name, so reading it here would take that
 *     entity's records. `Aro` is the Aro people's own name and an alias of Arochukwu, and matching it
 *     made the Aro people's records claim the town.
 *   * `tooShort` — a token shorter than `MIN_NAME`. A two-letter token is a syllable, not a name.
 *
 * The three lists are returned rather than only counted because a caller has to be able to say WHY a name
 * a reader typed was not read. A refusal the reader cannot see is a refusal they cannot correct.
 */
export interface EvidenceNames {
  /** The tokens that may carry a match, the entity's own name first, in the order the register holds them. */
  counted: string[];
  /** Tokens `NAME_IS_NOT_EVIDENCE` refuses, each with the reason recorded there. */
  refused: { token: string; reason: string }[];
  /** Tokens not read because another entity already owns the name. */
  ownedByAnother: string[];
  /** Tokens below `MIN_NAME`. */
  tooShort: string[];
}

/**
 * Read one place's name and aliases through the three filters above.
 *
 * `ownedNames` is the set of every entity name in the graph, lowercased; it is only consulted for tokens
 * that are not this entity's own name, so an entity can always match its own name even if another entity
 * somehow holds it too. Pass an empty set when aliases are not being read — an entity with no aliases can
 * only be dropped by length or by `NAME_IS_NOT_EVIDENCE`, and the query that builds `ownedNames` is one
 * this function then does not need.
 */
export function evidenceNames(
  entity: { name: string; aliases?: string[] | null },
  ownedNames: ReadonlySet<string> = new Set()
): EvidenceNames {
  const ownName = entity.name.trim().toLowerCase();
  const counted: string[] = [];
  const refused: { token: string; reason: string }[] = [];
  const ownedByAnother: string[] = [];
  const tooShort: string[] = [];
  const seen = new Set<string>();

  for (const raw of [entity.name, ...(entity.aliases ?? [])]) {
    const token = raw.trim();
    const key = token.toLowerCase();
    if (token.length === 0 || seen.has(key)) continue;
    seen.add(key);
    if (token.length < MIN_NAME) {
      tooShort.push(token);
      continue;
    }
    const reason = NAME_IS_NOT_EVIDENCE[key];
    if (reason) {
      refused.push({ token, reason });
      continue;
    }
    if (key !== ownName && ownedNames.has(key)) {
      ownedByAnother.push(token);
      continue;
    }
    counted.push(token);
  }

  return { counted, refused, ownedByAnother, tooShort };
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
    ambiguousNames: [],
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

  /*
   * THE ENTITY'S OWN NAMES, AND THE ALIASES THE DICTIONARY ALREADY SLEPT ON.
   *
   * The first version matched `ozikoro_entity.name` alone, so it could not link *Arondizuogu: An Aro
   * Settlement* to `Ndizuogu` — even though `Arondizuogu` is Ndizuogu's own first alias, recorded in
   * the dictionary and published on `/entities/ndizuogu`. **An alias that resolves is a link found,**
   * and reading it costs nothing because the matcher, the boundary and `NAME_IS_NOT_EVIDENCE` are
   * unchanged.
   *
   * An alias that ANOTHER entity already owns as its name is not read. `Aro` is the name of the Aro
   * people and an alias of Arochukwu, and matching both made the Aro people's own records claim the
   * town. (The token is in `NAME_IS_NOT_EVIDENCE` as well, for its own reason.)
   */
  const entities = await db.rows<{ id: number; name: string; kind: string; aliases: string[] }>(
    `select id, name, kind, aliases from ozikoro_entity
      where clan_id is not null and length(name) >= ${MIN_NAME}`
  );
  const ownedNames = new Set(entities.map((e) => e.name.trim().toLowerCase()));
  const articles = await db.rows<{ id: number; title: string }>(
    `select id, title from ozikoro_article where is_page = false and status = 'published'`
  );

  /**
   * Every match this article has on this entity, names first, with the token that carried it.
   *
   * The token list is `evidenceNames`' — the same list `/town/<slug>/` reads for its mentions — and this
   * function only adds the title test on top. See that function for what each filter refuses and why.
   */
  const matchesFor = (title: string, entity: { name: string; aliases: string[] }): string[] =>
    evidenceNames(entity, ownedNames).counted.filter((t) => titleNames(title, t));

  const ambiguous = new Map<string, Set<number>>();
  const linked = new Set<number>();
  for (const article of articles) {
    for (const entity of entities) {
      const matched = matchesFor(article.title, entity);
      if (matched.length === 0) continue;

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
   * THE REFUSALS, COUNTED AND NAMED.
   *
   * Every token in `NAME_IS_NOT_EVIDENCE` that a title uses is counted here, so a run reports "Oba
   * was seen in 4 titles and refused" rather than silently linking four kings to a clan. The count is
   * per token, not per record, because the reader's question is "why is this word not matched?", and
   * the answer is a property of the word.
   */
  const ambiguousCounts = new Map<string, number>();
  for (const token of Object.keys(NAME_IS_NOT_EVIDENCE)) {
    let titles = 0;
    for (const article of articles) if (titleNames(article.title, token)) titles += 1;
    if (titles > 0) ambiguousCounts.set(token, titles);
  }
  report.ambiguousNames = [...ambiguousCounts.entries()]
    .map(([token, titles]) => ({ token, titles }))
    .sort((a, b) => b.titles - a.titles || a.token.localeCompare(b.token));
  if (ambiguousCounts.size > 0) {
    console.log(
      `  refused ${ambiguousCounts.size} name(s) that are not evidence on their own: ` +
        report.ambiguousNames.map((a) => `${a.token} (${a.titles} titles)`).join(', ')
    );
  }

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
        ambiguousNames: report.ambiguousNames,
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
