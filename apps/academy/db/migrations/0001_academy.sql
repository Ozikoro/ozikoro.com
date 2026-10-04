-- ===========================================================================
-- Ozikoro Academy — the Academy's own tables.
--
-- WHY THIS IS A SEPARATE CHAIN FROM packages/db/migrations
--
-- The Academy shares the dictionary's database — that is the point, because it shares the
-- `account` table so one registration works on every Ozikoro site. It does not share the
-- dictionary's MIGRATION chain, and that is a deliberate response to a fact found in production:
--
--   The live database has migrations 0001-0033, then `0034_suggestion_drafts` and
--   `0035_donation_recurring`. This repository has 0001-0033, then `0034_spotify` and
--   `0035_ozikoro_archive` onwards to `0052_ozikoro_external_audio`.
--
-- The two lineages diverged after 0033. Production matches the application that is actually
-- deployed there (the legacy tree); this repository's later migrations belong to applications that
-- are not. Running this repository's chain against production would therefore apply twenty
-- migrations written for software the host does not run, against the live dictionary.
--
-- So the Academy tracks its own schema in its own table. It is additive and idempotent: it creates
-- only `academy_*` tables, touches nothing the dictionary owns, and can be applied to production
-- without altering a single existing row. `academy_migration` exists so the Academy can evolve its
-- own schema independently of a chain it does not control.
--
-- WHAT IS NOT CREATED HERE, AND WHY
--
-- `account`, `auth_session`, `learn_course`, `learn_unit`, `learn_lesson`, `learn_progress`,
-- `learn_attempt`, `learn_item_state` and the other 26 `learn_*` tables already exist in production
-- (created by 0028-0031) and are shared. They are empty — the imported content died with the
-- deleted Supabase project — so the curriculum import is a separate, repeatable step rather than
-- part of this schema.
-- ===========================================================================

create table if not exists academy_migration (
  id          text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);

comment on table academy_migration is
  'The Academy''s own migration ledger. Separate from schema_migration because the dictionary''s chain diverged from this repository after 0033.';

-- ---------------------------------------------------------------------------
-- Enrolment — which learner is studying which course.
--
-- The course is identified by its slug rather than a foreign key into `learn_course`. That is
-- deliberate for this vertical slice: the catalogue is authored in `src/data/academy.ts` and served
-- from the application, which AGENTS.md requires the front end to stay data-driven through. A
-- foreign key would mean the catalogue had to be imported before anybody could enrol, which would
-- make the enrolment feature depend on a content migration that has not happened.
--
-- When the catalogue moves into `learn_course`, the slug column becomes a foreign key and this
-- table needs no other change.
-- ---------------------------------------------------------------------------
create table if not exists academy_enrolment (
  id           bigserial primary key,
  account_id   bigint not null references account(id) on delete cascade,
  course_slug  text not null,
  status       text not null default 'active',
  enrolled_at  timestamptz not null default now(),
  completed_at timestamptz,
  constraint academy_enrolment_status_check check (status in ('active', 'completed', 'withdrawn')),
  -- One enrolment per learner per course. This is what makes `enrol` idempotent: pressing the
  -- button twice returns the existing enrolment rather than creating a second one.
  constraint academy_enrolment_unique unique (account_id, course_slug)
);

create index if not exists academy_enrolment_account_idx on academy_enrolment (account_id);

-- ---------------------------------------------------------------------------
-- Progress — how far through a course a learner is.
--
-- One row per learner per lesson, updated in place. `position` is the fraction of the lesson
-- completed for an audio or video block, and is 1 when the lesson is finished.
-- ---------------------------------------------------------------------------
create table if not exists academy_progress (
  id          bigserial primary key,
  account_id  bigint not null references account(id) on delete cascade,
  course_slug text not null,
  lesson_slug text not null,
  state       text not null default 'in_progress',
  position    real not null default 0,
  updated_at  timestamptz not null default now(),
  constraint academy_progress_state_check check (state in ('in_progress', 'completed')),
  constraint academy_progress_unique unique (account_id, course_slug, lesson_slug)
);

create index if not exists academy_progress_account_course_idx
  on academy_progress (account_id, course_slug);

-- ---------------------------------------------------------------------------
-- Attempts — every assessment, practice and diagnostic submission.
--
-- Kept as a log rather than a single mutable score because the spec's mastery engine needs the
-- history, not just the latest result: "retain mastery history" and "surface previously learned
-- concepts for spaced review" are both impossible from a column that gets overwritten.
--
-- `answers` is jsonb because the activity types differ — a multiple choice answer, a matching
-- answer and an essay prompt have no common shape, and inventing one would be a schema that lies
-- about its contents.
-- ---------------------------------------------------------------------------
create table if not exists academy_attempt (
  id            bigserial primary key,
  account_id    bigint not null references account(id) on delete cascade,
  course_slug   text not null,
  activity_slug text not null,
  kind          text not null default 'practice',
  score         integer,
  max_score     integer,
  answers       jsonb,
  created_at    timestamptz not null default now(),
  constraint academy_attempt_kind_check
    check (kind in ('practice', 'assessment', 'diagnostic', 'challenge'))
);

create index if not exists academy_attempt_account_idx
  on academy_attempt (account_id, course_slug, created_at desc);
