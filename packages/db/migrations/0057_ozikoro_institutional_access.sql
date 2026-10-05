-- Institutional access: who may read a record that is not readable without an agreement.
--
-- THE OWNER'S DECISION, AND THE FOUR ANSWERS IT SETTLES
--
-- The feature was blocked on four questions — what is gated, who grants it, on what terms, and what a
-- revocation does. The owner answered the first and the second, chose a grantor set out of the options he was
-- given, and volunteered the corporate structure that says who the parties are:
--
--   "only the admin gives institutional rights, while you decide who else since i am new to this, choose who
--    you think is better and let me know"
--
--   "Ozikoro.com is the mother company of academy, and store, while ozituma.com is subsidiary which
--    ozikoro.com owns 60% of it. Use this information to do what is right"
--
-- and then, ruling on the recommendation he was given:
--
--   "then let only the owner 'idenzeme@gmail.com' hold it since you think it is the best"
--
-- So the grantor set is the `owner` ROLE and nothing else. **Not the administrator, and not any Ozituma-side
-- role.** The single-grantor design was the owner's decision and is not a simplification taken here; the
-- failure mode it accepts — a tier that no second account can grant while the proprietor is unavailable — is
-- named in the round's report rather than worked around in this file.
--
-- ── TWO CLAIMS, AND WHY THEY MUST NOT SHARE A COLUMN, A FLAG OR A WORD ─────────────────────────────
--
-- `ozikoro_media_rights.restricted` (migration 0040) already exists and it means something else:
--
--   * `restricted = true` says **"you may read this item here, and you may not reuse it."** The archive's own
--     public sentence for it, in `rightsStatement`, is *"This item is restricted: <reason>. It is held for the
--     record but is not available for reuse."* It is a claim about REUSE.
--   * `ozikoro_article.access_tier = 'by_agreement'` says **"you may not read this at all without an
--     agreement."** It is a claim about READING.
--
-- **These are different claims, so they get different columns, different vocabulary and different words on
-- screen.** The word `restricted` is never used for the new tier anywhere a reader can see it: the reader's
-- words are "held by agreement", and the refusal page does not contain the word at all. A reader who sees
-- "restricted" is therefore always reading the reuse claim, on the media surfaces that make it.
--
-- ── WHY THE MARK IS A COLUMN ON THE RECORD AND NOT A FLAG BESIDE IT ───────────────────────────────
--
-- Same reasoning as 0056's `trashed` status: **every reader of a record already selects the record, so a
-- property ON the row is a property no read path can fail to see.** A separate table keyed by article id would
-- have to be joined by every read path, and the one that was forgotten would be a gated record still served.
-- The column is `access_tier` and it is named for what it answers — which tier of reading this record is in —
-- rather than for a permission, so no reader mistakes it for the reuse flag.
--
-- ── WHY THE GRANT IS A TABLE, AND WHY A REVOCATION IS NOT A DELETE ────────────────────────────────
--
-- A grant must answer "who granted this, when, to whom, on what terms", and a revocation must answer "who
-- withdrew it, when, and why". The archive's audit tradition already holds the first at the row level
-- (`ozikoro_audit` carries actor, before and after) and this table carries it natively: `granted_by`,
-- `granted_at`, `revoked_by`, `revoked_at` and `revocation_reason` are columns rather than an edit that
-- destroys the grant. **A grant whose revocation erased it could not answer "was this person ever allowed to
-- read it", which is the question asked after a leak.**
--
-- `entity_id` in `ozikoro_audit` deliberately has no foreign key so the trail survives a deletion; the foreign
-- keys here are `on delete set null` for the same reason — deleting a person's account must not delete the
-- record of what they were given.
--
-- THE ONE THING THAT IS UNIQUE: an account holds at most one LIVE grant. A second grant is a second decision
-- about the same person and would make "what are the terms?" have two answers. The partial unique index is
-- what enforces that, and a revoked grant leaves the index free.

-- ---------------------------------------------------------------------------
-- 1. What the record is: which tier of reading it is in.
-- ---------------------------------------------------------------------------
alter table ozikoro_article
  add column if not exists access_tier text not null default 'open';

alter table ozikoro_article drop constraint if exists ozikoro_article_access_tier_check;
alter table ozikoro_article add constraint ozikoro_article_access_tier_check
  check (access_tier in ('open', 'by_agreement'));

comment on column ozikoro_article.access_tier is
  'Which tier of reading this record is in. `open` — anyone may read it. `by_agreement` — the record cannot be '
  'read at all without an institutional access agreement, and a caller who does not hold `read_restricted` is '
  'refused by name rather than shown a 404. THIS IS A CLAIM ABOUT READING AND IS NOT THE SAME CLAIM AS '
  '`ozikoro_media_rights.restricted`, which says an item may be read here but not reused. The two share no '
  'column, no flag and no word on screen.';

create index if not exists ozikoro_article_access_tier_idx
  on ozikoro_article (access_tier) where access_tier <> 'open';

-- ---------------------------------------------------------------------------
-- 2. Who may read by agreement: the grant, with its actor, its date and its terms.
-- ---------------------------------------------------------------------------
create table if not exists ozikoro_institutional_access (
  id          bigserial primary key,

  -- The reader the agreement is for. One account, because access is asked of an account.
  account_id  bigint not null references account(id) on delete cascade,

  /*
   * The institution the agreement is with, as stated by the person recording it. FREE TEXT ON PURPOSE.
   *
   * There is no institutions table and inventing one before it has a row would block the first grant on data
   * entry. **Nothing in this repository fills this column**: a value here is a name a person typed, and the
   * refusal page never reads it, so an agreement cannot be described to a reader from a field no one checked.
   */
  holder      text not null,

  -- The instrument's own name or reference, if there is one. Optional, because a verbal permission is a
  -- permission and the archive's media rights already accept one (`verbal_permission`, migration 0040).
  instrument  text,

  -- The terms, in the words of whoever recorded them. Required: an agreement with no terms is not terms.
  terms       text not null,

  -- Who granted it, and when. SET NULL rather than CASCADE: the row outlives the account, which is the whole
  -- point of an access record.
  granted_by  bigint references account(id) on delete set null,
  granted_at  timestamptz not null default now(),

  -- The revocation, as its own fact on the same row rather than as a delete.
  revoked_at          timestamptz,
  revoked_by          bigint references account(id) on delete set null,
  revocation_reason   text,

  /*
   * A revocation states why. `revoked_by` is deliberately NOT required by a check constraint: its foreign key
   * is `on delete set null`, so a constraint that demanded it would make deleting the revoker's account
   * impossible — the trail would become the obstacle, which is the failure the audit table's own comment
   * refuses. The reason cannot be nulled that way, so that half is enforced.
   */
  constraint ozikoro_institutional_access_revocation_needs_a_reason
    check (revoked_at is null or (revocation_reason is not null and length(btrim(revocation_reason)) >= 3))
);

comment on table ozikoro_institutional_access is
  'Institutional access agreements: which account may read a record held at access_tier = by_agreement, on what '
  'terms, granted by whom, and — where it has been withdrawn — revoked by whom and why. A live grant is a row '
  'with revoked_at null; a revocation is written on the row AND to ozikoro_audit, never as an edit that erases '
  'the grant. Only the `owner` role holds the capability that writes this table (migration 0057).';

comment on column ozikoro_institutional_access.terms is
  'The terms of the agreement, in the words of whoever recorded them. Required, because a grant with no terms '
  'is an assertion rather than an instrument. The archive does not generate this text and no code fills it.';

comment on column ozikoro_institutional_access.revocation_reason is
  'Why access was withdrawn. Shown to the person who lost access by the refusal page, which says the agreement '
  'was withdrawn rather than pretending it never existed.';

-- One live grant per account. A second would make "what are the terms?" have two answers.
create unique index if not exists ozikoro_institutional_access_live_idx
  on ozikoro_institutional_access (account_id) where revoked_at is null;

create index if not exists ozikoro_institutional_access_account_idx
  on ozikoro_institutional_access (account_id, granted_at desc);

-- ---------------------------------------------------------------------------
-- 3. The capability, granted to the owner role and to nobody else.
-- ---------------------------------------------------------------------------
/*
 * TWO NAMES, AND THE SECOND ONE IS NOT DECORATION.
 *
 * `read_restricted` is the reading right: it is what a gated record asks for, and an ordinary reader holds it
 * only through a live row in the table above.
 *
 * `grant_institutional_access` is the granting right, and it is separate because the two acts are separate. A
 * reader who holds `read_restricted` may read one record; a grantor may open the tier for anybody. Making the
 * second follow from the first would mean that every reader given access could give it away.
 *
 * **BOTH ARE GRANTED TO `owner` AND TO NO OTHER ROLE.** `admin` deliberately does not hold either: an
 * institutional access agreement is an instrument about the archive's own holdings, and it is the proprietor's
 * to sign rather than an operator's. `editor` does not hold either, and that is stated rather than assumed —
 * migration 0055 grants an editor every capability the vocabulary held AT THE TIME IT RAN, and these two names
 * did not exist then, so the editor does not inherit them by that migration's read-out-the-table step. **The
 * vocabulary grew and the editor's set deliberately did not grow with it**, because neither name is editorial.
 */
insert into ozikoro_role_capability (role, capability) values
  ('owner', 'read_restricted'),
  ('owner', 'grant_institutional_access')
on conflict do nothing;

comment on table ozikoro_role_capability is
  'What each Ozikoro role may do. A table because the plan describes capabilities per role and a reviewer of '
  'this schema should be able to read them without opening the TypeScript. Since migration 0055 the rule is '
  'stated as ONE PROHIBITION rather than as a list of allowances: an editor holds every capability that '
  'existed at 0055 except purge_trash, and admin and owner hold that as well. **SINCE 0057 TWO CAPABILITIES '
  'ARE HELD BY `owner` ALONE** — read_restricted and grant_institutional_access, which together are the '
  'institutional access tier — because the proprietor signs access instruments and no operator does. A route '
  'asks for the capability by name; it does not ask what role the caller has.';

-- ---------------------------------------------------------------------------
-- 4. The capability function, extended for the owner role and for a live grant.
-- ---------------------------------------------------------------------------
/*
 * WHAT IS CHANGED, AND WHAT IS DELIBERATELY NOT.
 *
 * Migration 0043's function had three clauses. Two are untouched, and one clause is ADDED:
 *
 *   (unchanged) the reader role is universal
 *   (unchanged) roles granted in ozikoro_member_role
 *   (unchanged) an account whose own `account.role` is `admin` or `owner` holds the ADMIN role's capabilities,
 *               which is how the first administrator exists. **This is the clause that makes the shared
 *               account table matter**, and it is why the two new capabilities are on the `owner` role rather
 *               than the `admin` role: an `account.role = 'admin'` account resolves the ADMIN role's rows and
 *               therefore does not acquire them.
 *   (ADDED)     an account whose own `account.role` is `owner` also holds the OWNER role's capabilities.
 *               Nothing existing is removed by this: the owner already held the admin rows through the clause
 *               above, and this is additive. It is what makes `grant_institutional_access` resolve for the
 *               proprietor's own account — `idenzeme@gmail.com`, whose `account.role` is `owner` and whose
 *               `ozikoro_member_role` is also `owner`.
 *   (ADDED)     a live row in `ozikoro_institutional_access` carries `read_restricted`, and only that name. A
 *               grant opens reading; it does not hand over the right to grant.
 *
 * WHY THE OWNER CLAUSE IS NOT A SHORTCUT AROUND THE ROLE
 *
 * It is a binding of the platform's `owner` value to the archive's `owner` role, which is the same binding
 * 0043 made for `admin`. It does NOT name an address: **a capability attached to one email address is a
 * capability that breaks the day the address changes**, and the guard's own rule is to ask "may this caller
 * grant institutional access?" rather than "is this caller idenzeme@gmail.com?". The archive holds exactly one
 * `account.role = 'owner'` account today (measured, not assumed) and that is a fact about the data, not a
 * condition in this function.
 */
create or replace function ozikoro_capabilities(p_account_id bigint)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct c.capability
    from ozikoro_role_capability c
   where c.role = 'reader'
      or c.role in (select r.role from ozikoro_member_role r where r.account_id = p_account_id)
      or (c.role = 'admin' and exists (
            select 1 from account a
             where a.id = p_account_id
               and a.role::text in ('admin', 'owner')
         ))
      /* THE OWNER ROLE'S OWN ROWS. Additive: see the note above this function. */
      or (c.role = 'owner' and exists (
            select 1 from account a
             where a.id = p_account_id
               and a.role::text = 'owner'
         ))
   union
  select 'read'
   union
  /* A LIVE AGREEMENT IS THE READING RIGHT, AND NOTHING ELSE. */
  select 'read_restricted'
    from ozikoro_institutional_access g
   where g.account_id = p_account_id
     and g.revoked_at is null
$$;

comment on function ozikoro_capabilities(bigint) is
  'Every capability an account holds. The database is the authority; application code must not restate this. '
  'Since migration 0057 an account whose platform role is owner also holds the archive owner role''s '
  'capabilities, and a live row in ozikoro_institutional_access carries read_restricted.';

grant execute on function ozikoro_capabilities(bigint) to public;
