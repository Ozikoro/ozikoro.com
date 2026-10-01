-- Profiles must not outlive the account they belong to.
--
-- FOUND BY TESTING, not by reading: I created a throwaway user, deleted it, and the profile row
-- stayed. `profiles.id` is a bare `uuid primary key` with no foreign key to `auth.users`, so nothing
-- removes it when the account goes.
--
-- WHY IT MATTERS BEYOND TIDINESS. "Delete my account" is a legal right under the Nigeria Data
-- Protection Act 2023 and GDPR, and a profile holds `display_name`, `native_language`,
-- `learning_reason`, `starting_level` and `settings` — personal data about the person. An account
-- deletion that leaves it behind does not satisfy the request, and the leftover row is invisible
-- because nothing in the product reads it once the user is gone.
--
-- ON DELETE CASCADE rather than SET NULL: a profile is not a record of a person who once existed,
-- it is the person's own settings. With no account there is nothing for it to configure.
--
-- Idempotent: safe to run more than once.

do $$ begin
  -- Clear orphans first, or adding the constraint fails.
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

-- Verification: this should return 0.
select count(*)::int as orphaned_profiles
  from public.profiles p
 where not exists (select 1 from auth.users u where u.id = p.id);
