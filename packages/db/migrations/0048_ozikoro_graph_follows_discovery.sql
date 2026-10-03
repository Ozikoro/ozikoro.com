-- The knowledge graph's identity, the research network's follows, and the affiliation a search runs on.
--
-- THREE SMALL ADDITIONS, EACH CLOSING A GAP THAT A BUILT FEATURE CANNOT WORK AROUND.
--
-- 1. ONE DICTIONARY ROW, ONE ENTITY.
--
-- `ozikoro_entity.clan_id` points at the dictionary's `clan` row, and the graph builder is run more
-- than once — a clan published next month must be picked up by the next run, and a second run must
-- not duplicate the clans already made. Identity therefore has to be the dictionary row, and the
-- database has to be the one enforcing it: a partial unique index, not a `select` in TypeScript that
-- a future caller could forget. `clan_town_id` gets the same treatment for the same reason.
--
-- The indexes are PARTIAL because most entities have no dictionary counterpart at all — a person, a
-- period, an event — and a plain unique index would permit exactly one such row in the entire table
-- and reject every other. **That is the mistake this comment exists to prevent**: `unique (clan_id)`
-- reads as "one entity per clan" and behaves as "one entity that is not a clan, ever".
--
-- 2. FOLLOWING, WHICH §3.2 ASKS FOR BY NAME.
--
-- The brief requires "following and visibility controls" in the researchers network. Following is
-- deliberately one table over three kinds of subject rather than the three tables the reader's
-- dashboard originally implied, because the question being asked — *does this account follow this
-- thing* — is one question, and three tables would be three places for it to be answered
-- differently. A CHECK constraint keeps the three shapes honest: a member follow needs no label, a
-- topic follow is a topic, and an institution follow carries the institution as text because an
-- institution is not yet an entity in this graph and inventing one would be inventing the answer.
--
-- 3. THE AFFILIATION A PUBLICATION IS FOUND BY.
--
-- The brief: "search and discovery by topic, author or institution". The institution lives on the
-- author row, and search by institution is a join through it. Without an index that join is a
-- sequential scan of every author on every search, so the column the feature depends on gets the
-- index the feature needs.

-- ---------------------------------------------------------------------------
-- 1. Identity in the graph
-- ---------------------------------------------------------------------------
create unique index if not exists ozikoro_entity_clan_uniq
  on ozikoro_entity (clan_id) where clan_id is not null;

comment on index ozikoro_entity_clan_uniq is
  'One entity per dictionary clan. Partial, because an entity with no dictionary counterpart — a '
  'person, a period, an event — has a null clan_id and any number of those must be allowed.';

create unique index if not exists ozikoro_entity_clan_town_uniq
  on ozikoro_entity (clan_town_id) where clan_town_id is not null;

comment on index ozikoro_entity_clan_town_uniq is
  'One entity per dictionary town, for the same reason and with the same partiality as the clan index above.';

-- The graph builder's link step matches a place name against an article title, so it reads every
-- published record once per run. The partial index keeps that read off the whole table.
create index if not exists ozikoro_article_title_idx
  on ozikoro_article (id) where status = 'published' and is_page = false;

-- ---------------------------------------------------------------------------
-- 2. Following
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_follow (
  id          bigserial primary key,
  -- The account doing the following. Cascades: closing an account ends its follows, which is a
  -- preference rather than a record of something that happened.
  account_id  bigint not null references account(id) on delete cascade,

  kind        text not null check (kind in ('researcher', 'topic', 'institution')),

  -- A followed researcher. Null for the other two kinds.
  subject_account_id bigint references account(id) on delete cascade,
  -- A followed series. Null unless the kind is 'topic'.
  topic_id    bigint references ozikoro_topic(id) on delete cascade,
  -- A followed institution, as the author row records it. Text because an institution is not yet an
  -- entity in this graph, and pointing at a table with no rows would make the feature unusable.
  institution text,

  created_at  timestamptz not null default now(),

  /*
   * The three shapes, enforced rather than described. A row that claims to follow a topic and
   * carries a researcher id would be a row that no query can read and no screen can show.
   */
  constraint ozikoro_follow_shape check (
    (kind = 'researcher'  and subject_account_id is not null and topic_id is null and institution is null)
    or (kind = 'topic'    and topic_id is not null and subject_account_id is null and institution is null)
    or (kind = 'institution' and institution is not null and subject_account_id is null and topic_id is null)
  ),
  -- Nobody follows themselves. Allowed by the shape above and meaningless in every query below.
  constraint ozikoro_follow_not_self check (subject_account_id is null or subject_account_id <> account_id)
);

comment on table ozikoro_follow is
  'What an account follows on ozikoro.com: another researcher, a series, or an institution. One '
  'table because "does this account follow this" is one question; the CHECK constraint carries the '
  'three shapes so no row can claim to be two things at once.';

-- One row per follow. A partial unique index per kind, because nulls do not compare equal in a
-- plain unique constraint and three nullable columns cannot express the three keys.
create unique index if not exists ozikoro_follow_researcher_uniq
  on ozikoro_follow (account_id, subject_account_id) where kind = 'researcher';
create unique index if not exists ozikoro_follow_topic_uniq
  on ozikoro_follow (account_id, topic_id) where kind = 'topic';
create unique index if not exists ozikoro_follow_institution_uniq
  on ozikoro_follow (account_id, lower(institution)) where kind = 'institution';

-- The reader's own list, and a follower count on a profile.
create index if not exists ozikoro_follow_account_idx on ozikoro_follow (account_id, created_at desc);
create index if not exists ozikoro_follow_subject_idx on ozikoro_follow (subject_account_id) where kind = 'researcher';
create index if not exists ozikoro_follow_topic_idx   on ozikoro_follow (topic_id) where kind = 'topic';

-- ---------------------------------------------------------------------------
-- 3. Discovery by institution
-- ---------------------------------------------------------------------------
create index if not exists ozikoro_pub_author_affiliation_idx
  on ozikoro_publication_author (lower(affiliation)) where affiliation is not null;

comment on index ozikoro_pub_author_affiliation_idx is
  'Search and discovery by institution, which the brief names as one of the three ways a work is '
  'found. Lowercased because "University of Nigeria" and "university of nigeria" are the same place.';
