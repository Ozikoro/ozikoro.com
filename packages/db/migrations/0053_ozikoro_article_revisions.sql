-- Editorial history for the articles: what a record said before it said this.
--
-- WHY THIS EXISTS, WITH THE MEASUREMENT THAT JUSTIFIES IT
--
-- The WordPress dump holds 4,266 revisions of the articles. The archive had nowhere to put them, so
-- superseded editorial text of 1,051 published histories was the largest measured category with no
-- home in the cluster. The reconciliation (docs/IMPORT-RECONCILIATION.md §7.3) measured 30,007,462
-- bytes of revision text that appears in no surviving post — 28.6 MiB.
--
-- THAT FIGURE IS NOT THE SIZE OF WHAT WAS LOST, and this migration was written after measuring what
-- is. WordPress autosaves the WHOLE document every 60 seconds, so revision 6,148 is revision 6,150
-- with one more sentence and the pair are 23,151 and 23,173 characters of the same article. Measured
-- at the level of the BLOCK — a run of text between tags, which is what an editor types and a reader
-- reads — the archive is missing **1,225 KiB of distinct block text, of which 442 KiB has not even
-- its opening 80 characters anywhere in a surviving record**. That is 2,390 blocks across 524 of the
-- 1,099 records, and the smallest set of records that carries all of it is 524. The measurement is
-- reproducible from `.scratch/round341/revision-blocks.py`.
--
-- So the honest statement is: the loss is real, it is paragraph-sized prose rather than 28.6 MiB of
-- autosave noise, and the carrier set is small enough to hold in full.
--
-- WHY THIS TABLE HAS THE SHAPE IT HAS
--
-- `episode_revision`, `clan_revision`, `word_revision`, `name_revision` and `proverb_revision` all
-- exist, and the pattern across them is the same: a revision row belongs to a parent record, holds
-- the text as it was, and says who and when. **This follows that pattern rather than inventing a
-- second one.** Two differences are deliberate and each is stated:
--
--   1. A WordPress revision is a WHOLE-DOCUMENT SNAPSHOT, not a before/after pair, so there is one
--      body column and not the `previous_x`/`x` pairs the clan and word tables carry. Storing both
--      sides of a diff would duplicate every byte of the parent's current body 4,266 times.
--   2. `article_id` is NULLABLE *and* so is `wp_parent_post_id`. 74 revisions belong to 4,192
--      revisions' worth of posts that do not survive — their parents are of post types the archive
--      deliberately did not import (`nav_menu_item`, `elementor_library`, `attachment`). Their text
--      is still the record of what was written, and **dropping them because the parent is not held
--      would be exactly the loss this table exists to prevent.**
--
-- WHY THERE IS NO (article_id, revision_number) UNIQUE KEY
--
-- `episode_revision` has one, and it is wrong for this import: its revisions are numbered by a
-- render loop. WordPress numbers by `wpc9_posts.ID`, and those ids are unique on their own, so
-- `wp_revision_id` is the key — UNIQUE and nullable, because a revision an editor saves in this
-- archive later will not have one.
--
-- THE BODY IS KEPT VERBATIM, INCLUDING MARKUP. `ozikoro_article.body_html` is the same kind of
-- thing for the same reason: "the published HTML, kept verbatim. It is the evidence of what was
-- published; it is sanitised when rendered, not when stored." Superseded editorial text is
-- evidence, and a revision whose markup was stripped could not be diffed against the record it
-- belongs to or restored from.

create table if not exists ozikoro_article_revision (
  id                 bigserial primary key,

  -- The record this revision belongs to. NULL when WordPress held a revision whose parent is not in
  -- this archive — see the header. ON DELETE CASCADE because a revision of a deleted record has no
  -- subject; ON DELETE was not chosen to make the count smaller, and nothing deletes articles.
  article_id         bigint references ozikoro_article(id) on delete cascade,

  -- The WordPress revision id itself, so a re-run of the backfill updates rather than duplicates and
  -- any row can be traced to the dump it came from. Unique on its own: WordPress ids are.
  wp_revision_id     bigint unique,

  -- The WordPress id of the post the revision is a revision OF, kept even where `article_id` is set,
  -- because it is what the dump holds and it is what makes the row checkable against the dump.
  wp_parent_post_id  bigint,

  /*
   * The whole document as it stood, verbatim. Nullable for one reason only: the importer refuses to
   * store a body larger than its ceiling (see `--max-body-bytes` in scripts/import-article-revisions.ts)
   * and records the size it refused on the audit row instead of silently truncating. A truncated body
   * passed off as the text would be worse than a null one that says so.
   */
  body_html          text,

  -- What the revision was titled and when WordPress says it was written. `post_modified_gmt` is the
  -- only date a revision carries.
  title              text,
  revised_at         timestamptz,

  -- Counted from the body at import, so a list can say how much text a revision holds without
  -- loading it. Never typed by hand.
  word_count         integer not null default 0,

  -- Who wrote it, where WordPress's own `post_author` maps to a contributor. SET NULL rather than
  -- CASCADE: losing a byline must not delete the text the person wrote.
  author_id          bigint references ozikoro_contributor(id) on delete set null,

  -- Whether this revision is the one the backfill chose to carry the record's unique text. Nothing
  -- is discarded on the strength of it; it is a reading aid, and it is false for a revision saved in
  -- this archive rather than imported.
  carries_unique_text boolean not null default false,

  created_at         timestamptz not null default now()
);

comment on table ozikoro_article_revision is
  'An article as it stood before it stood this way. Imported from the WordPress revisions, which had '
  'no home in the archive, so superseded editorial text of the histories is retained rather than lost. '
  'The body is kept verbatim because it is evidence of what was written.';
comment on column ozikoro_article_revision.article_id is
  'The record this revision belongs to. NULL when WordPress held a revision whose parent post this '
  'archive deliberately did not import — the text is kept and the parent is named by wp_parent_post_id.';
comment on column ozikoro_article_revision.carries_unique_text is
  'True for the revision the backfill chose to carry block text that appears in no surviving record. '
  'A reading aid, not a reason anything was discarded: every revision is stored.';

-- The list on a record: newest first, which is the order an editor reads a history in.
create index if not exists ozikoro_article_revision_article_idx
  on ozikoro_article_revision (article_id, revised_at desc nulls last, id desc);

-- For the pages that answer "which records have a history at all".
create index if not exists ozikoro_article_revision_parent_idx
  on ozikoro_article_revision (wp_parent_post_id);
