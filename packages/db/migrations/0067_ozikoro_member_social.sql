-- The social handles an account publishes beside its profile.
--
-- ── WHY THIS IS A NEW TABLE, AND WHY IT IS NOT ON `account` ──────────────────────────────────────────
--
-- The owner asked: *"people should be able to edit their profiles, especially writers to change their bio,
-- or profile pictures and social media networks username."*
--
-- The bio and the picture already have homes. `ozikoro_member.bio` has existed since migration 0037 and
-- `account.avatar_url` since 0033 — a column whose own comment quotes the owner asking for this feature and
-- which nothing has ever written. **Those two are "expose a field", not "add a field".** A social handle has
-- no home anywhere in this schema, so this is the one genuinely new thing the request needs.
--
-- It goes here rather than on `account` because `account` is ONE table shared with ozituma.com and
-- academy.ozikoro.com. A column added there is a column two other live applications carry and never read,
-- and it is a migration against a table all three sites write. `ozikoro_member` already exists for exactly
-- the opposite reason — migration 0037's own header says the account is "one person, one account, three
-- sites" and that membership is "Ozikoro's own record of what that person is here". Handles are part of that
-- record, so they live on Ozikoro's side of the line, keyed to the shared account.
--
-- ── WHY `account_id` AND NOT `ozikoro_member.id` ─────────────────────────────────────────────────────
--
-- A handle belongs to a PERSON, and the account is the person: it is the thing the session resolves to and
-- the only identity a form can safely be keyed on. `ozikoro_member` is the profile those handles are drawn
-- beside, and a member row may be created by the same act that first writes a handle — so keying the handles
-- on the member row would make "save a handle" depend on "have a profile row first" for no gain. The foreign
-- key still cascades: close the account and its handles go with it.
--
-- ── WHY A ROW PER NETWORK RATHER THAN SIX COLUMNS, OR ONE `jsonb` ────────────────────────────────────
--
-- Because the set of networks is a fact the database should be able to state and a screen should be able to
-- enumerate, and because "which networks does this archive recognise" is a question a reviewer should be
-- able to answer with a query rather than by reading TypeScript. A `jsonb` column answers neither: it admits
-- any key, so a typo is stored as a network, and it holds no constraint that a handle is well formed.
--
-- ── ⚠️ THE `username` CHECK IS A SECURITY CONTROL, NOT HOUSEKEEPING ───────────────────────────────────
--
-- The address a handle is rendered to is built from a CONSTANT host in application code — `x.com/<handle>`
-- and so on — so the stored value can never change the destination of the link. That property holds only as
-- long as the stored value cannot contain a character that means something to a URL parser. `:`, `/`, `?`,
-- `#`, `\` and a space each end or alter a URL, and `@` in the middle of a path is how a Mastodon address
-- smuggles a second host into a link.
--
-- So the class is `[A-Za-z0-9._-]`, first and last character alphanumeric, at most 64 — and the check is
-- written HERE as well as in TypeScript, deliberately. A rule that lives only in the application is a rule
-- that any other writer to this table — a script, a migration, a console — can bypass, and this archive has
-- already been bitten by a validation that existed in one place and not the one that mattered. **The
-- database refuses a value that could escape the host, so the renderer's promise is true of every row that
-- can exist rather than of every row this application happens to write.**
--
-- The leading-`@` form a person actually types (`@ozikoro`) is stripped by the application before the insert;
-- it is not stored, because the address template adds whatever punctuation the network wants.
--
-- ⚠️ MASTODON IS DELIBERATELY ABSENT. A Mastodon address is `@user@instance`, and its profile URL carries a
-- host the READER supplies (`https://<instance>/@user`). Supporting it would mean the href is no longer
-- built from a constant, which is the entire security property above. Refusing it is the honest answer;
-- accepting it and validating the host against a list would be a second, weaker mechanism.

create table if not exists ozikoro_member_social (
  id         bigserial primary key,
  -- The shared platform account, which is the person. Gone with the account.
  account_id bigint not null references account(id) on delete cascade,

  /*
   * Which network. Named rather than free text so a screen can render a label and an address for every row
   * it finds, and so a value the archive cannot address is not storable. Adding one is an additive migration
   * that changes this constraint and nothing else.
   */
  network    text not null check (network in (
               'x', 'instagram', 'facebook', 'linkedin', 'youtube', 'tiktok')),

  -- The handle WITHOUT its leading `@` and without any part of the address. See the header.
  username   text not null check (username ~ '^[A-Za-z0-9]([A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One handle per network per person. A second row for the same network would be two addresses claiming to
  -- be the same account, which is the ambiguity this constraint removes rather than a case to handle.
  unique (account_id, network)
);

comment on table ozikoro_member_social is
  'The social network handles an account publishes beside its Ozikoro profile. One row per network. The '
  'address is built from a constant host in application code and the stored value is a bare handle, so no '
  'row in this table can redirect a reader to a host the archive did not choose.';

comment on column ozikoro_member_social.username is
  'A bare handle: no leading @, no address, no punctuation a URL parser reads. Constrained here as well as '
  'in the application, because the renderer builds the href from a constant host and that promise is only '
  'true if a value that could escape the host cannot be stored by any path.';

-- The read on every profile page is "the handles for this account", which the unique index above already
-- serves as its leading column; this index exists for the other direction, so "who has a handle on this
-- network" is answerable without a sequential scan as the table grows.
create index if not exists ozikoro_member_social_network_idx
  on ozikoro_member_social (network, account_id);
