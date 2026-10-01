-- The Spotify connection: who Ozikoro is on Spotify, and the key that proves it.
--
-- The production callback the Spotify Developer Dashboard is configured with is
-- https://ozikoro.com/api/spotify/callback. Three tables carry that flow:
--
--   spotify_oauth_state  the CSRF state, one row per attempt, single use
--   spotify_connection   the organisation's one authorised Spotify account
--   spotify_event        what happened and when, so the admin can show it
--
-- WHY THE STATE IS A TABLE AND NOT A COOKIE
--
-- A state parameter exists to prove the callback answers a request this server
-- started. The cheap version is a signed cookie holding a nonce, and it is
-- weaker than it looks: it proves only that the browser finished a flow, not
-- which administrator started one. Storing the state server-side lets the row
-- name the account that initiated it, so the callback can refuse a state that
-- was issued to somebody else, and it lets the row be CONSUMED — deleted from
-- the set of usable states the moment it is spent. A replayed callback then
-- finds nothing to consume, which is what makes replay impossible rather than
-- merely unlikely.
--
-- The state itself is never stored. Only its SHA-256 is, for the same reason
-- session tokens are hashed (see accounts.ts): a leak of this table must not
-- hand over a live credential.
--
-- WHY THE TOKENS ARE STORED AT ALL, AND ENCRYPTED
--
-- A refresh token cannot be hashed — that is the whole point of a refresh token,
-- it must be presented back to Spotify — so unlike an API key or a session it
-- has to be recoverable. It is therefore kept as AES-256-GCM ciphertext under a
-- key that lives only in the server environment (SPOTIFY_TOKEN_KEY) and never in
-- the database, the repository or a log. A database dump on its own yields
-- nothing usable. `v1.iv.tag.ciphertext` is self-describing so the format can be
-- changed later without invalidating rows already written.

-- ---------------------------------------------------------------------------
-- The CSRF state, one row per connect attempt.
-- ---------------------------------------------------------------------------
create table if not exists spotify_oauth_state (
  -- sha256(state). The state value itself is never written down.
  state_hash    text primary key,
  -- The administrator who pressed Connect. The callback refuses any state whose
  -- account is not the account presenting it.
  account_id    bigint not null references account(id) on delete cascade,
  -- PKCE, per attempt. The verifier stays server-side; only its challenge is
  -- sent to Spotify, so an intercepted authorisation code is not redeemable.
  code_verifier text not null,
  -- Recorded per attempt so a redirect URI change cannot silently redeem an
  -- authorisation code against a different address.
  redirect_uri  text not null,
  -- Where to put the administrator afterwards. Constrained to a path, never an
  -- absolute URL, so a crafted state cannot turn the callback into an open
  -- redirect.
  return_to     text,
  created_at    timestamptz not null default now(),
  -- Spotify authorisation codes are short-lived; the state is given a window of
  -- the same order. An expired row can never be used.
  expires_at    timestamptz not null,
  -- Set the moment it is redeemed. A second callback presenting the same state
  -- finds a consumed row and is refused.
  consumed_at   timestamptz
);

comment on table spotify_oauth_state is
  'One row per Spotify authorisation attempt: the hashed state, the PKCE verifier it belongs to, '
  'the account that started it, and the moment it stops being usable. Single use, short lived, '
  'and the state value itself is never stored.';

create index if not exists spotify_oauth_state_expiry_idx on spotify_oauth_state (expires_at);

-- ---------------------------------------------------------------------------
-- The connection. One row, ever.
-- ---------------------------------------------------------------------------
create table if not exists spotify_connection (
  -- A singleton, enforced rather than assumed. Ozikoro publishes as one
  -- organisation on one Spotify account, and a second row would mean two
  -- answers to "which account is connected".
  id                smallint primary key default 1 check (id = 1),
  -- The administrator who authorised it, for the audit trail. Kept if that
  -- account is deleted: the connection outlives the person who made it.
  account_id        bigint references account(id) on delete set null,

  -- Who Spotify says this is. Recorded so the admin screen can name the account
  -- instead of showing a bare "connected".
  spotify_user_id   text,
  display_name      text,
  email             text,
  product           text,
  country           text,

  -- What was actually granted, which is not always what was asked for: Spotify
  -- shows a consent screen that may be edited, and the response's `scope` is the
  -- authority. Stored per connection so the screen reports the truth.
  scopes            text[] not null default '{}',

  -- AES-256-GCM ciphertext, or null when that token was not issued. Never the
  -- token itself.
  access_token_enc  text,
  refresh_token_enc text,
  token_type        text,

  -- When the access token stops working. Refresh is driven from this rather
  -- than from a failure, so a request is not spent discovering it is too late.
  access_expires_at timestamptz,

  connected_at      timestamptz,
  last_refresh_at   timestamptz,
  -- The last time the connection was positively confirmed still good.
  last_check_at     timestamptz,

  -- A safe, human-readable summary of the last failure. Sanitised before it is
  -- written; no token, code, secret or full response body is ever stored here.
  last_error        text,
  last_error_at     timestamptz,

  disconnected_at   timestamptz,
  updated_at        timestamptz not null default now()
);

comment on table spotify_connection is
  'The one authorised Spotify account Ozikoro publishes as. Tokens are AES-256-GCM ciphertext '
  'under SPOTIFY_TOKEN_KEY; the key is never in this database. A disconnected row is kept rather '
  'than deleted so the admin can still see what was disconnected and when.';

-- ---------------------------------------------------------------------------
-- What happened, so the admin screen can show it.
-- ---------------------------------------------------------------------------
create table if not exists spotify_event (
  id         bigserial primary key,
  kind       text not null check (kind in ('connect', 'refresh', 'check', 'disconnect', 'error')),
  -- A short, safe sentence. Written for a human reading the admin screen.
  message    text not null,
  -- The technical cause when there is one, already sanitised. Never a token.
  detail     text,
  account_id bigint references account(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table spotify_event is
  'The Spotify connection history: connected, refreshed, checked, disconnected, and every refusal. '
  'Messages are written for an administrator to read and are sanitised of anything token-shaped '
  'before they are stored, because a log that can leak a credential is a liability.';

create index if not exists spotify_event_created_idx on spotify_event (created_at desc);
