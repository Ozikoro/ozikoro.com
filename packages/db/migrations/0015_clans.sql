-- Clans and tribes.
--
-- The dictionary has, until now, held words and names and nothing about where
-- their speakers live. This is the other half of the same fact: an Igbo person
-- belongs to a town, the town to a clan, and the clan to one of the large
-- groupings the ethnographic literature calls sections — Northern Igbo,
-- Southern Igbo, Western Igbo, Eastern Igbo — and which this platform calls
-- TRIBES, because the sources' word for the lower level is "sub-tribe" and
-- calling both levels a tribe is how a reader ends up thinking the Igbo are
-- several peoples rather than one.
--
-- So the shape is deliberately two-level and shallow:
--
--   tribe  (Northern Igbo)  ->  clan  (Nri, Awka, Nsukka …)  ->  town
--
-- A clan here is a named unit with a territory and, in the sources, a founding
-- tradition: the level a person answers when asked where they are from. A town
-- is a settlement inside it. Nothing deeper is modelled, because the sources do
-- not agree on anything deeper and a schema that pretends otherwise invites
-- invented structure.
--
-- PROVENANCE IS INTERNAL. `clan_source` records the book, the page and the
-- reading each row rests on. It is never rendered on a public page: the owner's
-- standing rule is that the site does not publish where its material came from,
-- and this table is what makes that rule safe rather than lossy — the reading
-- can still be checked by anyone working in the repository.

create table tribe (
  id         bigserial primary key,
  slug       text not null unique,
  name       text not null,
  -- One or two sentences on what the grouping covers.
  note       text,
  -- Where the grouping comes from, for the repository rather than the site.
  source     text,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table tribe is
  'The large Igbo groupings (Northern Igbo, Southern Igbo, Western Igbo …). '
  'The ethnographic sources call the level below this a "sub-tribe".';

create table clan (
  id             bigserial primary key,
  slug           text not null unique,
  name           text not null,
  -- Always 'Igbo' today; a column rather than a constant because Edo, Yoruba
  -- and Ẹkpẹyẹ are already in the language table and their clans will follow.
  ethnic_group   text not null default 'Igbo',
  tribe_id       bigint references tribe(id) on delete set null,
  -- The present-day state or plain geographic area, where the sources make it
  -- unambiguous. Null rather than guessed.
  region         text,
  -- The line shown on the index card. Short and factual.
  origin_summary text,
  -- Paragraphs. An array because the sources describe these in sections that do
  -- not survive being welded into one string.
  description    text[] not null default '{}',
  -- Book, page and reading. Internal.
  source         text,
  -- Ordering inside a tribe, and a stable order when there is no tribe.
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index clan_tribe_idx  on clan (tribe_id, position);
create index clan_name_idx   on clan (lower(name));

comment on column clan.origin_summary is
  'One or two sentences for the index card: where the clan is and what it is known for.';
comment on column clan.source is
  'Book, page and reading this row rests on. Repository metadata, never rendered on the site.';

create table clan_town (
  id         bigserial primary key,
  clan_id    bigint not null references clan(id) on delete cascade,
  name       text not null,
  -- Some towns are listed by the source as the clan's main town, or are the
  -- seat of its senior title-holder. Only recorded where the source says so.
  is_head    boolean not null default false,
  source     text,
  unique (clan_id, name)
);

create index clan_town_idx on clan_town (clan_id, name);

comment on table clan_town is
  'Settlements inside a clan. A town is listed only where a source lists it; '
  'an empty clan_town set means the sources did not enumerate its towns, not '
  'that it has none.';

-- A clan's names are the first thing a reader will want next, and the names
-- already carry where they are borne: `person_name.origins` is an array of the
-- places a name is found. A GIN index makes "the names borne in this clan" a
-- lookup rather than a scan, which is what the clan page does.
create index if not exists person_name_origins_gin_idx
  on person_name using gin (origins);
