-- Ozituma Learn — M1 foundation: roles, learner profiles, the curriculum hierarchy,
-- the shared-lexicon link, and the editorial workflow.
--
-- Spec §19.3 (M1): "Auth, roles, schema and RLS, migrations, seed script with clearly marked
-- placeholder data, design tokens, PWA shell." This migration is the schema half.
--
-- WHAT THIS ADDS, AND WHY EACH PIECE EXISTS
--
-- 0023 created the first cut of the course tables (learn_course/unit/lesson/vocab/phrase) plus
-- progress. That was a four-table sketch of a curriculum. §9 asks for a good deal more, and this
-- migration closes the gap without duplicating anything the dictionary already holds.
--
-- REUSE, NOT DUPLICATION — the most important decision here
--
-- §6.2 calls for a "shared lexicon", and §9 lists a `lexemes` table with exactly the fields the
-- dictionary's `word` table already has: headword, a normalised form for forgiving search, a
-- pronunciation, a status, a source. The dictionary holds 16,596 published headwords with 39,103
-- definitions, 43,180 examples and ~46,400 recordings.
--
-- So a lesson does NOT get its own copy of a word. `learn_lesson_lexeme` LINKS a lesson to a
-- `word` row, and §F3's word page is the dictionary's existing word page. Copying the lexicon
-- would create two sources of truth for the same Igbo word, and the copy would drift — which is
-- the failure §16's "single-developer dependency" and §11.4's provenance rules both point at.
--
-- What the dictionary lacks for teaching is added to `word` as columns rather than to a parallel
-- table: `register` (§11.1 asks items to be tagged neutral/elder/casual/proverbial/archaic) and
-- `tone_pattern` (§Appendix A lists it).
--
-- WHY ROLES ARE AN ENUM AND NOT A TABLE
--
-- §9 lists `roles`, `permissions` and `user_roles`. §5.2 defines eight fixed roles. A permissions
-- table exists to serve roles that are configured at runtime by an administrator; nothing in this
-- specification asks for that, and §17.2's access checklist keeps role assignment in human hands.
-- So roles stay an enum — the same choice the existing `account_role` already made — and the
-- migration adds the four §5.2 roles that are missing. If a later release needs configurable
-- permissions, that is a table introduced alongside the enum, not a reason to build one now.
--
-- NOTE ON ROW LEVEL SECURITY
--
-- §9 and §13 ask for RLS on every table. That is deliberately not here: RLS defends a database
-- that clients reach directly, and in this architecture the browser never touches Postgres — every
-- query goes through a server-side route holding the only credentials. Recorded as decision T2 in
-- docs/decisions.md, with the compensating controls named there. It must be revisited if any
-- future feature gives a client direct database access.

-- ---------------------------------------------------------------------------
-- 1. Roles — the four §5.2 roles that do not exist yet
-- ---------------------------------------------------------------------------

-- `alter type ... add value` cannot run inside a transaction block before PostgreSQL 12, and the
-- migration runner wraps every file in begin/commit. PostgreSQL 16 allows it, but the new value
-- cannot be USED in the same transaction that adds it — so nothing below references these values,
-- and any code that does must wait for the next statement. Noted because it produces a confusing
-- "unsafe use of new value of enum type" error if someone later tries to insert a linguist in the
-- same migration.
alter type account_role add value if not exists 'learner';
alter type account_role add value if not exists 'linguist';
alter type account_role add value if not exists 'native_reviewer';
alter type account_role add value if not exists 'content_editor';

-- ---------------------------------------------------------------------------
-- 2. Learner profile (§5.1, §F1, §F7)
-- ---------------------------------------------------------------------------

-- Separate from `account` because it is a different kind of fact. `account` is identity and
-- authorisation and is shared with the dictionary's contributors; this is a learner's own
-- settings and is only meaningful for someone using the courses. An editor who never learns Igbo
-- has no row here, and a learner who never contributes has no role beyond `learner`.
create table if not exists learner_profile (
  account_id      bigint primary key references account(id) on delete cascade,

  -- §F1 collects these during onboarding.
  native_language text,
  learning_goal   text,
  daily_minutes   integer not null default 10 check (daily_minutes between 1 and 240),
  -- Self-selected: "Complete beginner", "I know a few words", "I can hold simple conversations".
  self_level      text check (self_level in ('beginner', 'few_words', 'simple_conversations')),
  -- 0–4, matching §4's level structure. Derived from placement where one was taken.
  current_level   integer not null default 0 check (current_level between 0 and 4),

  -- §F7: "the day is defined in the learner's time zone", and "Time zone is stored per user".
  -- An IANA name, because a fixed UTC offset is wrong twice a year and wrong again when the
  -- learner travels. Defaults to Lagos: the primary audience.
  time_zone       text not null default 'Africa/Lagos',

  -- §18 #5 default: "Adults and teens 13+ with parental notice for under 18; no under-13
  -- accounts". Stored as a band rather than a birth date so the platform holds no more personal
  -- data than the policy requires, and so the value cannot be used to identify a person.
  age_band        text check (age_band in ('under_13', 'teen', 'adult')),
  -- Recorded separately from the band so §13's consent requirements can be answered per purpose.
  -- §18 #5 makes under-13 accounts unavailable, so the column exists to record a refusal.
  guardian_consent_at timestamptz,

  -- §14 and §18 #6: "everything free during beta; premium switched off".
  plan            text not null default 'beta' check (plan in ('beta', 'free', 'premium')),

  -- §F1 acceptance: "User can export and delete their data from settings."
  data_export_requested_at timestamptz,
  deletion_requested_at    timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column learner_profile.age_band is
  'A band, not a birth date: the platform should not hold a precise age it has no use for. §18 #5 sets the policy.';
comment on column learner_profile.time_zone is
  'IANA name. §F7 requires the streak day to be defined in the learner''s zone, and an offset is wrong across DST and travel.';

-- ---------------------------------------------------------------------------
-- 3. Curriculum: course -> level -> unit -> lesson  (§9.1)
-- ---------------------------------------------------------------------------

-- §4 gives levels 0–4 with only 0 and 1 in v1.0, so levels are rows rather than an integer on the
-- unit: level 2 arriving should be data, not a migration, exactly as §3's second principle
-- requires for languages.
create table if not exists learn_level (
  id          bigserial primary key,
  course_id   bigint not null references learn_course(id) on delete cascade,
  -- 0 = sounds and alphabet, 1 = beginner, matching §4 and §F2.
  number      integer not null check (number between 0 and 4),
  title       text not null,
  summary     text,
  status      text not null default 'draft' check (status in ('draft', 'published')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (course_id, number)
);

-- Units gain a level. Nullable so the migration does not have to guess a level for existing rows;
-- the importer requires it, and `getCourse` treats a unit with no level as level 0.
alter table learn_unit
  add column if not exists level_id bigint references learn_level(id) on delete set null;

create index if not exists learn_unit_level_idx on learn_unit (level_id, position);

-- ---------------------------------------------------------------------------
-- 4. Lesson sections (§9: `lesson_sections`)
-- ---------------------------------------------------------------------------

-- The first version of a lesson stored its body as a jsonb array of blocks (see 0023's header for
-- why that was right at the time). That is still how an AUTHORED lesson reads, but §9 wants
-- sections as rows, because a section needs its own review state and its own version — a grammar
-- note is approved by a linguist, an audio clip by a native speaker, and they are not approved
-- together.
--
-- Both exist, and the split is deliberate: `learn_lesson.body` is the author's document, and
-- `learn_lesson_section` is the reviewable unit derived from it. The importer writes both. A
-- learner reads the assembled body; the CMS reviews sections.
create table if not exists learn_lesson_section (
  id          bigserial primary key,
  lesson_id   bigint not null references learn_lesson(id) on delete cascade,
  -- The kind of section. Matches the block types the renderer already handles, plus the two the
  -- spec requires per lesson (§F2: "a cultural note", §F9: "a structured cultural note").
  kind        text not null check (kind in (
                'objective', 'vocabulary', 'pronunciation', 'grammar', 'culture',
                'dialogue', 'example', 'exercise', 'review', 'note', 'tip', 'table'
              )),
  title       text,
  -- The section's content, in the same block shape `learn_lesson.body` uses.
  body        jsonb not null default '[]'::jsonb,
  position    integer not null default 100,

  -- §5.3's lifecycle, per section, so a lesson can be partly reviewed and honestly say so.
  status      text not null default 'draft' check (status in (
                'draft', 'submitted', 'in_review', 'linguist_approved', 'native_approved',
                'published', 'changes_requested', 'archived'
              )),
  -- §5.3: "AI-generated drafts are created with source = 'ai' and can never skip review."
  generation_method text not null default 'authored' check (generation_method in ('authored', 'ai')),
  -- §11.4: "Every entry records its source and licence."
  source      text,
  licence     text,

  created_by  bigint references account(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists learn_lesson_section_idx on learn_lesson_section (lesson_id, position);
-- The CMS's review queue reads across lessons, so it needs its own access path.
create index if not exists learn_lesson_section_status_idx on learn_lesson_section (status, updated_at);

-- ---------------------------------------------------------------------------
-- 5. The shared lexicon link (§6.2)
-- ---------------------------------------------------------------------------

-- Columns the dictionary needs in order to teach, added to `word` rather than to a parallel table.
alter table word add column if not exists register text;
alter table word add column if not exists tone_pattern text;

comment on column word.register is
  '§11.1: neutral, elder/formal, casual, proverbial or archaic. NULL means not yet assigned, which is different from neutral.';

create index if not exists word_register_idx on word (language_code, register) where register is not null;

-- A lesson teaches specific dictionary entries. This is the link §6.2 asks for, and it is what
-- makes "from each dictionary entry a link to related lessons" (§6.2) answerable in both
-- directions with one join.
create table if not exists learn_lesson_lexeme (
  lesson_id   bigint not null references learn_lesson(id) on delete cascade,
  word_id     bigint not null references word(id) on delete cascade,
  position    integer not null default 100,
  -- §F4: "A lexeme cannot be published without approved audio" — but a lesson may legitimately
  -- teach a word before its recording is approved, so the requirement is enforced at publish
  -- time by `assertLessonPublishable`, not at link time.
  is_new      boolean not null default true,
  note        text,
  primary key (lesson_id, word_id)
);

-- The reverse direction: which lessons teach this word.
create index if not exists learn_lesson_lexeme_word_idx on learn_lesson_lexeme (word_id);

-- ---------------------------------------------------------------------------
-- 6. Grammar and culture notes (§F9, §9)
-- ---------------------------------------------------------------------------

-- Separate tables rather than section rows, because both outlive the lesson that introduced them:
-- the same grammar note is referenced by several lessons and the same culture note by several
-- units, and §9.1's "lesson N---N grammar_note" is many-to-many.
create table if not exists learn_grammar_note (
  id          bigserial primary key,
  language_code text not null references language(code),
  slug        text not null unique,
  title       text not null,
  -- §11.1: "rule text (linguist-authored)". The note is a claim about the language, so it carries
  -- the same review machinery as any other content.
  body        text not null,
  examples    jsonb not null default '[]'::jsonb,
  -- §F2 wants one grammar note per lesson and §F6 wants them level-appropriate.
  level       integer not null default 0 check (level between 0 and 4),
  status      text not null default 'draft' check (status in (
                'draft', 'submitted', 'in_review', 'linguist_approved', 'native_approved',
                'published', 'changes_requested', 'archived'
              )),
  generation_method text not null default 'authored' check (generation_method in ('authored', 'ai')),
  source      text,
  licence     text,
  created_by  bigint references account(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists learn_grammar_note_status_idx on learn_grammar_note (language_code, status);

-- §F9: "who says it, to whom, in what setting, elder or peer register, regional differences".
-- Those are columns rather than prose, because §F9 requires each to be answerable and because
-- §16's dialect-dispute mitigation depends on a regional claim being tagged rather than implied.
create table if not exists learn_culture_note (
  id            bigserial primary key,
  language_code text not null references language(code),
  slug          text not null unique,
  title         text not null,
  body          text not null,
  -- §F9's structured fields.
  who_says_it   text,
  said_to       text,
  setting       text,
  register      text check (register in ('neutral', 'elder', 'formal', 'casual', 'proverbial', 'archaic')),
  region        text,
  -- §F9: "a related proverb or custom where a reviewed source exists".
  related_proverb_id bigint,
  status        text not null default 'draft' check (status in (
                  'draft', 'submitted', 'in_review', 'linguist_approved', 'native_approved',
                  'published', 'changes_requested', 'archived'
                )),
  generation_method text not null default 'authored' check (generation_method in ('authored', 'ai')),
  source        text,
  licence       text,
  created_by    bigint references account(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists learn_culture_note_status_idx on learn_culture_note (language_code, status);

create table if not exists learn_lesson_grammar_note (
  lesson_id bigint not null references learn_lesson(id) on delete cascade,
  note_id   bigint not null references learn_grammar_note(id) on delete cascade,
  position  integer not null default 100,
  primary key (lesson_id, note_id)
);

create table if not exists learn_lesson_culture_note (
  lesson_id bigint not null references learn_lesson(id) on delete cascade,
  note_id   bigint not null references learn_culture_note(id) on delete cascade,
  position  integer not null default 100,
  primary key (lesson_id, note_id)
);

-- ---------------------------------------------------------------------------
-- 7. Editorial: versions, review tasks, audit, reports (§5.3, §F10, §9)
-- ---------------------------------------------------------------------------

-- §5.3: "Any edit to a published item creates a new version; the previous version stays in
-- content_versions." One table across every content kind, keyed by (kind, id), because the
-- workflow is identical for all of them and separate tables would mean seven copies of the same
-- review logic.
create table if not exists learn_content_version (
  id          bigserial primary key,
  content_kind text not null check (content_kind in (
                 'lesson', 'lesson_section', 'grammar_note', 'culture_note', 'lexeme', 'exercise'
               )),
  content_id  bigint not null,
  version     integer not null,
  -- The full row as it stood, so a revert is a write rather than a reconstruction.
  snapshot    jsonb not null,
  -- §F10: "Every content record stores author, reviewer, timestamps, source or citation, language,
  -- dialect and region, AI-generated flag, version number and change note."
  change_note text,
  author_id   bigint references account(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (content_kind, content_id, version)
);

create index if not exists learn_content_version_lookup_idx
  on learn_content_version (content_kind, content_id, version desc);

-- §5.3's review queue. One row per request for a decision, carrying the state the item must be in
-- and who is allowed to make the call.
create table if not exists learn_review_task (
  id            bigserial primary key,
  content_kind  text not null check (content_kind in (
                  'lesson', 'lesson_section', 'grammar_note', 'culture_note', 'lexeme', 'exercise'
                )),
  content_id    bigint not null,
  -- Which role the task needs. §5.3's two approval steps are different people: a linguist approves
  -- the language, a native speaker approves the audio and naturalness.
  required_role text not null check (required_role in ('linguist', 'native_reviewer', 'content_editor')),
  state         text not null default 'open' check (state in ('open', 'claimed', 'approved', 'rejected', 'changes_requested', 'cancelled')),
  -- §F10: "Side-by-side view of current versus proposed change for reviewers."
  proposal      jsonb,
  reason        text,
  -- A learner's error report creates a review task (§5.3), so the origin is recorded.
  origin        text not null default 'author' check (origin in ('author', 'ai_draft', 'learner_report', 'system')),
  assigned_to   bigint references account(id) on delete set null,
  resolved_by   bigint references account(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists learn_review_task_queue_idx
  on learn_review_task (state, required_role, created_at);
create index if not exists learn_review_task_content_idx
  on learn_review_task (content_kind, content_id);

-- §9: "an audit_log for staff actions" and §F10: "Every staff action is written to audit_log."
create table if not exists learn_audit_log (
  id          bigserial primary key,
  actor_id    bigint references account(id) on delete set null,
  action      text not null,
  content_kind text,
  content_id  bigint,
  -- Before and after, so an action can be read back without joining anything.
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists learn_audit_log_actor_idx on learn_audit_log (actor_id, created_at desc);
create index if not exists learn_audit_log_content_idx on learn_audit_log (content_kind, content_id, created_at desc);

-- §F8's "Report" button and §F3's "Report a problem" button both write here, and §5.3 says a
-- learner report creates a review task assigned to a linguist.
create table if not exists learn_error_report (
  id           bigserial primary key,
  reporter_id  bigint references account(id) on delete set null,
  content_kind text not null,
  content_id   bigint,
  -- What the learner was looking at. Free text, because the useful report is in their words.
  message      text not null,
  category     text check (category in ('wrong_meaning', 'wrong_tone', 'wrong_audio', 'wrong_translation', 'other')),
  status       text not null default 'open' check (status in ('open', 'triaged', 'resolved', 'dismissed')),
  review_task_id bigint references learn_review_task(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists learn_error_report_status_idx on learn_error_report (status, created_at desc);
