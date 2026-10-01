create type public.app_role as enum ('admin', 'linguist', 'editor');
create type public.content_status as enum ('draft', 'in_review', 'published', 'rejected');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
$$;

create policy "Users see own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));
create policy "Admins manage roles" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create table public.profiles (
  id uuid primary key,
  display_name text,
  native_language text,
  learning_reason text,
  daily_goal_minutes int not null default 10,
  starting_level text not null default 'beginner',
  is_adult boolean not null default false,
  onboarded boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "Own profile read" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Own profile update" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "Own profile delete" on public.profiles for delete to authenticated using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,
  new_status text,
  created_at timestamptz not null default now()
);
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;
create policy "Staff read audit" on public.audit_log for select to authenticated using (public.is_staff(auth.uid()));

create table public.lexemes (
  id uuid primary key default gen_random_uuid(),
  headword text not null,
  tone_marked text,
  search_key text not null default '',
  part_of_speech text,
  meaning text not null,
  example_ig text,
  example_en text,
  audio_url text,
  dialect text,
  source text,
  ai_generated boolean not null default false,
  status public.content_status not null default 'draft',
  change_note text,
  author_id uuid,
  reviewer_id uuid,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lexemes_search_idx on public.lexemes (search_key);
grant select on public.lexemes to anon;
grant select, insert, update, delete on public.lexemes to authenticated;
grant all on public.lexemes to service_role;
alter table public.lexemes enable row level security;
create policy "Published lexemes are public" on public.lexemes for select to anon, authenticated using (status = 'published');
create policy "Staff read all lexemes" on public.lexemes for select to authenticated using (public.is_staff(auth.uid()));
create policy "Staff create lexemes" on public.lexemes for insert to authenticated with check (public.is_staff(auth.uid()) and author_id = auth.uid() and status in ('draft','in_review'));
create policy "Staff edit lexemes" on public.lexemes for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "Admins delete lexemes" on public.lexemes for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create table public.course_units (
  id uuid primary key default gen_random_uuid(),
  level int not null default 0,
  position int not null default 0,
  title text not null,
  status public.content_status not null default 'draft',
  change_note text,
  author_id uuid,
  reviewer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.course_units to anon;
grant select, insert, update, delete on public.course_units to authenticated;
grant all on public.course_units to service_role;
alter table public.course_units enable row level security;
create policy "Published units public" on public.course_units for select to anon, authenticated using (status = 'published');
create policy "Staff read units" on public.course_units for select to authenticated using (public.is_staff(auth.uid()));
create policy "Staff write units" on public.course_units for insert to authenticated with check (public.is_staff(auth.uid()) and status in ('draft','in_review'));
create policy "Staff update units" on public.course_units for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "Admins delete units" on public.course_units for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create table public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.course_units(id) on delete cascade,
  position int not null default 0,
  slug text not null unique,
  title text not null,
  scene text not null default '',
  objective text not null default '',
  culture_note text not null default '',
  culture_source text,
  cards jsonb not null default '[]'::jsonb,
  story jsonb not null default '[]'::jsonb,
  status public.content_status not null default 'draft',
  change_note text,
  author_id uuid,
  reviewer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.course_lessons to anon;
grant select, insert, update, delete on public.course_lessons to authenticated;
grant all on public.course_lessons to service_role;
alter table public.course_lessons enable row level security;
create policy "Published lessons public" on public.course_lessons for select to anon, authenticated using (status = 'published');
create policy "Staff read lessons" on public.course_lessons for select to authenticated using (public.is_staff(auth.uid()));
create policy "Staff write lessons" on public.course_lessons for insert to authenticated with check (public.is_staff(auth.uid()) and status in ('draft','in_review'));
create policy "Staff update lessons" on public.course_lessons for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "Admins delete lessons" on public.course_lessons for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create or replace function public.guard_publish()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('published','rejected') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if not (public.has_role(auth.uid(), 'linguist') or public.has_role(auth.uid(), 'admin')) then
      raise exception 'Only linguists or admins can publish or reject content';
    end if;
    new.reviewer_id := auth.uid();
  end if;
  new.updated_at := now();
  insert into public.audit_log (actor_id, table_name, record_id, action, new_status)
  values (auth.uid(), tg_table_name, new.id, tg_op, new.status::text);
  return new;
end $$;
create trigger lexemes_guard before insert or update on public.lexemes for each row execute function public.guard_publish();
create trigger units_guard before insert or update on public.course_units for each row execute function public.guard_publish();
create trigger lessons_guard before insert or update on public.course_lessons for each row execute function public.guard_publish();

create table public.lesson_progress (
  user_id uuid not null,
  lesson_key text not null,
  state jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_key)
);
grant select, insert, update, delete on public.lesson_progress to authenticated;
grant all on public.lesson_progress to service_role;
alter table public.lesson_progress enable row level security;
create policy "Own progress" on public.lesson_progress for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  target_type text not null,
  target_id text,
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.error_reports to authenticated;
grant all on public.error_reports to service_role;
alter table public.error_reports enable row level security;
create policy "Users file reports" on public.error_reports for insert to authenticated with check (auth.uid() = user_id);
create policy "Staff read reports" on public.error_reports for select to authenticated using (public.is_staff(auth.uid()));
create policy "Staff resolve reports" on public.error_reports for update to authenticated using (public.is_staff(auth.uid()));