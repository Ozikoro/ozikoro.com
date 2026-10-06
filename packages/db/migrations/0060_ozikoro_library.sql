-- The reader's own library: what they saved, and what they read.
--
-- WHY THIS MIGRATION EXISTS
--
-- The reader's dashboard has promised four things since the design was handed over — *Saved histories*,
-- *Followed topics*, *Reading history* and *Collections* — and the role the archive defines for a reader
-- is written down in `members.ts` as *"An account, bookmarks, follows, collections and reading history."*
-- **Three of those four had no table at all.** `ozikoro_follow` was built in 0048 for the research
-- network's follows; saves and reads were not, so the dashboard's own sidebar items could only be served
-- as labels that said the feature was missing. *The owner's report is what that looked like from outside:
-- "even 'Saved histories — Not built yet' … are not working."*
--
-- WHY TWO TABLES AND NOT ONE
--
-- A save and a read are different claims and they end differently. **A save is an instruction the reader
-- gives — "keep this" — and only the reader can withdraw it.** A read is something that happened to them,
-- recorded as they browse, and a reader who deletes it is deleting a record of their own behaviour rather
-- than undoing an act. Collapsing them into one `library_item` table with a `kind` column would mean every
-- query has to remember which kind it may write, and the first query that forgets would let a page view
-- delete a deliberate save. Two tables cannot make that mistake.
--
-- WHY `unique (account_id, article_id)` AND NOT A SURROGATE KEY ALONE
--
-- The two facts are each true once per reader per record: a record is saved or it is not, and a reader has
-- one most-recent read of it. **The uniqueness is the feature** — `on conflict do update` is what makes a
-- second visit update the timestamp instead of stacking a row, and it is the database rather than
-- TypeScript that guarantees it, so no future caller can forget.
--
-- WHAT THESE TABLES DELIBERATELY DO NOT CARRY
--
-- No note, no tag, no folder. The design draws no control for one, and **a column nothing can write is a
-- promise dressed as a schema.** When a screen offers a note, this is where it goes.

create table if not exists ozikoro_saved (
  id         bigserial primary key,
  account_id bigint not null references account(id) on delete cascade,
  -- Cascades: a record that leaves the archive leaves every reader's library, because a saved row that
  -- points at nothing would be a row the library page has to explain away on every load.
  article_id bigint not null references ozikoro_article(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (account_id, article_id)
);

comment on table ozikoro_saved is
  'What a reader asked the archive to keep. One row per account per record, written by the reader and '
  'withdrawn by the reader; the unique pair is what makes "save" idempotent.';

-- The library page reads one account''s saves newest first, which is the only order it ever asks for.
create index if not exists ozikoro_saved_account_idx
  on ozikoro_saved (account_id, created_at desc);

create table if not exists ozikoro_read_event (
  id         bigserial primary key,
  account_id bigint not null references account(id) on delete cascade,
  article_id bigint not null references ozikoro_article(id) on delete cascade,
  -- The FIRST time this account opened this record. Kept separate from `read_at` because "when did I find
  -- this" and "when did I last look" are different questions and one column cannot answer both.
  first_read_at timestamptz not null default now(),
  -- The most recent time. Updated on every subsequent open.
  read_at    timestamptz not null default now(),
  -- How many times this account has opened it. A count rather than a list of events: **the archive has no
  -- business keeping a page-view log of a named person's reading**, and a count answers everything the
  -- reading-history screen asks.
  opens      integer not null default 1,
  unique (account_id, article_id)
);

comment on table ozikoro_read_event is
  'Where a signed-in reader has been. One row per account per record with the first and last open and a '
  'count, deliberately not an event log: the screen needs "continue reading", not a surveillance trail.';

create index if not exists ozikoro_read_event_recent_idx
  on ozikoro_read_event (account_id, read_at desc);
