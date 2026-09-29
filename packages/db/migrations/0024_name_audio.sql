-- Recordings for names.
--
-- The owner: "on the names section, I want to add voice records like I did for names" (for the
-- dictionary), and then, concretely: "this ada here /word/igbo/ada-2 (dictionary) is same as
-- pronunciation as this /names/ada (name), so i need voice record in the dictionary to be added to
-- the name as they are same and mean same in both name and dictionary, so copy the voice recording."
--
-- The name dictionary had no way to hold a recording at all. A name is a word said aloud, and the
-- recording is the part a reader cannot reconstruct from the spelling, so this adds one.
--
-- It is the SAME table rather than a second one. `audio` already holds recordings with exactly one
-- owner — a word, a dialect spelling, or an example — and a name recording is a fourth kind of the
-- same thing: bytes in object storage, a storage key, a speaker, a licence and a moderation status.
-- A parallel table would duplicate all of that and drift from it.
--
-- The check constraint is the only thing that has to change, because it enumerates the owners.

alter table audio add column if not exists person_name_id bigint references person_name(id) on delete cascade;

alter table audio drop constraint if exists audio_check;
alter table audio drop constraint if exists audio_owner_check;
alter table audio drop constraint if exists audio_one_owner_check;

do $$
declare
  c record;
begin
  -- The constraint is unnamed in the original migration, so it is found by what it says rather
  -- than guessed at, and every variant of the name is dropped above in case a later migration
  -- named it.
  for c in
    select conname from pg_constraint
     where conrelid = 'audio'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%num_nonnulls%'
  loop
    execute format('alter table audio drop constraint %I', c.conname);
  end loop;
end $$;

alter table audio
  add constraint audio_one_owner_check
  check (num_nonnulls(word_id, word_dialect_id, example_id, person_name_id) = 1);

create index if not exists audio_published_name_idx on audio (person_name_id) where status = 'published';
create index if not exists audio_name_any_idx on audio (person_name_id);
create unique index if not exists audio_no_duplicate_name_recording
  on audio (person_name_id, coalesce(storage_key, ''), coalesce(external_url, ''))
  where person_name_id is not null;

comment on column audio.person_name_id is
  'The personal name this recording is of, when the recording is of a name rather than a word. '
  'Set instead of word_id, word_dialect_id and example_id — exactly one owner per row.';
