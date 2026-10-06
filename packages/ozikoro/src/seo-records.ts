/**
 * Per-record SEO: the title and meta description an editor writes for ONE record.
 *
 * ── THE QUESTION THIS ANSWERS, IN THE OWNER'S OWN TERMS ─────────────────────────────────────────
 *
 * The archive has 1,051 histories and every one of their search results is generated from the record itself:
 * `<title>` is the record's title, the meta description is its standfirst, and the canonical is built from
 * its address. **That was the right default and it is still the default here.** What a WordPress user
 * reaches for most often is the ability to overrule it for one record — a title that is longer than a result
 * shows, a summary that reads badly in a snippet — and until now there was nowhere to write one, which is why
 * `/admin/seo/` names this screen as the first thing it does not have.
 *
 * ── WHAT IS STORED, AND WHAT IS DELIBERATELY NOT ────────────────────────────────────────────────
 *
 * TWO FIELDS, and they are the two that change what a search result says:
 *
 *   `seo_title`        the record's `<title>` when an editor has written one
 *   `seo_description`  the record's meta description when an editor has written one
 *
 * **The canonical URL is not editable and no field here touches it**, which is a decision rather than an
 * omission: this archive's addresses are permanent by contract (the owner's rule is that a record keeps its
 * address), a canonical is a machine-readable claim about which address is the real one, and letting an
 * editor point it at a second address would be a way to declare a duplicate of the archive's own record.
 * Nor is the social-preview card, the JSON-LD graph, robots.txt, the sitemap or the redirect table: **all five
 * now have a section of their own under `/admin/seo/`** — the card's defaults on `social`, the graph's
 * publisher on `schema`, and the rest on `tools` — and none of them is this. A card is built from the title and
 * the description this module resolves; a redirect is a statement about an ADDRESS, and it is written by
 * `site-seo.ts`'s `changeRecordPermalink` rather than by anything here.
 *
 * ── AN ABSENT OVERRIDE AND AN EMPTY FIELD ARE THE SAME THING, AND THAT IS ENFORCED ───────────────
 *
 * A field submitted blank means "use the record's own words". So `saveRecordSeo` stores NULL for it, the
 * check constraint in migration 0058 refuses a row in which both are blank, and a save that clears the last
 * remaining field deletes the row rather than leaving an empty one. **There is therefore no state in which a
 * record has "an override" that says nothing**, which is what stops an empty `<title>` from ever reaching a
 * crawler.
 *
 * ── THE CAPABILITY IS ASKED IN THE WRITE, NOT ONLY AT THE DOOR ───────────────────────────────────
 *
 * Same doctrine as `trash.ts`: *the rule lives in the write path, not in the UI.* `saveRecordSeo` and
 * `clearRecordSeo` call `requireCapability` themselves, so a script, a job or a route added later is refused
 * by the same rule the screen is. The capability is `manage_design` — the one `/admin/seo/` and `/admin/design/`
 * already ask for, and the reasoning is written in `apps/ozikoro/app/api/admin/seo/route.ts` and in migration
 * 0058. It is exported as a constant so a call site cannot typo it into a check that never passes.
 *
 * ── WHY THE LENGTHS ARE ADVISORY AND THE SHAPE IS NOT ───────────────────────────────────────────
 *
 * A title longer than about 60 characters is truncated by the search engine rather than refused, so a hard
 * limit would refuse a write a search engine would have accepted and would teach the editor to shorten a
 * title for the wrong reason. **The limits are reported, not enforced** (`titleAdvice`, `descriptionAdvice`),
 * and the two things that ARE enforced are the ones that would produce a broken head: a control character, or
 * a value long enough to be a paste of a whole document rather than a title.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError, requireCapability } from './members.ts';

/**
 * The capability that writes a per-record override.
 *
 * `manage_design`, and the reasoning is in `apps/ozikoro/app/api/admin/seo/route.ts`: it is the capability
 * the owner's other site-wide, reader-visible settings are already gated on, migration 0055's rule already
 * decided the site's own face is an editor's to change, and a `manage_seo` would be a name held by exactly
 * the accounts this one admits. See migration 0058, which deliberately adds no capability.
 */
export const RECORD_SEO_CAPABILITY = 'manage_design';

/** The audit `entity_type` every event here is filed under, so the trail reads beside the record's own. */
const AUDIT_ENTITY = 'ozikoro_article';

/** What a search result shows before it truncates. Advisory — see the header. */
export const SEO_TITLE_ADVISED = 60;
export const SEO_DESCRIPTION_ADVISED = 160;

/**
 * The hard ceiling, and why it is this large.
 *
 * It is not a style guide. It is the length past which a value is not a title at all but a paste of the
 * record's body into the wrong field, and a meta description of 4,000 characters is a served page telling a
 * crawler something that is not a summary of anything. A value beyond it is refused by name.
 */
export const SEO_FIELD_MAX = 320;

/* ================================================================================================
 * 1. What the read path gets
 * ============================================================================================== */

/** The two strings the head builder should use for one record, and where each came from. */
export interface ResolvedRecordSeo {
  /**
   * The `<title>`. Always a non-empty string: an override when one is stored, the record's own title
   * otherwise. **It is never null**, because a page with no title is the one outcome worse than a bad one.
   */
  title: string;
  /** The meta description, or null when neither the override nor the record supplies one. */
  description: string | null;
  /** True when an editor wrote the title, so a screen can say so rather than claiming the record's own. */
  titleOverridden: boolean;
  descriptionOverridden: boolean;
}

/**
 * The override for one record, or null when there is none.
 *
 * Read by the route that serves the record, which passes the result to `seoHead`. **A record with no row is
 * served exactly as it was before this table existed** — that is the property that makes this change safe to
 * land on a live archive.
 */
export async function loadRecordSeo(
  db: Db,
  articleId: number
): Promise<{ title: string | null; description: string | null } | null> {
  const row = await db.one<{ seo_title: string | null; seo_description: string | null }>(
    `select seo_title, seo_description from ozikoro_record_seo where article_id = $1`,
    [articleId]
  );
  if (!row) return null;
  return { title: row.seo_title, description: row.seo_description };
}

/**
 * What the head should say for one record, given its own title and standfirst.
 *
 * THIS IS THE ONLY PLACE THE FALLBACK IS DECIDED, and it takes the record's own words as arguments rather
 * than reading them, because the caller has already selected the record and a second query would be a second
 * answer to a question already answered. See the record route: it passes `article.title` and `row.standfirst`.
 *
 * A stored value that is only whitespace is treated as absent, so a row written before the constraint existed
 * (or by a path that bypassed this module) cannot serve a blank title.
 */
export function resolveRecordSeo(input: {
  /** What the record's own title is. Used when no override is stored. */
  articleTitle: string;
  /** What the record's own standfirst is. Used when no description override is stored. */
  standfirst?: string | null;
  /** What `loadRecordSeo` returned, or null. */
  override: { title: string | null; description: string | null } | null;
}): ResolvedRecordSeo {
  const own = input.articleTitle.trim();
  const overrideTitle = input.override?.title?.trim() ?? '';
  const overrideDescription = input.override?.description?.trim() ?? '';
  const station = input.standfirst?.trim() ?? '';

  return {
    title: overrideTitle.length > 0 ? overrideTitle : own,
    description: overrideDescription.length > 0 ? overrideDescription : station.length > 0 ? station : null,
    titleOverridden: overrideTitle.length > 0,
    descriptionOverridden: overrideDescription.length > 0,
  };
}

/* ================================================================================================
 * 2. What the editor sees
 * ============================================================================================== */

/** One record as the editor's list draws it. */
export interface RecordSeoRow {
  id: number;
  slug: string;
  title: string;
  standfirst: string | null;
  status: string;
  publishedAt: string | null;
  /** The override, or null. Both fields are null when only one was written. */
  override: { title: string | null; description: string | null; updatedAt: string; updatedBy: string | null } | null;
}

/**
 * The records the editor may edit, newest first, with their override where one exists.
 *
 * ── WHY THIS DOES NOT SHOW DRAFTS, AND WHY IT IS NOT A PERMISSION ────────────────────────────────
 *
 * The list is the records a search engine can actually reach: `published` and not a `page`. **A draft's
 * search result does not exist**, so offering to write one would be offering to write something with no
 * effect — the same fault as a button that posts nowhere, one screen further up. A record that is published
 * later appears here then, and its override can be written then.
 *
 * Pages are excluded for the reason `/admin/archive/` gives for its own scope: a page is not a history, and
 * this screen is titled for records. **This is a display scope and not a permission** — nothing stops the
 * write path from storing an override for any record id it is handed, and the route resolves the id against
 * this same query so the id can only be one the screen listed.
 */
export async function listRecordSeo(
  db: Db,
  options: { search?: string; onlyOverridden?: boolean; limit?: number; offset?: number } = {}
): Promise<RecordSeoRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const params: unknown[] = [`%${(options.search ?? '').trim()}%`, limit, offset];
  const conditions = [`a.status = 'published'`, `a.is_page = false`, `(a.title ilike $1 or a.slug ilike $1)`];

  /*
   * `onlyOverridden` joins rather than filtering a column, and the join is the whole of the condition: a row
   * exists in `ozikoro_record_seo` exactly when somebody wrote an override, which is the fact being asked
   * about. `left join` in the other direction so the list can show which records HAVE one without a second
   * query per row.
   */
  const join = options.onlyOverridden ? 'join' : 'left join';

  const rows = await db.rows<{
    id: number; slug: string; title: string; standfirst: string | null; status: string;
    published_at: string | null; seo_title: string | null; seo_description: string | null;
    updated_at: string | null; updated_by: string | null;
  }>(
    `select a.id, a.slug, a.title, a.standfirst, a.status::text as status,
            a.published_at::text as published_at,
            s.seo_title, s.seo_description, s.updated_at::text as updated_at,
            u.display_name as updated_by
       from ozikoro_article a
       ${join} ozikoro_record_seo s on s.article_id = a.id
       left join account u on u.id = s.updated_by
      where ${conditions.join(' and ')}
      order by a.id desc
      limit $2 offset $3`,
    params
  );

  return rows.map((row) => ({
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    standfirst: row.standfirst,
    status: row.status,
    publishedAt: row.published_at,
    override:
      row.updated_at === null
        ? null
        : {
            title: row.seo_title,
            description: row.seo_description,
            updatedAt: row.updated_at,
            updatedBy: row.updated_by,
          },
  }));
}

/** How many published records there are, how many carry an override, and how many have neither field set. */
export async function recordSeoStats(
  db: Db
): Promise<{ records: number; withTitle: number; withDescription: number; withEither: number }> {
  const row = await db.one<{
    records: number; with_title: number; with_description: number; with_either: number;
  }>(
    `select
       (select count(*)::int from ozikoro_article where status = 'published' and is_page = false) as records,
       (select count(*)::int from ozikoro_record_seo s join ozikoro_article a on a.id = s.article_id
         where a.status = 'published' and a.is_page = false
           and nullif(btrim(coalesce(s.seo_title, '')), '') is not null) as with_title,
       (select count(*)::int from ozikoro_record_seo s join ozikoro_article a on a.id = s.article_id
         where a.status = 'published' and a.is_page = false
           and nullif(btrim(coalesce(s.seo_description, '')), '') is not null) as with_description,
       (select count(*)::int from ozikoro_record_seo s join ozikoro_article a on a.id = s.article_id
         where a.status = 'published' and a.is_page = false) as with_either`
  );
  return {
    records: Number(row?.records ?? 0),
    withTitle: Number(row?.with_title ?? 0),
    withDescription: Number(row?.with_description ?? 0),
    withEither: Number(row?.with_either ?? 0),
  };
}

/* ================================================================================================
 * 3. Advice, which is not enforcement
 * ============================================================================================== */

/** A note about a field's length, or null when there is nothing to say. */
function advice(value: string, advised: number, what: string): string | null {
  const length = value.trim().length;
  if (length === 0) return null;
  if (length > advised) {
    return `${length} characters — a search result usually shows about ${advised}, so the end of this ${what} will be cut off. It is saved either way.`;
  }
  if (length < Math.round(advised * 0.4) && what === 'description') {
    return `${length} characters — shorter than a result usually shows. Not an error.`;
  }
  return null;
}

export function titleAdvice(value: string): string | null {
  return advice(value, SEO_TITLE_ADVISED, 'title');
}

export function descriptionAdvice(value: string): string | null {
  return advice(value, SEO_DESCRIPTION_ADVISED, 'description');
}

/* ================================================================================================
 * 4. The write, which asks the capability itself
 * ============================================================================================== */

/** A title or description after validation, or the refusal. */
export interface RecordSeoInput {
  articleId: number;
  /** The actor. The capability is asked of THIS account, in here, not only at the route. */
  actorId: number;
  /** The title, or blank to clear it. */
  title?: string | null;
  /** The description, or blank to clear it. */
  description?: string | null;
  note?: string | null;
}

/** Trim, collapse internal runs of space, and refuse the two shapes that would break a head. */
function cleanField(raw: string | null | undefined, label: string): string | null {
  if (raw === null || raw === undefined) return null;
  // Control characters are the one thing that can break out of a `<title>` or an attribute in a way escaping
  // alone does not cover — a newline in a `<title>` is legal but is a paste accident, and a NUL never is.
  const value = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (value.length === 0) return null;
  if (value.length > SEO_FIELD_MAX) {
    throw new MemberError(
      'too_long',
      `That ${label} is ${value.length} characters. The longest this screen stores is ${SEO_FIELD_MAX}, because past that it is not a ${label} — it is a paste of something else. Nothing was saved.`
    );
  }
  return value;
}

/**
 * Write, replace or clear one record's override.
 *
 * IDEMPOTENT AND TOTAL: the call states what both fields should now be, and the row afterwards says exactly
 * that. Writing both blank deletes the row, which is the same state as never having written one — see the
 * header for why those must not be two states.
 *
 * The capability is asked HERE, so a caller that reaches this function by any route is refused by the same
 * rule the screen applies. The record is checked for existence first, so an override cannot be written for an
 * id that is not a record.
 */
export async function saveRecordSeo(
  db: Db,
  input: RecordSeoInput
): Promise<{ cleared: boolean; title: string | null; description: string | null }> {
  await requireCapability(db, input.actorId, RECORD_SEO_CAPABILITY);

  const record = await db.one<{ id: number; title: string }>(
    `select id, title from ozikoro_article where id = $1`,
    [input.articleId]
  );
  if (!record) throw new MemberError('no_article', 'That record does not exist, so nothing was written.');

  const title = cleanField(input.title, 'title');
  const description = cleanField(input.description, 'description');

  const before = await loadRecordSeo(db, input.articleId);

  if (title === null && description === null) {
    return clearRecordSeo(db, { articleId: input.articleId, actorId: input.actorId, note: input.note, alreadyChecked: true });
  }

  await db.query(
    `insert into ozikoro_record_seo (article_id, seo_title, seo_description, created_by, created_at, updated_by, updated_at)
     values ($1, $2, $3, $4, now(), $4, now())
     on conflict (article_id) do update
        set seo_title = excluded.seo_title,
            seo_description = excluded.seo_description,
            updated_by = excluded.updated_by,
            updated_at = now()`,
    [input.articleId, title, description, input.actorId]
  );

  await audit(db, {
    entityType: AUDIT_ENTITY,
    entityId: input.articleId,
    action: 'record_seo_saved',
    before,
    /*
     * THE NEW VALUES ARE IN THE TRAIL, BECAUSE THEY ARE THE THING BEING DECIDED.
     *
     * Unlike a verification token — a credential, which `/admin/seo/` deliberately keeps out of the audit
     * trail — a title and a description are written to be read by anybody, and they are served to every
     * crawler that asks. A trail that recorded "the SEO title was changed" without recording what it was
     * changed FROM and TO could not answer the question the trail exists for.
     */
    after: { title, description },
    actorId: input.actorId,
    note: input.note ?? null,
  });

  return { cleared: false, title, description };
}

/**
 * Remove one record's override, so its own title and standfirst are served again.
 *
 * **A removal is written to the trail with the values it removed**, for the same reason a save records what
 * it wrote: "this record's search result used to say something else" is a fact the owner may need, and a
 * delete with no `before` could not supply it.
 */
export async function clearRecordSeo(
  db: Db,
  input: { articleId: number; actorId: number; note?: string | null; alreadyChecked?: boolean }
): Promise<{ cleared: boolean; title: null; description: null }> {
  if (!input.alreadyChecked) await requireCapability(db, input.actorId, RECORD_SEO_CAPABILITY);

  const before = await loadRecordSeo(db, input.articleId);
  if (!before) return { cleared: false, title: null, description: null };

  await db.query(`delete from ozikoro_record_seo where article_id = $1`, [input.articleId]);

  await audit(db, {
    entityType: AUDIT_ENTITY,
    entityId: input.articleId,
    action: 'record_seo_cleared',
    before,
    actorId: input.actorId,
    note: input.note ?? null,
  });

  return { cleared: true, title: null, description: null };
}

/** The audit row, written like every other module's: a failure is logged and the write stands. */
async function audit(
  db: Db,
  event: {
    entityType: string;
    entityId: number;
    action: string;
    before?: unknown;
    after?: unknown;
    actorId: number | null;
    note?: string | null;
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
        event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/seo-records] could not record audit event:', String(error).slice(0, 160));
  }
}
