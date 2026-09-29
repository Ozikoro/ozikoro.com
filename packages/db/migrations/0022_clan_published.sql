-- Which peoples are ready to be shown.
--
-- The owner, 2026-09-28: "remove the ethnicities that we don't have the data yet in
-- /clans. Any Ethnicity that is not ready, dont make it visible yet. Since Igbo is
-- available... show only Igbo. until others are live, then show just the ones available."
--
-- The clans section holds 205 Igbo entries, which rest on Forde & Jones (1950), Meek
-- (1937) and Afigbo (1981) with a page reference each, and 40 entries for thirteen other
-- peoples — Yoruba, Edo, Ijaw, Itsekiri, Nupe, Idoma, Urhobo, Isoko, Efik, Ibibio, Tiv,
-- Igala, Ebira — which were proposed by a model and given one verification pass. They are
-- not the same kind of material and they should not be presented as though they were.
--
-- So "not ready" becomes a state in the data rather than a filter in the page: the rows
-- stay, the work of researching them stays to be done, and a reader sees only what has
-- been checked. When a people is researched, `published` flips — there is nothing else to
-- remember and no code to change.
--
-- Deliberately NOT deleted. The owner's rule on this project is that nothing is removed on
-- a guess, and the 40 entries are the starting point for the work, not the wrong answer.

alter table clan add column if not exists published boolean not null default false;

-- Igbo is the people we hold sourced material for.
update clan set published = true where ethnic_group = 'Igbo';

create index if not exists clan_published_idx on clan (published, ethnic_group);

comment on column clan.published is
  'True when a reader may see this entry: its material has been checked against a source. '
  'The non-Igbo entries are held until they have been researched the same way.';
