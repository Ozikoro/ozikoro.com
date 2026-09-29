-- What each entry actually is.
--
-- The owner read the registry and said plainly that some of what it calls a clan
-- is a town, and that some clans have been split. He was right, and the fault is
-- upstream: Forde & Jones tabulates the groups a colonial division was
-- administered through, and that is not the unit an Igbo person names when asked
-- where they are from. Every entry was put to a model that knows Igbo place
-- organisation, with the three books' own answer in hand, and asked which it is.
-- The answer was blunt: of 203 entries, 120 are clans, 37 are single towns, 27 are
-- colonial sections, 12 are confederations of clans, and 7 are administrative
-- groupings.
--
-- Presenting those 83 as clans is the mistake. Deleting them would be a different
-- one — each holds material somebody can use, and the owner's standing rule is
-- that nothing is removed that he did not ask to remove. So an entry keeps its
-- place and gains two things instead:
--
--   kind       what it is, so a page can say "Town" instead of "Clan"
--   parent_id  what it belongs to, so a town sits under its clan and a clan under
--              the confederation it is part of
--
-- The hierarchy is deliberately shallow — one parent, no loops — because that is
-- all the sources and the verification support.

alter table clan
  add column if not exists kind text not null default 'clan';

alter table clan
  drop constraint if exists clan_kind_check;
alter table clan
  add constraint clan_kind_check
  check (kind in ('clan', 'town', 'section', 'confederation', 'kingdom', 'other'));

alter table clan
  add column if not exists parent_id bigint references clan(id) on delete set null;

create index if not exists clan_kind_idx   on clan (kind, position);
create index if not exists clan_parent_idx on clan (parent_id, name);

comment on column clan.kind is
  'What the entry is: clan (the unit a person names), town (a single settlement), '
  'section (a colonial administrative grouping), confederation (a federation of '
  'clans), kingdom, or other. Verified against the sources and by an independent '
  'check; a town is no longer presented as a clan.';
comment on column clan.parent_id is
  'The entry this one belongs to: a town''s clan, a clan''s confederation or '
  'section. Null when the sources place it nowhere.';
