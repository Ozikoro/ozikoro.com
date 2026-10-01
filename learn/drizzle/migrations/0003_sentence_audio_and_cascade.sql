-- ===========================================================================
-- Everything that needs DDL, in one paste.
-- Supabase SQL Editor -> paste all -> Run.  Idempotent; safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. PROFILES MUST NOT OUTLIVE THE ACCOUNT
--
-- `profiles.id` is a bare `uuid primary key` with no foreign key to `auth.users`, so deleting an
-- account leaves the profile row behind. A profile holds `display_name`, `native_language`,
-- `learning_reason`, `starting_level` and `settings` — personal data — and "delete my account" is a
-- right under the Nigeria Data Protection Act 2023 and GDPR. The leftover row is invisible because
-- nothing reads it once the user is gone, which is what makes it dangerous.
--
-- CASCADE, not SET NULL: a profile is not a record that someone existed, it is that person's own
-- settings, and with no account there is nothing for it to configure.
-- ---------------------------------------------------------------------------

do $$ begin
  delete from public.profiles p
   where not exists (select 1 from auth.users u where u.id = p.id);

  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_id_fkey' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. SENTENCE AUDIO
--
-- The dictionary holds 30,850 recordings of EXAMPLE SENTENCES attached to 1,083 Central Igbo words
-- — far more audio than the 497 word-level recordings. `lexemes` has one `audio_url` for the word
-- and nowhere to put the sentence recording, so that asset is unreachable.
--
-- A TABLE rather than more columns on `lexemes`, because a word has SEVERAL example sentences and
-- each may have its own recording. Columns would force one, and which one would be arbitrary.
--
-- `status` mirrors the dictionary's review: nothing here is learner-visible until it is published,
-- the same rule `lexemes` follows.
-- ---------------------------------------------------------------------------

create table if not exists public.lexeme_examples (
  id            uuid primary key default gen_random_uuid(),
  lexeme_id     uuid not null references public.lexemes(id) on delete cascade,
  position      int  not null default 0,
  text_ig       text not null,
  text_en       text,
  audio_url     text,
  status        public.content_status not null default 'draft',
  source        text,
  created_at    timestamptz not null default now(),
  unique (lexeme_id, text_ig)
);

create index if not exists lexeme_examples_lexeme_idx on public.lexeme_examples (lexeme_id);
create index if not exists lexeme_examples_status_idx on public.lexeme_examples (status);

-- Learners read published examples; nobody but the server writes them.
grant select on public.lexeme_examples to anon, authenticated;
grant all    on public.lexeme_examples to service_role;

alter table public.lexeme_examples enable row level security;

drop policy if exists "Published examples are public" on public.lexeme_examples;
create policy "Published examples are public"
  on public.lexeme_examples for select
  using (status = 'published');

drop policy if exists "Staff see all examples" on public.lexeme_examples;
create policy "Staff see all examples"
  on public.lexeme_examples for select to authenticated
  using (public.is_staff(auth.uid()));

drop policy if exists "Staff write examples" on public.lexeme_examples;
create policy "Staff write examples"
  on public.lexeme_examples for all to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

-- ---------------------------------------------------------------------------
-- Verification. Expect orphaned_profiles = 0 and a lexeme_examples row.
-- ---------------------------------------------------------------------------

select
  (select count(*)::int from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id)) as orphaned_profiles,
  (select count(*)::int from public.lexeme_examples) as example_rows,
  (select count(*)::int from information_schema.columns
    where table_name = 'lexeme_examples') as example_columns;
