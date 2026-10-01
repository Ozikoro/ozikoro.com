-- The Ozikoro archive: the history, archaeology and research record of ozikoro.com.
--
-- THE TABLE PREFIX IS NOT DECORATION
--
-- This is ONE database shared by three sites, and the dictionary got here first. It already
-- owns `clan`, `clan_town`, `tribe`, `person_name`, `language`, `dialect`, `source`, `tag` and
-- `word`. An unprefixed `source` or `clan` here would collide with a table that is already
-- populated and load-bearing, and `create table if not exists` would silently do nothing while
-- the new code wrote into the dictionary's records. So every table in this file is `ozikoro_*`,
-- and the collision is impossible rather than merely unlikely.
--
-- WHAT IS SHARED, AND WHAT IS NOT
--
-- The build plan is explicit: "Ozituma is the language layer. Do not duplicate its dictionary
-- inside Ozikoro." So this schema REFERENCES the dictionary rather than restating it:
--
--   ozikoro_entity.clan_id        -> clan(id)          the 228-clan registry
--   ozikoro_entity.clan_town_id   -> clan_town(id)     settlements inside a clan
--   ozikoro_entity.language_code  -> language(code)    the ISO 639-3 registry
--   ozikoro_contributor.account_id -> account(id)      one person, one account, three sites
--
-- A town or a clan is recorded ONCE, in the dictionary, and the archive points at it. The
-- archive's own contribution is the historical record: the articles, the sources with their
-- rights, the media, the claims and evidence, and the research network.
--
-- WHY ONE `ozikoro_entity` TABLE RATHER THAN EIGHTY
--
-- The plan lists roughly eighty entity families — Person, People, Community, Clan, Town,
-- Settlement, Polity, Kingdom, Event, Period, Migration, Trade Route, Deity, Ritual, Festival,
-- Folklore, Oral Tradition, Archaeological Site, Excavation, Object, Find, Dating Record,
-- Museum, Collection, Document, Photograph, Manuscript, Dataset, Publication and so on. Eighty
-- tables means eighty migrations, eighty repositories and eighty API surfaces before a single
-- page works, and the relationships between them — which are the actual product — would be
-- eighty join tables.
--
-- So the graph gets a typed spine: one `ozikoro_entity` row per thing, a `kind` that says what
-- it is, and one `ozikoro_entity_relation` table for how things connect. A typed detail table
-- (an excavation, a dating record) is added where a kind needs fields the spine cannot carry,
-- and it references the spine row rather than replacing it. That keeps "everything about
-- Ọ̀nịchạ" one query away, which is the requirement, while leaving room to specialise.
--
-- WHY PROVENANCE IS TABLES AND NOT FIELDS
--
-- The brief makes provenance a designed, first-class property: a `.provenance` block with the
-- same visual weight as a pull quote, a `.cite-block`, and an explicit `.unsourced` state. A
-- single `source` text column cannot carry that. Sources are their own table with their own
-- identifiers, licences and rights, articles attach to them in order, and a claim can cite
-- several with different weights — including contradictory ones, which the model has to allow
-- because the plan requires that uncertainty and competing interpretations be representable
-- rather than resolved away.

-- ---------------------------------------------------------------------------
-- People: the contributors and authors the archive already has
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_contributor (
  id          bigserial primary key,
  -- The WordPress user id. Kept so the import is idempotent and so an author can always be
  -- traced back to the record they came from.
  wp_user_id  integer unique,
  slug        text not null unique,
  display_name text not null,
  bio         text,
  website     text,
  avatar_url  text,
  -- The shared platform account, when this person has one. SET NULL rather than CASCADE: a
  -- closed account must not delete the attribution of everything the person wrote.
  account_id  bigint references account(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table ozikoro_contributor is
  'A person credited in the archive: an author, a narrator, a photographer, a researcher. '
  'Distinct from an account, which is a login. One person may have both, or only one.';

-- ---------------------------------------------------------------------------
-- Taxonomy: what WordPress called categories and tags
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_topic (
  id          bigserial primary key,
  wp_term_id  integer unique,
  slug        text not null unique,
  name        text not null,
  description text,
  parent_id   bigint references ozikoro_topic(id) on delete set null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table ozikoro_topic is
  'The archive''s sections, migrated from the WordPress category tree. Fourteen rows, and the '
  'narrative spine of the site (Historical Studies, Cultural Heritage, and so on).';

create table if not exists ozikoro_label (
  id         bigserial primary key,
  wp_term_id integer unique,
  slug       text not null unique,
  name       text not null,
  -- WordPress'' own count, kept as the migration''s record of how much each label was used.
  usage_count integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table ozikoro_label is
  'The long tail of WordPress tags: 11,056 of them, mostly names of places, people, towns and '
  'events. Kept because they are how the existing site is found in search, and because they are '
  'the raw material for the entity graph — the same names will resolve to real entities over time.';

-- ---------------------------------------------------------------------------
-- The knowledge graph spine
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_entity (
  id            bigserial primary key,
  kind          text not null check (kind in (
                  'person','people','community','clan','town','place','historical_place',
                  'archaeological_site','polity','kingdom','chiefdom','event','period',
                  'migration','trade_route','conflict','treaty','deity','ritual','festival',
                  'folklore','oral_tradition','architecture','music','craft','institution',
                  'language','dialect','object','museum','collection','document','photograph',
                  'audio','video','manuscript','dataset','publication','topic','other')),
  slug          text not null unique,
  name          text not null,
  -- Alternative and historical spellings, endonyms and exonyms. The plan requires search over
  -- these, and a separate table would make "which entity is this string?" a join in the hot path.
  aliases       text[] not null default '{}',
  summary       text,

  -- Links into the dictionary. Every one is nullable: most archive entities will not have a
  -- dictionary counterpart, and forcing a match would manufacture false confidence.
  clan_id       bigint references clan(id) on delete set null,
  clan_town_id  bigint references clan_town(id) on delete set null,
  language_code text references language(code) on delete set null,

  -- Geography, carried here so the map can be built from one table. A move to PostGIS is an
  -- additive migration; the columns are the same either way.
  latitude      double precision check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude     double precision check (longitude is null or (longitude >= -180 and longitude <= 180)),
  -- What the coordinates mean, because a point is not a boundary.
  location_note text,

  -- Chronology as it is actually known: an exact year, a range, or "circa". The plan requires
  -- before/after and uncertain dates, so a single integer would lose the record.
  date_start    integer,
  date_end      integer,
  date_qualifier text check (date_qualifier is null or date_qualifier in
                  ('exact','circa','before','after','range','unknown')),
  date_note     text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ozikoro_entity_dates_ordered check (date_end is null or date_start is null or date_end >= date_start)
);

comment on table ozikoro_entity is
  'One row per thing the archive knows about, of any kind, with the relationships held in '
  'ozikoro_entity_relation. The typed spine exists so the graph is queryable now and '
  'specialisable later; a kind that needs its own fields gets its own table referencing this one.';
comment on column ozikoro_entity.aliases is
  'Historical spellings, endonyms and exonyms. Search matches these, because a reader typing the '
  'spelling they were taught must find the record.';
comment on column ozikoro_entity.date_qualifier is
  'How the date is known. "circa", "before" and "after" are not decoration: collapsing them to a '
  'year would assert precision the sources do not support.';

-- The names that were never going to resolve to a real entity on day one, kept searchable so
-- that a label linking to nothing is still findable rather than lost.
create table if not exists ozikoro_entity_label (
  entity_id bigint not null references ozikoro_entity(id) on delete cascade,
  label_id  bigint not null references ozikoro_label(id) on delete cascade,
  primary key (entity_id, label_id)
);

create table if not exists ozikoro_entity_relation (
  id             bigserial primary key,
  from_entity_id bigint not null references ozikoro_entity(id) on delete cascade,
  to_entity_id   bigint not null references ozikoro_entity(id) on delete cascade,
  relation       text not null,
  note           text,
  -- A relationship can itself rest on a source, which is half the point of the graph.
  source_id      bigint,
  created_at     timestamptz not null default now(),
  constraint ozikoro_relation_not_self check (from_entity_id <> to_entity_id)
);

comment on table ozikoro_entity_relation is
  'A directed, named relationship between two entities (child_of, part_of, ruled, found_at, '
  'migrated_to, disputed_by). The relation name is free text on purpose: the plan''s vocabulary is '
  'still growing, and an enum here would mean a migration per new verb.';

-- ---------------------------------------------------------------------------
-- Sources: the provenance backbone
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_source (
  id            bigserial primary key,
  slug          text not null unique,
  kind          text not null check (kind in (
                  'book','journal_article','chapter','thesis','dissertation','preprint','report',
                  'archive_document','colonial_record','oral_history','interview','newspaper',
                  'website','dataset','photograph','audio','video','manuscript','catalogue','other')),
  title         text not null,
  authors       text[] not null default '{}',
  year          integer,
  -- When the year is approximate, said so rather than rounding to a number that reads as fact.
  year_note     text,
  publisher     text,
  journal       text,
  volume        text,
  issue         text,
  pages         text,
  url           text,
  identifier    text,
  archive       text,
  collection    text,
  -- Rights, which the plan requires on every source and every media record.
  licence       text,
  rights_note   text,
  accessed_at   date,

  /*
   * The evidence weight. The plan is careful here and so is this column: "Do not treat oral
   * tradition as inferior by default, but do distinguish it clearly from other evidence types."
   * So oral history is a first-class value of the same enum, not a lesser flag, and the UI is
   * expected to present it with equal weight while still saying which kind it is.
   */
  evidence_type text check (evidence_type is null or evidence_type in (
                  'archaeological','primary_source','oral_history','linguistic','anthropological',
                  'genetic','historical_document','scholarly_interpretation','traditional_account',
                  'disputed','unverified')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table ozikoro_source is
  'A citable source: a book, a colonial record, an oral history, a photograph, a dataset. Carries '
  'its own rights and licence because the archive republishes and cites rather than owns.';
comment on column ozikoro_source.evidence_type is
  'What kind of evidence the source provides. Oral history carries the same standing as the '
  'others in the enum; the value distinguishes kinds of evidence, it does not rank them.';

-- ---------------------------------------------------------------------------
-- Media: the record, not the bytes
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_media (
  id             bigserial primary key,
  wp_media_id    integer unique,
  slug           text not null unique,
  kind           text not null check (kind in ('image','audio','video','document','dataset','other')),
  title          text,
  alt_text       text,
  caption        text,
  description    text,
  -- Where the file came from, and where it now lives. Both are kept: the first is provenance,
  -- the second is what the site serves.
  source_url     text,
  storage_key    text,
  mime_type      text,
  width          integer,
  height         integer,
  filesize_bytes bigint,
  duration_seconds integer,

  -- Rights and provenance, per the plan: "Image rights and provenance for every object/media
  -- record", and "Photograph records with creator, date, collection, licence and attribution".
  creator        text,
  credit         text,
  licence        text,
  rights_note    text,
  captured_at    date,

  uploaded_at    timestamptz,
  contributor_id bigint references ozikoro_contributor(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table ozikoro_media is
  'A media record. The file itself lives in object storage; this row is the provenance, the '
  'rights and the description, which is what makes it publishable.';

-- ---------------------------------------------------------------------------
-- Articles: the existing archive, preserved
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_article (
  id            bigserial primary key,
  -- The WordPress post id. The import keys on this, so re-running it updates rather than
  -- duplicates, and a re-import months from now still lands on the same rows.
  wp_post_id    integer unique,
  slug          text not null unique,
  /*
   * The address the article had on WordPress. The old URLs are root-level slugs
   * (https://ozikoro.com/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/) and the plan requires
   * that existing URLs and SEO value are preserved, so this is kept as the record of what to
   * serve and what to redirect from.
   */
  legacy_url    text,

  title         text not null,
  standfirst    text,
  -- Preserved verbatim. This is the record; sanitisation belongs at render time, and rewriting
  -- the source on import would destroy the evidence of what was actually published.
  body_html     text not null default '',

  author_id          bigint references ozikoro_contributor(id) on delete set null,
  featured_media_id  bigint references ozikoro_media(id) on delete set null,
  topic_id           bigint references ozikoro_topic(id) on delete set null,

  /*
   * The archive's required structure, from the design brief: "Every article carries required
   * structure: ethnic group, sub-group or clan, town or place, time period, and source type."
   * The first three are relations to ozikoro_entity; these two are the article's own columns
   * because they describe the piece rather than point at another record.
   */
  source_type   text check (source_type is null or source_type in
                  ('oral_history','colonial_record','academic_source','mixed','unsourced')),
  period_label  text,
  period_start  integer,
  period_end    integer,

  -- Editorial state, with the same inert-until-approved rule the dictionary uses.
  status        text not null default 'draft' check (status in ('draft','review','published','archived')),
  published_at  timestamptz,
  modified_at   timestamptz,

  -- Yoast's metadata, so titles, descriptions and canonicals survive the move intact.
  seo_title       text,
  seo_description text,
  canonical_url   text,

  word_count    integer not null default 0,

  -- Full-text search over title and body. A generated column so it cannot drift from the source
  -- it indexes, which is the same reasoning as the dictionary's derived search forms.
  search_vector tsvector generated always as (
                  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(standfirst, '')), 'B') ||
                  setweight(to_tsvector('english', coalesce(regexp_replace(body_html, '<[^>]+>', ' ', 'g'), '')), 'C')
                ) stored,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ozikoro_article_period_ordered check (period_end is null or period_start is null or period_end >= period_start)
);

comment on table ozikoro_article is
  'An article in the archive, migrated from WordPress with its body and its original address '
  'preserved. It is a scholarly record, so what it rests on is modelled rather than described: '
  'its sources, its evidence and its related entities are separate tables.';
comment on column ozikoro_article.body_html is
  'The published HTML, kept verbatim. It is the evidence of what was published; it is sanitised '
  'when rendered, not when stored.';
comment on column ozikoro_article.legacy_url is
  'The WordPress address, kept so that old URLs can be served or redirected rather than broken.';

-- ---------------------------------------------------------------------------
-- How an article connects to everything else
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_article_entity (
  article_id bigint not null references ozikoro_article(id) on delete cascade,
  entity_id  bigint not null references ozikoro_entity(id) on delete cascade,
  -- Which of the brief's required facets this entity fills for this article.
  role       text not null check (role in ('ethnic_group','clan','town','place','period','person','event','other')),
  primary key (article_id, entity_id, role)
);

comment on table ozikoro_article_entity is
  'The article''s structured tags: which people, clan, town, place or period it belongs to. The '
  'role column is what lets the archive answer "every article about this clan" and '
  '"every article from this period" without parsing prose.';

create table if not exists ozikoro_article_source (
  article_id bigint not null references ozikoro_article(id) on delete cascade,
  source_id  bigint not null references ozikoro_source(id) on delete cascade,
  -- The order the references appear in the article, so the footnote numbers survive.
  position   integer not null default 0,
  -- How the article uses it: supporting, contradicting or qualifying. The plan requires all
  -- three, because an archive that can only cite agreement is not a record of a debate.
  stance     text not null default 'supports' check (stance in ('supports','contradicts','qualifies','context')),
  note       text,
  primary key (article_id, source_id)
);

create table if not exists ozikoro_article_label (
  article_id bigint not null references ozikoro_article(id) on delete cascade,
  label_id   bigint not null references ozikoro_label(id) on delete cascade,
  primary key (article_id, label_id)
);

create table if not exists ozikoro_article_media (
  article_id bigint not null references ozikoro_article(id) on delete cascade,
  media_id   bigint not null references ozikoro_media(id) on delete cascade,
  role       text not null default 'inline' check (role in ('featured','inline','attachment')),
  position   integer not null default 0,
  caption    text,
  primary key (article_id, media_id)
);

-- ---------------------------------------------------------------------------
-- Claims and evidence
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_claim (
  id          bigserial primary key,
  article_id  bigint references ozikoro_article(id) on delete cascade,
  entity_id   bigint references ozikoro_entity(id) on delete set null,
  -- The claim as a sentence, so it can be shown, quoted and reviewed on its own.
  statement   text not null,
  -- Where in the article, when it is attached to one.
  anchor      text,
  status      text not null default 'unverified' check (status in
                ('unverified','supported','disputed','contradicted','superseded')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ozikoro_claim_has_context check (article_id is not null or entity_id is not null)
);

comment on table ozikoro_claim is
  'A statement the archive makes, held separately from the prose so its support can be shown, '
  'contested and reviewed. This is what makes "never automatically convert oral tradition into '
  'established historical fact" a property of the data rather than a promise in the editor.';

create table if not exists ozikoro_evidence (
  id         bigserial primary key,
  claim_id   bigint not null references ozikoro_claim(id) on delete cascade,
  source_id  bigint references ozikoro_source(id) on delete set null,
  entity_id  bigint references ozikoro_entity(id) on delete set null,
  stance     text not null default 'supports' check (stance in ('supports','contradicts','qualifies','context')),
  -- A quotation and its translation, which is how most of this material actually arrives.
  quote      text,
  translation text,
  note       text,
  weight     smallint check (weight is null or weight between 1 and 5),
  created_at timestamptz not null default now(),
  constraint ozikoro_evidence_has_ground check (source_id is not null or entity_id is not null)
);

comment on table ozikoro_evidence is
  'The ground under a claim: a source, a record, or another entity, with the stance it takes. '
  'Several rows may contradict each other, and should where the record does.';

-- ---------------------------------------------------------------------------
-- Addresses, so nothing 404s
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_redirect (
  id         bigserial primary key,
  -- The path as requested, without the origin: '/ute-okpu-.../'.
  from_path  text not null unique,
  to_path    text not null,
  status     smallint not null default 301 check (status in (301, 302, 308)),
  reason     text,
  created_at timestamptz not null default now()
);

comment on table ozikoro_redirect is
  'Preserved addresses. The plan requires that existing URLs and their search value survive the '
  'move, so a URL that changes gets a row here rather than becoming a 404.';

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_audit (
  id          bigserial primary key,
  entity_type text not null,
  entity_id   bigint not null,
  action      text not null,
  -- Before and after, so an editorial decision can be read back rather than guessed at.
  before      jsonb,
  after       jsonb,
  actor_id    bigint references account(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

comment on table ozikoro_audit is
  'Who changed what, when, and from what to what. The plan requires an audit trail when an '
  'editorial status changes, and this is also what makes "do not silently overwrite historical '
  'records" enforceable rather than a matter of good behaviour.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists ozikoro_article_search_idx  on ozikoro_article using gin (search_vector);
create index if not exists ozikoro_article_status_idx  on ozikoro_article (status, published_at desc);
create index if not exists ozikoro_article_topic_idx   on ozikoro_article (topic_id);
create index if not exists ozikoro_article_author_idx  on ozikoro_article (author_id);

create index if not exists ozikoro_entity_kind_idx     on ozikoro_entity (kind);
create index if not exists ozikoro_entity_name_idx     on ozikoro_entity (lower(name));
create index if not exists ozikoro_entity_aliases_idx  on ozikoro_entity using gin (aliases);
create index if not exists ozikoro_entity_clan_idx     on ozikoro_entity (clan_id);
create index if not exists ozikoro_entity_geo_idx      on ozikoro_entity (latitude, longitude)
  where latitude is not null and longitude is not null;

create index if not exists ozikoro_relation_from_idx   on ozikoro_entity_relation (from_entity_id, relation);
create index if not exists ozikoro_relation_to_idx     on ozikoro_entity_relation (to_entity_id, relation);

create index if not exists ozikoro_article_entity_role_idx on ozikoro_article_entity (entity_id, role);
create index if not exists ozikoro_article_label_idx       on ozikoro_article_label (label_id);
create index if not exists ozikoro_article_source_idx      on ozikoro_article_source (source_id);

create index if not exists ozikoro_label_name_idx  on ozikoro_label (lower(name));
create index if not exists ozikoro_media_kind_idx  on ozikoro_media (kind);
create index if not exists ozikoro_source_kind_idx on ozikoro_source (kind);
create index if not exists ozikoro_claim_article_idx on ozikoro_claim (article_id);
create index if not exists ozikoro_evidence_claim_idx on ozikoro_evidence (claim_id);
create index if not exists ozikoro_audit_target_idx on ozikoro_audit (entity_type, entity_id, created_at desc);
