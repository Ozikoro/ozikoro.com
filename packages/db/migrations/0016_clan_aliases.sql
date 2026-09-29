-- A clan's other names.
--
-- The sources name a clan after its leading town, its founders, or the whole
-- fraternity, and often give two of those in one breath: "Umunri (Nri)",
-- "Mbanasato (Awka)", "Ikwerri (Ikwerre)". The registry was importing those
-- strings as the name, which is how a reader looking for Nri — the clan half the
-- northern Igbo trace themselves to — found nothing at all, because the entry
-- was filed under Umunri.
--
-- So a clan has one NAME and any number of ALIASES, and the aliases are what a
-- reader may reasonably search for. They are stored rather than derived (there is
-- no rule that turns Umunri into Nri) and displayed, so a reader who arrives by
-- the other name can see they are in the right place.

alter table clan add column if not exists aliases text[] not null default '{}';

comment on column clan.aliases is
  'Other names this clan is known by, taken from the sources: the town that leads '
  'it, the fraternity it belongs to, or the spelling another author uses.';

-- A reader's search goes through either name, so both are indexed.
create index if not exists clan_aliases_gin_idx on clan using gin (aliases);
