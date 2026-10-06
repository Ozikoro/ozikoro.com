/**
 * Readers' comments: the store, the states, and the box that shows them.
 *
 * THE OWNER'S REQUEST, AND THE MEASUREMENT THAT PRECEDED IT
 *
 * *"go back to the github, and add the comment section it added. just copy the design, and make it work"* —
 * and there was nothing to copy. **"Sign in to join" and "source or correction" appear in no branch, no
 * file and no format**, the design deliverable draws no discussion block on any of its 52 screens, and the
 * editor's own Discussion box said *"this archive has no comment system: there is no comment table, no
 * moderation queue for readers' replies"*. That sentence was true. So the feature is built from the owner's
 * description of it, which is the only specification that exists:
 *
 *     "Not signed in: a 'Sign in to join the discussion' message with Sign in and Create an account
 *      buttons. Signed in: a comment box with a 'This includes a source or correction' tick box and a
 *      Post comment button."  …  "comments are checked before they appear."
 *
 * ── WHY A PATH AND NOT ONLY AN ARTICLE ──────────────────────────────────────────────────────────────
 *
 * He named six kinds of page and only two of them are records. A publication is an `ozikoro_publication`;
 * `/watch/`, `/projects/` and `/cultural-calendar/` are section pages with no row of their own — the archive
 * has no project table and no event table, which those pages say in their own words. **A store that could
 * only hold an `article_id` could not carry a comment on four of his six pages**, and inventing an
 * `ozikoro_article` row for `/watch/` to hang a comment on would be fabricating a record. So the thread is
 * the page ADDRESS, and `article_id` is set only when the page really is a record. See migration 0061.
 *
 * ── THE STATE MACHINE, AND WHY PENDING IS THE DEFAULT IN SQL ─────────────────────────────────────────
 *
 * `pending` is what the schema writes when a caller names no state, so **a route added later that forgets to
 * think about moderation does not publish anything.** `approved` is shown to everyone; `pending` is shown to
 * the account that wrote it and to a moderator, and to nobody else; `rejected` is shown to nobody. That is
 * the whole of the visibility rule and it lives in one SQL predicate (`visibleTo`) rather than in the
 * screens, because a screen is presentation and this is the archive's decision about somebody's words.
 *
 * ⚠️ **THE OWNER'S TWO EXAMPLE COMMENTS ARE NOT HERE, AND MUST NOT BE.** *"Design examples — do not put
 * them on live pages."* So a reader is shown real comments or an honest empty state. The two shapes exist
 * for exactly one viewer — an account holding `moderate`, behind `?ozcommentstates=1` — and every line of
 * them says "Example" and claims no author. **No invented person's name and no invented person's words ever
 * reach a public page from this module.**
 *
 * ── WHAT A COMMENTER IS CALLED, AND WHAT IS DELIBERATELY NOT SHOWN ───────────────────────────────────
 *
 * The account's own display name. **Never the email address** — the account table's email is a credential
 * and a private fact, and a comment page is public. An account with no display name is shown as "A member",
 * which is honest and anonymous rather than a guess. The archive's contributors are named by
 * `ozikoro_contributor`; a commenter is not a contributor and is not dressed as one.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError, can } from './members.ts';

/** The three states a comment can be in. See the module header for the visibility of each. */
export type CommentState = 'pending' | 'approved' | 'rejected';

/** One comment, as the store holds it and as a screen shows it. */
export interface Comment {
  id: number;
  /** The page address the comment belongs to. */
  path: string;
  /** The record, when the page is a record. `null` on a section page. */
  articleId: number | null;
  accountId: number;
  /** The display name the account chose, or "A member". **Never the email.** */
  author: string;
  body: string;
  isSourceOrCorrection: boolean;
  state: CommentState;
  createdAt: string;
  moderatedAt: string | null;
}

/**
 * What a comment is attached to.
 *
 * `record` carries the `article_id` as well as the address, because a record's page reads its own thread by
 * key rather than by re-deriving an address — and because the foreign key is what makes a record's
 * discussion cascade away with the record.
 */
export type CommentSubject =
  | { kind: 'record'; articleId: number; path: string }
  | { kind: 'page'; path: string };

/**
 * The section pages that are open for discussion, and the only paths accepted that are not records.
 *
 * A closed set rather than a pattern: `/watch/`, `/projects/` and `/cultural-calendar/` are the three of the
 * owner's six that are not records and not publications. **A path outside it is refused**, so a crafted POST
 * cannot open a discussion on an address the archive never agreed to discuss on.
 */
export const SECTION_DISCUSSION_PATHS = ['/watch/', '/projects/', '/cultural-calendar/'] as const;

/** The longest comment the box and the table both accept. The table's own check is the rule. */
export const COMMENT_MAX_LENGTH = 4000;

/**
 * The design screens that ARE discussion pages, and the public address each one is served at.
 *
 * ⚠️ **THIS IS A CLOSED MAP AND EVERY OTHER SCREEN NAME MUST RETURN `null`.** `apps/ozikoro/middleware.ts`
 * rewrites `/watch/`, `/projects/` and `/cultural-calendar/` to these three screens — measured on the served
 * site, where `/watch/` and `/design-screen/watch` are byte-identical — so for those three the SCREEN is the
 * page and this is where its discussion has to be drawn.
 *
 * **THE OTHER 50 SCREENS ARE THE REASON THIS FUNCTION IS PURE AND SEPARATE.** The hook that calls it runs on
 * every design screen, and the deliverable under `public/design/` is inviolable: a fill pass that shifted one
 * byte of a screen nobody asked about would be a regression dressed as a feature. Splitting the decision out
 * of the app-level helper is what lets `comments.test.ts` assert, over every screen name the deliverable
 * ships, that exactly three of them are discussion pages — instead of that being a claim in a comment.
 */
const DISCUSSION_SCREENS: Record<string, string> = {
  watch: '/watch/',
  projects: '/projects/',
  'cultural-calendar': '/cultural-calendar/',
};

/**
 * The address a design screen is discussed at, or `null` when that screen carries no discussion.
 *
 * `null` is the answer for 50 of the deliverable's 53 files, and a caller must return its document
 * **unchanged** when it gets one.
 */
export function discussionScreenPath(screen: string): string | null {
  return Object.prototype.hasOwnProperty.call(DISCUSSION_SCREENS, screen)
    ? (DISCUSSION_SCREENS[screen] as string)
    : null;
}

/** The design screens that are discussion pages, for a check that wants to enumerate them. */
export const DISCUSSION_SCREEN_NAMES = Object.keys(DISCUSSION_SCREENS);

/** The most comments one page renders. A discussion, not an unbounded archive of one. */
const RENDER_LIMIT = 200;

/**
 * The same slug re-encoded the way WordPress stored it, for the one record whose slug holds a `%xx`.
 *
 * `app/[slug]/route.ts` keeps the identical function privately and explains the fault it answers: Next
 * decodes the path before routing, so a record whose stored slug contains `%c7%b9` arrives decoded and does
 * not equal the row. A discussion is looked up by exactly the same string the page was served under, so the
 * same round trip is needed here — **without it, that one record's page would show a box that could not find
 * the comments it had just accepted.**
 */
function wordpressUriEncode(slug: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(slug)) {
    out += byte < 0x80 ? String.fromCharCode(byte) : `%${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}

/**
 * A page address, cleaned, or null when it is not one this archive serves.
 *
 * The query and the fragment are dropped rather than refused: `?page=2` and `#discussion` are two spellings
 * of one page and one discussion, which is the same rule the migration records on the column. Everything
 * else — a relative address, a protocol-relative host, anything long enough to be an attack — is refused.
 */
function cleanPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed.length > 300) return null;
  const withoutFragment = trimmed.split('#')[0] ?? '';
  const withoutQuery = withoutFragment.split('?')[0] ?? '';
  return withoutQuery.length > 0 ? withoutQuery : null;
}

/**
 * What a posted address actually refers to, decided by the database and never by the caller.
 *
 * ⚠️ **THIS IS THE ONE PLACE A CLIENT-SUPPLIED STRING BECOMES A SUBJECT, AND IT IS WHY THE FORM MAY CARRY
 * AN ADDRESS AT ALL.** The alternative — posting an `article_id` — would let a form name any record in the
 * archive, including a draft one, and would have nothing to say about the three pages that are not records.
 * Here the address is resolved against `ozikoro_article` and `ozikoro_publication`, **and the stored slug is
 * what comes back**, so the thread key is the archive's own and not the browser's spelling of it.
 */
export async function resolveSubject(db: Db, rawPath: string): Promise<CommentSubject> {
  const path = cleanPath(rawPath);
  if (!path) throw new MemberError('no_page', 'That is not a page on this archive.');

  if ((SECTION_DISCUSSION_PATHS as readonly string[]).includes(path)) {
    return { kind: 'page', path };
  }

  if (path.startsWith('/publications/')) {
    const slug = path.slice('/publications/'.length).replace(/\/+$/, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
      throw new MemberError('no_page', 'That is not a publication on this archive.');
    }
    const row = await db.one<{ slug: string }>(
      `select slug from ozikoro_publication
        where slug = $1 and status = 'published' and is_public = true`,
      [slug]
    );
    if (!row) throw new MemberError('no_page', 'That publication is not open.');
    return { kind: 'page', path: `/publications/${row.slug}/` };
  }

  const slug = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (slug.length === 0 || slug.includes('/')) {
    throw new MemberError('no_page', 'That is not a page on this archive.');
  }
  const row = await db.one<{ id: number; slug: string }>(
    `select id, slug from ozikoro_article
      where is_page = false and status = 'published' and (slug = $1 or slug = $2)`,
    [slug, wordpressUriEncode(slug)]
  );
  if (!row) throw new MemberError('no_page', 'That is not a page on this archive.');
  return { kind: 'record', articleId: Number(row.id), path: `/${row.slug}/` };
}

/** The SQL that selects one subject's comments, and the parameters it needs. */
function subjectClause(subject: CommentSubject): { sql: string; params: unknown[] } {
  if (subject.kind === 'record') {
    return { sql: 'c.article_id = $1', params: [subject.articleId] };
  }
  return { sql: 'c.path = $1 and c.article_id is null', params: [subject.path] };
}

/**
 * What one page shows its reader.
 *
 * `approved` comments always; **the reader's own `pending` comment as well**, labelled — which is not a
 * concession to the reader but the honest state of their words: they wrote it, the archive holds it, and
 * hiding it from its author while telling them "comments are checked" would leave them unable to tell
 * whether the POST had worked at all. A `rejected` comment is shown to nobody, including its author.
 */
export async function listComments(
  db: Db,
  subject: CommentSubject,
  viewerId: number | null
): Promise<Comment[]> {
  const clause = subjectClause(subject);
  const visible = viewerId === null
    ? `c.state = 'approved'`
    : `(c.state = 'approved' or (c.state = 'pending' and c.account_id = $2))`;
  const params = viewerId === null ? clause.params : [...clause.params, viewerId];

  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.path, c.article_id, c.account_id, c.body, c.is_source_or_correction,
            c.state, c.created_at, c.moderated_at, ${AUTHOR_SQL} as author
       from ozikoro_comment c
       join account a on a.id = c.account_id
      where ${clause.sql} and ${visible}
      order by c.created_at, c.id
      limit ${RENDER_LIMIT}`,
    params
  );
  return rows.map(rowToComment);
}

/**
 * How many approved comments a page holds.
 *
 * Counted rather than measured from `listComments`, because the list is capped at `RENDER_LIMIT` and a
 * heading that said "200" for a page with 340 comments would be a wrong number rather than a limit.
 */
export async function countApproved(db: Db, subject: CommentSubject): Promise<number> {
  const clause = subjectClause(subject);
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_comment c
      where ${clause.sql} and c.state = 'approved'`,
    clause.params
  );
  return Number(row?.n ?? 0);
}

/**
 * Write one comment, as awaiting review, and return it.
 *
 * ⚠️ **THE STATE IS NOT A PARAMETER.** There is no way to call this and get a published comment: the column
 * defaults to `pending` and this function does not name it. `moderateComment` is the only thing in the
 * codebase that can move a row out of `pending`, and it checks the capability before it does.
 *
 * Idempotent against the double submit through the database: the same account posting the same words on the
 * same page twice leaves one row, because `ozikoro_comment_once_idx` says so. The second call returns the
 * row the first one wrote rather than an error, so a double click and a slow reader get the same answer.
 */
export async function postComment(
  db: Db,
  input: { accountId: number; rawPath: string; body: string; isSourceOrCorrection: boolean }
): Promise<{ comment: Comment; subject: CommentSubject }> {
  const body = input.body.replace(/\r\n/g, '\n').trim();
  if (body.length === 0) {
    throw new MemberError('empty_comment', 'A comment needs some words in it.');
  }
  if (body.length > COMMENT_MAX_LENGTH) {
    throw new MemberError(
      'comment_too_long',
      `A comment can be up to ${COMMENT_MAX_LENGTH.toLocaleString('en-GB')} characters.`
    );
  }

  const subject = await resolveSubject(db, input.rawPath);

  /*
   * THE INSERT NAMES NO STATE, AND THAT IS THE SAFETY. The column's own default is `pending`; a future
   * caller that copies this statement cannot accidentally publish, because publishing is not expressible
   * here.
   *
   * `on conflict do nothing` on the double-submit index: two identical writes are one comment, which is what
   * a repeated submit of the same form means. It is deliberately NOT an `on conflict do update` — the second
   * submit says nothing new, and moving `created_at` would reorder a discussion because somebody clicked
   * twice.
   */
  const articleId = subject.kind === 'record' ? subject.articleId : null;
  await db.query(
    `insert into ozikoro_comment (path, article_id, account_id, body, is_source_or_correction)
     values ($1, $2, $3, $4, $5)
     on conflict (account_id, path, md5(body)) do nothing`,
    [subject.path, articleId, input.accountId, body, input.isSourceOrCorrection]
  );

  const row = await db.one<Record<string, unknown>>(
    `select c.id, c.path, c.article_id, c.account_id, c.body, c.is_source_or_correction,
            c.state, c.created_at, c.moderated_at, ${AUTHOR_SQL} as author
       from ozikoro_comment c
       join account a on a.id = c.account_id
      where c.account_id = $1 and c.path = $2 and md5(c.body) = md5($3)`,
    [input.accountId, subject.path, body]
  );
  if (!row) {
    // Only reachable if the row was deleted between the insert and the read, which is a race and not a state.
    throw new MemberError('not_saved', 'That comment was not saved. Nothing was changed.');
  }
  return { comment: rowToComment(row), subject };
}

/** The comments waiting on a decision, oldest first — the order a queue should be worked in. */
export async function listPending(db: Db, limit = 100): Promise<Comment[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.path, c.article_id, c.account_id, c.body, c.is_source_or_correction,
            c.state, c.created_at, c.moderated_at, ${AUTHOR_SQL} as author
       from ozikoro_comment c
       join account a on a.id = c.account_id
      where c.state = 'pending'
      order by c.is_source_or_correction desc, c.created_at, c.id
      limit $1`,
    [limit]
  );
  return rows.map(rowToComment);
}

/** The decisions already taken, most recent first — so a moderator can see what they did and undo it. */
export async function listDecided(db: Db, limit = 50): Promise<Comment[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.path, c.article_id, c.account_id, c.body, c.is_source_or_correction,
            c.state, c.created_at, c.moderated_at, ${AUTHOR_SQL} as author
       from ozikoro_comment c
       join account a on a.id = c.account_id
      where c.state <> 'pending'
      order by c.moderated_at desc nulls last, c.id desc
      limit $1`,
    [limit]
  );
  return rows.map(rowToComment);
}

/** What the moderation screen's header shows. */
export async function commentCounts(db: Db): Promise<{ pending: number; approved: number; rejected: number }> {
  const rows = await db.rows<{ state: string; n: number }>(
    `select state, count(*)::int as n from ozikoro_comment group by state`
  );
  const at = (state: CommentState) => Number(rows.find((row) => row.state === state)?.n ?? 0);
  return { pending: at('pending'), approved: at('approved'), rejected: at('rejected') };
}

/**
 * Approve or reject one comment.
 *
 * ⚠️ **THE CAPABILITY IS CHECKED HERE AS WELL AS AT THE DOOR, AND THAT IS THE ARCHIVE'S OWN RULE.**
 * `purgeArticle` and `purgeMedia` both call their own `requirePurge` for the same reason: the check at the
 * endpoint is a check the NEXT endpoint has to remember, and a script, a job or a route added later reaches
 * the write path directly. `moderate` is the vocabulary's own word for this act — "Reports, moderation of
 * users and content, and escalation" — and it is held by `moderator`, `editor`, `admin` and `owner`.
 *
 * It is reversible in both directions on purpose: approving something by mistake is corrected by rejecting
 * it, and the audit trail is `moderated_by`/`moderated_at`, which move with the decision.
 */
export async function moderateComment(
  db: Db,
  input: { id: number; approve: boolean; moderatorId: number }
): Promise<CommentState> {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    throw new MemberError('no_comment', 'That comment does not exist.');
  }
  if (!(await can(db, input.moderatorId, 'moderate'))) {
    throw new MemberError('forbidden', 'Only a moderator, an editor or an administrator may check comments.');
  }

  const state: CommentState = input.approve ? 'approved' : 'rejected';
  const row = await db.one<{ state: string }>(
    `update ozikoro_comment
        set state = $2, moderated_at = now(), moderated_by = $3
      where id = $1
      returning state`,
    [input.id, state, input.moderatorId]
  );
  if (!row) throw new MemberError('no_comment', 'That comment does not exist.');
  return state;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * RENDERING
 *
 * The box is ONE function returning ONE string, and both worlds use it: the record route and the three
 * design screens inject it into HTML they already hold, and the publication page drops it in through a
 * single `dangerouslySetInnerHTML`. **One renderer rather than a React component and an HTML twin**, because
 * two renderings of one box drift, and the drift would be the signed-in form missing a field on one of the
 * six pages — which is precisely the fault the owner has reported three times tonight.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Escape text for HTML.
 *
 * Strict, and deliberately not the entity-preserving escaper `content.ts` keeps for archived WordPress
 * bodies: **a comment's body is plain text a reader typed**, not HTML that was already encoded somewhere, so
 * an `&lt;` in a comment is four characters the reader meant to type and `&amp;lt;` is what renders them
 * faithfully. Reusing the archive's escaper here would render a reader's literal `&lt;` as `<`.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `7 October 2026`, the same shape the rest of the archive writes a date in. */
function day(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A comment body as paragraphs. Blank lines separate them; a single newline is a line break. */
function paragraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${esc(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** Who is looking, and what they may do. */
export interface DiscussionViewer {
  signedIn: boolean;
  /** The account's display name, or null. **The email is never passed in.** */
  name: string | null;
  canModerate: boolean;
}

/** Everything the box needs to draw itself. */
export interface DiscussionView {
  /** The canonical page address the form will post back. */
  path: string;
  /** The page's own word for itself, used in the heading's eyebrow: 'Article', 'Folklore story', … */
  kindLabel?: string;
  viewer: DiscussionViewer;
  comments: Comment[];
  /** A message carried back from the POST, already plain text. */
  notice?: { kind: 'ok' | 'error'; text: string } | null;
  /**
   * ⚠️ The two DESIGN SHAPES the owner asked to review, and the only thing in this module that is not a real
   * comment. Set only by the app layer, only for an account holding `moderate`, and only when
   * `?ozcommentstates=1` is in the address. **It is false for every reader.**
   */
  examples?: boolean;
}

/** One comment as a list item. */
function renderComment(comment: Comment): string {
  const isOwnPending = comment.state === 'pending';
  /*
   * THE AUTHOR IS NAMED BY THEIR OWN DISPLAY NAME, and an account without one is "A member" — never the
   * email, which is a private fact and a credential. A pending comment is labelled in the archive's own
   * words, because the reader has to be able to tell that their words are held rather than published.
   */
  const author = comment.author === 'A member' ? 'A member' : comment.author;
  const stateLine = isOwnPending
    ? `<span class="oz-state">Pending review</span>`
    : `<time datetime="${esc(comment.createdAt)}">${esc(day(comment.createdAt))}</time>`;
  const flag = comment.isSourceOrCorrection
    ? `<span class="oz-flag">Source or correction</span>`
    : '';
  return `<li class="oz-comment${isOwnPending ? ' is-pending' : ' is-approved'}" id="oz-comment-${comment.id}">
  <p class="oz-comment-meta"><strong>${esc(author)}</strong> ${stateLine} ${flag}</p>
  ${isOwnPending ? '<p class="oz-comment-held">Only you and the editors can see this until it has been checked.</p>' : ''}
  <div class="oz-comment-body">
${paragraphs(comment.body)}
  </div>
</li>`;
}

/**
 * The two design shapes, unmistakably examples.
 *
 * ⚠️ **NO NAME, NO REAL WORDS, AND A LABEL THAT SAYS WHAT IT IS.** The owner's instruction was *"Design
 * examples — do not put them on live pages."* These carry no author at all — not an invented person, and not
 * a real contributor borrowed for the purpose — and their bodies describe what would be there rather than
 * saying anything a person could be read as having said. They appear for a moderator who asks for them, and
 * for nobody else on any page.
 */
function renderExamples(): string {
  return `<div class="oz-examples" role="group" aria-labelledby="oz-examples-title">
  <p class="oz-examples-title" id="oz-examples-title">Design examples — not comments anybody wrote, and shown on no public page. They are here because the two shapes below are the ones you asked to review.</p>
  <ol class="oz-comments">
    <li class="oz-comment is-approved oz-example">
      <p class="oz-comment-meta"><span class="oz-example-tag">Example</span> <span class="oz-state">Approved — shown to every reader</span></p>
      <div class="oz-comment-body">
        <p>Example shape: an approved comment is printed here, with the display name of the member who wrote it, the date they wrote it, and a “Source or correction” mark when they ticked that box.</p>
      </div>
    </li>
    <li class="oz-comment is-pending oz-example">
      <p class="oz-comment-meta"><span class="oz-example-tag">Example</span> <span class="oz-state">Pending review — not on the page for anyone else</span></p>
      <div class="oz-comment-body">
        <p>Example shape: a comment waiting on an editor is shown to the member who wrote it and to the editors, is labelled “Pending review”, and is invisible to every other reader until it is approved.</p>
      </div>
    </li>
  </ol>
</div>`;
}

/**
 * The box, in both states, as one HTML block.
 *
 * A `<link>` to the box's own stylesheet travels inside the block, which is deliberate: the record route and
 * the design screens return complete documents of their own and the design's stylesheets do not carry a
 * discussion, so `/comments.css` is this application's own sheet — the same shape `/watch-video.css` already
 * has — and it must arrive wherever the box does. A `<link rel=stylesheet>` is valid in the body, and the
 * browser fetches it once.
 *
 * ⚠️ **AND THE CONTENT SITS INSIDE THE DESIGN'S OWN `.wrap`, WHICH WAS A MEASURED CORRECTION.** The first
 * version put the section directly inside `<main>`, and the served phone screenshot showed what that costs:
 * every other section on these pages is inside `.wrap`, which is what carries `max-width: var(--container)`
 * and `padding-inline: var(--s-5)`, so **the box ran the full width of the screen with its text against the
 * glass and its buttons past the right edge.** The box is page content and it lines up with the page.
 */
export function renderDiscussion(view: DiscussionView): string {
  const path = view.path;
  const kind = view.kindLabel ?? 'this page';
  const notice = view.notice && view.notice.text
    ? `<p class="oz-comment-notice${view.notice.kind === 'error' ? ' is-error' : ''}" role="status">${esc(view.notice.text)}</p>`
    : '';

  const heading = view.viewer.signedIn
    ? `Join the discussion`
    : `Sign in to join the discussion`;

  /*
   * THE SIGNED-OUT HALF, IN THE OWNER'S OWN WORDS AND WITH THE ARCHIVE'S REAL DOORS.
   *
   * `/signin` and `/join` are the two routes that exist — `app/signin/route.ts` and `app/join/route.ts` are
   * the same account screen in its two modes — and they are named rather than invented. `next` is carried the
   * way `requireUser` carries it; whether the sign-in screen returns the reader here is its own behaviour and
   * is stated in this round's report rather than promised here.
   */
  const signedOut = `<p class="oz-discussion-actions">
    <a class="btn btn-gold" href="/signin?next=${encodeURIComponent(path)}">Sign in</a>
    <a class="btn" href="/join">Create an account</a>
  </p>`;

  /*
   * THE SIGNED-IN HALF. A real `<form method="post">` to a real endpoint, with the page's own address in it,
   * the owner's tick box labelled with his exact words, and a Post comment button that submits it.
   */
  const signedIn = `<form class="oz-comment-form" method="post" action="/api/comments">
    <input type="hidden" name="path" value="${esc(path)}">
    <label class="field" for="oz-comment-body">
      <span class="label">Your comment</span>
      <textarea id="oz-comment-body" name="body" rows="5" maxlength="${COMMENT_MAX_LENGTH}" required
        placeholder="Add a source, a correction, or something the record does not say."></textarea>
    </label>
    <label class="oz-comment-flag" for="oz-comment-flag">
      <input id="oz-comment-flag" type="checkbox" name="sourceOrCorrection" value="1">
      <span>This includes a source or correction</span>
    </label>
    <p class="oz-comment-post">
      <button class="btn btn-gold" type="submit">Post comment</button>
    </p>
  </form>`;

  const shown = view.comments.filter((comment) => comment.state !== 'rejected');
  const list = shown.length > 0
    ? `<ol class="oz-comments">
${shown.map((comment) => renderComment(comment)).join('\n')}
</ol>`
    : `<div class="oz-comments-empty">
    <p class="eyebrow">No comments yet</p>
    <p>Nothing has been approved on ${esc(kind)} yet. Comments are checked by an editor before they appear, so one written now shows on this page after that check.</p>
  </div>`;

  return `<link rel="stylesheet" href="/comments.css">
<section class="oz-discussion" id="discussion" aria-labelledby="oz-discussion-title">
  <div class="wrap">
    <div class="oz-discussion-inner">
      <header class="oz-discussion-head">
        <p class="eyebrow">Discussion</p>
        <h2 id="oz-discussion-title">${heading}</h2>
        <p class="oz-discussion-note">Comments are checked by an editor before they appear. Leave a source or a correction and it is read first.</p>
      </header>
      ${notice}
      ${view.viewer.signedIn ? signedIn : signedOut}
      ${list}
      ${view.examples ? renderExamples() : ''}
    </div>
  </div>
</section>`;
}

/**
 * Put the box inside a document that is already built, before its closing `</main>`.
 *
 * ⚠️ **THE LAST `</main>`, AND THE BOX IS INSIDE IT.** The discussion belongs to the page's main content, not
 * beside the footer, and every one of the four documents this is used on holds exactly one `<main>` — measured
 * on the served pages rather than on the design files, because the fills insert markup and a count taken from
 * the file is not a count of what is served. A document with no `</main>` is returned UNCHANGED and the
 * caller logs it: a page that quietly grew a discussion outside its own frame would be worse than one with no
 * discussion at all.
 */
export function insertDiscussion(html: string, block: string): string {
  if (!block) return html;
  const at = html.lastIndexOf('</main>');
  if (at === -1) return html;
  return `${html.slice(0, at)}${block}\n${html.slice(at)}`;
}

/*
 * How a commenter is named in SQL, in one place so the public page and the moderation screen cannot disagree
 * about who wrote a comment. **`coalesce` on a blank display name too**: an account row whose name is spaces
 * is an account with no name, and printing the spaces would leave the author line looking empty.
 *
 * The email is deliberately absent. It is a private fact and it is a credential, and this expression is the
 * only thing that decides what a comment shows next to it.
 */
const AUTHOR_SQL = `coalesce(nullif(btrim(a.display_name), ''), 'A member')`;

/** One row, as the screens read it. */
function rowToComment(row: Record<string, unknown>): Comment {
  return {
    id: Number(row.id),
    path: String(row.path),
    articleId: row.article_id === null || row.article_id === undefined ? null : Number(row.article_id),
    accountId: Number(row.account_id),
    author: String(row.author ?? 'A member'),
    body: String(row.body),
    isSourceOrCorrection: Boolean(row.is_source_or_correction),
    state: String(row.state) as CommentState,
    createdAt: isoMoment(row.created_at),
    moderatedAt: row.moderated_at === null || row.moderated_at === undefined ? null : isoMoment(row.moderated_at),
  };
}

/**
 * A timestamp as ISO 8601, whatever the driver handed back.
 *
 * ⚠️ **THIS EXISTS BECAUSE `String(aDate)` IS NOT ISO, AND THE FIRST SERVED PAGE PROVED IT.** PGlite returns
 * a `timestamptz` as a JavaScript `Date`, and `String(date)` produces
 * `Tue Oct 06 2026 22:09:16 GMT+0100 (West Africa Time)` — which is a perfectly good date for a human and a
 * useless one for a machine. It was landing in `<time datetime="…">`, an attribute whose entire purpose is to
 * be machine-readable, so a crawler or a screen reader was being handed a format that is not the one the
 * element specifies. The visible text was right and the attribute was wrong, which is the kind of fault that
 * survives a glance at the page.
 */
function isoMoment(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}
