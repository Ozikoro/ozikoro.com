-- Make §5.3's lifecycle enforceable on every learn content table.
--
-- THREE PROBLEMS, ALL FOUND BY TRYING TO BUILD THE REVIEW QUEUE
--
-- 0028_learn.sql created `learn_lesson` with the narrowest possible status:
--
--     status text not null default 'draft' check (status in ('draft', 'published'))
--
-- Two states. Then 0029_learn_foundation.sql introduced §5.3's actual lifecycle -- draft,
-- submitted, in_review, linguist_approved, native_approved, published, changes_requested,
-- archived -- and applied it to `learn_lesson_section`, `learn_grammar_note` and
-- `learn_culture_note`. `learn_lesson` was left behind, because it already existed. The effect is
-- that a LESSON cannot be submitted for review at all: every other kind of content can move
-- through the eight states, and a lesson cannot leave `draft`.
--
-- The second problem is worse than the first, because it is silent. §5.3 has two rules that need
-- columns no learn table has:
--
--   * the TWO-PERSON RULE -- a linguist must not approve content they wrote -- needs to know who
--     wrote a row and who approved it.
--   * AI DRAFTS CANNOT SKIP REVIEW needs to know whether a machine produced the row.
--
-- `learn_lesson_section`, `learn_grammar_note` and `learn_culture_note` have `generation_method`
-- and `created_by`, which covers the AI rule and identifies the author. But NOTHING records WHO
-- APPROVED, on any table, so the two-person rule cannot be enforced -- and a rule that cannot be
-- enforced is a rule that will be broken. `learn_lesson` has not even `generation_method`, so an
-- AI-written lesson is indistinguishable from an authored one.
--
-- The third is a naming inconsistency rather than a missing thing: the tables that do record an
-- author call it `created_by`, while `learn_content_version` calls it `author_id`. The review layer
-- reads the content tables, so `created_by` is what it uses; `learn_content_version.author_id` is
-- left alone because it is a different table recording a different thing.
--
-- WHY THIS IS SAFE
--
-- Every change is additive or a widening. The new status set is a superset of the old, so no stored
-- row can become invalid. The new columns are nullable or defaulted, so no backfill is needed and
-- the ALTERs cannot fail on existing data. Nothing reads these columns today -- the learner-facing
-- queries in learn.ts do not filter on lesson status at all -- so the visible behaviour of the
-- platform is unchanged until the review queue starts using them.

-- ---------------------------------------------------------------------------
-- 1. A lesson can move through §5.3's lifecycle
-- ---------------------------------------------------------------------------

alter table learn_lesson drop constraint if exists learn_lesson_status_check;

alter table learn_lesson add constraint learn_lesson_status_check
  check (status in (
    'draft',
    'submitted',
    'in_review',
    'linguist_approved',
    'native_approved',
    'published',
    'changes_requested',
    'archived'
  ));

comment on column learn_lesson.status is
  'Section 5.3 lifecycle. Widened from (draft, published) by 0031 so a lesson can be submitted for '
  'review like every other kind of content. See review-workflow.ts for the transitions.';

-- ---------------------------------------------------------------------------
-- 2. `learn_lesson` gains the provenance columns the other tables already have
-- ---------------------------------------------------------------------------
--
-- `generation_method` is the load-bearing one: §5.3 says AI-generated drafts "can never skip
-- review", and a table that cannot say whether a row was machine-written cannot honour that.

alter table learn_lesson
  add column if not exists generation_method text not null default 'authored'
    check (generation_method in ('authored', 'ai'));

alter table learn_lesson add column if not exists source  text;
alter table learn_lesson add column if not exists licence text;
alter table learn_lesson add column if not exists created_by bigint references account(id) on delete set null;

comment on column learn_lesson.generation_method is
  'Section 5.3: an ''ai'' row can never skip review, whatever its status. Added by 0031 -- without '
  'it an AI-written lesson was indistinguishable from an authored one.';

-- ---------------------------------------------------------------------------
-- 3. Every content table records WHO approved, so the two-person rule is enforceable
-- ---------------------------------------------------------------------------
--
-- Two columns rather than one "approved_by", because §5.3 has TWO approval steps performed by
-- different people: a linguist approves the language, a native reviewer approves the audio and
-- naturalness. Collapsing them would make it impossible to tell whether the second step happened.
--
-- The timestamps are kept because a review queue wants to show how long something waited, and
-- because an approval with no date cannot be audited against a later edit.

do $$
declare
  t text;
begin
  foreach t in array array['learn_lesson', 'learn_lesson_section', 'learn_grammar_note', 'learn_culture_note']
  loop
    execute format(
      'alter table %I add column if not exists linguist_approved_by bigint references account(id) on delete set null', t);
    execute format(
      'alter table %I add column if not exists native_approved_by bigint references account(id) on delete set null', t);
    execute format(
      'alter table %I add column if not exists linguist_approved_at timestamptz', t);
    execute format(
      'alter table %I add column if not exists native_approved_at timestamptz', t);
  end loop;
end $$;

comment on column learn_lesson.linguist_approved_by is
  'Section 5.3''s first approval. Read back by the review layer so a linguist cannot approve their '
  'own content -- the two-person rule needs to know both who wrote it and who approved it.';
