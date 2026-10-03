-- One live recovery link per account, enforced by the database rather than by one function.
--
-- WHY THIS IS AN INDEX AND NOT A TABLE
--
-- Migration 0027 already gives `password_reset` everything a recovery link needs, and it says so in
-- its own comment: only the SHA-256 of the token is stored, `used_at` makes a row single-use,
-- `expires_at` makes it short-lived, and `requestPasswordReset` voids the previous open row before
-- inserting a new one. **A second table named `account_password_reset` holding the same columns
-- would be a duplicate of a fact that already has a home, and two homes for one fact drift.** The
-- flow is therefore built on 0027's table: `packages/db/src/passwords.ts` is the only writer of
-- `account.password_hash`, and this migration adds the one guarantee that was missing.
--
-- THE GAP THIS CLOSES
--
-- "Asking again voids the earlier link" is a rule inside `requestPasswordReset`, not a property of
-- the data. **A convention maintained by one function is a convention the next caller can forget**,
-- and two concurrent requests can both read, both void and both insert — leaving two working keys in
-- one inbox, which is exactly what the voiding exists to prevent. A partial unique index makes the
-- rule structural: at most one row per account with `used_at is null`.
--
-- It is PARTIAL because spent and expired rows are history. An account may accumulate any number of
-- those; only unspent ones are keys.
--
-- THE FUNCTION IS BUILT FOR IT. `requestPasswordReset` in `packages/db/src/passwords.ts` carries
-- `on conflict (account_id) where used_at is null do update`, so an index that would otherwise raise a
-- `unique_violation` when two requests overlap instead replaces the open row — the newest request wins,
-- which is the same answer the sequential path gives. **The index here is the authoritative rule; the
-- function's earlier `update` is the ordinary path that keeps history; the conflict clause is what the rule
-- does when two requests arrive at once.** Read the note above that insert before changing either.
--
-- THE REPAIR RUNS FIRST, AND IT IS NOT OPTIONAL
--
-- An environment that already holds two open rows — which is the state this migration exists to make
-- impossible — would refuse the index, and because Postgres has transactional DDL the whole migration
-- would roll back and the deployment would stop. So the oldest open rows are marked used first, which
-- is precisely what the application would have done had it noticed: the newest link is the one the
-- person most recently asked for, and that is the one they still have an email about.

with ranked as (
  select id,
         row_number() over (partition by account_id order by created_at desc, id desc) as rn
    from password_reset
   where used_at is null
)
update password_reset r
   set used_at = now()
  from ranked
 where r.id = ranked.id
   and ranked.rn > 1;

create unique index if not exists password_reset_one_open_idx
  on password_reset (account_id)
  where used_at is null;

comment on index password_reset_one_open_idx is
  'At most one unspent recovery link per account. Asking again voids the earlier one, and this index '
  'is what makes that a fact about the data rather than a habit of one function.';
