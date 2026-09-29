-- Editing a clan, so the gaps in the registry can be filled by the people who know.
--
-- The owner: "let editors and contributors be able to edit the clans, and fill information needed, so
-- we can be able to fill up the places we don't have information on."
--
-- The need is concrete: 196 of the 201 published clans have no state recorded, because the records
-- were built from a 1950 survey that located a group by colonial division. The people who can fill
-- that in are the ones reading the pages, and until now there was no way for them to.
--
-- Same machinery as 0020 and 0023. `clan_revision` holds what the entry said before, so a
-- correction is traceable and reversible, and the towns are recorded on both sides as a list.

alter table suggestion drop constraint if exists suggestion_kind_check;
alter table suggestion
  add constraint suggestion_kind_check
  check (kind in ('new_word', 'edit_word', 'new_definition', 'new_example',
                  'audio', 'correction', 'dialect', 'proverb_edit', 'word_edit',
                  'name_edit', 'clan_edit'));

create table clan_revision (
  id                    bigserial primary key,
  clan_id               bigint not null references clan(id) on delete cascade,
  suggestion_id         bigint references suggestion(id) on delete set null,

  previous_name         text not null,
  previous_origin       text,
  previous_description  text[],
  previous_states       text[],
  previous_lgas         text[],
  previous_towns        text[],

  name                  text not null,
  origin                text,
  description           text[],
  states                text[],
  lgas                  text[],
  towns                 text[],

  proposed_by           bigint references account(id) on delete set null,
  approved_by           bigint references account(id) on delete set null,
  approved_at           timestamptz not null default now()
);

create index clan_revision_clan_idx on clan_revision (clan_id, approved_at desc);

comment on table clan_revision is
  'Every approved edit to a clan entry — its name, where it is today, its description and its towns — '
  'with what it said before. Written before the update, so a correction is traceable and reversible.';
