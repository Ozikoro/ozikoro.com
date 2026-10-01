/**
 * The Spotify OAuth layer that can be tested without a network, a database or an
 * environment.
 *
 * These are the assertions that matter most, because they are the ones that would
 * otherwise be checked by hand against a live Spotify account and therefore never
 * checked again: that a redirect URI cannot be plain HTTP in production, that a token
 * response missing `expires_in` is refused rather than producing an `Invalid Date`,
 * that a credential cannot survive into an error message, and that the connection
 * state distinguishes "will renew itself" from "needs a person".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPOTIFY_SCOPES,
  SPOTIFY_AUTHORIZE_ENDPOINT,
  SPOTIFY_STATE_TTL_SECONDS,
  SpotifyError,
  asSpotifyError,
  buildAuthorizeUrl,
  connectionState,
  connectionStateLabel,
  expiresAtFrom,
  isRedirectUriAcceptable,
  normaliseScopes,
  parseGrantedScopes,
  parseTokenResponse,
  readSpotifyConfig,
  refreshDue,
  sanitiseSpotifyMessage,
} from './spotify.ts';

// ---------------------------------------------------------------------------
// Sanitisation — no credential survives into a message
// ---------------------------------------------------------------------------

test('a token in an error string is redacted, in every shape it arrives in', () => {
  // 1. key=value, which is how an OAuth error echoes the offending parameter
  assert.equal(
    sanitiseSpotifyMessage('invalid_request: access_token=BQ' + 'x'.repeat(60) + ' rejected'),
    'invalid_request: access_token=[redacted] rejected'
  );
  // 2. the query-string form, which is how a redirect URI gets logged by a proxy
  assert.equal(
    sanitiseSpotifyMessage('GET /callback?code=AQD9secretvalue&state=abc123'),
    'GET /callback?code=[redacted]&state=[redacted]'
  );
  // 3. a header echo
  assert.equal(
    sanitiseSpotifyMessage('Authorization: Bearer BQD1a2b3c4d5e6f7g8h9i0j'),
    'Authorization: Bearer [redacted]'
  );
  // 4. a bare long opaque string, which is what a library pastes into a message
  const bare = 'A'.repeat(20) + 'b'.repeat(20) + '0123456789';
  assert.ok(!sanitiseSpotifyMessage(`boom: ${bare}`).includes(bare));
  // and the refresh token, which is the one that matters most
  assert.equal(
    sanitiseSpotifyMessage('refresh_token=AQ' + 'y'.repeat(80)),
    'refresh_token=[redacted]'
  );
});

test('the client secret can never appear, however it is spelled', () => {
  const secret = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  for (const msg of [
    `client_secret=${secret}`,
    `client_secret: ${secret}`,
    `{"error":"bad","client_secret":"${secret}"}`,
  ]) {
    assert.ok(!sanitiseSpotifyMessage(msg).includes(secret), `leaked from: ${msg}`);
  }
});

test('a message is capped, and never multi-line', () => {
  const long = sanitiseSpotifyMessage(`start ${'word '.repeat(200)} end`);
  assert.ok(long.length <= 300, `${long.length} characters`);
  assert.ok(!long.includes('\n'));
  // Control characters cannot be smuggled into a one-line notice.
  assert.ok(!sanitiseSpotifyMessage('a\nb\u0000c').includes('\u0000'));
});

test('an empty or unreadable error still yields something a person can read', () => {
  assert.equal(sanitiseSpotifyMessage(''), 'No further detail was available.');
  assert.equal(sanitiseSpotifyMessage(null), 'No further detail was available.');
  assert.equal(sanitiseSpotifyMessage(undefined), 'No further detail was available.');
  assert.equal(sanitiseSpotifyMessage(new Error('socket hang up')), 'socket hang up');
  // Spotify's OAuth shape
  assert.equal(
    sanitiseSpotifyMessage({ error: 'invalid_grant', error_description: 'Invalid authorization code' }),
    'Invalid authorization code'
  );
  // Spotify's Web API shape — a nested object, not a string
  assert.equal(
    sanitiseSpotifyMessage({ error: { status: 401, message: 'The access token expired' } }),
    'The access token expired'
  );
});

test('asSpotifyError names an unnamed failure instead of letting it escape', () => {
  const known = new SpotifyError('not_connected', 'nothing here');
  assert.equal(asSpotifyError(known), known);

  const wrapped = asSpotifyError('something exploded', 'network');
  assert.equal(wrapped.code, 'network');
  assert.equal(wrapped.message, 'something exploded');
  // and the wrapped form is itself sanitised
  assert.ok(!asSpotifyError(`token=${'z'.repeat(50)}`).message.includes('zzzz'));
});

// ---------------------------------------------------------------------------
// Configuration — reported, not thrown, and HTTPS-only in production
// ---------------------------------------------------------------------------

test('the production redirect URI needs no configuration at all', () => {
  const config = readSpotifyConfig({});
  assert.equal(config.redirectUri, 'https://ozikoro.com/api/spotify/callback');
  assert.equal(config.clientId, null);
  assert.ok(config.problem?.includes('SPOTIFY_CLIENT_ID'));
  assert.ok(config.problem?.includes('SPOTIFY_CLIENT_SECRET'));
  assert.ok(config.problem?.includes('SPOTIFY_TOKEN_KEY'));
});

test('a fully configured environment reports no problem', () => {
  const config = readSpotifyConfig({
    SPOTIFY_CLIENT_ID: 'abc123',
    SPOTIFY_CLIENT_SECRET: 'shhh',
    SPOTIFY_TOKEN_KEY: 'k'.repeat(64),
    NODE_ENV: 'production',
  });
  assert.equal(config.problem, null);
  assert.equal(config.redirectUri, 'https://ozikoro.com/api/spotify/callback');
  assert.equal(config.tokenKeyPresent, true);
  assert.deepEqual(config.scopes, [...DEFAULT_SPOTIFY_SCOPES]);
});

test('variables are read by the names a deployment actually sets', () => {
  /*
   * The regression this guards against is silent and total. An earlier version of this
   * function read `env.clientId` while callers passed `process.env`, so every value came
   * back undefined, the integration reported itself unconfigured, and no error was raised
   * anywhere — the screen simply said "set SPOTIFY_CLIENT_ID" to a deployment that already
   * had. Asserting against `process.env` itself, rather than a hand-built object, is what
   * makes the names the real ones.
   */
  const keys = [
    'SPOTIFY_CLIENT_ID',
    'SPOTIFY_CLIENT_SECRET',
    'SPOTIFY_TOKEN_KEY',
    'SPOTIFY_REDIRECT_URI',
  ] as const;
  const saved = keys.map((key) => [key, process.env[key]] as const);
  try {
    process.env.SPOTIFY_CLIENT_ID = 'from-the-real-environment';
    process.env.SPOTIFY_CLIENT_SECRET = 'shhh';
    process.env.SPOTIFY_TOKEN_KEY = 'k'.repeat(64);
    process.env.SPOTIFY_REDIRECT_URI = 'https://staging.ozikoro.com/api/spotify/callback';

    const config = readSpotifyConfig(process.env);
    assert.equal(config.clientId, 'from-the-real-environment');
    assert.equal(config.clientSecret, 'shhh');
    assert.equal(config.tokenKeyPresent, true);
    assert.equal(config.redirectUri, 'https://staging.ozikoro.com/api/spotify/callback');
    assert.equal(config.problem, null, config.problem ?? '');
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a development environment can point at its own callback without touching production', () => {
  const dev = readSpotifyConfig({
    SPOTIFY_CLIENT_ID: 'abc123',
    SPOTIFY_CLIENT_SECRET: 'shhh',
    SPOTIFY_TOKEN_KEY: 'k'.repeat(64),
    SPOTIFY_REDIRECT_URI: 'http://localhost:3100/api/spotify/callback',
    NODE_ENV: 'development',
  });
  assert.equal(dev.problem, null);
  assert.equal(dev.redirectUri, 'http://localhost:3100/api/spotify/callback');
});

test('plain HTTP is refused in production, and only loopback HTTP is allowed elsewhere', () => {
  // The requirement is an HTTPS-only production callback. This is the assertion
  // that enforces it, rather than a comment claiming it.
  assert.equal(isRedirectUriAcceptable('https://ozikoro.com/api/spotify/callback', 'production'), true);
  assert.equal(isRedirectUriAcceptable('http://ozikoro.com/api/spotify/callback', 'production'), false);
  assert.equal(isRedirectUriAcceptable('http://localhost:3000/api/spotify/callback', 'production'), false);

  assert.equal(isRedirectUriAcceptable('http://localhost:3000/api/spotify/callback', 'development'), true);
  assert.equal(isRedirectUriAcceptable('http://127.0.0.1:3000/api/spotify/callback', 'development'), true);
  // A staging host over plain HTTP on a non-loopback address is still refused.
  assert.equal(isRedirectUriAcceptable('http://staging.ozikoro.com/api/spotify/callback', 'staging'), false);
});

test('a non-http scheme cannot be smuggled in as a redirect URI', () => {
  for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'ftp://ozikoro.com/cb', 'not a url', '']) {
    assert.equal(isRedirectUriAcceptable(uri, 'development'), false, uri);
  }
});

test('config rejects an http production redirect URI in the problem field', () => {
  const config = readSpotifyConfig({
    SPOTIFY_CLIENT_ID: 'abc',
    SPOTIFY_CLIENT_SECRET: 'shh',
    SPOTIFY_TOKEN_KEY: 'k'.repeat(64),
    SPOTIFY_REDIRECT_URI: 'http://ozikoro.com/api/spotify/callback',
    NODE_ENV: 'production',
  });
  assert.ok(config.problem?.includes('https://'), config.problem ?? 'no problem reported');
});

test('the scope list is deduped, validated, and falls back rather than emptying', () => {
  assert.deepEqual(normaliseScopes('user-read-email user-read-private'), ['user-read-email', 'user-read-private']);
  assert.deepEqual(normaliseScopes('user-read-email,user-read-email'), ['user-read-email']);
  // One malformed entry refuses the whole list. Keeping only the well-formed tokens
  // would salvage `account` out of this string, and an environment that mistyped a
  // widened grant would quietly ask Spotify for something else.
  assert.deepEqual(normaliseScopes('user-read-email; DROP TABLE account'), [...DEFAULT_SPOTIFY_SCOPES]);
  assert.deepEqual(normaliseScopes('../../etc/passwd'), [...DEFAULT_SPOTIFY_SCOPES]);
  assert.deepEqual(normaliseScopes(''), [...DEFAULT_SPOTIFY_SCOPES]);
  assert.deepEqual(normaliseScopes(undefined), [...DEFAULT_SPOTIFY_SCOPES]);
});

// ---------------------------------------------------------------------------
// The authorisation URL
// ---------------------------------------------------------------------------

test('the authorisation URL carries exactly what Spotify requires', () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: 'client-abc',
      redirectUri: 'https://ozikoro.com/api/spotify/callback',
      scopes: ['user-read-email', 'user-read-private'],
      state: 'state-value-123',
      codeChallenge: 'challenge-value-456',
    })
  );

  assert.equal(`${url.origin}${url.pathname}`, SPOTIFY_AUTHORIZE_ENDPOINT);
  assert.equal(url.searchParams.get('client_id'), 'client-abc');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://ozikoro.com/api/spotify/callback');
  assert.equal(url.searchParams.get('state'), 'state-value-123');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-value-456');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'user-read-email user-read-private');
});

test('the redirect URI survives encoding, so it matches the Dashboard byte for byte', () => {
  // A callback registered with the Dashboard is matched exactly; a URL builder that
  // mangled it would produce `redirect_uri` mismatch, which is the single most common
  // way this integration fails.
  const redirectUri = 'https://ozikoro.com/api/spotify/callback';
  const url = new URL(buildAuthorizeUrl({
    clientId: 'c', redirectUri, scopes: [], state: 's', codeChallenge: 'cc',
  }));
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.ok(url.toString().includes('redirect_uri=https%3A%2F%2Fozikoro.com%2Fapi%2Fspotify%2Fcallback'));
});

test('no scope parameter is sent when there are no scopes', () => {
  const url = new URL(
    buildAuthorizeUrl({ clientId: 'c', redirectUri: 'https://x/cb', scopes: [], state: 's', codeChallenge: 'cc' })
  );
  assert.equal(url.searchParams.has('scope'), false);
});

// ---------------------------------------------------------------------------
// The token response
// ---------------------------------------------------------------------------

test('a good token response is validated into a usable set', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const tokens = parseTokenResponse(
    {
      access_token: 'BQ-access',
      refresh_token: 'AQ-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'user-read-email user-read-private',
    },
    { now }
  );

  assert.equal(tokens.accessToken, 'BQ-access');
  assert.equal(tokens.refreshToken, 'AQ-refresh');
  assert.equal(tokens.tokenType, 'Bearer');
  assert.deepEqual(tokens.scopes, ['user-read-email', 'user-read-private']);
  assert.equal(tokens.expiresInSeconds, 3600);
  assert.equal(tokens.expiresAt, '2026-01-01T01:00:00.000Z');
});

test('a refresh response with no refresh_token keeps the stored one', () => {
  // Spotify does not always return a new refresh token. Treating that as a failure, or
  // as "the refresh token is now empty", is how a connection breaks on its first
  // automatic renewal.
  const tokens = parseTokenResponse(
    { access_token: 'BQ-new', expires_in: 3600 },
    { context: 'refresh' }
  );
  assert.equal(tokens.refreshToken, null);
  assert.equal(tokens.scopes.length, 0);
  assert.equal(tokens.tokenType, 'Bearer');
});

test('a token response missing expires_in is refused, not turned into Invalid Date', () => {
  // This is the quiet failure the validator exists for: `expires_in` absent means the
  // expiry is NaN, every `refreshDue` comparison is false, and the connection simply
  // stops working an hour later with nothing in the log.
  assert.throws(
    () => parseTokenResponse({ access_token: 'BQ-a' }),
    (error: unknown) => error instanceof SpotifyError && error.code === 'token_response_invalid'
  );
  assert.throws(
    () => parseTokenResponse({ access_token: 'BQ-a', expires_in: 0 }),
    (error: unknown) => error instanceof SpotifyError && error.code === 'token_response_invalid'
  );
  assert.throws(
    () => parseTokenResponse({ access_token: 'BQ-a', expires_in: Number.NaN }),
    (error: unknown) => error instanceof SpotifyError && error.code === 'token_response_invalid'
  );
  assert.throws(
    () => parseTokenResponse({ expires_in: 3600 }),
    (error: unknown) => error instanceof SpotifyError && error.code === 'token_response_invalid'
  );
});

test('an error body returned with a 200 is treated as the failure it is', () => {
  assert.throws(
    () => parseTokenResponse({ error: 'invalid_grant', error_description: 'Invalid authorization code' }),
    (error: unknown) => error instanceof SpotifyError && error.code === 'exchange_failed'
  );
  // On the refresh path it is named as a refresh failure, because the administrator's
  // action is different: an exchange failure is a failed connect, a refresh failure
  // means reconnect.
  assert.throws(
    () => parseTokenResponse({ error: 'invalid_grant' }, { context: 'refresh' }),
    (error: unknown) => error instanceof SpotifyError && error.code === 'refresh_failed'
  );
});

test('a non-object token response is refused rather than read', () => {
  for (const payload of [null, undefined, 'ok', 42, []]) {
    assert.throws(
      () => parseTokenResponse(payload),
      (error: unknown) => error instanceof SpotifyError,
      `accepted ${JSON.stringify(payload)}`
    );
  }
});

test('granted scopes are parsed from the single string Spotify sends', () => {
  assert.deepEqual(parseGrantedScopes('user-read-email  user-read-private'), [
    'user-read-email',
    'user-read-private',
  ]);
  assert.deepEqual(parseGrantedScopes(''), []);
  assert.deepEqual(parseGrantedScopes(undefined), []);
  assert.deepEqual(parseGrantedScopes(42), []);
});

// ---------------------------------------------------------------------------
// Expiry and renewal
// ---------------------------------------------------------------------------

test('expiry is absolute and derived from the relative lifetime', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  assert.equal(expiresAtFrom(3600, now), '2026-01-01T01:00:00.000Z');
  assert.equal(expiresAtFrom(0, now), '2026-01-01T00:00:00.000Z');
});

test('renewal is decided before the token expires, not after it fails', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const at = (seconds: number) => new Date(now + seconds * 1000).toISOString();

  // Well inside its life: use it.
  assert.equal(refreshDue(at(3600), { now }), false);
  // Inside the five-minute headroom: replace it now.
  assert.equal(refreshDue(at(299), { now }), true);
  assert.equal(refreshDue(at(301), { now }), false);
  // Already gone.
  assert.equal(refreshDue(at(-1), { now }), true);
  // Unknown or unparseable means "must refresh" — the safe direction to guess.
  assert.equal(refreshDue(null, { now }), true);
  assert.equal(refreshDue('not a date', { now }), true);
});

test('the renewal skew is configurable, which a short-lived token needs', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const expiresAt = new Date(now + 120 * 1000).toISOString();
  assert.equal(refreshDue(expiresAt, { now, skewSeconds: 300 }), true);
  assert.equal(refreshDue(expiresAt, { now, skewSeconds: 60 }), false);
});

// ---------------------------------------------------------------------------
// The state machine the admin screen reports
// ---------------------------------------------------------------------------

test('a fresh checkout is not a failure, it is "not configured"', () => {
  const state = connectionState({
    configured: false,
    connected: false,
    expiresAt: null,
    hasRefreshToken: false,
    lastError: null,
  });
  assert.equal(state, 'not_configured');
});

test('connected, renewing, unrecoverable and failed are four different things', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const at = (s: number) => new Date(now + s * 1000).toISOString();
  const base = { configured: true, connected: true, lastError: null, now };

  // Healthy, and renewable.
  assert.equal(connectionState({ ...base, expiresAt: at(3600), hasRefreshToken: true }), 'connected');
  // Expiring, but a refresh token is held — this resolves itself.
  assert.equal(
    connectionState({ ...base, expiresAt: at(60), hasRefreshToken: true }),
    'connected_expiring'
  );
  // Expired with no refresh token — the only case that needs the administrator.
  assert.equal(
    connectionState({ ...base, expiresAt: at(-60), hasRefreshToken: false }),
    'connected_unrefreshable'
  );
  // A stored failure outranks a healthy-looking token, because it is the newer fact.
  assert.equal(
    connectionState({ ...base, expiresAt: at(3600), hasRefreshToken: true, lastError: 'refresh refused' }),
    'error'
  );
  // Never connected, but something failed on the way.
  assert.equal(
    connectionState({ configured: true, connected: false, expiresAt: null, hasRefreshToken: false, lastError: 'denied' }),
    'error'
  );
  assert.equal(
    connectionState({ configured: true, connected: false, expiresAt: null, hasRefreshToken: false, lastError: null }),
    'disconnected'
  );
});

test('every state has a sentence, and none of them is empty', () => {
  const states = [
    'not_configured',
    'disconnected',
    'connected',
    'connected_expiring',
    'connected_unrefreshable',
    'error',
  ] as const;
  for (const state of states) {
    const label = connectionStateLabel(state);
    assert.ok(label.length > 0, state);
    assert.ok(!/undefined|NaN/.test(label), `${state}: ${label}`);
  }
});

// ---------------------------------------------------------------------------
// Constants the environment documentation depends on
// ---------------------------------------------------------------------------

test('the state window is short enough to not be a standing key', () => {
  // Ten minutes. Asserted so a change to it is a deliberate change with a test to update.
  assert.equal(SPOTIFY_STATE_TTL_SECONDS, 600);
});
