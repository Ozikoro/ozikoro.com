-- Ozituma Learn — M1/M5: spaced repetition state, gamification, and the AI record.
--
-- Spec §F6 (SRS and the daily plan), §F7 (XP, streaks, badges), §8.1–§8.3 (the AI layer),
-- §9 (the data model).
--
-- WHY THE REVIEW LOG IS THE MOST IMPORTANT TABLE IN THIS FILE
--
-- §F6: "the review log must keep enough data to move to FSRS later."
--
-- Every scheduling algorithm is a guess about how memory works, and FSRS is a better guess than
-- SM-2 — but only if it has per-review history to fit against. A log that records "reviewed at,
-- next due" cannot be used for that; the information was never captured and no amount of later
-- work recovers it.
--
-- So `learn_review_log` stores what the scheduler consumed and produced: the rating, the state
-- before and after, the interval before and after, the ease before and after, the elapsed time
-- since the previous review, and whether the review was a lapse. That is exactly the input an
-- FSRS optimiser needs. `packages/core/src/srs.ts` produces these fields; this table keeps them.
--
-- WHY SRS STATE IS KEYED BY (account, item) AND NOT BY EXERCISE
--
-- §F6: "Each learner-item pair has an SRS state." The ITEM is the thing being remembered — a
-- lexeme, or a lesson's worth of them — not the question that happened to test it. If state were
-- per exercise, the same word presented as a multiple choice and as a listening question would be
-- scheduled twice and the learner would be made to answer it twice for no pedagogical reason.
-- Reviews of different exercise types therefore feed ONE state per item, which is also what makes
-- §F6's "review mixes recognition, recall, production and listening variants" work.

-- ---------------------------------------------------------------------------
-- 1. Spaced repetition (§F6)
-- ---------------------------------------------------------------------------

-- What an SRS state can be attached to. A lexeme for vocabulary; a grammar note or a culture note
-- for the things that are learned rather than memorised, which the same scheduler handles because
-- the mechanism is identical even though the interval curve may later differ.
create table if not exists learn_item_state (
  account_id   bigint not null references account(id) on delete cascade,
  item_kind    text not null check (item_kind in ('lexeme', 'grammar_note', 'culture_note')),
  item_id      bigint not null,

  -- Mirrors `ReviewState` in packages/core/src/srs.ts field for field, so the domain type
  -- round-trips without translation and the two cannot drift.
  state        text not null default 'new' check (state in ('new', 'learning', 'review', 'relearning')),
  ease         real not null default 2.5 check (ease >= 1.3),
  interval_days real not null default 0 check (interval_days >= 0),
  learning_step integer not null default 0 check (learning_step >= 0),
  repetitions  integer not null default 0 check (repetitions >= 0),
  lapses       integer not null default 0 check (lapses >= 0),
  due_at       timestamptz not null default now(),
  last_reviewed_at timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (account_id, item_kind, item_id)
);

comment on column learn_item_state.ease is
  'SM-2 ease factor, floored at 1.3. The same lower bound the domain code enforces, repeated here so a bad write cannot get past the database either.';

-- The daily plan's query: "what is due for this learner, most overdue first" (§F6). A partial
-- index keeps it small by excluding items never yet studied, which are served from a different
-- query with a different limit.
create index if not exists learn_item_state_due_idx
  on learn_item_state (account_id, due_at)
  where state <> 'new';

-- §F6: "every answer logged so the algorithm can be upgraded later."
create table if not exists learn_review_log (
  id            bigserial primary key,
  account_id    bigint not null references account(id) on delete cascade,
  item_kind     text not null,
  item_id       bigint not null,

  -- What the learner said and what the engine made of it.
  rating        text not null check (rating in ('again', 'hard', 'good', 'easy')),
  quality       integer not null check (quality between 0 and 5),
  -- The exercise that produced it, so the log can answer "which format is hardest". Nullable
  -- because a flashcard review may not correspond to a stored exercise row.
  exercise_id   bigint,
  -- §F5: "Every answer is logged with time taken and the exact response."
  elapsed_ms    integer,
  response      text,

  -- The transition. These are the fields an FSRS optimiser fits against.
  state_before  text not null,
  state_after   text not null,
  interval_before_days real not null,
  interval_after_days  real not null,
  ease_before   real not null,
  ease_after    real not null,
  elapsed_days  real,
  lapse         boolean not null default false,

  reviewed_at   timestamptz not null default now()
);

create index if not exists learn_review_log_item_idx
  on learn_review_log (account_id, item_kind, item_id, reviewed_at desc);
create index if not exists learn_review_log_recent_idx
  on learn_review_log (account_id, reviewed_at desc);

-- ---------------------------------------------------------------------------
-- 2. Gamification (§F7)
-- ---------------------------------------------------------------------------

-- §F7 acceptance: "XP and streak calculations are server-authoritative and tamper-resistant."
--
-- The defence is structural: XP is DERIVED from these event rows, and an event is only written
-- after the server has validated the thing it claims. The client never sends an amount. The
-- unique key is what makes that hold under retries — a replayed offline queue or a repeated POST
-- collides and is ignored rather than paying twice.
create table if not exists learn_xp_event (
  id          bigserial primary key,
  account_id  bigint not null references account(id) on delete cascade,
  source      text not null check (source in (
                'lesson_completed', 'exercise_correct', 'review_session_completed',
                'placement_completed', 'content_report_submitted'
              )),
  -- The lesson, exercise or session the event is about. Together with `source` this is the
  -- idempotency key.
  reference   text not null,
  amount      integer not null check (amount >= 0),
  -- True for a re-attempt of something already completed, which is worth less (§F7).
  repeat      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (account_id, source, reference)
);

create index if not exists learn_xp_event_account_idx on learn_xp_event (account_id, created_at desc);

create table if not exists learn_streak (
  account_id      bigint primary key references account(id) on delete cascade,
  current         integer not null default 0 check (current >= 0),
  longest         integer not null default 0 check (longest >= 0),
  -- A LOCAL day string in the learner's zone, not a date: §F7 requires the day to be defined in
  -- the learner's time zone, and a timestamptz cannot express "which day was that where they are".
  last_active_day date,
  freezes_available integer not null default 0 check (freezes_available between 0 and 2),
  freezes_used    integer not null default 0 check (freezes_used >= 0),
  freezes_earned  integer not null default 0 check (freezes_earned >= 0),
  updated_at      timestamptz not null default now()
);

create table if not exists learn_badge (
  id          text primary key,
  name        text not null,
  description text not null
);

create table if not exists learn_user_badge (
  account_id  bigint not null references account(id) on delete cascade,
  badge_id    text not null references learn_badge(id) on delete cascade,
  earned_at   timestamptz not null default now(),
  primary key (account_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- 3. The AI record (§8.1, §8.2, §9)
-- ---------------------------------------------------------------------------

-- §8.2: "Prompt registry — Versioned system and task prompts. Every change auditable and testable;
-- version stored on each AI message."
--
-- The prompt TEXT lives in code (`packages/core/src/ai/prompts.ts`) because it is versioned with
-- the code that renders it. This table is the registry of which versions have been RELEASED, which
-- is what makes §8.1's "Every change to model, provider or prompt MUST be run against this set and
-- results stored before release" checkable: a version with no passing evaluation row is visible as
-- an unreleased version rather than as a silent gap.
create table if not exists learn_prompt_version (
  id            text not null,
  version       integer not null,
  mode          text not null,
  -- The verbatim text, so a stored evaluation can be read against what actually ran even after the
  -- code has moved on.
  system_prompt text not null,
  max_output_tokens integer not null,
  temperature   real not null,
  released_at   timestamptz,
  created_at    timestamptz not null default now(),
  primary key (id, version)
);

-- §8.1: "log prompts for quality review with user identifiers separated and a retention limit."
--
-- "Separated" is why conversation and message rows carry the account id but the prompt text sent
-- to the provider is not joined to it in one place — a reviewer reading prompts for quality does
-- not need to know whose they were. "Retention limit" is `expires_at`, set by the writer, so a
-- sweep can delete on age without a rule having to be remembered per query.
create table if not exists learn_ai_conversation (
  id          bigserial primary key,
  account_id  bigint not null references account(id) on delete cascade,
  mode        text not null,
  -- §F8: "Context-aware of learner level and current lesson."
  lesson_id   bigint references learn_lesson(id) on delete set null,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists learn_ai_conversation_account_idx
  on learn_ai_conversation (account_id, updated_at desc);

create table if not exists learn_ai_message (
  id              bigserial primary key,
  conversation_id bigint not null references learn_ai_conversation(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null,
  -- §5.3 and §8.1: every response carries a trust label. Null for user messages.
  trust_label     text check (trust_label in ('verified', 'ai_assisted', 'community_submission', 'regional_variant', 'needs_review')),

  -- §8.2: "version stored on each AI message", plus the provider and model that produced it.
  provider_id     text,
  model           text,
  prompt_id       text,
  prompt_version  integer,
  -- The retrieved knowledge the answer was grounded in, so a disputed answer can be traced to
  -- what it was shown. §8.1's retrieval-first design is unverifiable without this.
  grounding       jsonb,
  -- §8.1: "Failed checks fall back to a safe reply." Recorded so the rate of refusals is visible.
  validation_issues jsonb,
  fell_back       boolean not null default false,

  input_tokens    integer,
  output_tokens   integer,
  latency_ms      integer,

  -- §8.1 retention limit. Set by the writer.
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists learn_ai_message_conversation_idx
  on learn_ai_message (conversation_id, created_at);
create index if not exists learn_ai_message_expiry_idx
  on learn_ai_message (expires_at) where expires_at is not null;

-- §F8: "A 'Report' button on each message writes to error_reports and creates a review task."
alter table learn_error_report
  add column if not exists ai_message_id bigint references learn_ai_message(id) on delete set null;

-- §8.1 requires an evaluation set of at least 200 cases with reference answers, written and
-- maintained by linguists, and §8.3 names the six things measured.
create table if not exists learn_eval_case (
  id          text primary key,
  category    text not null check (category in (
                'lexical_accuracy', 'orthography', 'grammar',
                'cultural_context', 'regional_variation', 'instruction_following'
              )),
  mode        text not null,
  input       text not null,
  reference_answer text not null,
  must_include jsonb not null default '[]'::jsonb,
  must_not_include jsonb not null default '[]'::jsonb,
  expected_trust text check (expected_trust in ('verified', 'unverified')),
  expect_fallback boolean not null default false,
  -- §11.5's two-person review, applied to the test set itself.
  authored_by text not null,
  reviewed_by text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists learn_eval_case_category_idx on learn_eval_case (category);

-- §8.1: "results stored before release." A report is stored whole so a release decision can be
-- read back exactly as it was made, including the caveats its own run recorded.
create table if not exists learn_eval_run (
  id            bigserial primary key,
  provider_id   text not null,
  model         text not null,
  prompt_versions jsonb not null,
  total         integer not null,
  passed        integer not null,
  failed        integer not null,
  pass_rate     real not null,
  by_category   jsonb not null,
  failures      jsonb not null default '[]'::jsonb,
  set_problems  jsonb not null default '[]'::jsonb,
  certifiable   boolean not null,
  usage         jsonb,
  ran_at        timestamptz not null default now(),
  -- §8.1: the score "is recorded in the release notes".
  release_note  text
);

create index if not exists learn_eval_run_config_idx on learn_eval_run (model, ran_at desc);

-- ---------------------------------------------------------------------------
-- 4. Platform (§9: feature flags, notifications, async jobs)
-- ---------------------------------------------------------------------------

create table if not exists learn_feature_flag (
  key         text primary key,
  enabled     boolean not null default false,
  -- §9: "staged rollout".
  rollout_percent integer not null default 0 check (rollout_percent between 0 and 100),
  description text,
  updated_at  timestamptz not null default now()
);

-- §F14: "Nothing is sent to a channel the learner has not opted into; opt-in time and channel are
-- recorded." Hence a row per channel with its own timestamp rather than one boolean.
create table if not exists learn_notification_preference (
  account_id  bigint not null references account(id) on delete cascade,
  channel     text not null check (channel in ('email', 'web_push', 'whatsapp')),
  category    text not null check (category in ('account', 'streak_reminder', 'weekly_progress', 'product')),
  opted_in    boolean not null default false,
  -- §F14: "opt-in time and channel are recorded."
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (account_id, channel, category)
);

-- §8.4: asynchronous jobs — AI drafting, audio normalisation, email delivery, analytics.
create table if not exists learn_job (
  id          bigserial primary key,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts    integer not null default 0,
  last_error  text,
  run_after   timestamptz not null default now(),
  claimed_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists learn_job_claim_idx
  on learn_job (status, run_after)
  where status in ('queued', 'running');
