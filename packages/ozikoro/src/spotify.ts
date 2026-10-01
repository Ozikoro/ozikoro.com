/**
 * Spotify OAuth — the parts that are pure arithmetic and string handling.
 *
 * WHY THIS FILE HAS NO `node:` IMPORTS
 *
 * Everything here is a pure function of its arguments, so the randomness, the SHA-256 and
 * the symmetric encryption live one file over in `connection.ts`, which is server-only.
 * Keeping the two apart buys two things: a client component can import the pure half
 * without dragging `node:crypto` into a browser bundle, and this half is testable with no
 * database, no network and no environment at all — `node --test src/spotify.test.ts`
 * exercises the state machine, the URL the browser is sent to, and the token validation,
 * with no setup whatsoever.
 *
 * WHY IT IS NOT IN `@ozituma/core`
 *
 * It used to be. `@ozituma/core` is a shared barrel that the dictionary and the courses
 * both import, including from client components, so putting Ozikoro's Spotify code there
 * meant every app inherited it and any of them could reach it. The Spotify connection
 * belongs to ozikoro.com alone, so it lives in `@ozikoro/platform`, which only
 * `apps/ozikoro` depends on. The shared part is the database, not this.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Nothing in this file decides WHAT Ozikoro may do with the connection. Spotify's
 * authorisation endpoint does not hand out an audio-upload capability, and no amount of
 * OAuth scope changes that: publishing a podcast episode to Spotify is a distribution
 * relationship, not an API call. The scope list below is therefore the minimum needed to
 * identify the account, and the publishing mechanism is expected to arrive separately —
 * see docs/SPOTIFY.md and docs/PODCAST-PIPELINE.md.
 */

// ---------------------------------------------------------------------------
// Endpoints and defaults
// ---------------------------------------------------------------------------

export const SPOTIFY_ACCOUNTS_ORIGIN = 'https://accounts.spotify.com';
export const SPOTIFY_AUTHORIZE_ENDPOINT = `${SPOTIFY_ACCOUNTS_ORIGIN}/authorize`;
export const SPOTIFY_TOKEN_ENDPOINT = `${SPOTIFY_ACCOUNTS_ORIGIN}/api/token`;
export const SPOTIFY_API_ORIGIN = 'https://api.spotify.com/v1';

/**
 * The scopes asked for, and nothing beyond them.
 *
 * `user-read-private` and `user-read-email` are what let the admin screen name the
 * account it is connected to instead of showing a bare "connected". They grant no
 * ability to change anything on the account.
 *
 * They are deliberately NOT the union of everything that might one day be useful. A
 * consent screen asking for library or playback permissions to power a feature that
 * does not exist yet is how an integration loses an administrator's trust, and the
 * requested set is overridable per environment (SPOTIFY_SCOPES) for the day a real
 * publishing mechanism needs more.
 */
export const DEFAULT_SPOTIFY_SCOPES: readonly string[] = ['user-read-private', 'user-read-email'];

/**
 * How long a connect attempt stays good for.
 *
 * Ten minutes: long enough to sign into Spotify, decide, and read a consent screen on
 * a slow connection; short enough that an abandoned attempt is not a standing key.
 */
export const SPOTIFY_STATE_TTL_SECONDS = 600;

/**
 * How early an access token is refreshed.
 *
 * An access token is refreshed once it is within this of expiring rather than after
 * it has, so a request never fails its way into discovering the token was too old.
 * Spotify's access tokens last an hour; five minutes of headroom costs one extra
 * refresh a day and removes an entire category of intermittent failure.
 */
export const SPOTIFY_REFRESH_SKEW_SECONDS = 300;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Every way this integration is allowed to fail, named.
 *
 * The code is what the route branches on and what the admin screen keys its message
 * from; the message is written for an administrator to read and is safe to show. A
 * caller that has to match on message text has already lost.
 */
export type SpotifyErrorCode =
  /** Client id, secret or token key is absent. Fixable in the environment only. */
  | 'not_configured'
  /** The token encryption key is missing, so nothing may be stored. Fails closed. */
  | 'token_key_missing'
  /** The administrator pressed Cancel/Access-denied on Spotify's consent screen. */
  | 'access_denied'
  /** No state, or one this server never issued. */
  | 'state_invalid'
  /** A real state, but past its window. */
  | 'state_expired'
  /** A real state, already spent. A second callback presenting it is refused. */
  | 'state_consumed'
  /** A real state, issued to a different administrator. */
  | 'state_mismatch'
  /** The configured redirect URI is unacceptable for the environment it is running in. */
  | 'redirect_insecure'
  /** The code-for-token exchange was refused. */
  | 'exchange_failed'
  /** The refresh grant was refused, so the administrator must reconnect. */
  | 'refresh_failed'
  /** Spotify answered with something that is not a usable token set. */
  | 'token_response_invalid'
  /** No connection exists yet. */
  | 'not_connected'
  /** Credentials were refused when calling the Spotify API. */
  | 'api_unauthorised'
  /** The Spotify API answered with an error. */
  | 'api_failed'
  /** The network was unreachable or timed out. */
  | 'network';

export class SpotifyError extends Error {
  override readonly name = 'SpotifyError';
  readonly code: SpotifyErrorCode;

  constructor(code: SpotifyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Message sanitisation — the reason a log cannot leak a credential
// ---------------------------------------------------------------------------

/** Longest a stored or displayed message may be. */
const MAX_MESSAGE_LENGTH = 300;

/**
 * Anything that looks like a credential, removed.
 *
 * This runs on the way IN to storage and to the screen, not on the way out, because a
 * value that reached the database is already a copy of the secret and redacting it at
 * render time would be theatre.
 *
 * Three shapes are covered, in order:
 *
 *   1. `name=value` for the names that carry secrets, including the authorisation code
 *      itself — a code is single-use, but it is still live until it is redeemed.
 *   2. `Bearer <token>`, which is how an access token appears in a header echo.
 *   3. Any long unbroken run of token characters. A secret pasted into an error string
 *      by a library is exactly this shape, and this is the clause that catches it when
 *      the first two miss.
 *
 * The third clause is deliberately the loosest and would also redact a long URL. That
 * is the right trade for an error string: a slightly less informative message is worth
 * more than a logged refresh token.
 */
export function sanitiseSpotifyMessage(input: unknown): string {
  const raw = rawMessage(input)
    // Newlines and control characters never belong in a one-line notice.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const scrubbed = raw
    // 1. secret-bearing key/value pairs, in the spellings they actually arrive in:
    //    `name=value`, `name: value`, `"name":"value"`, and inside a query string.
    //    The optional closing quote after the name is what makes the JSON form match:
    //    `"client_secret":"…"` has a quote sitting between the name and the colon.
    .replace(
      /\b(access_token|refresh_token|client_secret|client_id|code_verifier|code_challenge|id_token|authorization_code|code|state|token)\b["']?\s*[:=]\s*["']?([^"'\s&<>]+)/gi,
      '$1=[redacted]'
    )
    // 2. Bearer <token>
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    // 3. anything long and unbroken that is shaped like a token
    .replace(/[A-Za-z0-9._~+/-]{40,}=*/g, '[redacted]');

  if (scrubbed.length === 0) return 'No further detail was available.';
  return scrubbed.length > MAX_MESSAGE_LENGTH ? `${scrubbed.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : scrubbed;
}

/** Pull a human-usable sentence out of whatever was thrown. */
function rawMessage(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  if (input instanceof Error) return input.message || input.name;

  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    /*
     * Spotify's error body is `{"error": "...", "error_description": "..."}` for OAuth
     * and `{"error": {"status": 401, "message": "..."}}` for the Web API. Both shapes
     * are read here so an operator sees Spotify's own words rather than "unknown".
     */
    for (const key of ['error_description', 'message', 'error']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) return value;
      if (value && typeof value === 'object') {
        const nested = rawMessage(value);
        if (nested.length > 0) return nested;
      }
    }
    try {
      return JSON.stringify(record);
    } catch {
      return 'An unreadable error value was returned.';
    }
  }

  return String(input);
}

/**
 * Turn anything thrown into a `SpotifyError`.
 *
 * Used at the boundary of every network call so an unexpected shape — a proxy's HTML
 * error page, a thrown string — still becomes a named refusal rather than escaping as
 * an unhandled rejection whose stack ends up in a log.
 */
export function asSpotifyError(error: unknown, fallback: SpotifyErrorCode = 'api_failed'): SpotifyError {
  if (error instanceof SpotifyError) return error;
  return new SpotifyError(fallback, sanitiseSpotifyMessage(error));
}

// ---------------------------------------------------------------------------
// Configuration, described rather than read
// ---------------------------------------------------------------------------

export interface SpotifyConfig {
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  scopes: string[];
  tokenKeyPresent: boolean;
  /** Why it is unusable, when it is. Null when everything needed is present. */
  problem: string | null;
}

/**
 * The environment, by the names the deployment actually sets.
 *
 * These are the variable names rather than camelCase properties, because the object passed
 * in is `process.env` itself. A shape that does not match it silently reads nothing: every
 * value comes back undefined, the integration reports itself unconfigured, and the cause is
 * invisible from the outside. Using the real names makes `readSpotifyConfig(process.env)`
 * correct by construction rather than by remembering to map.
 */
export interface SpotifyConfigInput {
  SPOTIFY_CLIENT_ID?: string | undefined;
  SPOTIFY_CLIENT_SECRET?: string | undefined;
  SPOTIFY_REDIRECT_URI?: string | undefined;
  SPOTIFY_SCOPES?: string | undefined;
  SPOTIFY_TOKEN_KEY?: string | undefined;
  /** `process.env.NODE_ENV`. HTTPS is required in production. */
  NODE_ENV?: string | undefined;
}

/**
 * Read the environment into a description the admin screen can act on.
 *
 * It returns a value rather than throwing, and that is the point: a missing client id
 * is the ordinary state of a fresh checkout, not an exception. The screen needs to say
 * "not configured, and here is which variable is missing" — so this reports the
 * problem instead of refusing to run. The refusal happens at the moment something is
 * actually attempted (`assertSpotifyConfigured`).
 */
export function readSpotifyConfig(env: SpotifyConfigInput): SpotifyConfig {
  const clientId = trim(env.SPOTIFY_CLIENT_ID);
  const clientSecret = trim(env.SPOTIFY_CLIENT_SECRET);
  const scopes = normaliseScopes(env.SPOTIFY_SCOPES);
  const tokenKey = trim(env.SPOTIFY_TOKEN_KEY);

  /*
   * The redirect URI is environment configuration, and it defaults to the production
   * address so that production is the case that needs no configuration at all. A
   * development or staging environment overrides it and the production value is left
   * untouched — which is the requirement: each environment owns its own callback
   * without editing the one that serves ozikoro.com.
   */
  const redirectUri = trim(env.SPOTIFY_REDIRECT_URI) ?? 'https://ozikoro.com/api/spotify/callback';

  const missing: string[] = [];
  if (!clientId) missing.push('SPOTIFY_CLIENT_ID');
  if (!clientSecret) missing.push('SPOTIFY_CLIENT_SECRET');
  if (!tokenKey) missing.push('SPOTIFY_TOKEN_KEY');

  let problem: string | null = null;
  if (missing.length > 0) {
    problem = `Not configured yet. Set ${missing.join(', ')} in the server environment.`;
  } else if (!isRedirectUriAcceptable(redirectUri, env.NODE_ENV)) {
    problem = `SPOTIFY_REDIRECT_URI must be an https:// address in production; it is "${redirectUri}".`;
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    tokenKeyPresent: tokenKey !== null,
    problem,
  };
}

/** True when this environment is allowed to use this redirect URI. */
export function isRedirectUriAcceptable(redirectUri: string, nodeEnv?: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  // `javascript:` and `data:` are the reason this parses rather than prefix-matches.
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;

  /*
   * Plain HTTP is refused in production and allowed only on a loopback host
   * everywhere else. That is what lets a developer run the whole flow against
   * localhost without the production callback ever being reachable over http.
   */
  if (nodeEnv === 'production') return false;
  return isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/**
 * Split the comma-or-space separated scope list.
 *
 * A list where ANY entry is malformed falls back to the default set rather than keeping the
 * well-formed entries. Dropping the bad ones sounds friendlier and is worse:
 * `user-read-email; DROP TABLE account` would keep `account`, and an environment that meant to
 * widen the grant but mistyped it would quietly ask for a different one. A scope list is a
 * security decision, so a malformed one is refused whole. Spotify would reject an unknown scope
 * anyway; this refuses it here, where it can be seen.
 */
export function normaliseScopes(raw: string | undefined): string[] {
  const source = (raw ?? '').trim();
  if (source.length === 0) return [...DEFAULT_SPOTIFY_SCOPES];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of source.split(/[\s,]+/)) {
    const scope = token.trim();
    if (scope.length === 0) continue;
    // Spotify scope names are lowercase words joined by hyphens.
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(scope)) return [...DEFAULT_SPOTIFY_SCOPES];
    if (seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out.length > 0 ? out : [...DEFAULT_SPOTIFY_SCOPES];
}

function trim(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
}

/** The configuration, or a refusal naming what is missing. */
export function assertSpotifyConfigured(config: SpotifyConfig): asserts config is SpotifyConfig & {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  if (config.clientId && config.clientSecret && config.redirectUri && !config.problem) return;
  throw new SpotifyError('not_configured', config.problem ?? 'Spotify is not configured.');
}

// ---------------------------------------------------------------------------
// The authorisation request
// ---------------------------------------------------------------------------

export interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
}

/**
 * The address the administrator's browser is sent to.
 *
 * `code_challenge_method=S256` is PKCE. It is not required for a confidential client
 * that already holds a secret, and it is included anyway because it costs one hash and
 * closes the case where the authorisation code is intercepted before it is redeemed —
 * the code is useless without the verifier, which never leaves this server.
 *
 * `show_dialog=false` is left to Spotify's default on purpose: forcing the consent
 * screen on every connect would be a worse experience for an administrator
 * reconnecting, and Spotify already shows it when the grant actually changes.
 */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL(SPOTIFY_AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.scopes.length > 0) url.searchParams.set('scope', input.scopes.join(' '));
  return url.toString();
}

// ---------------------------------------------------------------------------
// The token response
// ---------------------------------------------------------------------------

export interface SpotifyTokenSet {
  accessToken: string;
  /** Absent on a refresh response, in which case the stored one stands. */
  refreshToken: string | null;
  tokenType: string;
  /** What was actually granted, which is not always what was asked for. */
  scopes: string[];
  /** Absolute expiry, ISO 8601. */
  expiresAt: string;
  expiresInSeconds: number;
}

/**
 * Validate Spotify's token response into something the rest of the system can rely on.
 *
 * Written as a validator rather than a cast because the failure it prevents is quiet:
 * a missing `expires_in` that becomes `NaN` yields an expiry of `Invalid Date`, every
 * comparison against it is false, and the connection then never refreshes and simply
 * stops working an hour later with nothing in the log to say why.
 */
export function parseTokenResponse(
  payload: unknown,
  options: { now?: number; context?: 'exchange' | 'refresh' } = {}
): SpotifyTokenSet {
  const code: SpotifyErrorCode = options.context === 'refresh' ? 'refresh_failed' : 'exchange_failed';
  const now = options.now ?? Date.now();

  if (!payload || typeof payload !== 'object') {
    throw new SpotifyError('token_response_invalid', 'Spotify did not return a token response.');
  }

  const body = payload as Record<string, unknown>;

  // An error body can arrive with a 200 from some proxies; treat it as the failure it is.
  if (typeof body.error === 'string' && body.error.length > 0) {
    throw new SpotifyError(code, sanitiseSpotifyMessage(body));
  }

  const accessToken = requireString(body.access_token);
  if (!accessToken) {
    throw new SpotifyError('token_response_invalid', 'Spotify did not return an access token.');
  }

  const expiresIn = body.expires_in;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new SpotifyError('token_response_invalid', 'Spotify did not return a usable token lifetime.');
  }

  return {
    accessToken,
    refreshToken: requireString(body.refresh_token),
    tokenType: requireString(body.token_type) ?? 'Bearer',
    scopes: parseGrantedScopes(body.scope),
    expiresAt: expiresAtFrom(expiresIn, now),
    expiresInSeconds: expiresIn,
  };
}

function requireString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Spotify returns granted scopes as one space-separated string. */
export function parseGrantedScopes(scope: unknown): string[] {
  if (typeof scope !== 'string') return [];
  return scope
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Absolute ISO expiry from a relative lifetime. */
export function expiresAtFrom(expiresInSeconds: number, now: number = Date.now()): string {
  return new Date(now + expiresInSeconds * 1000).toISOString();
}

/**
 * Whether the access token should be replaced before it is used.
 *
 * A null expiry is treated as "must refresh": the only way to hold a token with no
 * known expiry is a row written by an older or broken path, and guessing that it is
 * still good is the wrong direction to guess.
 */
export function refreshDue(
  expiresAt: string | null,
  options: { now?: number; skewSeconds?: number } = {}
): boolean {
  if (!expiresAt) return true;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return true;
  const now = options.now ?? Date.now();
  const skew = (options.skewSeconds ?? SPOTIFY_REFRESH_SKEW_SECONDS) * 1000;
  return expiry - skew <= now;
}

// ---------------------------------------------------------------------------
// What the admin screen shows
// ---------------------------------------------------------------------------

export type SpotifyConnectionState =
  | 'not_configured'
  | 'disconnected'
  | 'connected'
  | 'connected_expiring'
  | 'connected_unrefreshable'
  | 'error';

export interface ConnectionStateInput {
  configured: boolean;
  /** A row exists with a live access token. */
  connected: boolean;
  expiresAt: string | null;
  hasRefreshToken: boolean;
  /** A stored, already-sanitised failure that has not been cleared by a success. */
  lastError: string | null;
  now?: number;
}

/**
 * One word for the state of the connection, derived in one place.
 *
 * The distinction between `connected` and `connected_expiring` is not decoration: an
 * access token that has expired is recoverable automatically as long as a refresh token
 * is held, and one without a refresh token is not recoverable at all and needs the
 * administrator. Collapsing those into a single "connected" would hide the only case
 * that requires a person.
 */
export function connectionState(input: ConnectionStateInput): SpotifyConnectionState {
  if (!input.configured) return 'not_configured';
  if (!input.connected) return input.lastError ? 'error' : 'disconnected';
  if (input.lastError) return 'error';
  if (!input.hasRefreshToken && refreshDue(input.expiresAt, { now: input.now })) {
    return 'connected_unrefreshable';
  }
  return refreshDue(input.expiresAt, { now: input.now }) ? 'connected_expiring' : 'connected';
}

/** The sentence the admin screen puts under the status. */
export function connectionStateLabel(state: SpotifyConnectionState): string {
  switch (state) {
    case 'not_configured':
      return 'Not configured';
    case 'disconnected':
      return 'Not connected';
    case 'connected':
      return 'Connected';
    case 'connected_expiring':
      return 'Connected — access token renewing automatically';
    case 'connected_unrefreshable':
      return 'Connected, but the access token has expired and cannot be renewed';
    case 'error':
      return 'Connected, with a problem';
  }
}
