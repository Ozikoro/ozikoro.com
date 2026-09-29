-- Ozituma Learn — the curriculum layer behind learn.ozituma.com.
--
-- WHY THIS IS SEPARATE FROM THE DICTIONARY TABLES
--
-- The dictionary answers "what does this word mean". A course answers "what
-- should I learn next, and can I now do it". Those are different questions with
-- different shapes, and the first does not contain the second:
--
--   - A dictionary is unordered and complete; a course is ordered and partial.
--     12,467 headwords in alphabetical order teach nobody anything.
--   - A dictionary entry is evidence; a lesson is an argument. "Kèdú" being a
--     greeting does not say that a beginner should meet it first, that it
--     belongs beside "Ọ dị mma", or that it should be practised before "Nnọọ".
--     That sequencing is authored, and it is the actual product.
--   - A course has learners attached to it. Progress is per-account, which the
--     dictionary has no notion of.
--
-- So lessons are authored content, and `dictionary_headword` links a vocab item
-- back to `word` WHEN the corpus has it. The link is a bonus, not a dependency:
-- the course renders in full against an empty dictionary, which matters because
-- a course cannot be allowed to break when a corpus import is re-run, and
-- because the 16 registered languages with no corpus still need somewhere for
-- their curriculum to live.
--
-- WHY lesson.body IS JSONB
--
-- A lesson is a sequence of heterogeneous blocks: a paragraph, a grammar note, a
-- conjugation table, a dialogue, a tip. The alternative is a block table with a
-- `kind` column and nullable columns for every shape's fields, which is a worse
-- fit — the columns a dialogue needs are not the columns a table needs, and
-- every new block kind would be a migration. Blocks are content, not relational
-- facts: nothing ever queries "all grammar notes", and they are always read as
-- an ordered whole for one lesson. jsonb is the honest type for that, and the
-- TypeScript union in packages/db/src/learn.ts is what actually validates it.
--
-- The relational facts — course, unit, lesson, vocabulary, progress — are all
-- real tables, because those are joined, filtered, counted and ordered.

-- ---------------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------------

create table if not exists learn_course (
  id            bigserial primary key,
  -- The URL segment: /learn/igbo. Stable, because it is linked to.
  slug          text not null unique,
  language_code text not null references language(code),
  title         text not null,
  -- The one-line promise under the title, e.g. "Speak Igbo from your first day".
  subtitle      text,
  description   text,
  -- CEFR where it maps honestly, and "beginner" where it does not. A course that
  -- claimed A1 without being one would mislead the learner who trusted it.
  level         text not null default 'beginner'
                check (level in ('beginner', 'elementary', 'intermediate', 'advanced')),
  status        text not null default 'draft'
                check (status in ('draft', 'published')),
  -- Ordering within the language list on /learn.
  position      integer not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists learn_course_published_idx
  on learn_course (position, slug)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- Units — a themed group of lessons. "Greetings and courtesy."
-- ---------------------------------------------------------------------------

create table if not exists learn_unit (
  id          bigserial primary key,
  course_id   bigint not null references learn_course(id) on delete cascade,
  slug        text not null,
  title       text not null,
  summary     text,
  position    integer not null default 100,
  status      text not null default 'draft'
              check (status in ('draft', 'published')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Slugs are unique per course, not globally: two languages may both have a
  -- unit called "greetings" and neither should have to rename it.
  unique (course_id, slug)
);

create index if not exists learn_unit_course_idx
  on learn_unit (course_id, position);

-- ---------------------------------------------------------------------------
-- Lessons
-- ---------------------------------------------------------------------------

create table if not exists learn_lesson (
  id          bigserial primary key,
  unit_id     bigint not null references learn_unit(id) on delete cascade,
  slug        text not null,
  title       text not null,
  -- One sentence, phrased as a capability, not a topic: "Greet someone at any
  -- time of day" rather than "Greetings". A learner should be able to tell
  -- whether they can do the thing, which a topic noun does not let them do.
  objective   text,
  -- Ordered array of content blocks. See the header note; the union that
  -- constrains it lives in learn.ts.
  body        jsonb not null default '[]'::jsonb,
  -- Author's estimate, shown so a learner can decide whether to start. Not a
  -- measurement, and labelled as an estimate in the UI.
  est_minutes integer not null default 8 check (est_minutes between 1 and 120),
  position    integer not null default 100,
  status      text not null default 'draft'
              check (status in ('draft', 'published')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (unit_id, slug)
);

create index if not exists learn_lesson_unit_idx
  on learn_lesson (unit_id, position);

-- ---------------------------------------------------------------------------
-- Vocabulary — the teachable atoms of a lesson
-- ---------------------------------------------------------------------------

create table if not exists learn_vocab (
  id          bigserial primary key,
  lesson_id   bigint not null references learn_lesson(id) on delete cascade,
  -- The Igbo term in standard orthography, tone marks included. Tone is not
  -- decoration in Igbo: "ákwá" (egg) and "àkwà" (bed) are different words, so
  -- the column stores what the learner must actually reproduce.
  igbo        text not null,
  english     text not null,
  -- Free text rather than a foreign key to part_of_speech: a beginner lesson
  -- says "greeting" or "phrase", which are pedagogical categories the dictionary
  -- grammar table does not have and should not be made to carry.
  pos         text,
  -- A practical respelling for an English-speaking beginner ("keh-DOO"), not
  -- IPA. IPA is correct and unreadable to the person this course is for; the
  -- dictionary entry carries IPA for the people who want it.
  pronunciation text,
  -- The literal word-for-word reading, for idioms: "Ka ọ dị" is literally "let
  -- it be so" and knowing that is what makes it memorable.
  literal     text,
  note        text,
  audio_url   text,
  -- Optional link into the dictionary. Null is normal and expected.
  dictionary_headword text,
  position    integer not null default 100,
  created_at  timestamptz not null default now(),
  -- One row per term per lesson. Two lessons may teach the same word — a course
  -- revisits vocabulary deliberately — so this is scoped to the lesson.
  unique (lesson_id, igbo)
);

create index if not exists learn_vocab_lesson_idx
  on learn_vocab (lesson_id, position);

-- ---------------------------------------------------------------------------
-- Phrases — full sentences, which are what a learner actually says
-- ---------------------------------------------------------------------------

create table if not exists learn_phrase (
  id          bigserial primary key,
  lesson_id   bigint not null references learn_lesson(id) on delete cascade,
  igbo        text not null,
  english     text not null,
  pronunciation text,
  note        text,
  audio_url   text,
  position    integer not null default 100,
  created_at  timestamptz not null default now(),
  unique (lesson_id, igbo)
);

create index if not exists learn_phrase_lesson_idx
  on learn_phrase (lesson_id, position);

-- ---------------------------------------------------------------------------
-- Progress
-- ---------------------------------------------------------------------------

-- One row per learner per lesson, and only for signed-in learners.
--
-- Anonymous progress is deliberately NOT stored here. A visitor with no account
-- has no identity to key a row on, and inventing one from an IP or a
-- fingerprint would be storing personal data to support a feature nobody asked
-- for. Signed-out visitors can still read every lesson and sit every exercise;
-- only the record of having done so requires signing in, and the UI says so
-- before the learner invests effort rather than after.
create table if not exists learn_progress (
  account_id   bigint not null references account(id) on delete cascade,
  lesson_id    bigint not null references learn_lesson(id) on delete cascade,
  state        text not null default 'started'
               check (state in ('started', 'completed')),
  -- The best exercise score seen for this lesson, as a percentage. Best rather
  -- than latest: a learner who revisits a lesson to warm up should not lose the
  -- record of having mastered it.
  best_score   integer check (best_score between 0 and 100),
  attempts     integer not null default 0,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (account_id, lesson_id)
);

-- "How far through this course am I" reads progress for every lesson in a
-- course, so the index leads with the account and the join does the rest.
create index if not exists learn_progress_account_idx
  on learn_progress (account_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Attempts — one row per finished exercise set
-- ---------------------------------------------------------------------------

-- Kept separate from learn_progress because it is append-only history rather
-- than current state: progress is "where are you", attempts is "what happened".
-- A learner who retries a lesson five times has one progress row and five
-- attempt rows, which is the difference between a status and a log.
--
-- account_id is nullable here because an anonymous visitor may still finish an
-- exercise set, and recording the aggregate with no identity attached is useful
-- ("which lessons are hard") without storing anything about the person.
create table if not exists learn_attempt (
  id          bigserial primary key,
  account_id  bigint references account(id) on delete set null,
  lesson_id   bigint not null references learn_lesson(id) on delete cascade,
  correct     integer not null check (correct >= 0),
  total       integer not null check (total > 0),
  created_at  timestamptz not null default now(),
  check (correct <= total)
);

create index if not exists learn_attempt_lesson_idx
  on learn_attempt (lesson_id, created_at desc);
