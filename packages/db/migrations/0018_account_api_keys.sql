-- API access belongs to the account that asks for it.
--
-- Until now a `developer` row was created by a public form with an email in it,
-- and the site's own accounts were a separate world: someone signed in on the
-- site could not see, name, rotate or revoke a key, because nothing connected the
-- two. The owner's instruction is that API access is obtained from the dashboard
-- and nowhere else, so the link has to exist in the schema before it can exist on
-- the page.
--
-- The link is nullable and unique, because the developers created by the public
-- form are real and keep working: they simply have no account behind them until
-- their owner signs in with the same email, at which point the dashboard adopts
-- the row rather than issuing a second developer for the same person.
--
-- Email is the join key, and only for adoption. It is not a foreign key and not
-- enforced: a person may legitimately hold a developer identity under an address
-- they no longer sign in with, and refusing to adopt it would strand their keys.

alter table developer
  add column if not exists account_id bigint references account(id) on delete set null;

create unique index if not exists developer_account_unique
  on developer (account_id) where account_id is not null;

comment on column developer.account_id is
  'The site account this developer belongs to, set when its owner first opens the '
  'dashboard. Null for developers created by the public API form who have not '
  'signed in; the dashboard adopts those by matching the account email.';

-- The dashboard's own query: "is there a developer for this account, and by
-- which email do I look for an unadopted one".
create index if not exists developer_email_lower_idx on developer (lower(email));

-- What a key may be asked to do, so a key's scope is a value the dashboard can
-- offer rather than a string it makes up. Read is the default and the only scope
-- any public endpoint needs today; `suggest` exists because the contribution API
-- is already behind a key and will take writes from a client before it takes them
-- from a browser.
alter table api_key
  add column if not exists created_by_account bigint references account(id) on delete set null;

comment on column api_key.created_by_account is
  'The account that issued this key from the dashboard, where it was issued there. '
  'Kept separately from developer.account_id so a key issued before an account '
  'existed, or by a different member of the same developer, is still attributable.';
