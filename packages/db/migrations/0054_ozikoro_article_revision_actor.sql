-- A human edit to a record, and the person who made it.
--
-- WHY 0053'S TABLE IS THE RIGHT TABLE, AND WHY IT WAS NOT YET ENOUGH
--
-- `ozikoro_article_revision` exists because the WordPress dump held 4,266 revisions of the articles and the
-- archive had nowhere to put them. Its own header says the table follows the pattern of `episode_revision`,
-- `clan_revision`, `word_revision`, `name_revision` and `proverb_revision` — "a revision row belongs to a
-- parent record, holds the text as it was, **and says who and when**". It also says, of `wp_revision_id`,
-- that it is nullable "because a revision an editor saves in this archive later will not have one". So the
-- table is the archive's revision table and not the importer's private property: human edits were designed
-- for.
--
-- BUT IT DID NOT SAY WHO. The only person column is `author_id`, and that is a reference to
-- `ozikoro_contributor` — the BYLINE. On an imported revision it names the WordPress author of the article,
-- which is what WordPress's `post_author` meant. On a revision an editor saves today it would name whoever
-- wrote the article, not whoever changed it, and those are different people every time an editor corrects
-- somebody else's record. A revision list that printed "by the author" over an editor's correction would be
-- a record that misattributes a decision, in the one table whose whole purpose is attribution.
--
-- The other four revision tables in this schema name the actor with a reference to `account(id)` —
-- `clan_revision.proposed_by`/`approved_by`, `ozikoro_episode_revision.created_by`,
-- `ozikoro_episode_transition.actor_account_id`. `author_id` is not that column, and adding the real one is
-- following the pattern rather than inventing beside it.
--
-- WHAT ELSE A HUMAN REVISION NEEDS, AND WHY EACH
--
--   `standfirst`  the record's summary is editable — round 352 measured that all thirteen film-holding
--                 records carry a truncated, tag-stripped window of the body in this field, because the
--                 import filled it that way. An editor fixing one of those is changing the summary, and a
--                 revision that recorded only the body could not put the summary back. **A revision of a
--                 form must hold every field the form can change, or it cannot restore what it replaced.**
--   `note`        why the change was made, where the person chose to say. Nullable, because a mandatory
--                 reason field is answered with "fix" and that is worse than an empty one.
--   `actor_id`    the account that saved the revision. NULL for the 4,266 imported rows, and honestly so:
--                 the import ran as a script with no signed-in person, which is the same distinction
--                 `ozikoro_audit.actor_id` already draws and for the same reason.
--
-- WHY THERE IS NO `source` COLUMN
--
-- The importer and a human are already distinguished exactly, and by a column that carries information
-- rather than a label: **an imported revision has a `wp_revision_id` and a human one cannot**, because the
-- id is WordPress's and WordPress is not writing here any more. A second discriminator would be a copy of a
-- fact the table already holds, and two copies drift.
--
-- WHY THIS IS `add column if not exists` AND NOTHING ELSE
--
-- 4,266 rows hold 36.6 MiB of imported revision text that exists nowhere else — the whole reason the table
-- was created. This migration adds columns and rewrites no row, so the worst case of running it twice is
-- the same as running it once, and the worst case of it failing half-way is that some of the three columns
-- exist. It touches no data.
--
-- AND IT IS STILL SAFE TO REPLAY. The migration runner records a checksum per file, and `add column if not
-- exists` is idempotent, so a fresh database and this one end in the same shape.

alter table ozikoro_article_revision
  add column if not exists actor_id   bigint references account(id) on delete set null,
  add column if not exists standfirst text,
  add column if not exists note       text;

comment on column ozikoro_article_revision.actor_id is
  'The account that saved this revision, for a revision written in this archive. NULL on the rows the '
  'WordPress backfill wrote, because no person was signed in; and NULL on a human revision whose account '
  'has since been deleted, which is the honest state rather than a deleted revision.';
comment on column ozikoro_article_revision.standfirst is
  'The record''s summary as it stood in this revision. Present because `standfirst` is editable and a '
  'revision that held only the body could not restore what it replaced.';
comment on column ozikoro_article_revision.note is
  'Why the change was made, when the editor said. Nullable on purpose: a mandatory reason is answered '
  'with "fix", which records less than an empty field does.';

-- The list an editor reads on a record: newest first, which 0053 already indexes. This is the second
-- question the same list has to answer — "what has a PERSON changed here?" — and it is asked of the whole
-- table, where the 4,266 imported rows are the vast majority.
create index if not exists ozikoro_article_revision_actor_idx
  on ozikoro_article_revision (actor_id, created_at desc) where actor_id is not null;
