-- Origin means where a name is borne, not where it was collected.
--
-- Three corrections from the owner, made in the schema because two of them are
-- claims the database should not be able to make at all:
--
--   1. `origin` was a free-text column sitting beside `clan` and `notes`. Nothing
--      ever reliably filled it, and the free-text shape is exactly what let
--      provenance drift into it. It is replaced by `origins`, a closed
--      vocabulary held in code (packages/core/src/regions.ts) — Nsukka, Mbaise,
--      Ngwa, Ikwerre, Anioma and the rest. An origin that is a website or a
--      compiler's name is now a value the importer and the integrity gate both
--      reject, rather than something a reviewer has to notice.
--
--      An array because a name can demonstrably be borne in more than one place,
--      and forcing a single answer would mean either discarding evidence or
--      inventing a ranking. Blank is the default and the common case: a name
--      used across all of Igboland carries no origin and its entry shows none.
--
--   2. `notes` held nothing but the importer's own provenance sentence — "Also
--      attested in: <list of websites>". That was the leak the owner objected
--      to, written into the very column a reader would see. The column is
--      dropped rather than emptied, so no future importer can put it back.
--
--   3. `clan` was never populated by any importer. Dropped as dead weight.
--
-- Provenance itself is NOT being removed from the database: `source_id` stays,
-- the `source` table stays, and the integrity gate still requires every
-- published name to name a source. It is the display that changes — the licence
-- record remains intact, it just stops being presented as if it were an origin.
--
-- Cross-variety forms are added in the same migration because they are the same
-- distinction: *Wike* is not a misspelling of *Nwike*, it is the Ikwerre form of
-- the same name, and a reader is owed the difference. Stored as
-- [{ "form": "Wike", "variety": "Ikwerre" }] rather than as loose strings in
-- `variants`, which carries no room for the label.

alter table person_name drop column if exists origin;
alter table person_name drop column if exists clan;
alter table person_name drop column if exists notes;

alter table person_name add column origins text[] not null default '{}';

alter table person_name
  add column variety_forms jsonb not null default '[]'::jsonb;

comment on column person_name.origins is
  'Igbo regions whose people bear this name, from the closed vocabulary in '
  'packages/core/src/regions.ts. Provenance does NOT belong here: this is where '
  'a name is borne, not where it was collected. Empty means unknown or '
  'pan-Igbo, and the entry then shows no Origin.';

comment on column person_name.variety_forms is
  'Forms of the same name in a neighbouring Igbo variety, as '
  '[{"form":"Wike","variety":"Ikwerre"}]. Distinct from `variants`, which are '
  'spellings of the name within the same language.';

-- The array shape is enforceable in SQL; the contents are not. A CHECK
-- constraint may not contain a subquery, so "every element is an object with a
-- form and a variety, and the variety is one we know" is checked in the
-- integrity gate instead, which is where the rest of the row-level invariants
-- live anyway.
alter table person_name add constraint person_name_variety_forms_is_array_check
  check (jsonb_typeof(variety_forms) = 'array');

-- Origins are filtered by overlap, which is what a GIN index serves.
create index person_name_origins_idx on person_name using gin (origins);
