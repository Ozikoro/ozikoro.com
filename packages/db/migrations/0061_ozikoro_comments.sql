-- Readers' comments on a page, and the check that stands between writing one and showing it.
--
-- THE OWNER'S REQUEST, VERBATIM
--
--   "go back to the github, and add the comment section it added. just copy the design, and make it work."
--   "I added a comment box for registered members to articles, folklore stories, publications, cultural
--    events, video pages and project pages."
--   "Below the box: two example comments, one already showing and one 'Pending review', because comments
--    are checked before they appear."
--
-- ⚠️ THERE WAS NOTHING TO COPY. The phrases "Sign in to join" and "source or correction" appear nowhere in
-- any branch, any file, any format; the editor's own Discussion box said so in words — *"This archive has no
-- comment system: there is no comment table, no moderation queue for readers' replies"* — and that sentence
-- was TRUE. So this is a feature rather than a port, and it is built from the owner's description.
--
-- ── WHY THE THREAD IS A PATH AND NOT ONLY AN ARTICLE ────────────────────────────────────────────────
--
-- The obvious schema — and the one this round was asked for — is a comment that belongs to an
-- `ozikoro_article`. **It cannot carry the feature the owner asked for.** He named six kinds of page, and
-- only two of them are records: a publication is an `ozikoro_publication`, and `/watch/`, `/projects/` and
-- `/cultural-calendar/` are section pages with no row of their own at all (the archive has no project table
-- and no event table — see the notes in `app/projects/page.tsx` and `app/cultural-calendar/page.tsx`).
--
-- So `path` is the thread: the address of the page the comment was written on. `article_id` is kept
-- alongside it and is **set when the page IS a record, null when it is not.** That is not redundancy:
-- it is what makes a record's discussion cascade away with the record, and what lets the record's page
-- read its own thread by key rather than by re-deriving an address.
--
-- A comment therefore belongs to an account, a page, a body, a time, a state and the source-or-correction
-- flag. That is the whole of it.
--
-- ── WHY THE COLUMN IS NULLABLE RATHER THAN A SECOND TABLE ────────────────────────────────────────────
--
-- Two tables — a thread and its comments — was the first shape considered and it was rejected: a thread has
-- no attribute of its own. Its key is the page address, its title is the page's title, and its count is
-- `count(*)`. A `ozikoro_comment_thread` table would hold one column that is already on this table and one
-- that belongs to the page, and every read would pay a join for it.
--
-- ── THE MODERATION STATE, IN THE OWNER'S WORDS ──────────────────────────────────────────────────────
--
--   "comments are checked before they appear"
--
-- So the state a comment is WRITTEN in is not the state it is SHOWN in, and there are three states rather
-- than two:
--
--   pending    written and not shown to readers. This is the default, and it is the default in the SCHEMA
--              rather than in TypeScript, so a script, a job or an endpoint added later inherits the check
--              by writing a row at all. **A route that forgets to set a state does not publish anything.**
--   approved   shown. Written by a moderator through `/admin/comments/`, which is gated on `moderate`.
--   rejected   not shown, and kept. Deleting it would destroy the record of a decision the archive made
--              about somebody's words, which the audit trail requires; `moderated_by` and `moderated_at`
--              are what make the decision answerable afterwards.
--
-- ── IDEMPOTENCE, IN THE DATABASE ────────────────────────────────────────────────────────────────────
--
-- This repository's rule is that a repeated write is stopped by a `unique` constraint and not by a check in
-- TypeScript, because two tabs are enough to fall into the gap between a `select` and an `insert`. `0060`
-- does it for a save with `unique (account_id, article_id)`. A comment has no such natural pair — the same
-- reader may leave several comments on one page, and should be able to.
--
-- **The repeat this table has to stop is the DOUBLE SUBMIT**, so the key is the thing a double submit
-- repeats: the same account, the same page and the same words. `md5(body)` and not `body`, because the
-- index is on text a reader typed and a digest is what keeps it small; `md5` and not a hash column, because
-- a column nothing else reads is a promise dressed as a schema. The POST is also answered with a 303, so a
-- refresh re-reads the page instead of re-posting — but a double CLICK sends two requests before either
-- answer arrives, and that is what this index is for.
--
-- ── WHAT THIS TABLE DELIBERATELY DOES NOT CARRY ─────────────────────────────────────────────────────
--
-- No parent id, so there are no replies and no depth; the design draws none, and a `parent_id` nothing can
-- write is the same fault as a note column. No likes, no votes, no edit history, no IP address, no user
-- agent: **the archive has no business keeping a network trail of a named person's opinion.** No
-- `ozikoro_article` row is invented for a section page to hang a comment on — that would be fabricating a
-- record to satisfy a foreign key.

create table if not exists ozikoro_comment (
  id         bigserial primary key,

  -- The address of the page the comment was written on: `/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/`,
  -- `/publications/<slug>/`, or one of the section addresses `/watch/`, `/projects/`, `/cultural-calendar/`.
  -- Stored without a query string or fragment, because two spellings of one page are one discussion.
  path       text not null check (path like '/%'),

  -- The record, when the page is a record. NULL on a section page, which is honest: there is no record.
  -- Cascades, so a record that leaves the archive takes its discussion with it rather than leaving rows
  -- pointing at a page that no longer exists.
  article_id bigint references ozikoro_article(id) on delete cascade,

  -- Cascades: an account that is deleted leaves no comment behind. `on delete cascade` and not `set null`,
  -- because a comment with no author is a comment that reads as the archive's own words.
  account_id bigint not null references account(id) on delete cascade,

  -- What the reader wrote. Bounded here as well as in the form: the check is the floor, and a route that
  -- forgets its own bound cannot write a 4 MB comment into the discussion.
  body       text not null,

  -- The owner's tick box, exactly as he labelled it: "This includes a source or correction". A moderator
  -- reads flagged comments first, which is the whole reason the box exists.
  is_source_or_correction boolean not null default false,

  state      text not null default 'pending'
               check (state in ('pending', 'approved', 'rejected')),

  created_at timestamptz not null default now(),

  -- Both null until a moderator decides. `moderated_by` is `set null` rather than cascade so that deleting
  -- a moderator's account does not delete the comments they approved — the decision stays and its author
  -- becomes unknown, which is the lesser loss.
  moderated_at timestamptz,
  moderated_by bigint references account(id) on delete set null,

  -- Whitespace is not a comment. Both bounds live here so no caller can write an empty one or an unbounded
  -- one; the form's own bounds are the readable copy of this rule, not the rule.
  constraint ozikoro_comment_body_length check (char_length(btrim(body)) between 1 and 4000)
);

comment on table ozikoro_comment is
  'A reader''s comment on one page, written by a signed-in account and INVISIBLE until a moderator approves '
  'it. `path` is the thread (the page address); `article_id` is set only when that page is a record. The '
  'state is written by the schema as `pending`, so a caller that forgets does not publish.';

comment on column ozikoro_comment.path is
  'The page address the comment belongs to, without query string or fragment. The thread key for a section '
  'page; carried alongside `article_id` for a record so the moderation screen can say which page it is on.';

comment on column ozikoro_comment.state is
  'pending (written, not shown), approved (shown, and counted as such on the public page), rejected (not '
  'shown, kept as the record of the decision). See this migration''s header for why there are three.';

comment on column ozikoro_comment.is_source_or_correction is
  'The owner''s own tick box: "This includes a source or correction". Surfaced first in the moderation queue.';

/*
 * THE DOUBLE SUBMIT, STOPPED BY THE DATABASE.
 *
 * Same account, same page, same words: one row. A second identical write is a no-op through
 * `on conflict do nothing`, which is the same shape `0060` uses for a save. Two deliberate copies of the
 * same sentence on the same page are the one thing a reader cannot do, and the archive's answer to a
 * duplicate comment is not to store it twice.
 */
create unique index if not exists ozikoro_comment_once_idx
  on ozikoro_comment (account_id, path, md5(body));

-- The public read: one page's approved comments, oldest first, which is the only order the page asks for.
create index if not exists ozikoro_comment_shown_idx
  on ozikoro_comment (path, created_at)
  where state = 'approved';

-- The moderation queue: what is waiting, oldest first. Partial, because a decided comment never appears in
-- it and an index that carried every comment ever written would grow without ever being read.
create index if not exists ozikoro_comment_pending_idx
  on ozikoro_comment (created_at)
  where state = 'pending';

-- "Has this reader already commented here?" — asked when the box is drawn, and the same lookup the reader's
-- own pending comment is fetched by, so the reader can see their own words waiting.
create index if not exists ozikoro_comment_account_idx
  on ozikoro_comment (account_id, path);

-- A record's own thread, read by key: the record page knows the row it is serving and does not have to
-- re-derive an address to find its discussion.
create index if not exists ozikoro_comment_article_idx
  on ozikoro_comment (article_id, created_at)
  where article_id is not null;
