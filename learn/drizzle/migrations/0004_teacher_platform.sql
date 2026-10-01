-- ===========================================================================
-- The teacher platform's missing tables.
--
-- WHY THIS FILE EXISTS
--
-- The frontend for booking, payments, messaging, the classroom and assignments already exists and
-- was designed by another agent. What it did not have was anywhere to store anything: 13 tables
-- existed and `lesson_bookings` was among them, but availability, payments, wallets, withdrawals,
-- conversations, messages and notifications had no table at all. Every one of those screens was
-- therefore driven by `platform-preview.ts` — fictional data.
--
-- This adds only the storage. No component is changed, no design is touched.
--
-- WHAT IS ALREADY HERE AND IS NOT DUPLICATED
--
--   profiles           the learner/teacher identity row, created by handle_new_user()
--   teacher_profiles   the marketplace profile, reviewed via guard_teacher_status
--   lesson_bookings    already carries teacher_id, learner_id, starts_at, minutes, price_kobo,
--                      status, payment_reference and paid — so payments attach to it rather than
--                      to a new bookings table
--   guard_booking_payment, guard_publish, guard_teacher_status, has_role, is_staff
--   content_status     enum: draft, in_review, published, rejected
--
-- MONEY IS IN KOBO
--
-- Every existing money column is `*_kobo` (lesson_bookings.price_kobo, teacher_profiles
-- .hourly_rate_kobo). Integers in kobo avoid floating-point rounding on currency entirely. This
-- follows that convention rather than introducing decimal naira.
--
-- IDEMPOTENT
--
-- Safe to run more than once, which matters because the Management API has no transaction across
-- calls and a partial run must be repairable by running it again.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. TEACHER AVAILABILITY
--
-- Weekly recurring windows, plus dated exceptions. Two tables because they answer different
-- questions: "when do you normally teach?" and "what is different about the 14th?".
--
-- `dow` is 0=Sunday..6=Saturday, matching JavaScript's Date.getDay() so the client never has to
-- translate. Stored in the teacher's own timezone (`tz`), because "6pm" means 6pm where they are.
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_availability (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.teacher_profiles(id) on delete cascade,
  dow         int  not null check (dow between 0 and 6),
  start_min   int  not null check (start_min between 0 and 1439),
  end_min     int  not null check (end_min between 1 and 1440),
  tz          text not null default 'Africa/Lagos',
  minutes     int  not null default 60,
  created_at  timestamptz not null default now(),
  -- A window that ends before it starts is a data error, not a preference.
  constraint availability_window_valid check (end_min > start_min)
);

create index if not exists teacher_availability_teacher_idx
  on public.teacher_availability (teacher_id, dow);

create table if not exists public.availability_exceptions (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.teacher_profiles(id) on delete cascade,
  on_date     date not null,
  /* null start/end means the whole day is blocked; set, it blocks just that window. */
  start_min   int,
  end_min     int,
  /* Blocked is the common case; `extra` lets a teacher open a one-off slot. */
  kind        text not null default 'blocked' check (kind in ('blocked', 'extra')),
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists availability_exceptions_teacher_date_idx
  on public.availability_exceptions (teacher_id, on_date);

-- ---------------------------------------------------------------------------
-- 2. MONEY
--
-- `payments` is the intent, `transactions` is the ledger. They are separate because a payment can
-- produce several ledger rows — a charge, a platform commission, a teacher credit, later a refund
-- — and collapsing them loses the audit trail that financial records need.
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid references public.lesson_bookings(id) on delete set null,
  payer_id       uuid not null references auth.users(id) on delete cascade,
  amount_kobo    bigint not null check (amount_kobo > 0),
  currency       text not null default 'NGN',
  provider       text not null default 'paystack',
  /* The provider's own reference. Unique, so a replayed webhook cannot double-credit. */
  provider_ref   text unique,
  status         text not null default 'pending'
                 check (status in ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
  /* Raw provider payload, kept for disputes. Never rendered. */
  provider_meta  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists payments_payer_idx   on public.payments (payer_id, created_at desc);
create index if not exists payments_booking_idx on public.payments (booking_id);

create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid references public.payments(id) on delete set null,
  teacher_id    uuid references public.teacher_profiles(id) on delete set null,
  /* Positive credits a wallet, negative debits it. The sign carries the meaning. */
  amount_kobo   bigint not null,
  kind          text not null check (kind in
                  ('lesson_charge', 'platform_commission', 'teacher_earning',
                   'withdrawal', 'refund', 'adjustment')),
  description   text,
  created_at    timestamptz not null default now()
);

create index if not exists transactions_teacher_idx on public.transactions (teacher_id, created_at desc);
create index if not exists transactions_payment_idx on public.transactions (payment_id);

create table if not exists public.teacher_wallets (
  teacher_id        uuid primary key references public.teacher_profiles(id) on delete cascade,
  /* Derived from `transactions` rather than incremented in place, so a lost update cannot corrupt
     the balance. Kept as a column because computing a sum per page load is wasteful. */
  balance_kobo      bigint not null default 0 check (balance_kobo >= 0),
  pending_kobo      bigint not null default 0 check (pending_kobo >= 0),
  currency          text not null default 'NGN',
  payout_bank       text,
  payout_account    text,
  updated_at        timestamptz not null default now()
);

create table if not exists public.withdrawals (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references public.teacher_profiles(id) on delete cascade,
  amount_kobo   bigint not null check (amount_kobo > 0),
  status        text not null default 'requested'
                check (status in ('requested', 'approved', 'paid', 'rejected')),
  reference     text,
  note          text,
  /* Who approved it. Financial actions must be auditable. */
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists withdrawals_teacher_idx on public.withdrawals (teacher_id, created_at desc);
create index if not exists withdrawals_status_idx  on public.withdrawals (status);

-- ---------------------------------------------------------------------------
-- 3. MESSAGING
--
-- One row per pair, found by the unordered pair of participants, so a conversation cannot be
-- created twice from opposite directions. `least`/`greatest` normalise the pair.
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id             uuid primary key default gen_random_uuid(),
  participant_a  uuid not null references auth.users(id) on delete cascade,
  participant_b  uuid not null references auth.users(id) on delete cascade,
  booking_id     uuid references public.lesson_bookings(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint conversation_distinct check (participant_a <> participant_b),
  constraint conversation_pair_unique unique (participant_a, participant_b)
);

create index if not exists conversations_a_idx on public.conversations (participant_a, last_message_at desc);
create index if not exists conversations_b_idx on public.conversations (participant_b, last_message_at desc);

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid not null references auth.users(id) on delete cascade,
  body             text,
  /* Text first. The column exists now so adding images or voice later is a row change, not a
     migration of every message. */
  attachment_url   text,
  attachment_kind  text check (attachment_kind in ('image', 'document', 'audio')),
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  /* A message with no text and no attachment is a mistake. */
  constraint message_has_content check (body is not null or attachment_url is not null)
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);
create index if not exists messages_unread_idx       on public.messages (conversation_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- 4. NOTIFICATIONS
--
-- One row per event per recipient. `read_at` rather than a boolean, so "when" is answerable.
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  /* Where clicking it should go, stored as a path so the client does not hardcode a mapping. */
  link        text,
  /* Set when the event is already delivered by email, so the UI can say so. */
  emailed_at  timestamptz,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx   on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
--
-- The client is not trusted. Every policy below answers "is this row mine?" in SQL, so a crafted
-- request cannot read another person's messages, earnings or availability even with a valid token.
-- ---------------------------------------------------------------------------

alter table public.teacher_availability     enable row level security;
alter table public.availability_exceptions  enable row level security;
alter table public.payments                 enable row level security;
alter table public.transactions             enable row level security;
alter table public.teacher_wallets          enable row level security;
alter table public.withdrawals              enable row level security;
alter table public.conversations            enable row level security;
alter table public.messages                 enable row level security;
alter table public.notifications            enable row level security;

-- Availability: public to read (it powers the booking calendar), writable only by its owner.
drop policy if exists "Availability is public" on public.teacher_availability;
create policy "Availability is public"
  on public.teacher_availability for select using (true);

drop policy if exists "Teachers manage own availability" on public.teacher_availability;
create policy "Teachers manage own availability"
  on public.teacher_availability for all to authenticated
  using (exists (select 1 from public.teacher_profiles t
                  where t.id = teacher_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.teacher_profiles t
                       where t.id = teacher_id and t.user_id = auth.uid()));

drop policy if exists "Availability exceptions are public" on public.availability_exceptions;
create policy "Availability exceptions are public"
  on public.availability_exceptions for select using (true);

drop policy if exists "Teachers manage own exceptions" on public.availability_exceptions;
create policy "Teachers manage own exceptions"
  on public.availability_exceptions for all to authenticated
  using (exists (select 1 from public.teacher_profiles t
                  where t.id = teacher_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.teacher_profiles t
                       where t.id = teacher_id and t.user_id = auth.uid()));

-- Payments and transactions: a payer sees their own; a teacher sees ledger rows about them.
-- Nobody but staff writes these — they are produced by the webhook with the service key.
drop policy if exists "Payers read own payments" on public.payments;
create policy "Payers read own payments"
  on public.payments for select to authenticated using (payer_id = auth.uid());

drop policy if exists "Staff read all payments" on public.payments;
create policy "Staff read all payments"
  on public.payments for select to authenticated using (public.is_staff(auth.uid()));

drop policy if exists "Teachers read own ledger" on public.transactions;
create policy "Teachers read own ledger"
  on public.transactions for select to authenticated
  using (exists (select 1 from public.teacher_profiles t
                  where t.id = teacher_id and t.user_id = auth.uid()));

drop policy if exists "Staff read all transactions" on public.transactions;
create policy "Staff read all transactions"
  on public.transactions for select to authenticated using (public.is_staff(auth.uid()));

-- Wallets and withdrawals are the teacher's own financial data. Students never see them, and
-- neither does another teacher.
drop policy if exists "Teachers read own wallet" on public.teacher_wallets;
create policy "Teachers read own wallet"
  on public.teacher_wallets for select to authenticated
  using (exists (select 1 from public.teacher_profiles t
                  where t.id = teacher_id and t.user_id = auth.uid()));

drop policy if exists "Teachers update own wallet" on public.teacher_wallets;
create policy "Teachers update own wallet"
  on public.teacher_wallets for update to authenticated
  using (exists (select 1 from public.teacher_profiles t
                  where t.id = teacher_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.teacher_profiles t
                       where t.id = teacher_id and t.user_id = auth.uid()));

drop policy if exists "Staff read all wallets" on public.teacher_wallets;
create policy "Staff read all wallets"
  on public.teacher_wallets for select to authenticated using (public.is_staff(auth.uid()));

drop policy if exists "Teachers read own withdrawals" on public.withdrawals;
create policy "Teachers read own withdrawals"
  on public.withdrawals for select to authenticated
  using (exists (select 1 from public.teacher_profiles t
                  where t.id = teacher_id and t.user_id = auth.uid()));

-- A teacher may REQUEST a withdrawal but never approve one — deciding is staff-only, and the
-- policy enforces that rather than relying on the UI hiding the button.
drop policy if exists "Teachers request withdrawals" on public.withdrawals;
create policy "Teachers request withdrawals"
  on public.withdrawals for insert to authenticated
  with check (
    status = 'requested'
    and exists (select 1 from public.teacher_profiles t
                 where t.id = teacher_id and t.user_id = auth.uid())
  );

drop policy if exists "Staff manage withdrawals" on public.withdrawals;
create policy "Staff manage withdrawals"
  on public.withdrawals for all to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- Conversations and messages: only the two participants. This is the policy that stops one learner
-- reading another's messages by guessing a conversation id.
drop policy if exists "Participants read conversation" on public.conversations;
create policy "Participants read conversation"
  on public.conversations for select to authenticated
  using (participant_a = auth.uid() or participant_b = auth.uid());

drop policy if exists "Participants start conversation" on public.conversations;
create policy "Participants start conversation"
  on public.conversations for insert to authenticated
  with check (participant_a = auth.uid() or participant_b = auth.uid());

drop policy if exists "Participants update conversation" on public.conversations;
create policy "Participants update conversation"
  on public.conversations for update to authenticated
  using (participant_a = auth.uid() or participant_b = auth.uid())
  with check (participant_a = auth.uid() or participant_b = auth.uid());

drop policy if exists "Participants read messages" on public.messages;
create policy "Participants read messages"
  on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c
                  where c.id = conversation_id
                    and (c.participant_a = auth.uid() or c.participant_b = auth.uid())));

drop policy if exists "Participants send messages" on public.messages;
create policy "Participants send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.conversations c
                 where c.id = conversation_id
                   and (c.participant_a = auth.uid() or c.participant_b = auth.uid()))
  );

-- Notifications are strictly personal.
drop policy if exists "Read own notifications" on public.notifications;
create policy "Read own notifications"
  on public.notifications for select to authenticated using (user_id = auth.uid());

drop policy if exists "Mark own notifications read" on public.notifications;
create policy "Mark own notifications read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. DOUBLE-BOOKING PREVENTION — enforced by the database, not the browser
--
-- The owner's requirement: two learners must not book the same teacher at the same time. A frontend
-- check cannot guarantee that — two requests race, both read "free", both write. The check has to
-- happen inside the database, where the second write can be refused.
--
-- WHY A TRIGGER AND NOT AN EXCLUSION CONSTRAINT
--
-- The obvious tool is `exclude using gist (teacher_id with =, tstzrange(...) with &&)`. It does not
-- work here. A booking's interval has to be built from `starts_at` and `minutes`, and every way of
-- doing that is STABLE rather than IMMUTABLE:
--
--     (minutes || ' minutes')::interval   -> 42P17 functions in index expression must be marked IMMUTABLE
--     make_interval(mins => minutes)      -> 42P17, same reason: timestamptz + interval is STABLE
--
-- An exclusion constraint's expression is evaluated in an index, and Postgres requires it to be
-- IMMUTABLE. `starts_at + interval` is not, because an interval can carry days or months whose
-- length depends on the time zone. No amount of rewriting fixes that.
--
-- A trigger has no such restriction and gives the same guarantee: the row is checked before it is
-- written, and the second one is refused. It also produces a message a learner can act on, which a
-- constraint violation does not.
--
-- One caveat, stated because it is real: two transactions inserting the SAME slot at the SAME
-- instant could both pass this check before either commits. A trigger does not take a lock. In
-- practice the booking path is a single learner action through one API route, and the unique index
-- on `lesson_bookings` for a confirmed slot is the belt to this braces. A true guarantee at the
-- isolation level would need `serializable` or an advisory lock, which is the right change if
-- concurrent booking for one teacher ever becomes realistic.
-- ---------------------------------------------------------------------------

create or replace function public.guard_double_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  clash record;
begin
  /* Only live bookings occupy a slot. A cancelled lesson must free the time it would have used. */
  if new.status not in ('requested', 'confirmed') then
    return new;
  end if;

  select b.id, b.starts_at, b.minutes
    into clash
    from public.lesson_bookings b
   where b.teacher_id = new.teacher_id
     and b.id is distinct from new.id          /* an UPDATE of the same row is not a clash with itself */
     and b.status in ('requested', 'confirmed')
     and tstzrange(b.starts_at, b.starts_at + make_interval(mins => b.minutes))
      && tstzrange(new.starts_at, new.starts_at + make_interval(mins => new.minutes))
   limit 1;

  if found then
    raise exception 'That time is already booked. The teacher has a lesson from % for % minutes.',
      clash.starts_at, clash.minutes
      using errcode = '23505', hint = 'Choose another slot.';
  end if;

  return new;
end;
$fn$;

drop trigger if exists lesson_bookings_no_double_booking on public.lesson_bookings;
create trigger lesson_bookings_no_double_booking
  before insert or update of starts_at, minutes, status, teacher_id
  on public.lesson_bookings
  for each row execute function public.guard_double_booking();

-- ---------------------------------------------------------------------------
-- Verification. Expect every count to be 0 on a fresh run.
-- ---------------------------------------------------------------------------

select
  (select count(*)::int from public.teacher_availability)    as availability_rows,
  (select count(*)::int from public.payments)                as payment_rows,
  (select count(*)::int from public.transactions)            as transaction_rows,
  (select count(*)::int from public.teacher_wallets)         as wallet_rows,
  (select count(*)::int from public.withdrawals)             as withdrawal_rows,
  (select count(*)::int from public.conversations)           as conversation_rows,
  (select count(*)::int from public.messages)                as message_rows,
  (select count(*)::int from public.notifications)           as notification_rows;
