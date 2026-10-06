-- Per-record SEO: the title and meta description an editor writes for one record, and the record they
-- were written for.
--
-- ── WHY THIS IS A TABLE AND NOT A COLUMN, WHICH IS THE OPPOSITE OF 0057 ────────────────────────────
--
-- Migration 0057 puts `access_tier` ON `ozikoro_article` and says why: *every reader of a record already
-- selects the record, so a property ON the row is a property no read path can fail to see.* **That reasoning
-- is about a property every read path must honour, and it does not apply here.** A record's reading tier
-- decides whether the record is served at all; an SEO override decides what two strings in the `<head>` say
-- when it is. A read path that misses an override serves the record's own title and description, which is
-- exactly what the archive did before this table existed and is a correct page.
--
-- So the two candidates were weighed on that difference:
--
--   a column pair on ozikoro_article   cheap to read, but it puts a nullable pair on the archive's central
--                                      table for a setting most records will never have, and it makes
--                                      "who changed this, and what did it say before" a question about
--                                      `ozikoro_audit` alone.
--   a table keyed by article            one row per EDITED record only, carrying its own actor and timestamps,
--                                      and the audit join is the row itself.
--
-- **The table is chosen because the override is the rare case and the actor is part of what is being
-- recorded** — this is an archive whose whole editorial tradition is "who said this, when, and on what
-- grounds", and a bare column could not answer it without a second query into a generic trail.
--
-- ── WHY `article_id` AND NOT A SLUG OR A PATH ────────────────────────────────────────────────────
--
-- The route that serves a record resolves the row FIRST and builds the address from it (`legacy_url` when the
-- WordPress record had one, `/<slug>/` otherwise). An override keyed on the address would detach the moment
-- a record moved, which is exactly the event this archive has already handled twice. A foreign key to the
-- record cannot detach, and `on delete cascade` is right here rather than `set null`: the override is ABOUT
-- the record, and an override for a record that no longer exists is not a fact worth keeping.
--
-- ── WHAT AN OVERRIDE IS NOT ──────────────────────────────────────────────────────────────────────
--
--   * IT IS NOT A PUBLICATION GATE. It does not change status, tier or visibility. A draft with an override
--     is still a draft and is still not served, and the sitemap still lists only published open records —
--     it reads `ozikoro_article` and knows nothing about this table.
--   * IT IS NOT THE SITE VERIFICATION TOKEN. That is a fact about the DOMAIN and lives in `site_setting`
--     (see `seo-verification.ts`); this is a fact about ONE RECORD.
--   * IT IS NOT A REDIRECT. The redirect manager is a separate unbuilt thing and is named as such on
--     `/admin/seo/`; nothing here changes where a record is served from.
--
-- ── THE EMPTY STRING IS NOT A VALUE, AND THE CONSTRAINT SAYS SO ──────────────────────────────────
--
-- A field left blank in the editor means "use the record's own words", which is the state of every record
-- that has no row at all. Storing `''` would be a THIRD state — a row that says an override exists and is
-- empty — and the read path would then have to decide whether to serve an empty `<title>`. The check
-- constraint refuses a row in which both fields are empty, so "an override exists" and "there is something
-- to say" cannot disagree.

-- ---------------------------------------------------------------------------
-- 1. The override.
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_record_seo (
  -- One row per record, so a second save is an update rather than a second opinion.
  article_id   bigint primary key references ozikoro_article(id) on delete cascade,

  -- The two fields the editor writes. Both nullable, because writing one and not the other is the normal
  -- case: a record whose title is already good but whose summary is not wants a description only.
  seo_title        text,
  seo_description  text,

  -- Who wrote it and when it was last touched. `on delete set null` for the same reason 0057 gives: deleting
  -- a person's account must not delete the record of what they wrote.
  updated_by   bigint references account(id) on delete set null,
  updated_at   timestamptz not null default now(),

  -- The first save's actor is kept separately from the last save's, because they answer different questions:
  -- "who decided this record's search result" and "who touched it last" are not always the same person.
  created_by   bigint references account(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint ozikoro_record_seo_not_empty
    check (nullif(btrim(coalesce(seo_title, '')), '') is not null
        or nullif(btrim(coalesce(seo_description, '')), '') is not null)
);

comment on table ozikoro_record_seo is
  'The per-record SEO override: the title and meta description an editor wrote for ONE record, replacing the '
  'record''s own title and standfirst in the head. Absent row = the record''s own words, which is the state of '
  'every record nobody has edited here. THIS IS NOT A PUBLICATION GATE and it is not the site verification '
  'token: it does not change status, tier or visibility, and the sitemap does not read it. The capability '
  'that writes it is `manage_design` — see app/api/admin/seo-records/route.ts for why that name and not a new '
  'one.';

comment on column ozikoro_record_seo.seo_title is
  'The <title> for this record, when an editor has written one. NULL means the record''s own title. There is '
  'no row-level default: the route reads this table only for a record it is about to serve, and a record with '
  'no row is served exactly as it was before this table existed.';

comment on column ozikoro_record_seo.seo_description is
  'The meta description for this record, when an editor has written one. NULL means the record''s own '
  'standfirst. An empty string is refused by the check constraint, because "no override" and "an override '
  'that says nothing" must not be two states.';

-- ---------------------------------------------------------------------------
-- 2. No capability is added, and the reason is a measurement rather than an omission.
-- ---------------------------------------------------------------------------
/*
 * THE SCREEN THAT WRITES THIS TABLE IS GATED ON `manage_design`, AND NO NEW NAME IS INVENTED FOR IT.
 *
 * `apps/ozikoro/app/api/admin/seo/route.ts` already decided this for the site-verification tokens, and the
 * reasoning transfers to a per-record override without a word changing: `manage_design` is the capability
 * the owner's other site-wide, reader-visible settings are gated on, migration 0055's rule ("an editor may
 * do everything except delete trash") already decided the site's own face is an editor's to change, and a
 * `manage_seo` would be a name held by exactly the accounts `manage_design` already admits.
 *
 * **AND THE EDITOR'S SET IS DELIBERATELY NOT RE-GRANTED HERE.** Migration 0055 grants an editor every
 * capability the vocabulary held WHEN IT RAN; 0057 declined to grow that set with two names that were not
 * editorial. This migration adds no name at all, so there is nothing to grant and nothing to decide, and an
 * editor reaching the new screen holds `manage_design` through 0055's own read-out-the-table step rather
 * than through a second grant that could drift from it.
 *
 * There is deliberately no `ozikoro_role_capability` insert in this file. That is the whole of section 2.
 */
