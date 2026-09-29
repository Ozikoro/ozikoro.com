-- ============================================================================
-- Ozituma — core schema
-- ============================================================================
--
-- DESIGN NOTES (read before changing)
--
-- 1. MULTI-LANGUAGE FROM DAY ONE.
--    The reference implementation (nkowaokwu/igbo_api) is structurally
--    single-language: Igbo's 7 tenses, Igbo's 46-dialect enum, Igbo's grammar
--    classes and the Nsibidi script are baked into its Mongoose models and
--    enums. Ozikoro's technical scope (section 5) requires the opposite: a
--    language field on every entry so one schema serves Igbo, Yoruba, Edo,
--    Ibibio, Ijaw "and beyond".
--
--    So every language-specific concept is a ROW here, not a column, enum or
--    check constraint:
--      * grammar classes  -> part_of_speech, scoped by language_code
--      * "tenses"         -> word_form + form_type, scoped by language_code
--      * dialects         -> dialect table, scoped by language_code
--      * Nsibidi/scripts  -> word_script (any script, any language)
--      * definition text  -> its own language_code (definitions are English
--                            today, but Igbo-in-Igbo and French-in-Ewe are
--                            expected later)
--    Adding a language is therefore data, never a migration.
--
-- 2. TWO DERIVED SEARCH FORMS ON EVERY HEADWORD.
--    exact_form keeps letter-defining diacritics (ọ ẹ ṣ ị ụ ṅ) but drops tone.
--    search_form drops every mark, for typo- and tone-blind recall. Both are
--    computed in the importer by @ozituma/core so they can never disagree.
--    See packages/core/src/orthography.ts for why this split is necessary.
--
-- 3. API KEYS ARE HASHED.
--    The reference implementation stores API keys as cleartext uuid v4 values
--    (see its Developer model — `const generateApiKey = uuid`). We store only a
--    SHA-256 hash plus a short visible prefix for the dashboard, so a database
--    leak does not hand over working credentials.
--
-- 4. QUOTA LIMITS ARE DATA, NOT CODE.
--    The reference advertises 500 requests/day on its Starter tier and 2,500
--    on Team, but enforces a flat 2,500 for every tier because its
--    `authorizeDeveloperUsage` middleware never reads the developer's plan. The
--    plan_limit table makes advertised and enforced limits the same number.
--
-- 5. ATTRIBUTION IS STRUCTURAL.
--    Imported corpora are CC-BY-4.0 (nkowaokwu/ibo-dict) and Apache-2.0
--    (igbo_api). Those licences require attribution, so `source` is a first
--    class table that every imported row points at. Attribution is not a
--    footer afterthought.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enumerated types that are genuinely universal
-- ---------------------------------------------------------------------------

create type entry_status as enum ('draft', 'pending_review', 'published', 'archived');

create type relation_kind as enum (
  'synonym', 'antonym', 'hypernym', 'hyponym',
  'variant', 'stem', 'derived', 'related', 'see_also'
);

create type account_role as enum ('contributor', 'editor', 'admin');

create type review_status as enum ('pending', 'approved', 'rejected', 'merged');

-- ---------------------------------------------------------------------------
-- Languages, dialects, grammar
-- ---------------------------------------------------------------------------

create table language (
  code          text primary key,                    -- ISO 639-3, e.g. 'ibo'
  name          text not null,
  native_name   text not null,
  direction     text not null default 'ltr' check (direction in ('ltr', 'rtl')),
  family        text,
  countries     text[] not null default '{}',
  scripts       text[] not null default '{}',
  tier          smallint not null default 3 check (tier between 1 and 3),
  marks_tone    boolean not null default true,
  speaker_count bigint,
  is_active     boolean not null default true,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now()
);

comment on column language.tier is
  'Delivery tier from the Ozikoro technical scope: 1 = Year 1 launch, 2 = Year 2, 3 = registered, corpus later.';

create table dialect (
  id            bigserial primary key,
  language_code text not null references language(code) on delete cascade,
  code          text not null,
  name          text not null,
  native_name   text,
  region        text,
  latitude      numeric(9, 6),
  longitude     numeric(9, 6),
  is_active     boolean not null default true,
  unique (language_code, code)
);

create index dialect_language_idx on dialect (language_code) where is_active;

-- Grammar classes. language_code NULL means "applies to any language".
create table part_of_speech (
  id            bigserial primary key,
  language_code text references language(code) on delete cascade,
  code          text not null,
  name          text not null,
  abbreviation  text not null,
  description   text,
  sort_order    integer not null default 100
);

-- A partial unique index is needed because NULL language_code means universal
-- and NULLs never compare equal in a plain unique constraint.
create unique index part_of_speech_unique
  on part_of_speech (coalesce(language_code, ''), code);

-- Inflection/derivation categories. Replaces Igbo's hardcoded 7-slot `tenses`
-- object, which cannot describe Yoruba or Bantu verb systems.
create table form_type (
  id            bigserial primary key,
  language_code text references language(code) on delete cascade,
  code          text not null,
  name          text not null,
  description   text,
  sort_order    integer not null default 100
);

create unique index form_type_unique
  on form_type (coalesce(language_code, ''), code);

-- ---------------------------------------------------------------------------
-- Provenance and attribution
-- ---------------------------------------------------------------------------

create table source (
  id               bigserial primary key,
  slug             text not null unique,
  name             text not null,
  url              text,
  license_code     text not null,        -- 'CC-BY-4.0', 'Apache-2.0', 'public-domain'
  license_url      text,
  attribution_text text not null,        -- the sentence we must display
  citation         text,                 -- academic citation where one exists
  retrieved_at     date,
  notes            text,
  created_at       timestamptz not null default now()
);

create table tag (
  id         bigserial primary key,
  slug       text not null unique,
  name       text not null,
  kind       text not null default 'topic'
             check (kind in ('topic', 'register', 'region', 'status', 'domain'))
);

-- ---------------------------------------------------------------------------
-- The dictionary itself
-- ---------------------------------------------------------------------------

create table word (
  id             bigserial primary key,
  uuid           uuid not null default gen_random_uuid(),
  language_code  text not null references language(code),
  headword       text not null,
  exact_form     text not null,                        -- tone stripped, letter marks kept
  search_form    text not null,                        -- fully folded, index key
  slug           text not null,                        -- URL segment, unique per language
  pronunciation  text,                                 -- IPA or a practical respelling
  syllables      text,
  frequency_rank integer,
  is_common      boolean not null default false,
  is_verified    boolean not null default false,
  status         entry_status not null default 'published',
  source_id      bigint references source(id) on delete set null,
  external_id    text,                                 -- id in the upstream corpus
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- One entry per spelling per language. Two languages may share a spelling.
  unique (language_code, headword),
  unique (language_code, slug)
);

create index word_language_idx      on word (language_code);
create index word_search_form_idx   on word (language_code, search_form);
-- Prefix index so `like 'akw%'` autocomplete is an index scan, not a seq scan.
create index word_search_prefix_idx on word (search_form text_pattern_ops);
create index word_exact_form_idx    on word (language_code, exact_form);
create index word_common_idx        on word (language_code, frequency_rank)
  where is_common and status = 'published';
create index word_source_idx        on word (source_id);
create index word_external_idx      on word (language_code, external_id);

create table definition (
  id             bigserial primary key,
  word_id        bigint not null references word(id) on delete cascade,
  language_code  text not null references language(code),   -- language OF the definition
  part_of_speech_id bigint references part_of_speech(id) on delete set null,
  text           text not null,
  label          text,                                       -- "figurative", "archaic", ...
  position       integer not null default 0,
  is_primary     boolean not null default false,
  source_id      bigint references source(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (word_id, language_code, text)
);

create index definition_word_idx     on definition (word_id, position);
create index definition_language_idx on definition (language_code);

-- Dialect-specific spellings of a headword. Replaces the embedded
-- `dialects: [{ word, variations, dialects: [code], pronunciation }]` array.
create table word_dialect (
  id            bigserial primary key,
  word_id       bigint not null references word(id) on delete cascade,
  dialect_id    bigint not null references dialect(id) on delete cascade,
  spelling      text not null,
  search_form   text not null,
  pronunciation text,
  notes         text,
  unique (word_id, dialect_id, spelling)
);

create index word_dialect_dialect_idx on word_dialect (dialect_id);
create index word_dialect_search_idx  on word_dialect (search_form);

-- Inflected / derived surface forms, e.g. Igbo tenses or Yoruba tonal variants.
create table word_form (
  id           bigserial primary key,
  word_id      bigint not null references word(id) on delete cascade,
  form_type_id bigint not null references form_type(id) on delete cascade,
  value        text not null,
  search_form  text not null,
  unique (word_id, form_type_id, value)
);

create index word_form_search_idx on word_form (search_form);

-- Relations between headwords, replacing `relatedTerms`/`hypernyms`/
-- `hyponyms`/`stems` ObjectId arrays with one typed edge table.
create table word_relation (
  id            bigserial primary key,
  from_word_id  bigint not null references word(id) on delete cascade,
  to_word_id    bigint not null references word(id) on delete cascade,
  relation_type relation_kind not null,
  source_id     bigint references source(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (from_word_id, to_word_id, relation_type),
  check (from_word_id <> to_word_id)
);

create index word_relation_from_idx on word_relation (from_word_id, relation_type);
create index word_relation_to_idx   on word_relation (to_word_id, relation_type);

-- Alternative scripts: generalises the reference implementation's hardcoded
-- NsibidiCharacter model into "any script, any language" (Nsibidi, Akagu,
-- Ajami, Kikakui, NKo, Tifinagh, Ge'ez...).
create table word_script (
  id          bigserial primary key,
  word_id     bigint not null references word(id) on delete cascade,
  script_code text not null,                -- 'Nsibidi', 'Ajami', 'Akagu', ...
  value       text not null,
  notes       text,
  unique (word_id, script_code, value)
);

create table word_tag (
  word_id bigint not null references word(id) on delete cascade,
  tag_id  bigint not null references tag(id) on delete cascade,
  primary key (word_id, tag_id)
);

create table example (
  id                       bigserial primary key,
  language_code            text not null references language(code),
  text                     text not null,
  search_form              text not null,
  translation              text,
  translation_language_code text references language(code),
  style                    text,                    -- 'proverb', 'biblical', 'colloquial', ...
  is_verified              boolean not null default false,
  status                   entry_status not null default 'published',
  source_id                bigint references source(id) on delete set null,
  external_id              text,
  created_at               timestamptz not null default now()
);

create index example_language_idx on example (language_code);
create index example_search_idx   on example (search_form);
create index example_source_idx   on example (source_id);

-- The join the reference implementation faked by storing ObjectIds in a field
-- declared as [String], then relying on $lookup at read time.
create table example_word (
  example_id bigint not null references example(id) on delete cascade,
  word_id    bigint not null references word(id) on delete cascade,
  primary key (example_id, word_id)
);

create index example_word_word_idx on example_word (word_id);

-- ---------------------------------------------------------------------------
-- Media: audio lives in S3-compatible object storage, only metadata here
-- ---------------------------------------------------------------------------

create table audio (
  id              bigserial primary key,
  uuid            uuid not null default gen_random_uuid(),
  language_code   text not null references language(code),
  dialect_id      bigint references dialect(id) on delete set null,
  -- Exactly one owner. Real foreign keys instead of a polymorphic owner_id.
  word_id         bigint references word(id) on delete cascade,
  word_dialect_id bigint references word_dialect(id) on delete cascade,
  example_id      bigint references example(id) on delete cascade,
  storage_key     text,                    -- S3/MinIO object key
  external_url    text,                    -- for corpora we only have a URL for
  mime_type       text,
  byte_size       bigint,
  duration_ms     integer,
  speaker_name    text,
  -- pending_review / published / rejected — user recordings are moderated.
  status          text not null default 'published'
                  check (status in ('pending_review', 'published', 'rejected')),
  license_code    text,
  source_id       bigint references source(id) on delete set null,
  approvals       integer not null default 0,
  denials         integer not null default 0,
  created_at      timestamptz not null default now(),
  check (num_nonnulls(word_id, word_dialect_id, example_id) = 1),
  check (storage_key is not null or external_url is not null)
);

create index audio_word_idx    on audio (word_id) where status = 'published';
create index audio_example_idx on audio (example_id) where status = 'published';
create index audio_review_idx  on audio (status) where status = 'pending_review';

-- ---------------------------------------------------------------------------
-- People, contributions and editorial review
-- ---------------------------------------------------------------------------

create table account (
  id             bigserial primary key,
  uuid           uuid not null default gen_random_uuid(),
  email          text not null,
  display_name   text,
  role           account_role not null default 'contributor',
  status         text not null default 'active'
                 check (status in ('active', 'suspended', 'deleted')),
  email_verified boolean not null default false,
  password_hash  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Case-insensitive uniqueness without needing the citext extension.
create unique index account_email_unique on account (lower(email));

-- The crowdsourcing queue: the pattern both Afam and nkowaokwu use, and the
-- "open contribution plus editorial review" flow the scope doc requires.
create table suggestion (
  id             bigserial primary key,
  uuid           uuid not null default gen_random_uuid(),
  kind           text not null
                 check (kind in ('new_word', 'edit_word', 'new_definition',
                                 'new_example', 'audio', 'correction', 'dialect')),
  language_code  text references language(code) on delete set null,
  target_word_id bigint references word(id) on delete set null,
  payload        jsonb not null,
  status         review_status not null default 'pending',
  submitted_by   bigint references account(id) on delete set null,
  submitted_at   timestamptz not null default now(),
  reviewed_by    bigint references account(id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text
);

create index suggestion_queue_idx on suggestion (status, submitted_at)
  where status = 'pending';
create index suggestion_word_idx  on suggestion (target_word_id);

-- ---------------------------------------------------------------------------
-- Public API consumers
-- ---------------------------------------------------------------------------

create table developer (
  id            bigserial primary key,
  uuid          uuid not null default gen_random_uuid(),
  name          text not null,
  email         text not null,
  organization  text,
  use_case      text,
  plan          text not null default 'free'
                check (plan in ('free', 'team', 'institution')),
  status        text not null default 'active'
                check (status in ('active', 'suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index developer_email_unique on developer (lower(email));

create table api_key (
  id           bigserial primary key,
  developer_id bigint not null references developer(id) on delete cascade,
  name         text not null default 'default',
  -- First 8 characters are stored in the clear so the dashboard can show
  -- "ozt_live_3f9a..." without ever holding the full secret.
  key_prefix   text not null,
  key_hash     text not null unique,     -- sha256(full key)
  scopes       text[] not null default '{read}',
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index api_key_developer_idx on api_key (developer_id);
create index api_key_prefix_idx    on api_key (key_prefix);

-- Daily metering, one row per developer/endpoint/day.
create table api_usage_daily (
  id           bigserial primary key,
  developer_id bigint not null references developer(id) on delete cascade,
  api_key_id   bigint references api_key(id) on delete set null,
  day          date not null,
  endpoint     text not null,
  count        integer not null default 0,
  unique (developer_id, day, endpoint)
);

create index api_usage_day_idx on api_usage_daily (day);

-- THE FIX for the reference implementation's central gap: it advertised
-- 500/day on Starter and 2,500/day on Team, then enforced a flat 2,500 for
-- everyone because the plan field was never read. Here the enforced limit is
-- a lookup in this table, so advertised and enforced cannot drift.
create table plan_limit (
  plan          text not null,
  endpoint      text not null,      -- '*' means every endpoint
  daily_limit   integer not null,
  monthly_limit integer,
  primary key (plan, endpoint)
);

create table plan_feature (
  plan    text not null,
  feature text not null,
  enabled boolean not null default true,
  primary key (plan, feature)
);

-- ---------------------------------------------------------------------------
-- Newsletter / waitlist for languages whose corpora are still being prepared
-- ---------------------------------------------------------------------------

create table language_interest (
  id            bigserial primary key,
  language_code text references language(code) on delete cascade,
  email         text not null,
  note          text,
  created_at    timestamptz not null default now(),
  unique (language_code, email)
);
