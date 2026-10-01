# Spotify

Ozikoro connects to Spotify through one authorised account. That connection is what lets
Ozikoro act on Spotify's behalf later. Today it is a secure, reusable authenticated
connection and nothing more, and this document is deliberate about that boundary: it records
how the integration is configured, what it guarantees, what it deliberately does not do, and
how to diagnose it when it fails.

## Where the code lives

| Where | What |
|---|---|
| `packages/ozikoro/src/spotify.ts` | The pure half: the authorise URL, token-response validation, expiry arithmetic, error sanitisation, config parsing. It has no `node:` imports, so a client component can import it without dragging `node:crypto` into a browser bundle, and it is testable with no setup at all. |
| `packages/ozikoro/src/connection.ts` | The server half: state storage, the code-for-token exchange, refresh, encryption, the admin view, and `spotifyApiCall`. |
| `packages/db/migrations/0034_spotify.sql` | The three tables: `spotify_oauth_state`, `spotify_connection`, `spotify_event`. |
| `apps/ozikoro/lib/access.ts` | The role guard and the request checks for the connect and callback endpoints. |
| `apps/ozikoro/lib/rate-limit.ts` | The per-client limiter on those two endpoints. |

The admin surface is in `apps/ozikoro`, the future ozikoro.com site, at `/admin/spotify`.

All of this lives in **`@ozikoro/platform`**, which only `apps/ozikoro` depends on. It is not in
`@ozituma/core` or `@ozituma/db`, so the dictionary and the courses neither carry it in their
bundles nor can import it by accident. See *The three sites* in [ARCHITECTURE.md](ARCHITECTURE.md). The
production OAuth callback is `https://ozikoro.com/api/spotify/callback`.

## What the connection is, and what it is not

The intended podcast workflow is:

```
article -> podcast script -> audio generation -> podcast metadata
        -> authorised publishing -> Spotify -> store the episode URL/ID back in Ozikoro
```

Getting OAuth access does **not** give a podcast audio upload capability. There is no OAuth
scope that grants "publish an episode", because Spotify's podcast distribution is a separate
relationship (Spotify for Creators), not part of the Web API. So the integration stops at a
secure, reusable authenticated connection, and the publishing and distribution mechanism has
to be chosen separately on its own terms. Building a fake upload call against an endpoint that
does not exist would be worse than leaving the gap visible.

The seam that is ready for that work is in `packages/ozikoro/src/connection.ts`:

- `getValidAccessToken(db)` returns a usable access token, refreshing it first when it is close
  to expiring.
- `spotifyApiCall(db, path, init)` calls the Spotify Web API with that token. `init` accepts
  `method`, `body` and `query`. It retries exactly once on HTTP 401 after forcing a token
  refresh, and for any other 4xx it returns `{ status, body }` rather than throwing, so a
  caller publishing an episode can decide for itself what a 429 means instead of unwinding.
- A second 401 after a successful refresh means the grant itself is gone, and is reported as
  `api_unauthorised` with the instruction to reconnect.

## How the flow works

The integration uses the authorisation code flow as a confidential, server-side client, with
PKCE (S256) and a CSRF `state`. It is not a public-client or implicit flow: the client secret
never leaves the server, and the PKCE verifier never leaves the server either, so an
intercepted authorisation code is not redeemable on its own.

### The state

- It is 256 bits of randomness and is held only as a SHA-256 hash. The plaintext value exists
  only in the browser's redirect and in the admin's own request; it is never stored.
- It is bound to the administrator account that started the flow.
- It is single-use. It is spent by one atomic conditional `UPDATE` (matching
  `consumed_at is null`), so two callbacks arriving at once cannot both succeed.
- It expires after 10 minutes (600 seconds).

The callback refuses a state that is unknown, expired, already spent, or issued to a different
administrator. A state presented by a different administrator is refused **without consuming
it**, so a cross-account attempt cannot burn the real administrator's attempt.

### The return path

`return_to` is constrained to a single-slash relative path. A value that could be an absolute
URL would turn the callback (a URL an attacker can make a browser visit) into an open
redirect, so anything else is rejected.

### Tokens

- Access tokens are refreshed automatically when they come within 5 minutes (300 seconds) of
  expiry, so an expired access token does not require the administrator to reconnect.
  Reconnecting is needed only when the refresh token itself is refused.
- A refresh that returns no new refresh token keeps the stored one, because discarding it
  would remove the only means of renewing ever again.
- `connected_at` is never rewritten by a refresh. It records when the administrator actually
  connected, not when the token was last renewed.
- Stored tokens are AES-256-GCM ciphertext in the `spotify_connection` table, in the format
  `v1.<iv>.<tag>.<ciphertext>`. The prefix is self-describing so the format can change later
  without invalidating rows already written. The encryption key lives only in the environment
  (`SPOTIFY_TOKEN_KEY`), never in the database, so a database dump on its own yields nothing
  usable. GCM rather than CBC means a tampered row fails to decrypt instead of decrypting to
  something else.
- Before anything is written to the `spotify_event` log or shown in the UI, messages are
  sanitised: `name=value` pairs, `Bearer <token>`, and any long token-shaped run are redacted.
  Sanitising happens on the way in to storage, not at render time, because a value that
  reached the database is already a copy of the secret.

### Disconnect

Disconnect clears the stored access and refresh tokens, which destroys Ozikoro's only copy,
and records the event. Spotify has **no token-revocation API endpoint**; it is an open feature
request at [spotify/web-api#600](https://github.com/spotify/web-api/issues/600). The
integration therefore does not call one and does not pretend to. Removing the authorisation on
Spotify's side is a manual step, and the admin UI points the administrator at
<https://www.spotify.com/account/apps> to do it.

## Environment variables

```bash
# ---------------------------------------------------------------------------
# Spotify (ozikoro.com). See docs/SPOTIFY.md.
# ---------------------------------------------------------------------------
# From the Spotify Developer Dashboard app.
SPOTIFY_CLIENT_ID=
# Server only. Never in frontend code, never committed.
SPOTIFY_CLIENT_SECRET=
# Defaults to https://ozikoro.com/api/spotify/callback, so production needs no
# configuration at all. Development and staging set their own value, and every
# value used must ALSO be added to the Dashboard allow-list.
# SPOTIFY_REDIRECT_URI=http://localhost:3100/api/spotify/callback
# 32 bytes, as 64 hex characters or base64. Generate with: openssl rand -hex 32
SPOTIFY_TOKEN_KEY=
# Optional. Defaults to: user-read-private user-read-email
# SPOTIFY_SCOPES=
```

| Variable | Required | Notes |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | yes | From the Spotify Developer Dashboard app. |
| `SPOTIFY_CLIENT_SECRET` | yes | Server only. Never in frontend code, never committed. |
| `SPOTIFY_REDIRECT_URI` | no | Defaults to `https://ozikoro.com/api/spotify/callback`. |
| `SPOTIFY_TOKEN_KEY` | yes | 32 bytes as 64 hex characters or base64. |
| `SPOTIFY_SCOPES` | no | Space- or comma-separated override of the default scope list. |

Two related variables matter for context:

- `OZITUMA_SITE_URL` is what the session cookie's `secure` flag is derived from, so a
  production instance served over plain HTTP will set a Secure cookie the browser silently
  refuses. See `apps/ozikoro/lib/session.ts`.
- `DATABASE_URL` selects the database. The Spotify tables ship in migration `0034_spotify.sql`
  and need `npm -w @ozituma/db run migrate` (or the equivalent deploy step) to exist.

### Redirect URI rules

- In production, only `https://` is accepted. Plain HTTP is refused.
- Outside production, plain HTTP is allowed only on a loopback host (`localhost`,
  `127.0.0.1`, `::1`), which is what lets a developer run the whole flow locally. An HTTP
  staging hostname is refused.
- Every URI used must also be in the Spotify Developer Dashboard allow-list, and it must match
  byte for byte. See *Troubleshooting*.

### The scope list

`SPOTIFY_SCOPES` defaults to `user-read-private user-read-email`, which is the minimum needed
to name the connected account and grant no ability to change anything. If any entry in an
override is malformed, the whole list falls back to the default rather than keeping the
well-formed entries: a scope list is a security decision, and an environment that meant to
widen the grant but mistyped it should not quietly receive a different one.

### The token key

`SPOTIFY_TOKEN_KEY` is used for AES-256-GCM encryption of stored tokens. If it is absent, the
integration fails closed: it refuses to start a connection rather than storing a token
unencrypted. A key that is not exactly 32 bytes is refused rather than stretched, because
silently accepting a short passphrase as a 256-bit key would look like encryption while
providing very little of it.

## Setup

1. Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add the redirect URI or URIs exactly, including
   `https://ozikoro.com/api/spotify/callback`. It must match byte for byte. A mismatch is the
   most common failure, and Spotify reports it as a `redirect_uri` mismatch (error
   `INVALID_CLIENT`, "Invalid redirect URI").
3. Set the environment variables on the server. `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`
   and `SPOTIFY_TOKEN_KEY` are required; `SPOTIFY_REDIRECT_URI` and `SPOTIFY_SCOPES` are
   optional. Generate the token key with `openssl rand -hex 32`.
4. Sign in to the Ozikoro admin as an administrator or owner, open the Spotify settings page,
   press Connect Spotify, and approve on Spotify.
5. The admin page then shows the status, the connected Spotify account, when it connected,
   when it was last refreshed, when it was last checked, and the recent connection history.

### Constraints of the live app as configured

Read from the Spotify Developer Dashboard for Ozikoro's app:

- **App Status: Development mode.** Only accounts on the app's own allow-list can authorise it,
  and it is not usable by the public. That is acceptable here, because the connection belongs to
  one organisational account, but anyone who needs to press Connect must be added to the app's
  user list in the Dashboard first.
- **Refresh Token Lifetime: 180 days.** The connection cannot live forever unattended. When the
  window lapses the refresh grant is refused, and the implementation already handles that the
  right way: the failure is recorded, the settings screen says to reconnect, and the stored
  tokens are not destroyed while the connection is broken.
- Spotify shipped **February 2026 development-mode changes** (see the
  [migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)),
  reported as requiring a Premium account and reducing the number of test users. Those
  specifics could not be confirmed from the documentation while writing this, so check the
  Dashboard rather than relying on them.

### What this connection does not do

It does not publish anything. Spotify has no podcast upload endpoint, so the article-to-audio
pipeline cannot use OAuth as its distribution mechanism; Spotify ingests podcasts from an RSS
feed instead. See [PODCAST-PIPELINE.md](PODCAST-PIPELINE.md) for the corrected architecture and
the obstacles that remain.

## Production security checklist

- The production callback is HTTPS only; plain HTTP is refused in production.
- OAuth state validation is enforced server-side, not in the browser.
- Session handling is reused from the existing Ozikoro account system: server-side sessions,
  hashed session tokens, and an httpOnly, `SameSite=Lax` cookie. The role check is the first
  thing every endpoint does.
- CSRF protection comes from the bound, single-use state plus the `SameSite` cookie.
- Tokens are stored as AES-256-GCM ciphertext under a key held only in the environment.
- The connect and callback endpoints are admin-only (administrator or owner role).
- Both endpoints are rate limited per client. The window lives in process memory, so with
  several instances behind a load balancer each instance allows the full quota and the real
  ceiling is multiplied by the number of instances. See `apps/ozikoro/lib/rate-limit.ts` for
  why that trade is accepted here.
- Error handling is sanitised before storage or display, and no credential appears in a log,
  an event row, or a client response.
- The client secret and the token key are server-side only and are never committed.

## Testing

The pure layer needs no database, network or environment:

```bash
npm -w @ozikoro/platform run test
```

That runs 29 tests covering URL building, token validation, expiry arithmetic, error
sanitisation, HTTPS enforcement, and config parsing.

The database and flow layer runs against a real database and a scripted Spotify (a scripted
fetch replaces the network, so the exchange and refusal paths are the production code):

```bash
npm run test:spotify
```

That runs 99 checks covering state validation and single use, a successful exchange, a denied
authorisation, a refused exchange, token refresh and rotation, a refused refresh, the admin
view, and a final sweep proving no secret is findable in any table. With the default PGlite
database, stop `npm run dev` first: PGlite is single-process, and running a CLI script while
the dev server holds `.data/pg` corrupts the directory.

## Troubleshooting

**"Not configured yet. Set ... in the server environment."**

The admin screen names the missing variables. `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and
`SPOTIFY_TOKEN_KEY` are all required before a connection can start. Set them in the server
environment and restart the process; the configuration is read from `process.env` when a
request is handled.

**The callback fails with `redirect_uri` mismatch**

Spotify reports this as `INVALID_CLIENT` and "Invalid redirect URI". The value Ozikoro sends
and the value registered in the Spotify Developer Dashboard must be identical character for
character, including the scheme, host, port, path and any trailing slash. Check both the
`SPOTIFY_REDIRECT_URI` value and that the same URI is present in the Dashboard allow-list. This
is the most common failure by a wide margin.

**`token_key_missing`**

`SPOTIFY_TOKEN_KEY` is not set, so the integration refuses to start a connection rather than
store a token unencrypted. Generate one with `openssl rand -hex 32`, set it on the server, and
restart. A key that is not exactly 32 bytes is refused rather than stretched, so the error also
appears if the value was truncated or is a passphrase rather than a key.

**A refresh is refused (`refresh_failed`)**

The refresh token itself is no longer accepted, which is the one case Spotify makes
unavoidable and the only case that needs a person. Automatic renewal cannot recover from it;
the administrator must press Connect Spotify again to establish a new grant. Common causes are
the authorisation having been removed at <https://www.spotify.com/account/apps>, a password
change, or a grant that Spotify has expired.

**An administrator is refused**

Only an administrator or the owner role may change the Spotify connection. The connection
belongs to the organisation rather than to the person who made it, so an editor is refused even
if they can review elsewhere. A signed-out visitor is sent to sign in; a signed-in
non-administrator is told plainly that this is not their area. The role check runs before
anything reads a parameter, writes a row, or calls Spotify.

## Failure codes

Every way the integration is allowed to fail has a named code, which is what the routes branch
on and what the admin screen keys its message from. The message is written for an
administrator and is safe to show. The codes, as declared in
`packages/ozikoro/src/spotify.ts`:

| Code | Meaning |
|---|---|
| `not_configured` | A required environment variable is absent. |
| `token_key_missing` | `SPOTIFY_TOKEN_KEY` is absent, so nothing may be stored. |
| `access_denied` | The administrator cancelled or denied the consent screen. |
| `state_invalid` | No state, or one this server never issued. |
| `state_expired` | A real state, past its 10-minute window. |
| `state_consumed` | A real state, already spent. |
| `state_mismatch` | A real state, issued to a different administrator. |
| `redirect_insecure` | The redirect URI is not acceptable for this environment. |
| `exchange_failed` | The code-for-token exchange was refused. |
| `refresh_failed` | The refresh grant was refused, so the administrator must reconnect. |
| `token_response_invalid` | Spotify answered with something that is not a usable token set. |
| `not_connected` | No connection exists yet. |
| `api_unauthorised` | Credentials were refused when calling the Spotify API. |
| `api_failed` | The Spotify API answered with an error. |
| `network` | The network was unreachable or timed out. |
