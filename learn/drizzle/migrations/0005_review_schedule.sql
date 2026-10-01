-- ===========================================================================
-- Spaced repetition: the review schedule.
--
-- WHY A TABLE AND NOT localStorage
--
-- The daily plan has to survive a device change, and it has to be the same schedule on a phone and
-- a laptop. A review queue held in the browser is not a schedule; it is a copy of one, and two
-- copies disagree.
--
-- WHY SM-2 SHAPED FIELDS RATHER THAN A DUE-DATE ONLY
--
-- A single "next review" date is enough to build a queue but not enough to change it. Repetition
-- scheduling needs to know how well the item is known to decide the NEXT interval, so `ease` and
-- `interval_days` are stored alongside. They are the two numbers SuperMemo-2 needs, and they are the
-- minimum: anything less and every card advances at the same rate regardless of the learner.
--
-- WHY ONE ROW PER LEARNER PER WORD
--
-- The same dictionary entry is reviewed by many learners, each with their own history, so the
-- schedule cannot live on `lexemes`. The unique constraint is (user_id, lexeme_id) because a learner
-- has exactly one schedule per word — a second row would be two answers to one question.
-- ===========================================================================

create table if not exists public.review_schedule (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  lexeme_id     uuid not null references public.lexemes(id) on delete cascade,

  /* SuperMemo-2 state. `ease` starts at 2.5, the value the algorithm specifies. */
  ease          numeric(4,2) not null default 2.5 check (ease >= 1.3 and ease <= 5.0),
  interval_days int not null default 0 check (interval_days >= 0),
  /* How many times in a row the learner recalled it. Reset to 0 on a lapse. */
  streak        int not null default 0 check (streak >= 0),
  /* Total reviews, for "you have seen this word 12 times" and for not re-teaching a known word. */
  reviews       int not null default 0 check (reviews >= 0),
  lapses        int not null default 0 check (lapses >= 0),

  /* When it next comes up. This is the query the daily plan runs. */
  due_at        timestamptz not null default now(),
  last_reviewed_at timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint review_schedule_one_per_word unique (user_id, lexeme_id)
);

/*
 * The index the daily plan actually needs: "what is due for this learner, soonest first?".
 * A partial index on the unreviewed-past case would be narrower, but a due queue grows and shrinks
 * across the whole table, so a plain composite index serves both.
 */
create index if not exists review_schedule_due_idx
  on public.review_schedule (user_id, due_at);

alter table public.review_schedule enable row level security;

/* A schedule is private to the learner it belongs to. Nothing here is shared or public. */
drop policy if exists "Read own review schedule" on public.review_schedule;
create policy "Read own review schedule"
  on public.review_schedule for select to authenticated using (user_id = auth.uid());

drop policy if exists "Write own review schedule" on public.review_schedule;
create policy "Write own review schedule"
  on public.review_schedule for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Update own review schedule" on public.review_schedule;
create policy "Update own review schedule"
  on public.review_schedule for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Delete own review schedule" on public.review_schedule;
create policy "Delete own review schedule"
  on public.review_schedule for delete to authenticated using (user_id = auth.uid());

/* Staff may read the aggregate to see whether the feature is used, but not who is studying what. */
drop policy if exists "Staff read review counts" on public.review_schedule;
create policy "Staff read review counts"
  on public.review_schedule for select to authenticated using (public.is_staff(auth.uid()));

-- Verification.
select
  (select count(*)::int from public.review_schedule) as review_rows,
  (select count(*)::int from pg_policies where tablename = 'review_schedule') as policies;
