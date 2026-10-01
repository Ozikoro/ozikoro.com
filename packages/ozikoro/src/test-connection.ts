/**
 * The Spotify connection, exercised against a real database and a scripted Spotify.
 *
 * WHAT THIS IS TESTING, AND WHY IT IS NOT A UNIT TEST
 *
 * The pure parts — URL building, token validation, expiry arithmetic, error sanitisation —
 * are covered by `packages/core/src/spotify.test.ts`, which needs nothing. What is left is
 * the part that can only be wrong in ways a unit test cannot see: whether a state is
 * actually single-use against the database, whether a token really is ciphertext on disk,
 * whether a refresh preserves the connection's history, and whether a refused exchange
 * leaves a secret in a log. Those need a database and a scripted server, which is what this
 * script provides.
 *
 * The scripted fetch replaces the network entirely, so the "successful token exchange" and
 * "Spotify refused" cases are both real paths through the production code rather than
 * mocked-out ones.
 *
 * Run with: npm -w @ozituma/db run test:spotify
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import {
  checkSpotifyConnection,
  completeSpotifyCallback,
  consumeSpotifyAuthorization,
  decryptToken,
  disconnectSpotify,
  encryptToken,
  generateOAuthState,
  getValidAccessToken,
  hashOAuthState,
  listSpotifyEvents,
  readSpotifyConnectionRow,
  recordSpotifyEvent,
  safeReturnPath,
  spotifyApiCall,
  spotifyConfig,
  spotifyConnectionView,
  startSpotifyAuthorization,
  type SpotifyFetch,
  type SpotifyHttpResponse,
} from './connection.ts';
import { SpotifyError } from './spotify.ts';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const CLIENT_ID = 'test-spotify-client-id';
const CLIENT_SECRET = 'test-spotify-client-secret-value';
const TOKEN_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const REDIRECT_URI = 'https://ozikoro.com/api/spotify/callback';

const REAL_ACCESS_TOKEN = 'BQ-real-access-token-value-that-must-never-be-stored-in-plaintext';
const REAL_REFRESH_TOKEN = 'AQ-real-refresh-token-value-that-must-never-be-stored-in-plaintext';
const ROTATED_ACCESS_TOKEN = 'BQ-rotated-access-token-value';
const ROTATED_REFRESH_TOKEN = 'AQ-rotated-refresh-token-value';

process.env.SPOTIFY_CLIENT_ID = CLIENT_ID;
process.env.SPOTIFY_CLIENT_SECRET = CLIENT_SECRET;
process.env.SPOTIFY_TOKEN_KEY = TOKEN_KEY;
process.env.SPOTIFY_REDIRECT_URI = REDIRECT_URI;
delete process.env.SPOTIFY_SCOPES;

const db = await getDb();
let failures = 0;

const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Assert that a call fails with a named code, rather than merely failing. */
const refuses = async (label: string, run: () => Promise<unknown>, code: string) => {
  try {
    await run();
    assert(label, false, 'it was allowed');
  } catch (error) {
    const actual = error instanceof SpotifyError ? error.code : '';
    assert(label, actual === code, actual || (error as Error).message);
  }
};

// ---------------------------------------------------------------------------
// A scripted Spotify
// ---------------------------------------------------------------------------

interface ScriptedBody {
  status?: number;
  body: unknown;
}

interface Script {
  token?: (form: URLSearchParams) => ScriptedBody;
  api?: (url: string, token: string) => ScriptedBody;
}

interface RecordedCall {
  url: string;
  method: string;
  form: URLSearchParams;
  auth: string;
}

function scriptedSpotify(script: Script): { fetch: SpotifyFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const fetchImpl: SpotifyFetch = async (url, init): Promise<SpotifyHttpResponse> => {
    const form = new URLSearchParams(init.body ?? '');
    const auth = init.headers.Authorization ?? '';
    calls.push({ url, method: init.method, form, auth });

    let result: ScriptedBody;
    if (url.includes('/api/token')) {
      result = script.token ? script.token(form) : { status: 400, body: { error: 'unexpected_token_call' } };
    } else {
      const bearer = auth.replace(/^Bearer\s+/i, '');
      result = script.api ? script.api(url, bearer) : { status: 404, body: { error: 'unexpected_api_call' } };
    }

    const status = result.status ?? 200;
    const text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
  };

  return { fetch: fetchImpl, calls };
}

/** The token response Spotify sends for a successful authorisation. */
function tokenGrant(overrides: Record<string, unknown> = {}): ScriptedBody {
  return {
    body: {
      access_token: REAL_ACCESS_TOKEN,
      refresh_token: REAL_REFRESH_TOKEN,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'user-read-private user-read-email',
      ...overrides,
    },
  };
}

const PROFILE = {
  id: 'ozikoro-spotify-user',
  display_name: 'Ozikoro',
  email: 'hello@ozikoro.com',
  product: 'premium',
  country: 'NG',
};

function profileCall(): ScriptedBody {
  return { body: PROFILE };
}

// ---------------------------------------------------------------------------
// Test fixtures, and clearing up after them
// ---------------------------------------------------------------------------

/** Anything of ours that must not be findable in the database afterwards. */
async function findLeaks(needles: string[]): Promise<string[]> {
  const found: string[] = [];
  const targets: { table: string; columns: string[] }[] = [
    { table: 'spotify_connection', columns: ['access_token_enc', 'refresh_token_enc', 'last_error'] },
    { table: 'spotify_oauth_state', columns: ['state_hash', 'code_verifier'] },
    { table: 'spotify_event', columns: ['message', 'detail'] },
  ];

  for (const { table, columns } of targets) {
    const rows = await db.rows<Record<string, unknown>>(`select ${columns.join(', ')} from ${table}`);
    for (const row of rows) {
      for (const column of columns) {
        const value = row[column];
        if (typeof value !== 'string') continue;
        for (const needle of needles) {
          if (needle.length > 0 && value.includes(needle)) found.push(`${table}.${column}`);
        }
      }
    }
  }
  return [...new Set(found)];
}

const SUFFIX = 'zztest-spotify';
await db.query(`delete from account where email like '${SUFFIX}-%'`);
// Events written by this run are removed at the end by id, so anything already there is
// left exactly as it was.
const eventHighWater = Number(
  (await db.one<{ n: number }>(`select coalesce(max(id), 0)::int as n from spotify_event`))?.n ?? 0
);

/**
 * Put the connection row back as it was found.
 *
 * The table is a singleton, so a test run necessarily replaces whatever was there. A test
 * that quietly destroys a developer's connected account would be worse than no test, so
 * the row is captured first and restored afterwards.
 */
const savedConnection =
  (await db.one<Record<string, unknown>>(`select * from spotify_connection where id = 1`)) ?? null;

const owner = await registerAccount(db, {
  email: `${SUFFIX}-owner@example.com`,
  password: 'a long enough password',
});
const stranger = await registerAccount(db, {
  email: `${SUFFIX}-stranger@example.com`,
  password: 'a long enough password',
});
await db.query(`update account set role='owner' where id=$1`, [owner.id]);

async function cleanup() {
  try {
    await db.query(`delete from spotify_oauth_state where account_id in ($1, $2)`, [owner.id, stranger.id]);
    await db.query(`delete from spotify_event where id > $1`, [eventHighWater]);
    await db.query(`delete from spotify_connection`);
    if (savedConnection) {
      const columns = Object.keys(savedConnection);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      await db.query(
        `insert into spotify_connection (${columns.join(', ')}) values (${placeholders})`,
        columns.map((c) => savedConnection[c])
      );
    }
    await db.query(`delete from account where email like '${SUFFIX}-%'`);
  } catch (error) {
    console.error('cleanup failed:', error);
  }
  await closeDb();
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

console.log('\n--- configuration ---');

{
  const config = spotifyConfig();
  assert('the production redirect URI is the one registered with Spotify', config.redirectUri === REDIRECT_URI, config.redirectUri ?? '');
  assert('a configured environment reports no problem', config.problem === null, config.problem ?? '');
  assert('the default scopes are the minimum needed to name the account', config.scopes.join(' ') === 'user-read-private user-read-email', config.scopes.join(' '));
}

{
  // With the credentials removed, the flow must refuse rather than half-run. The
  // configuration is read per call, so this can be exercised without restarting.
  const saved = { id: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET };
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  try {
    await refuses(
      'starting a connection refuses when the client credentials are absent',
      () => startSpotifyAuthorization(db, { accountId: owner.id }),
      'not_configured'
    );
  } finally {
    process.env.SPOTIFY_CLIENT_ID = saved.id;
    process.env.SPOTIFY_CLIENT_SECRET = saved.secret;
  }
}

{
  const saved = process.env.SPOTIFY_TOKEN_KEY;
  delete process.env.SPOTIFY_TOKEN_KEY;
  try {
    await refuses(
      'starting a connection refuses when the token key is absent, before asking for consent',
      () => startSpotifyAuthorization(db, { accountId: owner.id }),
      'token_key_missing'
    );
  } finally {
    process.env.SPOTIFY_TOKEN_KEY = saved;
  }
}

{
  // A callback over plain HTTP is refused in production, and it is named separately from
  // "not configured" because every variable is set and one of them holds the wrong value.
  const savedUri = process.env.SPOTIFY_REDIRECT_URI;
  const savedEnv = process.env.NODE_ENV;
  process.env.SPOTIFY_REDIRECT_URI = 'http://ozikoro.com/api/spotify/callback';
  process.env.NODE_ENV = 'production';
  try {
    await refuses(
      'a plain-HTTP production callback is refused as an insecure redirect',
      () => startSpotifyAuthorization(db, { accountId: owner.id }),
      'redirect_insecure'
    );
  } finally {
    process.env.SPOTIFY_REDIRECT_URI = savedUri;
    process.env.NODE_ENV = savedEnv;
  }
}

// ---------------------------------------------------------------------------
// Starting an authorisation
// ---------------------------------------------------------------------------

console.log('\n--- starting an authorisation ---');

const started = await startSpotifyAuthorization(db, { accountId: owner.id, returnTo: '/admin/spotify' });
const authorizeUrl = new URL(started.authorizeUrl);

assert('the browser is sent to Spotify\u2019s authorisation endpoint', authorizeUrl.origin + authorizeUrl.pathname === 'https://accounts.spotify.com/authorize');
assert('the redirect URI matches the Dashboard configuration exactly', authorizeUrl.searchParams.get('redirect_uri') === REDIRECT_URI, authorizeUrl.searchParams.get('redirect_uri') ?? '');
assert('PKCE is used', authorizeUrl.searchParams.get('code_challenge_method') === 'S256');
assert('a code challenge is present but the verifier is not', Boolean(authorizeUrl.searchParams.get('code_challenge')) && !started.authorizeUrl.includes('code_verifier'));
assert('the state is carried in the URL', authorizeUrl.searchParams.get('state') === started.state);

{
  const row = await db.one<Record<string, unknown>>(
    `select state_hash, code_verifier, redirect_uri from spotify_oauth_state where state_hash = $1`,
    [hashOAuthState(started.state)]
  );
  assert('the state is stored hashed, so the table holds no usable state', row !== null && row.state_hash !== started.state);
  assert('the stored hash is the SHA-256 of the state', row?.state_hash === hashOAuthState(started.state));
  assert('the PKCE verifier is held server-side for the exchange', typeof row?.code_verifier === 'string' && (row.code_verifier as string).length >= 43);
  assert('the attempt records the redirect URI it was made under', row?.redirect_uri === REDIRECT_URI);
}

// The return path is checked positively, because "it stored nothing" is not a refusal.
{
  const started2 = await startSpotifyAuthorization(db, { accountId: owner.id, returnTo: 'https://evil.example/steal' });
  const row = await db.one<Record<string, unknown>>(
    `select return_to from spotify_oauth_state where state_hash = $1`,
    [hashOAuthState(started2.state)]
  );
  assert('an absolute return path is not stored', row?.return_to === null, String(row?.return_to));
  assert(
    'safeReturnPath rejects absolute and protocol-relative paths, and keeps a normal one',
    safeReturnPath('//evil.example') === null &&
      safeReturnPath('https://evil.example') === null &&
      safeReturnPath('/admin/spotify') === '/admin/spotify'
  );
}

// ---------------------------------------------------------------------------
// State validation — the CSRF defence
// ---------------------------------------------------------------------------

console.log('\n--- state validation ---');

await refuses(
  'a state this server never issued is refused',
  () => consumeSpotifyAuthorization(db, { state: generateOAuthState(), accountId: owner.id }),
  'state_invalid'
);

await refuses(
  'an empty state is refused',
  () => consumeSpotifyAuthorization(db, { state: '', accountId: owner.id }),
  'state_invalid'
);

{
  // A real state, but issued to a different administrator.
  const other = await startSpotifyAuthorization(db, { accountId: stranger.id });
  await refuses(
    'a state issued to another administrator is refused',
    () => consumeSpotifyAuthorization(db, { state: other.state, accountId: owner.id }),
    'state_mismatch'
  );
  // The refusal must not burn the attempt: the legitimate administrator can still finish.
  const recovered = await consumeSpotifyAuthorization(db, { state: other.state, accountId: stranger.id });
  assert('a refused cross-account callback does not consume the legitimate attempt', recovered.accountId === stranger.id);
}

await refuses(
  'a state presented with no session is refused',
  () => consumeSpotifyAuthorization(db, { state: started.state, accountId: null }),
  'state_mismatch'
);

{
  // A real state that is past its window.
  const stale = generateOAuthState();
  await db.query(
    `insert into spotify_oauth_state (state_hash, account_id, code_verifier, redirect_uri, expires_at)
     values ($1, $2, $3, $4, now() - interval '1 minute')`,
    [hashOAuthState(stale), owner.id, 'a-code-verifier-that-is-long-enough-to-be-real-ok', REDIRECT_URI]
  );
  await refuses(
    'an expired state is refused',
    () => consumeSpotifyAuthorization(db, { state: stale, accountId: owner.id }),
    'state_expired'
  );
}

{
  const single = await startSpotifyAuthorization(db, { accountId: owner.id });
  const first = await consumeSpotifyAuthorization(db, { state: single.state, accountId: owner.id });
  assert('a valid state is spent and yields its PKCE verifier', first.codeVerifier.length >= 43);
  await refuses(
    'the same state cannot be spent twice — a replayed callback is impossible',
    () => consumeSpotifyAuthorization(db, { state: single.state, accountId: owner.id }),
    'state_consumed'
  );
}

// ---------------------------------------------------------------------------
// The callback: a denied authorisation
// ---------------------------------------------------------------------------

console.log('\n--- the callback, denied ---');

{
  const attempt = await startSpotifyAuthorization(db, { accountId: owner.id });
  const outcome = await completeSpotifyCallback(db, {
    params: new URLSearchParams({ error: 'access_denied', state: attempt.state }),
    accountId: owner.id,
  });

  assert('a denied authorisation is handled, not thrown', outcome.ok === false);
  assert('the administrator is sent back to the settings page', outcome.redirectPath === '/admin/spotify');
  assert('the message is human-readable and does not name the raw OAuth error', outcome.message.includes('not granted'), outcome.message);
  assert('the refusal is recorded server-side', (await listSpotifyEvents(db, 5)).some((e) => e.message.includes('not granted')));

  await refuses(
    'a denied attempt spends its state, so it cannot be replayed',
    () => consumeSpotifyAuthorization(db, { state: attempt.state, accountId: owner.id }),
    'state_consumed'
  );
}

{
  const outcome = await completeSpotifyCallback(db, {
    params: new URLSearchParams({ error: 'server_error', error_description: 'Something failed at Spotify' }),
    accountId: owner.id,
  });
  assert('a provider error other than a denial is also handled', outcome.ok === false);
  assert('and its description is sanitised into the record', (await listSpotifyEvents(db, 3)).some((e) => (e.detail ?? '').includes('Something failed')));
}

// ---------------------------------------------------------------------------
// The callback: a successful exchange
// ---------------------------------------------------------------------------

console.log('\n--- the callback, successful ---');

{
  const attempt = await startSpotifyAuthorization(db, { accountId: owner.id });
  const { fetch, calls } = scriptedSpotify({ token: () => tokenGrant(), api: () => profileCall() });

  const outcome = await completeSpotifyCallback(
    db,
    { params: new URLSearchParams({ code: 'an-authorisation-code', state: attempt.state }), accountId: owner.id },
    { fetchImpl: fetch }
  );

  assert('the callback succeeds', outcome.ok === true, outcome.message);
  assert('the success message is the one the requirement names', outcome.message === 'Spotify connected successfully.', outcome.message);
  assert('the administrator is returned to the Ozikoro settings page', outcome.redirectPath === '/admin/spotify');
  assert('the exchange sent the code and the PKCE verifier', calls[0]?.form.get('grant_type') === 'authorization_code' && calls[0]?.form.get('code') === 'an-authorisation-code' && (calls[0]?.form.get('code_verifier') ?? '').length >= 43);
  assert('the exchange sent the recorded redirect URI, byte for byte', calls[0]?.form.get('redirect_uri') === REDIRECT_URI);
  assert('the client secret travelled in the Authorization header, not the body', (calls[0]?.auth ?? '').startsWith('Basic ') && !(calls[0]?.form.toString() ?? '').includes(CLIENT_SECRET));
  assert('the account details were read from Spotify', outcome.connection?.displayName === 'Ozikoro' && outcome.connection?.email === 'hello@ozikoro.com');

  const row = await readSpotifyConnectionRow(db);
  assert('the connection is stored', row !== null && row.disconnectedAt === null);
  assert('the account is identifiable in the admin', row?.displayName === 'Ozikoro' && row?.spotifyUserId === 'ozikoro-spotify-user');
  assert('the granted scopes are stored as Spotify reported them', (row?.scopes ?? []).join(' ') === 'user-read-private user-read-email');
  assert('an expiry is recorded, so renewal can be decided before it is too late', Boolean(row?.accessExpiresAt) && Date.parse(row!.accessExpiresAt!) > Date.now());
  assert('a refresh token is held, so the administrator is not asked to reconnect later', Boolean(row?.refreshTokenEnc));
  assert('the access token is NOT stored in recoverable plaintext', row?.accessTokenEnc !== REAL_ACCESS_TOKEN && !(row?.accessTokenEnc ?? '').includes('real-access-token'));
  assert('the refresh token is NOT stored in recoverable plaintext', row?.refreshTokenEnc !== REAL_REFRESH_TOKEN && !(row?.refreshTokenEnc ?? '').includes('real-refresh-token'));
  assert('the stored ciphertext is self-describing for future format changes', (row?.accessTokenEnc ?? '').startsWith('v1.'));
  assert('the ciphertext round-trips under the environment key', decryptToken(row!.accessTokenEnc!, TOKEN_KEY) === REAL_ACCESS_TOKEN);
  assert('the connection is recorded in the history', (await listSpotifyEvents(db, 5)).some((e) => e.kind === 'connect'));

  const leaked = await findLeaks([CLIENT_SECRET, REAL_ACCESS_TOKEN, REAL_REFRESH_TOKEN, 'an-authorisation-code']);
  assert('no secret, token or code is findable anywhere the integration writes', leaked.length === 0, leaked.join(', '));
}

// ---------------------------------------------------------------------------
// The callback: a refused exchange
// ---------------------------------------------------------------------------

console.log('\n--- the callback, refused exchange ---');

{
  const attempt = await startSpotifyAuthorization(db, { accountId: owner.id });
  const { fetch } = scriptedSpotify({
    token: () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Invalid authorization code' } }),
  });

  const outcome = await completeSpotifyCallback(
    db,
    { params: new URLSearchParams({ code: 'a-bad-code', state: attempt.state }), accountId: owner.id },
    { fetchImpl: fetch }
  );

  assert('a refused exchange does not throw', outcome.ok === false);
  assert('it is named as an exchange failure', outcome.errorCode === 'exchange_failed', outcome.errorCode ?? 'none');
  assert('the administrator gets Spotify\u2019s own explanation', outcome.message.includes('Invalid authorization code'), outcome.message);
  assert('the failure is recorded against the connection', Boolean((await readSpotifyConnectionRow(db))?.lastError));

  // A token-shaped value in Spotify's error must not reach the database.
  const attempt2 = await startSpotifyAuthorization(db, { accountId: owner.id });
  const { fetch: leakyFetch } = scriptedSpotify({
    token: () => ({
      status: 400,
      body: { error: 'invalid_request', error_description: `access_token=${'Z'.repeat(60)} was rejected` },
    }),
  });
  await completeSpotifyCallback(
    db,
    { params: new URLSearchParams({ code: 'x', state: attempt2.state }), accountId: owner.id },
    { fetchImpl: leakyFetch }
  );
  const leaked = await findLeaks(['Z'.repeat(60)]);
  assert('a token echoed inside Spotify\u2019s error is redacted before it is stored', leaked.length === 0, leaked.join(', '));
}

{
  // A callback with no code at all, which is what a hand-crafted request looks like.
  const outcome = await completeSpotifyCallback(db, { params: new URLSearchParams({ state: 'nonsense' }), accountId: owner.id });
  assert('a callback with no code is refused safely', outcome.ok === false && outcome.message.length > 0);
}

{
  await recordSpotifyEvent(db, {
    kind: 'error',
    message: 'probe',
    detail: `refresh_token=${'Q'.repeat(50)}`,
  });
  const events = await listSpotifyEvents(db, 1);
  assert('the event writer redacts a secret even when a caller forgets to', !(events[0]?.detail ?? '').includes('Q'.repeat(50)), events[0]?.detail ?? '');
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

console.log('\n--- token refresh ---');

{
  // Reconnect cleanly so the starting state is known.
  const attempt = await startSpotifyAuthorization(db, { accountId: owner.id });
  const { fetch } = scriptedSpotify({ token: () => tokenGrant(), api: () => profileCall() });
  await completeSpotifyCallback(
    db,
    { params: new URLSearchParams({ code: 'code-for-refresh-test', state: attempt.state }), accountId: owner.id },
    { fetchImpl: fetch }
  );

  const before = await readSpotifyConnectionRow(db);

  // A token that is still well inside its life must be used as it is.
  {
    const { fetch: idle, calls } = scriptedSpotify({ token: () => tokenGrant() });
    const token = await getValidAccessToken(db, { fetchImpl: idle });
    assert('a healthy access token is used without a network round trip', token === REAL_ACCESS_TOKEN);
    assert('and nothing was refreshed', calls.length === 0, `${calls.length} calls`);
  }

  // Now expire it, the way an hour passing would.
  await db.query(`update spotify_connection set access_expires_at = now() - interval '1 minute' where id = 1`);

  {
    const { fetch: renewing, calls } = scriptedSpotify({
      token: (form) => {
        if (form.get('grant_type') !== 'refresh_token') return { status: 400, body: { error: 'wrong_grant' } };
        if (form.get('refresh_token') !== REAL_REFRESH_TOKEN) return { status: 400, body: { error: 'invalid_grant' } };
        return tokenGrant({ access_token: ROTATED_ACCESS_TOKEN, refresh_token: ROTATED_REFRESH_TOKEN });
      },
    });

    const token = await getValidAccessToken(db, { fetchImpl: renewing });
    assert('an expired access token is renewed from the stored refresh token', token === ROTATED_ACCESS_TOKEN);
    assert('the renewal presented the stored refresh token', calls[0]?.form.get('refresh_token') === REAL_REFRESH_TOKEN);
    assert('the administrator was not asked to reconnect', calls.length === 1, `${calls.length} calls`);

    const after = await readSpotifyConnectionRow(db);
    assert('the rotated access token replaced the old ciphertext', after?.accessTokenEnc !== before?.accessTokenEnc);
    assert('the rotated refresh token replaced the old one', after?.refreshTokenEnc !== before?.refreshTokenEnc);
    assert('the rotated refresh token is usable', decryptToken(after!.refreshTokenEnc!, TOKEN_KEY) === ROTATED_REFRESH_TOKEN);
    assert('the connection date is preserved across a renewal, not rewritten', after?.connectedAt === before?.connectedAt, `${before?.connectedAt} -> ${after?.connectedAt}`);
    assert('the renewal is recorded', (await listSpotifyEvents(db, 3)).some((e) => e.kind === 'refresh'));
  }

  // Spotify sometimes omits the refresh token, meaning "keep using the one you have".
  {
    await db.query(`update spotify_connection set access_expires_at = now() - interval '1 minute' where id = 1`);
    const beforeKeep = await readSpotifyConnectionRow(db);
    const { fetch: rotating } = scriptedSpotify({
      token: () => ({ body: { access_token: 'BQ-third-token', token_type: 'Bearer', expires_in: 3600 } }),
    });
    const token = await getValidAccessToken(db, { fetchImpl: rotating });
    const afterKeep = await readSpotifyConnectionRow(db);
    assert('a renewal that omits a refresh token still returns the new access token', token === 'BQ-third-token');
    assert('and keeps the stored refresh token rather than discarding it', afterKeep?.refreshTokenEnc === beforeKeep?.refreshTokenEnc);
  }

  // A refused refresh is terminal, and must say so without destroying the record.
  {
    await db.query(`update spotify_connection set access_expires_at = now() - interval '1 minute' where id = 1`);
    const { fetch: refusing } = scriptedSpotify({
      token: () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Refresh token revoked' } }),
    });
    await refuses(
      'a refused refresh is reported as a refresh failure',
      () => getValidAccessToken(db, { fetchImpl: refusing }),
      'refresh_failed'
    );
    const row = await readSpotifyConnectionRow(db);
    assert('the failure is recorded for the administrator to see', (row?.lastError ?? '').includes('Reconnect'));
    assert('the connection row is kept, so the screen can still explain itself', row !== null && row.disconnectedAt === null);
    assert('the stored refresh token is not destroyed by a failed renewal', Boolean(row?.refreshTokenEnc));
  }
}

// ---------------------------------------------------------------------------
// The admin view
// ---------------------------------------------------------------------------

console.log('\n--- the admin view ---');

{
  const view = await spotifyConnectionView(db);
  assert('the view reports a configured integration', view.configured === true);
  assert('the view reports the connected account', view.account?.displayName === 'Ozikoro');
  assert('the view exposes no token or ciphertext', !JSON.stringify(view).includes('v1.') && !JSON.stringify(view).includes(REAL_ACCESS_TOKEN));
  assert('the view carries the callback address so it can be checked against the Dashboard', view.redirectUri === REDIRECT_URI);
  assert('the view carries recent history', view.events.length > 0);
  assert('the view names a state', view.label.length > 0 && view.state !== 'not_configured', view.state);
}

// ---------------------------------------------------------------------------
// Checking, and the API seam
// ---------------------------------------------------------------------------

console.log('\n--- checking the connection ---');

{
  const attempt = await startSpotifyAuthorization(db, { accountId: owner.id });
  const { fetch } = scriptedSpotify({ token: () => tokenGrant(), api: () => profileCall() });
  await completeSpotifyCallback(
    db,
    { params: new URLSearchParams({ code: 'code-for-check', state: attempt.state }), accountId: owner.id },
    { fetchImpl: fetch }
  );

  const profile = await checkSpotifyConnection(db, { fetchImpl: fetch });
  assert('a check confirms the account against Spotify', profile.id === 'ozikoro-spotify-user');
  const row = await readSpotifyConnectionRow(db);
  assert('a successful check is timestamped, which is what "last check" means', Boolean(row?.lastCheckAt));
  assert('and it clears a previous failure', row?.lastError === null);
}

console.log('\n--- the API seam the podcast workflow will use ---');

{
  // A 401 must be retried once, after forcing a renewal — an access token can be revoked
  // between the expiry check and the call.
  let apiCalls = 0;
  const { fetch, calls } = scriptedSpotify({
    token: (form) => {
      if (form.get('grant_type') !== 'refresh_token') return { status: 400, body: { error: 'wrong_grant' } };
      return tokenGrant({ access_token: 'BQ-after-forced-refresh' });
    },
    api: (_url, token) => {
      apiCalls += 1;
      if (token !== 'BQ-after-forced-refresh') return { status: 401, body: { error: { status: 401, message: 'The access token expired' } } };
      return { body: { id: 'ozikoro-spotify-user' } };
    },
  });

  const result = await spotifyApiCall(db, '/me', {}, { fetchImpl: fetch });
  assert('a 401 is retried after a forced renewal rather than surfaced', result.status === 200, String(result.status));
  assert('exactly two API attempts were made', apiCalls === 2, String(apiCalls));
  assert('the retry forced a refresh rather than re-reading the dead token', calls.some((c) => c.form.get('grant_type') === 'refresh_token'));

  await refuses(
    'a path that is not a Spotify path is refused rather than concatenated',
    () => spotifyApiCall(db, 'https://evil.example/steal', {}, { fetchImpl: fetch }),
    'api_failed'
  );
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

console.log('\n--- disconnecting ---');

{
  await disconnectSpotify(db, { accountId: owner.id });

  const row = await readSpotifyConnectionRow(db);
  assert('the access token is destroyed', row?.accessTokenEnc === null);
  assert('the refresh token is destroyed', row?.refreshTokenEnc === null);
  assert('the connection is marked disconnected', Boolean(row?.disconnectedAt));
  assert('the disconnection is recorded', (await listSpotifyEvents(db, 3)).some((e) => e.kind === 'disconnect'));

  const view = await spotifyConnectionView(db);
  assert('the admin screen reports it as not connected', view.state === 'disconnected', view.state);

  await refuses(
    'and no access token can be obtained afterwards',
    () => getValidAccessToken(db),
    'not_connected'
  );

  // The grant record is kept, so the screen can still say what was disconnected.
  assert('the account name survives so the history is readable', row?.displayName === 'Ozikoro');
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

console.log('\n--- encryption ---');

{
  const ciphertext = encryptToken('a-secret-value', TOKEN_KEY);
  assert('the ciphertext does not contain the plaintext', !ciphertext.includes('a-secret-value'));
  assert('the same plaintext encrypts differently each time (a fresh IV)', encryptToken('a-secret-value', TOKEN_KEY) !== ciphertext);

  const parts = ciphertext.split('.');
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('something else').toString('base64url')].join('.');
  let threw = false;
  try {
    decryptToken(tampered, TOKEN_KEY);
  } catch {
    threw = true;
  }
  assert('tampered ciphertext fails to decrypt instead of yielding garbage', threw);

  let wrongKeyThrew = false;
  try {
    decryptToken(ciphertext, 'b'.repeat(64));
  } catch {
    wrongKeyThrew = true;
  }
  assert('a token written under another key is refused', wrongKeyThrew);

  let weakKeyThrew = false;
  try {
    encryptToken('x', 'too-short');
  } catch (error) {
    weakKeyThrew = error instanceof SpotifyError && error.code === 'token_key_missing';
  }
  assert('a passphrase that is not 32 bytes is refused rather than stretched', weakKeyThrew);
}

// ---------------------------------------------------------------------------
// A final sweep
// ---------------------------------------------------------------------------

console.log('\n--- secrets in the database ---');

{
  const leaked = await findLeaks([CLIENT_SECRET, REAL_ACCESS_TOKEN, REAL_REFRESH_TOKEN, ROTATED_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN, TOKEN_KEY, 'an-authorisation-code']);
  assert('after every path above, no secret is findable in any table this writes to', leaked.length === 0, leaked.join(', '));
}

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await cleanup();
process.exit(failures === 0 ? 0 : 1);
