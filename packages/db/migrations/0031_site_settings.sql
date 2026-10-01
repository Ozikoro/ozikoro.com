-- The things an administrator changes without a deploy.
--
-- The owner: "Admin can also edit footer, change colours of the website and practically
-- everything... change the menu, arranging and customising certain parts of the website should
-- be possible and admin can even add where ads can show, and where it can't."
--
-- Until now every one of those was a source file. A footer line was JSX, a colour was a token in
-- globals.css, the navigation was a component, and there was nowhere to put an advertisement at
-- all. So this is one key/value table for the small things and one table for the ads, because an
-- advertisement is a row with a placement and an on/off switch rather than a paragraph of text.
--
-- jsonb for the values: a footer link is a label and an href, a colour is a string, a menu is a
-- list of items, and modelling each as its own column would mean a migration for every knob.

create table if not exists site_setting (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by bigint references account(id) on delete set null
);

comment on table site_setting is
  'What an administrator can change from /admin without a deploy: the site name and tagline, the '
  'footer text and links, the colours, and the navigation. jsonb because the shapes differ.';

create table if not exists site_ad (
  id         bigserial primary key,
  -- Where it goes: header, footer, article and sidebar are the placements the layout renders.
  slot       text not null check (slot in ('header', 'footer', 'article', 'sidebar')),
  label      text not null,
  -- The markup or the network snippet, pasted by the administrator.
  html       text,
  active     boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_ad_slot_idx on site_ad (slot, position) where active;

comment on table site_ad is
  'An advertisement and where it is allowed to show. A slot with no active row renders nothing, '
  'so "nowhere" is the default state rather than something that has to be switched off.';
