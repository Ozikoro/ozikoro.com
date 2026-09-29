-- Ndebe on the name dictionary.
--
-- The word dictionary has carried the Ndebe script since `word_script` was
-- filled, and the owner asked for the same on names: a name is Igbo, so it can be
-- written in the syllabary, and a reader looking at Adannaya should be able to see
-- it. The name dictionary had no place to put it.
--
-- A TABLE OF ITS OWN rather than a column on `person_name`, mirroring
-- `word_script` exactly and for the same reasons:
--
--   * the script is not a property of the name, it is one of possibly several
--     writings of it — Nsibidi, Akagu, Ajami are all in the same table for words,
--     and that is what `script_code` is for;
--   * and `notes` is where a correction is recorded. The transliterator is
--     deterministic, so every row it writes says MECHANICAL, and the integrity
--     gate re-derives those rows and fails if the stored value has drifted. A
--     human correction changes the note, which is what keeps it from being
--     silently overwritten by the next import.

create table person_name_script (
  id             bigserial primary key,
  person_name_id bigint not null references person_name(id) on delete cascade,
  script_code    text not null,          -- 'Ndebe', and whatever comes later
  value          text not null,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (person_name_id, script_code, value)
);

create index person_name_script_name_idx on person_name_script (person_name_id);
create index person_name_script_code_idx on person_name_script (script_code);

comment on table person_name_script is
  'A personal name written in another script, mirroring word_script. notes says '
  'how the value was produced: MECHANICAL rows are re-derived by the gate, so a '
  'correction has to change the note rather than differ silently.';
