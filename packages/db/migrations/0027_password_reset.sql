-- Changing a password, and getting back in when it is forgotten.
--
-- The owner asked for both and they are one subject: a password is only as good
-- as the way out of a lost one. Until now an account's password was set once at
-- registration and could never be changed by its owner at all — there was no
-- route, no form and no table. Someone who forgot theirs had no way back in and
-- no way to ask, which is the worst state for a site that asks people to sign in
-- to contribute.
--
-- TWO TABLES, NOT ONE
--
-- `password_reset` holds a recovery request. It stores the SHA-256 of the token
-- and never the token, for the same reason `auth_session` does: a leaked dump
-- then yields nothing that can be used to take an account over. The row is
-- single-use (`used_at`), short-lived (`expires_at`), and asking again voids any
-- earlier link, so an old email sitting in an inbox stops being a key.
--
-- `password_change` is the audit trail. It records that a password changed, when,
-- by whom, and how — by the owner proving the old password, by a recovery link,
-- or by an administrator setting one. It records nothing about the password
-- itself: no hash, no length, no hint. The value of the trail is answering "was
-- this me?" after the fact, and that question needs only the fact and the route.

create table password_reset (
  id               bigserial primary key,
  account_id       bigint not null references account(id) on delete cascade,
  -- sha256 of the token that went to the address; the token itself is never stored.
  token_hash       text not null unique,
  -- Where the request came from, so an unexpected one can be recognised later.
  requested_ip     inet,
  requested_agent  text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz,
  -- How the link reached them: 'email' when it was sent, 'hand' when it was not
  -- and an administrator passed it on.
  delivered_by     text check (delivered_by in ('email', 'hand'))
);

create index password_reset_account_idx on password_reset (account_id, created_at desc);
create index password_reset_open_idx    on password_reset (expires_at) where used_at is null;

comment on table password_reset is
  'One recovery request per row. Only the token hash is stored, each row is single-use, and a new '
  'request voids the previous link.';

create table password_change (
  id           bigserial primary key,
  account_id   bigint not null references account(id) on delete cascade,
  changed_at   timestamptz not null default now(),
  -- 'self'        the owner proved the current password
  -- 'recovery'    a password-reset link was used
  -- 'admin'       an administrator set it, without knowing the old one
  changed_by   text not null check (changed_by in ('self', 'recovery', 'admin')),
  actor_id     bigint references account(id) on delete set null,
  ip_address   inet
);

create index password_change_account_idx on password_change (account_id, changed_at desc);

comment on table password_change is
  'That a password changed, and how. Holds no hash, no length and no hint — only the fact, the route '
  'and the time, which is what answering "was this me?" requires.';

-- Denormalised onto the account so a page can say when the password last changed
-- without reading the trail.
alter table account add column password_changed_at timestamptz;
