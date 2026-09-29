-- The owner of the project, as a role of its own.
--
--   "make 'Idenze Ezeme' account as the main admin account, and the owner of the
--    project"
--
-- `admin` was the top of the ladder and it is a permission: it says what an account
-- may do. Ownership is not a permission, it is a fact about the project — there is one
-- owner, and the account that holds the role should be identifiable as that rather than
-- as one administrator among however many are appointed later.
--
-- Ordering matters and is the only subtle part: the owner must be able to do everything
-- an admin can, so every check written as `role = 'admin'` has to admit the owner too.
-- Postgres enums compare by declaration order, so 'owner' is added BEFORE 'admin' and
-- `role >= 'admin'` would work — but the checks in this codebase are written out
-- explicitly, and an enum's order is not a fact a reader should have to know. The
-- application compares the two roles by name, and this file only makes the value legal.
--
-- Nothing is added to the public surface. The role is visible on the account page and in
-- the admin dashboard's account list, and it is granted only by the CLI on the database
-- host — the same rule that applies to `admin`, for the same reason.

alter type account_role add value if not exists 'owner' before 'admin';

comment on type account_role is
  'What an account may do, and whether it owns the project. owner > admin > editor > '
  'contributor; the owner is the project''s founder-owner and passes every admin check.';
