-- Where a clan is, in the present day.
--
-- The owner: "you also still retained the colonial definitions like 'awka division and other
-- divisions, instead of simply googling, find the present location and state, then add it. you must
-- clarify the towns and states the clans and towns are in. no more colonial definitions."
--
-- The clan records were built from Forde & Jones (1950), Meek (1937) and Afigbo (1981), and a 1950
-- survey locates a group by the ADMINISTRATIVE DIVISION it sat in and counts its ACTIVE ADULT MALES.
-- A reader in Anambra today is not in Onitsha Division and the count of fighting men is not a fact
-- about the town. Both are history of the record rather than description of the place.
--
-- So a clan carries the state (or states) it is in and the local government areas it falls under.
-- Arrays because both are genuinely plural: Idemili is in two LGAs, and a group that straddles a
-- state boundary has more than one state.
--
-- Deliberately additive. Nothing is dropped: the survey reference stays in `source`, where it is a
-- citation rather than a description, and the descriptions are rewritten by the import.

alter table clan add column if not exists states text[] not null default '{}';
alter table clan add column if not exists lgas   text[] not null default '{}';

create index if not exists clan_state_idx on clan using gin (states);

comment on column clan.states is
  'The Nigerian state or states the group is in today, e.g. {Anambra}. Empty means not yet researched.';
comment on column clan.lgas is
  'The local government areas the group falls under today. Empty means not yet researched.';
