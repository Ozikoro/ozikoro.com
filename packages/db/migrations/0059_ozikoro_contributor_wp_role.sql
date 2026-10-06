-- The WordPress role a byline carried on ozikoro.com, which the REST extractor dropped on the way in.
--
-- ── WHY THIS COLUMN EXISTS, AND WHY IT IS ON `ozikoro_contributor` RATHER THAN `account` ──────────────
--
-- The owner's report: *"i did not see the wordpress 15 users."* All fifteen are in the archive — the
-- WordPress import wrote every one of them into `ozikoro_contributor` — and what the screen could not say
-- was **what each of them was**: `author`, `editor`, `contributor`, `administrator`. That fact was in the
-- source the whole time and was thrown away twice over:
--
--   1. `normaliseUser` in `packages/ozikoro/src/import/wordpress.ts` mapped `id`, `slug`, `name`,
--      `description`, `url`, `avatar_urls` and `link` — and **not** `roles`, which the REST users endpoint
--      returns as an array. So `data/ozikoro-wp/users.json` never carried it.
--   2. `ozikoro_contributor` had no column for it, so even a verbatim import had nowhere to put it.
--
-- ⚠️ **IT IS A WORDPRESS ROLE AND NOT A PLATFORM ROLE, AND THE TWO MUST NOT BE FLATTENED.** `account.role`
-- is the shared platform's (`contributor`, `editor`, `admin`, `owner` …) and it decides who may sign in and
-- what they may do; `ozikoro_member_role` is the archive's own grant. This column records **what the person
-- was on the old site**, which is a statement about the archive's history and grants nothing at all. Eleven
-- of the fifteen can sign in nowhere — WordPress exposed no password hash, so there was nothing to migrate.
-- A screen that read this column as an access level would be inventing access for fifteen people.
--
-- ── WHY THE VOCABULARY IS CONSTRAINED, AND WHY NULL IS ALLOWED ────────────────────────────────────────
--
-- The check names WordPress's own five built-in roles, because a value outside that set would be a role
-- this archive cannot explain. **NULL is a real and expected value and is not an error**: it means the role
-- has not been read into this database yet, and the screen says exactly that rather than guessing. The
-- backfill is `packages/ozikoro/src/ops/backfill-contributor-roles.ts`, which reads the value from the
-- WordPress dump's `wpc9_usermeta` table — the only artefact that still carries it.
--
-- `add column if not exists` and a named constraint dropped before it is added, so this file can be re-run
-- against a database that already has it, which is what every migration in this directory does.

alter table ozikoro_contributor add column if not exists wp_role text;

comment on column ozikoro_contributor.wp_role is
  'The role this byline held on ozikoro.com (administrator, editor, author, contributor, subscriber). A '
  'record of the old site and NOT an access level: it grants no capability and no account. NULL means the '
  'role has not been read into this database; the screen says so rather than guessing.';

alter table ozikoro_contributor drop constraint if exists ozikoro_contributor_wp_role_check;

alter table ozikoro_contributor
  add constraint ozikoro_contributor_wp_role_check
  check (wp_role is null or wp_role in ('administrator', 'editor', 'author', 'contributor', 'subscriber'));
