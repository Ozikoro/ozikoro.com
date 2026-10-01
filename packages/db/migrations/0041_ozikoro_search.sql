-- Diacritic-insensitive search over the archive and the research network.
--
-- THE PROBLEM
--
-- Nearly a third of this archive is about places and people whose names carry Igbo diacritics:
-- Ọ̀nịchạ, Ị̀kẹ̀jìànị̀, Abạ, Ẹ̀kpẹ̀yẹ̀. A reader typing "Onitsha" or "Onicha" on a phone keyboard
-- will not type the dot-below vowels, and a search that needs them is a search that fails the
-- diaspora reader the design brief names first.
--
-- The dictionary already solved this: `@ozituma/core` derives a `search_form` that folds tone and
-- dotted letters, and Ozituma is searched on it. The same fold is applied here, in SQL, so the two
-- sites agree about what "the same word" means — which is the point of sharing an orthography model
-- rather than each site inventing its own.
--
-- Postgres can do the fold natively, verified rather than assumed:
--
--     select regexp_replace(normalize('Ọ̀nịchạ Ị̀kẹ̀jìànị̀', NFD), '[\u0300-\u036f]', '', 'g');
--     -> 'Onicha Ikejiani'
--
-- `normalize(..., NFD)` decomposes the precomposed characters, and stripping the combining marks
-- leaves the base letters. That is the same operation as the JavaScript fold, done where the index
-- can use it.
--
-- WHY GENERATED COLUMNS
--
-- `stored` generated columns cannot drift from what they index: they are recomputed by the database
-- on every write, so a title edited later is searchable under its new spelling without anything
-- having to remember to update an index. The dictionary uses the same reasoning for its own search
-- forms.

-- ---------------------------------------------------------------------------
-- Articles
-- ---------------------------------------------------------------------------
alter table ozikoro_article add column if not exists folded_title text generated always as (
  lower(regexp_replace(normalize(title, NFD), '[\u0300-\u036f]', '', 'g'))
) stored;

comment on column ozikoro_article.folded_title is
  'The title with tone marks and dotted vowels folded away, so "Onicha" finds "Ọ̀nịchạ". Generated, '
  'so it cannot fall out of step with the title it indexes.';

create index if not exists ozikoro_article_folded_idx on ozikoro_article (folded_title text_pattern_ops);

-- ---------------------------------------------------------------------------
-- Entities: the knowledge graph's names and their aliases
-- ---------------------------------------------------------------------------
alter table ozikoro_entity add column if not exists folded_name text generated always as (
  lower(regexp_replace(normalize(name, NFD), '[\u0300-\u036f]', '', 'g'))
) stored;

comment on column ozikoro_entity.folded_name is
  'The entity name with diacritics folded, so a historical spelling or a missing dot-below still '
  'finds the record.';

create index if not exists ozikoro_entity_folded_idx on ozikoro_entity (folded_name text_pattern_ops);

-- ---------------------------------------------------------------------------
-- Labels: 11,056 migrated subjects, which are how the existing site is found
-- ---------------------------------------------------------------------------
alter table ozikoro_label add column if not exists folded_name text generated always as (
  lower(regexp_replace(normalize(name, NFD), '[\u0300-\u036f]', '', 'g'))
) stored;

create index if not exists ozikoro_label_folded_idx on ozikoro_label (folded_name text_pattern_ops);

-- ---------------------------------------------------------------------------
-- Publications
-- ---------------------------------------------------------------------------
alter table ozikoro_publication add column if not exists folded_title text generated always as (
  lower(regexp_replace(normalize(title, NFD), '[\u0300-\u036f]', '', 'g'))
) stored;

create index if not exists ozikoro_publication_folded_idx on ozikoro_publication (folded_title text_pattern_ops);
