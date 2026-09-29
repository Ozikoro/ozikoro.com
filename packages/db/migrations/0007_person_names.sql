-- The name dictionary: Igbo personal names.
--
-- Deliberately a table of its own rather than more rows in `word`. A personal
-- name is not a dictionary headword with a different label: it carries a
-- meaning that is a sentence ("may this child live for God"), it has an
-- associated clan or town, and it has gender semantics that ordinary vocabulary
-- does not. Modelling it as a `word` would mean every one of those columns is
-- half-empty on all 34,000 existing rows.
--
-- GENDER
--
-- The owner's rule, and the reason there is a check constraint rather than a
-- comment: every name is unisex unless the source itself uses one of the six
-- words male, female, girl, boy, man, woman. Pairs that look gendered to a
-- reader - Afunwaelotanna / Afunwaelotanne ("remember father" / "remember
-- mother"), Akunna / Akunne ("father's wealth" / "mother's wealth") - are unisex
-- by that rule, confirmed by the owner. `father` and `mother` are deliberately
-- NOT gender signals here.
--
-- The constraint enforces the vocabulary. It cannot enforce the judgement: an
-- importer could still wrongly write 'male' where the source never said so, and
-- that is a review problem, not a schema one.

create table person_name (
  id            bigserial primary key,
  language_code text not null references language(code) on delete cascade,

  -- Case preserved: the corpus distinguishes capitalised forms, the same way
  -- word.headword does. search_form is the folded key used for lookup.
  name          text not null,
  search_form   text not null,
  slug          text not null,

  meaning       text,
  gender        text not null default 'unisex',

  -- Short forms and alternate spellings, e.g. {Beluana,Gazie,Tansi}.
  variants      text[] not null default '{}',

  origin        text,
  clan          text,
  notes         text,

  source_id     bigint references source(id) on delete set null,
  external_id   text,
  status        entry_status not null default 'published',
  created_at    timestamptz not null default now(),

  constraint person_name_gender_check check (gender in ('unisex', 'male', 'female'))
);

create unique index person_name_language_slug_idx on person_name (language_code, slug);
create index person_name_language_search_idx on person_name (language_code, search_form);
create index person_name_language_gender_idx on person_name (language_code, gender);
create index person_name_source_idx on person_name (source_id);

-- Same treatment as word: names are searched the way people type them, without
-- tone marks, so the folded form needs a prefix index alongside the exact one.
create index person_name_search_prefix_idx on person_name (search_form text_pattern_ops);

-- A name is allowed to repeat across variants of a source, but the same name
-- from the same source should land once.
create unique index person_name_source_external_idx
  on person_name (source_id, external_id)
  where external_id is not null;

comment on column person_name.gender is
  'unisex | male | female. Set to male/female only when the source itself says '
  'male, female, girl, boy, man or woman; father and mother are not signals.';
