-- ---------------------------------------------------------------------------
-- Capability resolution as a database function.
--
-- WHY THIS EXISTS
--
-- The brief is explicit: roles live in a dedicated table, checks happen server-side, and it names the
-- mechanism — a security-definer role function. Until this migration the resolution lived in TypeScript, in
-- `capabilitiesFor` in packages/ozikoro/src/members.ts. That worked, and `capability-check` verified that
-- every call site named a capability some role holds. But a static check is not a runtime guarantee: a route
-- that queried the archive directly and never called `requireCapability` would pass it, because the check
-- looks for call sites and a missing call site is not one.
--
-- Moving the resolution here means the DATABASE decides what a capability set is, and any query can ask it.
-- Application code cannot drift from it because there is no longer a second copy to drift.
--
-- WHY security definer, AND WHY search_path IS SET
--
-- A `security definer` function runs with the privileges of its owner rather than its caller, which is the
-- point: a capability question must be answerable without granting the caller read access to
-- `ozikoro_member_role`. That power is also the classic hazard — if the search_path is left to the caller, a
-- schema earlier in the path can shadow `ozikoro_member_role` with its own table and the function will read
-- the attacker's rows while running as its owner. **`SET search_path = public, pg_temp` is therefore not
-- decoration; it is the difference between a privileged function and a privilege-escalation primitive.**
-- `pg_temp` is named last, after `public`, so a temporary table cannot shadow a real one.
--
-- STABLE and not VOLATILE: these read tables and write nothing, so the planner may call them once per
-- statement rather than once per row.
-- ---------------------------------------------------------------------------

create or replace function ozikoro_capabilities(p_account_id bigint)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  /*
   * The rule, in one place.
   *
   *   everyone signed in reads      — 'read' is added unconditionally by the caller's membership
   *   the reader role is universal  — every account holds it without a row in ozikoro_member_role
   *   granted roles                 — whatever ozikoro_member_role says for this account
   *   account-level administration  — an account whose own role is admin or owner holds admin's
   *                                   capabilities even with no granted role, because that is how the
   *                                   first administrator exists
   */
  select distinct c.capability
    from ozikoro_role_capability c
   where c.role = 'reader'
      or c.role in (select r.role from ozikoro_member_role r where r.account_id = p_account_id)
      or (c.role = 'admin' and exists (
            select 1 from account a
             where a.id = p_account_id
               and a.role::text in ('admin', 'owner')
         ))
   union
  select 'read'
$$;

comment on function ozikoro_capabilities(bigint) is
  'Every capability an account holds. The database is the authority; application code must not restate this.';

-- ---------------------------------------------------------------------------
-- The yes/no form, for the common case.
--
-- A caller that only needs to know whether one action is allowed should not have to fetch the whole set and
-- search it. This is the function a guard should call.
-- ---------------------------------------------------------------------------
create or replace function ozikoro_has_capability(p_account_id bigint, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from ozikoro_capabilities(p_account_id) c where c = p_capability
  )
$$;

comment on function ozikoro_has_capability(bigint, text) is
  'Whether an account holds one capability. The guard every gated action should ask.';

-- ---------------------------------------------------------------------------
-- EXECUTE is granted to PUBLIC by default on a new function, which is correct here: the functions take an
-- account id and reveal only what that account may do. They do not accept an identity to act as, and they
-- cannot be made to answer for an account the caller does not already name. Revoking would break the
-- application, so the grant is stated rather than left implicit.
-- ---------------------------------------------------------------------------
grant execute on function ozikoro_capabilities(bigint) to public;
grant execute on function ozikoro_has_capability(bigint, text) to public;
