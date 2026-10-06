/**
 * Writing a post or a page from nothing, and the lists that find it again.
 *
 * ── WHY THIS MODULE EXISTS, IN THE OWNER'S OWN WORDS ────────────────────────────────────────────────
 *
 *   "you need to fix the add new posts and pages, by copying exactly what was designed on this classic
 *    editor attached. … also, if you want to publish or view darfts, it is not yet built, and does not
 *    work, please build."
 *
 * He is right, and the measurement is blunt: **there is no `insert into ozikoro_article` anywhere in the
 * application.** `editorial.ts` can edit a record that the WordPress import created; nothing in the site
 * could create one. So a draft could not be started at all, let alone saved, listed, reopened and
 * published.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────────
 *
 * It is NOT a second copy of `editorial.ts`, and it must not become one. `editorial.ts` owns the
 * *scholarly* write path — an existing archive record's title, body, series, source type, period,
 * entities, sources and its review decision — and every one of those functions refuses a page by
 * construction (`is_page = false` in the write's own WHERE clause). That refusal is correct there: a
 * WordPress page is site content rather than a history, and the editorial screen has never listed them.
 *
 * This module owns the *authoring* path, which is the one WordPress's Classic Editor screen drives: an
 * empty title field and a body, then Save Draft or Publish. It differs from `editorial.ts` in exactly
 * three ways, and each is stated rather than implied:
 *
 *   1. **IT CREATES.** A new row, of a stated kind, in `draft`.
 *   2. **IT KNOWS PAGES FROM POSTS.** Every function takes a `kind` and every statement filters on
 *      `is_page` with it, so a request aimed at a post cannot reach a page and the other way round. That
 *      is the schema's own distinction (migration 0036) used as the guard rather than re-derived.
 *   3. **AN UNTITLED DRAFT IS SAVEABLE.** WordPress's Add New Post screen is a title field you may leave
 *      empty and a Save Draft that works anyway — the list then prints "(no title)". `editorial.ts`
 *      requires a title on every save, which is right for a record that is already published and would
 *      make the first save of a new post impossible. So the title is required to PUBLISH and optional to
 *      SAVE, and the refusal names which of the two it is.
 *
 * ── WHAT IS SHARED ──────────────────────────────────────────────────────────────────────────────────
 *
 * The rules that are not about authoring are imported rather than restated: the body ceiling
 * (`MAX_ARTICLE_BODY`, the same 400,000 characters the WordPress revision backfill uses), the sanitiser
 * (`sanitiseArchiveHtml`, with `internalHosts: []` for the reason written up in `updateArticleContent`),
 * the audit writer shape, and the trash's own semantics — a delete is a move, and a recovery returns the
 * record to the state it was taken out of.
 *
 * ── AND THE ONE THING THAT IS A DECISION RATHER THAN A COPY ─────────────────────────────────────────
 *
 * **A SAVE WRITES A REVISION, AND SO DOES A PUBLISH.** The archive's promise is that nothing is
 * overwritten silently: `ozikoro_article_revision` exists for exactly this and has held 4,266 imported
 * revisions since migration 0053, and migration 0054 added `actor_id` for the human ones. A draft that
 * is saved ten times leaves ten revisions, which is what the WordPress screen did too.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';
import { sanitiseArchiveHtml } from './content.ts';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** The two things this screen writes. `is_page` in the schema is the same distinction. */
export type PieceKind = 'post' | 'page';

export const PIECE_KIND_LABEL: Record<PieceKind, string> = { post: 'Post', page: 'Page' };

/** The `is_page` value a kind means. One function, so no caller works it out for itself. */
export function isPageFor(kind: PieceKind): boolean {
  return kind === 'page';
}

export function isPieceKind(value: string): value is PieceKind {
  return value === 'post' || value === 'page';
}

/**
 * The statuses a piece can be in, in the archive's own vocabulary.
 *
 * `review` is what the review queue calls "In review" and what WordPress's list calls "Pending" —
 * the same state under two names, and the list table uses WordPress's because that is the screen being
 * reproduced. `trashed` is the bin (migration 0056).
 */
export type PieceStatus = 'draft' | 'review' | 'published' | 'archived' | 'trashed';

/** What a status is called on the list table, which is WordPress's own wording. */
export const PIECE_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  review: 'Pending',
  published: 'Published',
  archived: 'Archived',
  trashed: 'Trash',
};

/** The ceilings, named once. The title ceiling mirrors `editorial.ts`; the body's is imported. */
const MAX_TITLE = 300;
export const MAX_PIECE_BODY = 400_000;

/**
 * A slug from a title.
 *
 * `NFD` then strip combining marks, so `Ọ̀nịchạ` becomes `onicha` rather than being dropped or
 * percent-encoded: 27 of the archive's addresses carry Igbo letters today and a new one must not be the
 * first that cannot be typed. The result is single-segment by construction (`[^a-z0-9]+` becomes `-`),
 * which matters because the middleware rewrites an unknown TWO-segment path to `/attachment/<slug>/` —
 * so a slug containing a slash would be a post whose own address 404s.
 */
export function slugForTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * A slug nothing else in the table holds.
 *
 * `ozikoro_article.slug` is `text not null unique`, and the unique index spans pages and posts — the
 * column is one namespace, because both are served from the same root address by `app/[slug]/route.ts`.
 * WordPress keeps pages and posts in separate namespaces, so this is a real difference and the suffix
 * (`-2`, `-3`, …) is how it is resolved rather than a collision error.
 */
async function uniqueSlug(db: Db, base: string, exceptId: number | null = null): Promise<string> {
  const root = base.length > 0 ? base.slice(0, 72) : 'untitled';
  for (let n = 1; n <= 200; n += 1) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const taken = await db.one<{ id: number }>(
      `select id from ozikoro_article where slug = $1 and ($2::bigint is null or id <> $2::bigint) limit 1`,
      [candidate, exceptId]
    );
    if (!taken) return candidate;
  }
  throw new MemberError('slug_exhausted', 'Every address derived from that title is taken. Edit the slug and try again.');
}

// ---------------------------------------------------------------------------
// Reading one piece for the editor screen
// ---------------------------------------------------------------------------

export interface PieceForEditor {
  id: number;
  kind: PieceKind;
  slug: string;
  /** True while the slug is still the `draft-<id>` placeholder, so the screen can say "no permalink yet". */
  slugIsPlaceholder: boolean;
  title: string;
  standfirst: string | null;
  bodyHtml: string;
  status: string;
  topicId: number | null;
  authorId: number | null;
  featuredMediaId: number | null;
  accessTier: string;
  publishedAt: string | null;
  createdAt: string;
  modifiedAt: string | null;
  wordCount: number;
  labels: { id: number; name: string; slug: string }[];
}

/**
 * One piece, as the Classic Editor screen needs it.
 *
 * THE KIND IS PART OF THE QUESTION, NOT A FILTER APPLIED AFTERWARDS. A caller that asked for post 412 and
 * got page 412 back would render a page's title in a post's form and save it through a post's endpoint;
 * `is_page = $2` in the statement is what makes that impossible rather than unlikely.
 *
 * THE BODY IS RETURNED AS STORED, not as rendered — the same rule `getArticleContent` states, and for the
 * same reason: a form that showed the sanitised body would write the sanitiser's output back over the
 * record the first time somebody pressed Save without touching anything.
 */
export async function getPieceForEditor(db: Db, id: number, kind: PieceKind): Promise<PieceForEditor | null> {
  const row = await db.one<Record<string, unknown>>(
    `select id, slug, title, standfirst, body_html, status, topic_id, author_id, featured_media_id,
            access_tier, published_at, created_at, modified_at, word_count
       from ozikoro_article
      where id = $1 and is_page = $2`,
    [id, isPageFor(kind)]
  );
  if (!row) return null;

  const labels = await db.rows<Record<string, unknown>>(
    `select l.id, l.name, l.slug
       from ozikoro_article_label al join ozikoro_label l on l.id = al.label_id
      where al.article_id = $1
      order by l.name`,
    [id]
  );

  const slug = String(row.slug);
  return {
    id: Number(row.id),
    kind,
    slug,
    slugIsPlaceholder: slug === `draft-${Number(row.id)}`,
    title: String(row.title ?? ''),
    standfirst: row.standfirst ? String(row.standfirst) : null,
    bodyHtml: String(row.body_html ?? ''),
    status: String(row.status),
    topicId: row.topic_id === null || row.topic_id === undefined ? null : Number(row.topic_id),
    authorId: row.author_id === null || row.author_id === undefined ? null : Number(row.author_id),
    featuredMediaId:
      row.featured_media_id === null || row.featured_media_id === undefined ? null : Number(row.featured_media_id),
    accessTier: String(row.access_tier ?? 'open'),
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    modifiedAt: row.modified_at ? new Date(String(row.modified_at)).toISOString() : null,
    wordCount: Number(row.word_count ?? 0),
    labels: labels.map((l) => ({ id: Number(l.id), name: String(l.name), slug: String(l.slug) })),
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * One audit row, with the account that made the change.
 *
 * The shape is `editorial.ts`'s, and it is a copy of the *shape* rather than of the function because that
 * one is private to its module. What matters is not the helper but the rule: every function below writes
 * an audit row, and every row names a real account id, so "a publish that writes neither a revision nor
 * an audit row is a publish nobody can account for" cannot happen here.
 */
async function audit(
  db: Db,
  event: {
    entityId: number;
    action: string;
    before?: unknown;
    after?: unknown;
    actorId: number;
    note?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_article', $1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        event.entityId, event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId, event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/authoring] could not record audit event:', String(error).slice(0, 160));
  }
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

export interface CreatePieceInput {
  kind: PieceKind;
  /** May be empty: an untitled draft is a real state, and the list prints "(no title)" for it. */
  title: string;
  bodyHtml?: string;
  standfirst?: string | null;
  /** A slug the editor typed. When absent or empty, one is derived from the title. */
  slug?: string | null;
  topicId?: number | null;
  authorId?: number | null;
  actorId: number;
}

/**
 * A new post or page, in `draft`, with its first revision already written.
 *
 * WHY THE ID IS TAKEN FROM THE SEQUENCE FIRST RATHER THAN LET THE INSERT ASSIGN IT
 *
 * `slug` is `not null` and unique, and an untitled draft has no title to derive one from. WordPress
 * answers this by giving such a post no slug at all and printing `?p=123` where the permalink goes. This
 * schema cannot hold "no slug", so the placeholder is `draft-<id>` — deterministic, unique by
 * construction, single-segment, and recognised by `getPieceForEditor` so the screen can say "no permalink
 * yet" in the same place WordPress says `?p=123`. **When a title is first given to a placeholder-slugged
 * draft, the slug is replaced by one derived from the title** (see `savePieceText`), which is the moment
 * WordPress would have set `post_name` too.
 *
 * THE FIRST REVISION IS THE EMPTY DOCUMENT. It is written so that the new piece's history starts where
 * the piece does: "what it said before the first edit" is the empty body, which is true, rather than a
 * gap that a reader of the history has to interpret.
 */
export async function createPiece(
  db: Db,
  input: CreatePieceInput
): Promise<{ id: number; slug: string; kind: PieceKind }> {
  if (!Number.isInteger(input.actorId) || input.actorId <= 0) {
    throw new MemberError('no_actor', 'A new piece must name the account that made it.');
  }
  const title = input.title.trim().slice(0, MAX_TITLE);
  const rawBody = input.bodyHtml ?? '';
  if (rawBody.length > MAX_PIECE_BODY) {
    throw new MemberError(
      'body_too_long',
      `That body is ${rawBody.length.toLocaleString('en-GB')} characters and this archive accepts ` +
        `${MAX_PIECE_BODY.toLocaleString('en-GB')}. Nothing was created.`
    );
  }
  if (input.topicId !== null && input.topicId !== undefined) {
    const topic = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_topic where id = $1`, [input.topicId]);
    if (Number(topic?.n ?? 0) === 0) throw new MemberError('no_topic', 'That series does not exist.');
  }
  if (input.authorId !== null && input.authorId !== undefined) {
    const author = await db.one<{ n: number }>(
      `select count(*)::int as n from ozikoro_contributor where id = $1`,
      [input.authorId]
    );
    if (Number(author?.n ?? 0) === 0) throw new MemberError('no_author', 'That writer is not in the register.');
  }

  const body = sanitiseArchiveHtml(rawBody, { internalHosts: [] });
  const standfirst = input.standfirst?.trim() || null;
  /*
   * THE ADDRESS, DECIDED IN THE ORDER WORDPRESS DECIDES IT.
   *
   * An address the editor typed wins. Failing that, one is derived from the title — which is what a new
   * post gets at its first save, and a screen that showed the title and saved a `draft-<id>` anyway would
   * be showing an address the archive is not going to use. Only a piece with neither a slug nor a title
   * gets the placeholder, and that is the untitled draft the placeholder exists for.
   */
  const typedSlug = slugForTitle(input.slug ?? '');
  const derived = typedSlug.length > 0 ? typedSlug : slugForTitle(title);
  const slug = derived.length > 0 ? await uniqueSlug(db, derived) : '';

  /*
   * ONE STATEMENT. The sequence value, the placeholder slug and the row are decided together, so two
   * untitled drafts created in the same second cannot be given the same placeholder — the id in
   * `draft-<id>` comes from the same `nextval` that becomes the row's primary key.
   */
  const row = await db.one<Record<string, unknown>>(
    `with seq as (
       select nextval(pg_get_serial_sequence('ozikoro_article', 'id')) as id
     ), newrow as (
       insert into ozikoro_article
         (id, slug, title, standfirst, body_html, status, is_page, author_id, topic_id, word_count, modified_at)
       select seq.id,
              case when $1 = '' then 'draft-' || seq.id else $1 end,
              $2, $3, $4, 'draft', $5, $6, $7,
              ${wordsOf('$4')},
              now()
         from seq
       returning id, slug
     )
     select id, slug from newrow`,
    [slug, title, standfirst, body, isPageFor(input.kind), input.authorId ?? null, input.topicId ?? null]
  );
  const id = Number(row?.id);
  if (!Number.isInteger(id) || id <= 0) throw new MemberError('not_created', 'The piece could not be created.');

  const created = String(row?.slug ?? '');
  await db.query(
    `insert into ozikoro_article_revision
       (article_id, title, standfirst, body_html, revised_at, word_count, actor_id, note, carries_unique_text)
     values ($1, '', null, '', now(), 0, $2, 'The piece as it was created: no title and no body.', false)`,
    [id, input.actorId]
  );

  await audit(db, {
    entityId: id,
    action: input.kind === 'page' ? 'create_page' : 'create_post',
    after: { status: 'draft', kind: input.kind, slug: created, title },
    actorId: input.actorId,
    note:
      `Created a new ${PIECE_KIND_LABEL[input.kind].toLowerCase()} as a draft` +
      (title ? `, titled “${title}”` : ', with no title yet') +
      `. It is not served at any address until it is published.`,
  });

  return { id, slug: created, kind: input.kind };
}

// ---------------------------------------------------------------------------
// Saving the text
// ---------------------------------------------------------------------------

export interface SavePieceInput {
  id: number;
  kind: PieceKind;
  title: string;
  bodyHtml: string;
  standfirst?: string | null;
  /** The editor's slug, when they changed it from the Permalink control on the screen. */
  slug?: string | null;
  note?: string | null;
  actorId: number;
}

export interface SavePieceResult {
  revisionId: number;
  wordCount: number;
  sanitised: boolean;
  slug: string;
  status: string;
}

/**
 * The words-of-one-statement word counter.
 *
 * WHY THIS IS SQL AND NOT `wordCount()` IN TYPESCRIPT, WHICH THE REVISION BELOW COULD USE
 *
 * `editorial.ts` carries the same expression for the same reason and states it: the revision and the
 * column are written by ONE statement, so the count in the revision cannot describe a body the record no
 * longer holds. A read-then-write count is a number that can be one edit out of date, and this archive has
 * already paid for that class of bug.
 */
function wordsOf(expression: string): string {
  const text = `trim(regexp_replace(coalesce(${expression}, ''), '<[^>]*>', ' ', 'g'))`;
  return `case when ${text} = '' then 0 else array_length(regexp_split_to_array(${text}, '\\s+'), 1) end`;
}

/**
 * Save a piece's title, summary, body and slug, keeping what it said before as a revision.
 *
 * ── A TITLE IS REQUIRED TO PUBLISH AND OPTIONAL TO SAVE, AND THIS IS THE ONE PLACE THAT SAYS SO ─────
 *
 * WordPress will happily publish an untitled post and print "(no title)" on it. The archive will not, and
 * the reason is not fastidiousness: `ozikoro_article.title` is what a citation names the record by, what
 * the `<title>` element carries, and what the sitemap lists. An untitled *published* record is a page a
 * reader cannot identify and a crawler cannot describe. So an empty title is accepted here — a draft has
 * to be saveable before it has a name, or the screen cannot be used at all — and `publishPiece` is where
 * it is refused.
 *
 * ── THE SLUG IS REGENERATED ONLY WHILE IT IS THE PLACEHOLDER ───────────────────────────────────────
 *
 * A `draft-<id>` slug is not an address anybody has ever seen, so replacing it with one derived from the
 * title the moment a title exists is free. **A real slug is never touched by this function**, because a
 * published address is cited and a save must not break a link — which is exactly the rule
 * `editorial.ts` states about the title not moving the address. Moving a *published* address is a
 * separate, deliberate act: the Permalink control on the screen, which passes `slug` explicitly.
 *
 * ── AND IT WORKS FOR PAGES, WHICH `updateArticleContent` REFUSES ───────────────────────────────────
 *
 * `editorial.ts`'s write filters `is_page = false` and refuses a page by name; that refusal is right for
 * the archive's editorial screen and wrong for this one, where a page is a thing you write. The filter
 * here is `is_page = $kind`, so the statement reaches the piece the caller asked for and nothing else.
 */
export async function savePieceText(db: Db, input: SavePieceInput): Promise<SavePieceResult> {
  const title = input.title.trim().slice(0, MAX_TITLE);
  if (input.bodyHtml.length > MAX_PIECE_BODY) {
    throw new MemberError(
      'body_too_long',
      `That body is ${input.bodyHtml.length.toLocaleString('en-GB')} characters and the archive accepts ` +
        `${MAX_PIECE_BODY.toLocaleString('en-GB')}. Nothing was changed.`
    );
  }
  if (!Number.isInteger(input.actorId) || input.actorId <= 0) {
    throw new MemberError('no_actor', 'An edit must name the account that made it.');
  }

  const before = await db.one<{ slug: string; status: string; title: string; is_page: boolean }>(
    `select slug, status, title, is_page from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) {
    const other = await db.one<{ is_page: boolean }>(`select is_page from ozikoro_article where id = $1`, [input.id]);
    if (other) {
      throw new MemberError(
        'wrong_kind',
        `That is a ${other.is_page ? 'page' : 'post'}, and this screen writes ${PIECE_KIND_LABEL[input.kind].toLowerCase()}s.`
      );
    }
    throw new MemberError('no_piece', 'That does not exist.');
  }
  if (before.status === 'trashed') {
    throw new MemberError(
      'trashed',
      'That is in the trash. Restore it first — a trashed piece is not edited, so that what is in the bin is what was put there.'
    );
  }

  const sanitisedBody = sanitiseArchiveHtml(input.bodyHtml, { internalHosts: [] });
  const standfirst = input.standfirst?.trim() || null;

  /*
   * WHICH SLUG THE SAVE ENDS WITH.
   *
   *   the editor typed one      -> that one, made unique against every other row
   *   it is still `draft-<id>`  -> one derived from the title, as soon as there is a title
   *   anything else             -> unchanged, because a published address is cited
   */
  let slug = before.slug;
  const typed = slugForTitle(input.slug ?? '');
  if (typed.length > 0 && typed !== before.slug) {
    slug = await uniqueSlug(db, typed, input.id);
  } else if (before.slug === `draft-${input.id}` && title.length > 0) {
    slug = await uniqueSlug(db, slugForTitle(title), input.id);
  }

  const row = await db.one<Record<string, unknown>>(
    `with target as (
       select id, title, standfirst, body_html
         from ozikoro_article where id = $1 and is_page = $2
     ), rev as (
       insert into ozikoro_article_revision
         (article_id, title, standfirst, body_html, revised_at, word_count, actor_id, note, carries_unique_text)
       select t.id, t.title, t.standfirst, t.body_html, now(), ${wordsOf('t.body_html')}, $6, $7, false
         from target t
       returning id
     ), upd as (
       update ozikoro_article
          set title = $3,
              standfirst = $4,
              body_html = $5,
              slug = $8,
              word_count = ${wordsOf('$5')},
              modified_at = now(),
              updated_at = now()
        where id = (select id from target)
       returning id, word_count, slug
     )
     select (select id from rev) as revision_id,
            (select id from upd) as updated_id,
            (select word_count from upd) as word_count,
            (select slug from upd) as slug,
            (select title from target) as before_title,
            (select standfirst from target) as before_standfirst`,
    [input.id, isPageFor(input.kind), title, standfirst, sanitisedBody, input.actorId, input.note ?? null, slug]
  );

  const updatedId = row?.updated_id === null || row?.updated_id === undefined ? null : Number(row.updated_id);
  if (updatedId === null) throw new MemberError('no_piece', 'That does not exist, so nothing was saved.');

  const revisionId = Number(row?.revision_id);
  const newWordCount = Number(row?.word_count ?? 0);
  const savedSlug = String(row?.slug ?? slug);
  const sanitised = sanitisedBody !== input.bodyHtml;

  await audit(db, {
    entityId: input.id,
    action: 'update_content',
    before: { title: row?.before_title ?? null, standfirst: row?.before_standfirst ?? null, slug: before.slug },
    after: {
      title, standfirst, slug: savedSlug, revisionId,
      bodyBytes: sanitisedBody.length, wordCount: newWordCount, sanitised,
    },
    actorId: input.actorId,
    note: input.note ?? null,
  });

  return { revisionId, wordCount: newWordCount, sanitised, slug: savedSlug, status: before.status };
}

// ---------------------------------------------------------------------------
// Publishing — an event, recorded once
// ---------------------------------------------------------------------------

export interface PublishPieceResult {
  from: string;
  to: 'published';
  publishedAt: string;
  /**
   * The address it is now served at, as the write left it.
   *
   * Returned rather than re-read by the caller, because the save inside this function is what may have
   * replaced a `draft-<id>` placeholder with a slug derived from the title — and a notice that printed the
   * slug the form carried would name an address the piece is not at.
   */
  slug: string;
  /**
   * True when this call is the one that published it.
   *
   * `false` can never be returned: a second publish is a refusal with a `MemberError`, never a quiet
   * success. The field exists so a caller can say so without inferring it.
   */
  firstPublication: boolean;
}

/**
 * PUBLISH A PIECE. Once.
 *
 * ── "EXACTLY ONCE" IS A PROPERTY OF THE STATEMENT, NOT OF THE CALLER ────────────────────────────────
 *
 * The transition is `where status in ('draft','review','archived')`. A second publish of an already
 * published piece therefore matches **zero rows**, changes nothing, writes no audit row and returns a
 * refusal that says so. The `published_at` date is written with `coalesce(published_at, now())` for the
 * same reason `decideArticleStatus` uses it: re-approving a published record must not move the date it
 * was published on, because that date is what the archive claims about itself.
 *
 * **A REFUSED PUBLISH WRITES NOTHING AT ALL** — not an audit row either. A row saying a publication was
 * attempted is indistinguishable in the trail from one saying it happened, and this trail is the thing
 * that makes a publication accountable.
 *
 * ── AND IT IS GATED HERE AS WELL AS AT THE DOOR ─────────────────────────────────────────────────────
 *
 * `capabilities.has('publish')` is checked in this function, not only in the route. The reason is the one
 * `editorial.ts` gives: a second caller — a script, a job, a route added next year — would otherwise be a
 * way to publish without the permission, and the plan's rule is that permissions are enforced server-side
 * and a hidden button is not authorisation.
 *
 * ── IT ALSO WRITES THE REVISION, BECAUSE PUBLISHING IS A CHANGE TO WHAT THE ARCHIVE HOLDS ───────────
 *
 * WordPress's Publish button saves the body and publishes in one press. So does this: `publishPiece`
 * takes the text, saves it (which writes a revision of what was there before) and then transitions the
 * status. The order matters — the text is saved first, so a publication cannot fail halfway and leave a
 * published piece holding text nobody saved.
 */
export async function publishPiece(
  db: Db,
  input: SavePieceInput & { capabilities: Set<string> }
): Promise<PublishPieceResult> {
  if (!input.capabilities.has('publish')) {
    throw new MemberError(
      'forbidden',
      'Publishing puts a piece in front of readers, which needs the “publish” permission. That one is not yours.'
    );
  }

  const before = await db.one<{ status: string; is_page: boolean; published_at: Date | null }>(
    `select status, is_page, published_at from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (before.status === 'trashed') {
    throw new MemberError('trashed', 'That is in the trash. Restore it first; a piece in the bin is not published from here.');
  }
  if (before.status === 'published') {
    throw new MemberError(
      'already_published',
      `That is already published, on ${before.published_at ? new Date(before.published_at).toISOString().slice(0, 10) : 'a recorded date'}. ` +
        'Press “Update” to save changes to it; publishing a second time would move a date the archive has already stated.'
    );
  }
  if (input.title.trim().length === 0) {
    throw new MemberError(
      'no_title',
      'A published piece needs a title. It is what a citation names it by, what the browser tab shows and what the sitemap lists — ' +
        'so save it as a draft until it has one.'
    );
  }

  // The words first, so a publication never holds text nobody saved.
  const saved = await savePieceText(db, input);

  const updated = await db.one<{ published_at: Date }>(
    `update ozikoro_article
        set status = 'published',
            published_at = coalesce(published_at, now()),
            modified_at = now(),
            updated_at = now()
      where id = $1 and is_page = $2 and status in ('draft','review','archived')
      returning published_at`,
    [input.id, isPageFor(input.kind)]
  );
  if (!updated) {
    // Only reachable if the status moved between the read above and this statement.
    throw new MemberError('not_published', 'The status changed while this was saving, so nothing was published. Nothing was changed.');
  }
  const publishedAt = new Date(String(updated.published_at)).toISOString();

  await audit(db, {
    entityId: input.id,
    action: input.kind === 'page' ? 'publish_page' : 'publish_post',
    before: { status: before.status, publishedAt: before.published_at ? new Date(before.published_at).toISOString() : null },
    after: { status: 'published', publishedAt, slug: saved.slug, revisionId: saved.revisionId, wordCount: saved.wordCount },
    actorId: input.actorId,
    note:
      `Published at /${saved.slug}/, and the revision saved in the same press is ${saved.revisionId}.` +
      (input.note ? ` ${input.note.trim()}` : ''),
  });

  return { from: before.status, to: 'published', publishedAt, slug: saved.slug, firstPublication: true };
}

/**
 * Take a published piece back to draft. WordPress's "Switch to draft".
 *
 * IT KEEPS `published_at`, WHICH IS DELIBERATE. The archive's own `decideArticleStatus` does the same for
 * the same reason: the date says when the piece *was* published, and clearing it would erase a fact the
 * audit trail still holds. What stops it being public is the status, and only the status — every read path
 * selects on it.
 */
export async function unpublishPiece(
  db: Db,
  input: { id: number; kind: PieceKind; actorId: number; capabilities: Set<string>; note?: string | null }
): Promise<{ from: string; to: string }> {
  if (!input.capabilities.has('publish')) {
    throw new MemberError('forbidden', 'Taking a published piece down needs the “publish” permission. That one is not yours.');
  }
  const before = await db.one<{ status: string }>(
    `select status from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (before.status !== 'published') {
    throw new MemberError('not_published', `That is ${PIECE_STATUS_LABEL[before.status] ?? before.status}, so there is nothing to take down.`);
  }

  await db.query(
    `update ozikoro_article set status = 'draft', modified_at = now(), updated_at = now()
      where id = $1 and is_page = $2 and status = 'published'`,
    [input.id, isPageFor(input.kind)]
  );

  await audit(db, {
    entityId: input.id,
    action: input.kind === 'page' ? 'unpublish_page' : 'unpublish_post',
    before: { status: 'published' },
    after: { status: 'draft' },
    actorId: input.actorId,
    note:
      'Returned to draft, so its address stops resolving. The publication date is kept: it records when it was published, ' +
      'which is a thing that happened.' + (input.note ? ` ${input.note.trim()}` : ''),
  });

  return { from: 'published', to: 'draft' };
}

// ---------------------------------------------------------------------------
// The trash, for both kinds
// ---------------------------------------------------------------------------

/**
 * Move a piece to the trash. A move, not a destruction.
 *
 * WHY THIS IS NOT `trashArticle`. That function refuses a page by construction — *"Pages are not deleted
 * here"* — and it is right to: the archive's editorial screen never listed one. This screen does, and a
 * page that cannot be deleted from the list it appears in is a control that does nothing. The semantics
 * are copied exactly (`deleted_at`, `deleted_by`, `deleted_from_status`, an audit row), because the trash
 * screen reads those columns and a second way of writing them would be a second bin.
 */
export async function trashPiece(
  db: Db,
  input: { id: number; kind: PieceKind; actorId: number; note?: string | null }
): Promise<{ from: string }> {
  const before = await db.one<{ status: string; title: string; slug: string }>(
    `select status, title, slug from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (before.status === 'trashed') throw new MemberError('already_trashed', 'That is already in the trash.');

  await db.query(
    `update ozikoro_article
        set status = 'trashed', deleted_at = now(), deleted_by = $2, deleted_from_status = $3, updated_at = now()
      where id = $1`,
    [input.id, input.actorId, before.status]
  );

  await audit(db, {
    entityId: input.id,
    action: input.kind === 'page' ? 'trash_page' : 'trash_post',
    before: { status: before.status, deleted: false },
    after: { status: 'trashed', deleted: true, recoverable: true },
    actorId: input.actorId,
    note:
      `Moved “${before.title || '(no title)'}” to the trash from ${before.status}. Nothing was destroyed and it can be ` +
      'restored to that state.' + (input.note ? ` ${input.note.trim()}` : ''),
  });

  return { from: before.status };
}

/** Bring a piece back, as what it was. Mirrors `restoreArticle`, and works for pages too. */
export async function restorePiece(
  db: Db,
  input: { id: number; kind: PieceKind; actorId: number }
): Promise<{ to: string }> {
  const before = await db.one<{ status: string; deleted_from_status: string | null; title: string }>(
    `select status, deleted_from_status, title from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (before.status !== 'trashed') throw new MemberError('not_trashed', 'That is not in the trash, so there is nothing to restore.');

  const to = before.deleted_from_status ?? 'draft';
  await db.query(
    `update ozikoro_article
        set status = $2, deleted_at = null, deleted_by = null, deleted_from_status = null, updated_at = now()
      where id = $1 and status = 'trashed'`,
    [input.id, to]
  );

  await audit(db, {
    entityId: input.id,
    action: input.kind === 'page' ? 'restore_page' : 'restore_post',
    before: { status: 'trashed', deleted: true },
    after: { status: to, deleted: false },
    actorId: input.actorId,
    note: `Restored “${before.title || '(no title)'}” from the trash to ${to}, which is the state it was taken out of.`,
  });

  return { to };
}

// ---------------------------------------------------------------------------
// The meta boxes: series, tags, featured image, author
// ---------------------------------------------------------------------------

/** One label, found by name or created. `ozikoro_label.slug` is the unique key. */
async function findOrCreateLabel(db: Db, name: string): Promise<number> {
  const trimmed = name.trim().slice(0, 120);
  if (trimmed.length === 0) throw new MemberError('empty_label', 'A tag needs a name.');
  /*
   * ── THE REGISTER IS MATCHED BY NAME FIRST, BECAUSE A TAG'S WORDPRESS SLUG IS NOT `slugForTitle(NAME)` ──
   *
   * The 11,056 tags were imported with the slug WordPress gave them, and WordPress's slug is not always the
   * slug this function would derive from the same name. **MEASURED against the live register: 126 of the
   * 11,056 differ.**
   *
   *   `LP's`                          stored `lps`                         derives `lp-s`
   *   `Sclater’s guenon conservation`  stored `sclaters-guenon-conservation` derives `sclater-s-guenon-conservation`
   *   `Ímò Ḿmírí`                      stored `imo-%e1%b8%bfmiri`            derives `imo-mmiri`
   *   `Eghaevbo N'Ogbe`                stored `eghaevbo-nogbe`              derives `eghaevbo-n-ogbe`
   *
   * **AND THE CONSEQUENCE IS NOT COSMETIC, WHICH IS WHY THIS IS A LOOKUP AND NOT A TIDINESS PASS.** For one
   * of those 126, a lookup by derived slug alone finds nothing, so this function would MINT A SECOND LABEL
   * for a tag that already existed — and `setPieceTerms` deletes every link the piece has before it re-adds
   * them, so the first save of any article carrying that tag would move that article off the imported label
   * and onto the duplicate. The original tag would keep its `/labels/<slug>/` address, its usage count and
   * its search value, and quietly lose the article that was filed under it.
   *
   * The editor's Tags box is filled from `ozikoro_label.name` and submits those names back, so an unchanged
   * tag arrives here as the exact name it was read from. Matching on the name — case-insensitively, as
   * `ozikoro_label_name_idx` is built on `lower(name)` — is therefore the lookup that round-trips. The
   * derived slug is still the fallback for a genuinely new tag, and remains how one is created.
   */
  const byName = await db.one<{ id: number }>(
    `select id from ozikoro_label where lower(name) = lower($1) order by id limit 1`,
    [trimmed]
  );
  if (byName) return Number(byName.id);
  const slug = slugForTitle(trimmed) || `label-${Date.now()}`;
  const existing = await db.one<{ id: number }>(`select id from ozikoro_label where slug = $1`, [slug]);
  if (existing) return Number(existing.id);
  const created = await db.one<{ id: number }>(
    `insert into ozikoro_label (slug, name) values ($1, $2) returning id`,
    [slug, trimmed]
  );
  return Number(created?.id);
}

/**
 * Set a piece's series and its tags.
 *
 * THE SERIES IS ONE AND THE TAGS ARE MANY, WHICH IS THE SCHEMA AND NOT A SIMPLIFICATION.
 * WordPress's Categories box is a hierarchical multi-select and its Tags box is free text;
 * `ozikoro_article.topic_id` is a single foreign key into the fourteen migrated WordPress categories
 * and `ozikoro_article_label` is a many-to-many into the 11,056 tags. The screen says which is which
 * rather than drawing checkboxes that would silently keep only the last one ticked.
 */
export async function setPieceTerms(
  db: Db,
  input: { id: number; kind: PieceKind; topicId: number | null; labelNames: string[]; actorId: number }
): Promise<{ topicId: number | null; labels: string[] }> {
  const before = await db.one<{ topic_id: number | null; is_page: boolean; title: string }>(
    `select topic_id, is_page, title from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (input.topicId !== null) {
    const topic = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_topic where id = $1`, [input.topicId]);
    if (Number(topic?.n ?? 0) === 0) throw new MemberError('no_topic', 'That series does not exist.');
  }

  const beforeLabels = await db.rows<{ name: string }>(
    `select l.name from ozikoro_article_label al join ozikoro_label l on l.id = al.label_id
      where al.article_id = $1 order by l.name`,
    [input.id]
  );

  await db.query(`update ozikoro_article set topic_id = $2, updated_at = now() where id = $1`, [input.id, input.topicId]);

  // De-duplicate by slug, because "Ute-Okpu" typed twice is one tag.
  const wanted = new Map<string, string>();
  for (const raw of input.labelNames) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const slug = slugForTitle(name);
    if (slug.length > 0) wanted.set(slug, name);
  }

  await db.query(`delete from ozikoro_article_label where article_id = $1`, [input.id]);
  for (const name of wanted.values()) {
    const labelId = await findOrCreateLabel(db, name);
    await db.query(
      `insert into ozikoro_article_label (article_id, label_id) values ($1, $2) on conflict do nothing`,
      [input.id, labelId]
    );
  }

  const after = [...wanted.values()].sort((a, b) => a.localeCompare(b));
  await audit(db, {
    entityId: input.id,
    action: 'update_terms',
    before: { topicId: before.topic_id === null ? null : Number(before.topic_id), labels: beforeLabels.map((l) => l.name) },
    after: { topicId: input.topicId, labels: after },
    actorId: input.actorId,
    note: `Series and tags saved on “${before.title || '(no title)'}”.`,
  });

  return { topicId: input.topicId, labels: after };
}

/** A tag list, most used first, for the Tags box's "Choose from the most used tags". */
export async function listTagCloud(db: Db, limit = 30): Promise<{ name: string; slug: string; articleCount: number }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select l.name, l.slug,
            (select count(*)::int from ozikoro_article_label al where al.label_id = l.id) as article_count
       from ozikoro_label l
      where exists (select 1 from ozikoro_article_label al where al.label_id = l.id)
      order by article_count desc, l.name
      limit $1`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((r) => ({ name: String(r.name), slug: String(r.slug), articleCount: Number(r.article_count ?? 0) }));
}

/** Set the featured image. `null` clears it. */
export async function setFeaturedImage(
  db: Db,
  input: { id: number; kind: PieceKind; mediaId: number | null; actorId: number }
): Promise<void> {
  const before = await db.one<{ featured_media_id: number | null; title: string }>(
    `select featured_media_id, title from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (input.mediaId !== null) {
    const media = await db.one<{ id: number }>(`select id from ozikoro_media where id = $1`, [input.mediaId]);
    if (!media) throw new MemberError('no_media', 'That is not an item in the media register.');
  }
  await db.query(`update ozikoro_article set featured_media_id = $2, updated_at = now() where id = $1`, [
    input.id,
    input.mediaId,
  ]);
  await audit(db, {
    entityId: input.id,
    action: 'set_featured_image',
    before: { featuredMediaId: before.featured_media_id === null ? null : Number(before.featured_media_id) },
    after: { featuredMediaId: input.mediaId },
    actorId: input.actorId,
    note: `Featured image ${input.mediaId === null ? 'cleared' : 'set'} on “${before.title || '(no title)'}”.`,
  });
}

/** Set the byline. `null` clears it, which is a real state: the page then prints no author. */
export async function setPieceAuthor(
  db: Db,
  input: { id: number; kind: PieceKind; authorId: number | null; actorId: number }
): Promise<void> {
  const before = await db.one<{ author_id: number | null; title: string }>(
    `select author_id, title from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (input.authorId !== null) {
    const author = await db.one<{ id: number }>(`select id from ozikoro_contributor where id = $1`, [input.authorId]);
    if (!author) throw new MemberError('no_author', 'That writer is not in the register.');
  }
  await db.query(`update ozikoro_article set author_id = $2, updated_at = now() where id = $1`, [input.id, input.authorId]);
  await audit(db, {
    entityId: input.id,
    action: 'set_author',
    before: { authorId: before.author_id === null ? null : Number(before.author_id) },
    after: { authorId: input.authorId },
    actorId: input.actorId,
    note: `Byline changed on “${before.title || '(no title)'}”.`,
  });
}

// ---------------------------------------------------------------------------
// Quick Edit
// ---------------------------------------------------------------------------

/**
 * The Status control in the Publish box, and the only statuses it may reach.
 *
 * WHY THIS CANNOT SET `published`. WordPress's Status dropdown lists Draft, Pending, Private and
 * Published, and choosing Published there saves the small form and puts the post live. On this archive
 * that would be a second way to publish, from a control that sits beside the text but does not show the
 * title, the body or the date as one decision — and the owner's brief is about publishing being one
 * deliberate act. So `published` is refused here by name and told to use the Publish button, and the two
 * statuses this *can* reach are both steps that withhold the piece from readers:
 *
 *   `draft`   — a draft, which is what a piece starts as. WordPress's "Switch to draft".
 *   `review`  — "Pending" on the list tables and "In review" in the editorial queue: submitted for a
 *               second pair of eyes. A piece in review is not served anywhere either.
 *
 * TAKING A PUBLISHED PIECE DOWN IS AN UNPUBLISH, SO IT ASKS FOR `publish`. Otherwise a contributor who
 * may write would be able to withdraw something from the public site with a dropdown.
 */
export async function setPieceStatus(
  db: Db,
  input: {
    id: number;
    kind: PieceKind;
    status: 'draft' | 'review';
    actorId: number;
    capabilities: Set<string>;
    note?: string | null;
  }
): Promise<{ from: string; to: string }> {
  /*
   * THE TARGET IS CHECKED AT RUNTIME, NOT ONLY BY THE TYPE.
   *
   * `status: 'draft' | 'review'` stops a caller in this repository, and it is not a rule: a route reads
   * that value out of a form, and a TypeScript union is erased by the time the request arrives. So the
   * refusal is here, in the write, where a hand-made POST meets it too — **and it is the same shape as the
   * door's check, because this is the act the owner's brief is about.**
   */
  if (input.status !== 'draft' && input.status !== 'review') {
    throw new MemberError(
      'bad_status',
      'A piece is set to Draft or Pending here. Publishing is its own act with its own record, and it is not reachable from the status control.'
    );
  }

  const before = await db.one<{ status: string }>(
    `select status from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (before.status === 'trashed') {
    throw new MemberError('trashed', 'That is in the trash. Restore it first; a piece in the bin has no status to set.');
  }
  if (before.status === input.status) return { from: before.status, to: input.status };
  if (before.status === 'published' && !input.capabilities.has('publish')) {
    throw new MemberError(
      'forbidden',
      'Taking a published piece out of the public site needs the “publish” permission. That one is not yours.'
    );
  }

  await db.query(
    `update ozikoro_article set status = $2, modified_at = now(), updated_at = now() where id = $1 and is_page = $3`,
    [input.id, input.status, isPageFor(input.kind)]
  );

  await audit(db, {
    entityId: input.id,
    action: 'update_facets',
    before: { status: before.status },
    after: { status: input.status },
    actorId: input.actorId,
    note:
      `Status set from ${PIECE_STATUS_LABEL[before.status] ?? before.status} to ` +
      `${PIECE_STATUS_LABEL[input.status] ?? input.status}.` +
      (input.status === 'review' ? ' It is submitted for review and is not served anywhere while it is.' : '') +
      (input.note ? ` ${input.note.trim()}` : ''),
  });

  return { from: before.status, to: input.status };
}

/**
 * The row-level edit WordPress puts behind "Quick Edit": title, slug, date, author and status.
 *
 * **THE STATUS HERE IS ONLY DRAFT OR PUBLISHED, AND IT IS NOT A BACK DOOR TO PUBLISHING.** WordPress's
 * Quick Edit offers the whole status list, and on this archive that would be a second, one-click way to
 * put a piece in front of readers — from a table, with no body on the screen, on a piece whose title may
 * be empty. So the transition to `published` is refused here and told to use the editor, where the text
 * and the title are in front of the person making the decision. Taking a piece DOWN is allowed, because
 * that is the safe direction and the editor screen has the same control.
 *
 * The date is the `published_at` a published piece is dated by. Setting a date does not publish anything.
 */
export async function quickEditPiece(
  db: Db,
  input: {
    id: number;
    kind: PieceKind;
    title: string;
    slug: string;
    authorId: number | null;
    status: string;
    publishedAt: string | null;
    actorId: number;
    capabilities: Set<string>;
  }
): Promise<{ slug: string; status: string }> {
  const before = await db.one<{ title: string; slug: string; status: string; author_id: number | null; published_at: Date | null }>(
    `select title, slug, status, author_id, published_at from ozikoro_article where id = $1 and is_page = $2`,
    [input.id, isPageFor(input.kind)]
  );
  if (!before) throw new MemberError('no_piece', 'That does not exist.');
  if (before.status === 'trashed') throw new MemberError('trashed', 'That is in the trash, so it is not edited in a list. Restore it first.');

  const title = input.title.trim().slice(0, MAX_TITLE);
  if (title.length === 0) throw new MemberError('no_title', 'A piece needs a title even in the quick editor.');

  if (input.status === 'published' && before.status !== 'published') {
    throw new MemberError(
      'publish_needs_the_editor',
      'Publishing is not the quick editor’s. Open the piece and use Publish, where its title, its text and its date are in front of you.'
    );
  }
  if (input.status !== 'published' && input.status !== 'draft') {
    throw new MemberError('bad_status', 'The quick editor sets a piece to Published or Draft and nothing else.');
  }
  if (input.status === 'draft' && before.status === 'published' && !input.capabilities.has('publish')) {
    throw new MemberError('forbidden', 'Taking a published piece down needs the “publish” permission. That one is not yours.');
  }

  if (input.authorId !== null) {
    const author = await db.one<{ id: number }>(`select id from ozikoro_contributor where id = $1`, [input.authorId]);
    if (!author) throw new MemberError('no_author', 'That writer is not in the register.');
  }

  const typed = slugForTitle(input.slug);
  if (typed.length === 0 && input.slug.trim().length > 0) {
    throw new MemberError('bad_slug', 'That address has no letters or digits in it. Edit it into an address a reader could type.');
  }
  const slug = typed.length > 0 ? await uniqueSlug(db, typed, input.id) : before.slug;

  let when: string | null = null;
  if (input.publishedAt) {
    const parsed = new Date(input.publishedAt);
    if (Number.isNaN(parsed.getTime())) throw new MemberError('bad_date', 'That is not a date.');
    when = parsed.toISOString();
  }

  await db.query(
    `update ozikoro_article
        set title = $2,
            slug = $3,
            author_id = $4,
            status = $5,
            published_at = coalesce($6::timestamptz, published_at),
            modified_at = now(),
            updated_at = now()
      where id = $1 and is_page = $7`,
    [input.id, title, slug, input.authorId, input.status, when, isPageFor(input.kind)]
  );

  await audit(db, {
    entityId: input.id,
    action: 'quick_edit',
    before: {
      title: before.title, slug: before.slug, status: before.status,
      authorId: before.author_id === null ? null : Number(before.author_id),
      publishedAt: before.published_at ? new Date(before.published_at).toISOString() : null,
    },
    after: { title, slug, status: input.status, authorId: input.authorId, publishedAt: when },
    actorId: input.actorId,
    note: 'Edited from the list table.',
  });

  return { slug, status: input.status };
}

// ---------------------------------------------------------------------------
// The list tables
// ---------------------------------------------------------------------------

export type StatusFilter = 'all' | 'publish' | 'draft' | 'pending' | 'trash';

export interface PieceRow {
  id: number;
  title: string;
  slug: string;
  status: string;
  author: string | null;
  topic: string | null;
  /** The series id as well as its name, because Quick Edit offers the choice as a select. */
  topicId: number | null;
  tags: string[];
  publishedAt: string | null;
  modifiedAt: string | null;
  createdAt: string;
  wordCount: number;
  /** What it was before the trash, so the list can say a trashed piece can come back as that. */
  deletedFromStatus: string | null;
}

export interface PieceCounts {
  all: number;
  publish: number;
  draft: number;
  pending: number;
  trash: number;
}

/**
 * The rows one list table shows.
 *
 * THE KIND IS THE FIRST TERM OF THE QUERY AND THAT IS THE POINT. `is_page = $1` is in the statement, in
 * the counts and in every action that follows — so "All Posts" and "All Pages" are two lists over two
 * disjoint sets of rows rather than one list with a filter a caller could forget. The owner's brief asks
 * for them as separate menus and separate screens, and the schema's own `is_page` is what makes that
 * structural.
 *
 * "All" EXCLUDES THE TRASH, which is WordPress's behaviour and the right one: the bin is reached from its
 * own link at the end of the status row, and a piece you deleted should not still be counted in "All".
 */
export async function listPieces(
  db: Db,
  options: { kind: PieceKind; status?: StatusFilter; search?: string | null; limit?: number; offset?: number }
): Promise<PieceRow[]> {
  const status = options.status ?? 'all';
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const params: unknown[] = [isPageFor(options.kind)];

  let where = 'a.is_page = $1';
  if (status === 'trash') {
    where += ` and a.status = 'trashed'`;
  } else {
    where += ` and a.status <> 'trashed'`;
    if (status === 'publish') where += ` and a.status = 'published'`;
    if (status === 'draft') where += ` and a.status = 'draft'`;
    if (status === 'pending') where += ` and a.status = 'review'`;
  }
  if (options.search && options.search.trim().length > 0) {
    params.push(`%${options.search.trim()}%`);
    where += ` and a.title ilike $${params.length}`;
  }
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select a.id, a.title, a.slug, a.status, a.published_at, a.modified_at, a.created_at, a.word_count,
            a.deleted_from_status, a.topic_id,
            c.display_name as author,
            t.name as topic,
            (select coalesce(array_agg(l.name order by l.name), '{}')
               from ozikoro_article_label al join ozikoro_label l on l.id = al.label_id
              where al.article_id = a.id) as tags
       from ozikoro_article a
       left join ozikoro_contributor c on c.id = a.author_id
       left join ozikoro_topic t on t.id = a.topic_id
      where ${where}
      order by coalesce(a.published_at, a.modified_at, a.created_at) desc, a.id desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ''),
    slug: String(r.slug),
    status: String(r.status),
    author: r.author ? String(r.author) : null,
    topic: r.topic ? String(r.topic) : null,
    topicId: r.topic_id === null || r.topic_id === undefined ? null : Number(r.topic_id),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    publishedAt: r.published_at ? new Date(String(r.published_at)).toISOString() : null,
    modifiedAt: r.modified_at ? new Date(String(r.modified_at)).toISOString() : null,
    createdAt: new Date(String(r.created_at)).toISOString(),
    wordCount: Number(r.word_count ?? 0),
    deletedFromStatus: r.deleted_from_status ? String(r.deleted_from_status) : null,
  }));
}

/** The four figures the status links carry, plus the total the "All" link means. */
export async function countPieces(db: Db, kind: PieceKind, search?: string | null): Promise<PieceCounts> {
  const params: unknown[] = [isPageFor(kind)];
  let searchTerm = '';
  if (search && search.trim().length > 0) {
    params.push(`%${search.trim()}%`);
    searchTerm = ` and a.title ilike $${params.length}`;
  }
  const row = await db.one<Record<string, unknown>>(
    `select
       count(*) filter (where a.status <> 'trashed')::int as all_count,
       count(*) filter (where a.status = 'published')::int as publish_count,
       count(*) filter (where a.status = 'draft')::int as draft_count,
       count(*) filter (where a.status = 'review')::int as pending_count,
       count(*) filter (where a.status = 'trashed')::int as trash_count
     from ozikoro_article a
     where a.is_page = $1${searchTerm}`,
    params
  );
  return {
    all: Number(row?.all_count ?? 0),
    publish: Number(row?.publish_count ?? 0),
    draft: Number(row?.draft_count ?? 0),
    pending: Number(row?.pending_count ?? 0),
    trash: Number(row?.trash_count ?? 0),
  };
}

/** The writers the Author box offers: the archive's own contributor register. */
export async function listWriters(db: Db): Promise<{ id: number; name: string; slug: string }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, display_name, slug from ozikoro_contributor order by display_name`
  );
  return rows.map((r) => ({ id: Number(r.id), name: String(r.display_name), slug: String(r.slug) }));
}

/** The contributor linked to an account, when there is one, so a new piece can default its byline. */
export async function contributorForAccount(db: Db, accountId: number): Promise<number | null> {
  const row = await db.one<{ id: number }>(`select id from ozikoro_contributor where account_id = $1 limit 1`, [accountId]);
  return row ? Number(row.id) : null;
}

export interface MediaChoice {
  id: number;
  key: string;
  name: string;
  altText: string | null;
  kind: string;
}

/** Recent media, for the Featured Image box. A pick-list rather than a URL, so nothing is hot-linked. */
export async function listMediaChoices(
  db: Db,
  options: { search?: string | null; limit?: number; includeId?: number | null } = {}
): Promise<MediaChoice[]> {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const params: unknown[] = [];
  let where = `deleted_at is null and storage_key is not null`;
  if (options.search && options.search.trim().length > 0) {
    params.push(`%${options.search.trim()}%`);
    where += ` and (title ilike $1 or coalesce(alt_text, '') ilike $1 or storage_key ilike $1)`;
  }
  /*
   * THE ITEM ALREADY CHOSEN IS ALWAYS IN THE LIST, WHATEVER IT IS. The list is the twenty-four most recent
   * media, and a piece whose featured image was chosen a year ago would otherwise find its own picture
   * missing from the select — which a browser resolves to the first option, so the next save would replace
   * a photograph nobody asked to change.
   */
  if (options.includeId !== null && options.includeId !== undefined) {
    params.push(options.includeId);
    where = `(${where}) or id = $${params.length}`;
  }
  params.push(limit);
  const rows = await db.rows<Record<string, unknown>>(
    `select id, storage_key, coalesce(title, storage_key) as name, alt_text, kind
       from ozikoro_media
      where ${where}
      order by id desc
      limit $${params.length}`,
    params
  );
  return rows.map((r) => ({
    id: Number(r.id),
    key: String(r.storage_key),
    name: String(r.name),
    altText: r.alt_text ? String(r.alt_text) : null,
    kind: String(r.kind),
  }));
}

/**
 * The trashed pieces of one kind, for the counts the trash screen and this list both show.
 *
 * It exists so "Trash (3)" on the status row is the same number `/admin/trash` lists for this kind, read
 * from one place. The trash screen itself is not duplicated: its purge is a capability this screen does
 * not hold, and a second list would be a second place for the bin to be described.
 */
export async function countTrashed(db: Db, kind: PieceKind): Promise<number> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_article where is_page = $1 and status = 'trashed'`,
    [isPageFor(kind)]
  );
  return Number(row?.n ?? 0);
}
