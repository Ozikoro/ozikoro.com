-- Page views, counted by this site rather than by a third party.
--
-- The owner: "There should be page for analytics of both the main and subdomain outside the admin."
--
-- There was nothing to report: no request log, no counter, no traffic table anywhere in this
-- schema. So the page he asked for would have had to invent numbers, which is the one thing an
-- analytics page must never do. This is the smallest honest thing that makes it real — one row per
-- day, host and path, incremented in place.
--
-- Aggregated rather than one row per request, deliberately: a row per hit is a table that grows
-- without bound on a dictionary that a search engine crawls, and nobody needs to know that one
-- reader looked at one page at 14:02. What is stored is what a dashboard draws.
--
-- `host` is the key that separates the domains, so ozituma.com and learn.ozituma.com are counted
-- side by side and never mixed.

create table if not exists page_view (
  day    date not null,
  host   text not null,
  path   text not null,
  views  integer not null default 0,
  primary key (day, host, path)
);

create index if not exists page_view_day_idx on page_view (day desc);
create index if not exists page_view_host_idx on page_view (host, day desc);

comment on table page_view is
  'Page views counted first-hand, one row per day, host and path. Host separates the main site '
  'from the learn subdomain. Not a substitute for Google Analytics: it counts pages, not people, '
  'and it cannot see anything a script tag can.';
