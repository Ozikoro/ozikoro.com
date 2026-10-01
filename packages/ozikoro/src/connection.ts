/**
 * Spotify: the connection Ozikoro publishes from, and the OAuth flow that makes it.
 *
 * WHAT THIS MODULE IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It is the secure connection layer: start an authorisation, validate the state that
 * comes back, exchange the code, store the tokens encrypted, keep the access token
 * fresh, and report honestly what happened. `getValidAccessToken` and `spotifyApiCall`
 * are the seam the podcast workflow will use.
 *
 * It is NOT a publishing integration, and the reason is worth stating plainly rather
 * than discovering later. Spotify's authorisation endpoint does not hand out an
 * audio-upload capability. There is no OAuth scope that grants "publish an episode",
 * because Spotify's podcast distribution is a separate relationship (Spotify for
 * Creators), not a Web API surface. So the intended workflow —
 *
 *     article -> podcast script -> audio -> metadata -> publish -> Spotify -> store ID
 *
 * — resolves as far as "authenticated connection" today, and the last two arrows need a
 * distribution mechanism chosen on its own terms. Building a fake upload call against an
 * endpoint that does not exist would be worse than leaving the seam visible. See
 * docs/SPOTIFY.md.
 *
 * WHY TOKENS ARE ENCRYPTED RATHER THAN HASHED
 *
 * An API key can be hashed, because it is only ever compared. A refresh token cannot:
 * it has to be presented back to Spotify, so it must be recoverable. It is therefore
 * AES-256-GCM ciphertext under a key that lives only in the environment
 * (SPOTIFY_TOKEN_KEY), so a database dump on its own yields nothing usable. GCM rather
 * than CBC so the ciphertext is authenticated — a tampered row fails to decrypt instead
 * of decrypting to something else.
 *
 * WHY THIS IS ITS OWN PACKAGE
 *
 * This belongs to ozikoro.com and to nothing else, so it lives in `@ozikoro/platform`
 * rather than in the shared packages. The dictionary and the courses do not depend on
 * it, cannot import it by accident, and do not carry it in their bundles. What it does
 * share is the database: `@ozituma/db` gives it the connection and the account table,
 * which is exactly the part that should be common to all three sites.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_SPOTIFY_SCOPES,
  SPOTIFY_API_ORIGIN,
  SPOTIFY_REFRESH_SKEW_SECONDS,
  SPOTIFY_STATE_TTL_SECONDS,
  SPOTIFY_TOKEN_ENDPOINT,
  SpotifyError,
  asSpotifyError,
  buildAuthorizeUrl,
  connectionState,
  connectionStateLabel,
  parseTokenResponse,
  readSpotifyConfig,
  refreshDue,
  sanitiseSpotifyMessage,
  type SpotifyConfig,
  type SpotifyConnectionState,
  type SpotifyErrorCode,
  type SpotifyTokenSet,
} from './spotify.ts';
import type { Db } from '@ozituma/db/client';

// ---------------------------------------------------------------------------
// The narrow HTTP surface, so a test needs no network stack
// ---------------------------------------------------------------------------

/** Just enough of a response to read a token or an error. `fetch` satisfies it. */
export interface SpotifyHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface SpotifyHttpRequest {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/**
 * The shape of `fetch`, narrowed.
 *
 * Injecting this is what lets the whole flow — exchange, refresh, and the 401 retry —
 * be tested against a scripted server without a network, a proxy or a fixture file.
 */
export type SpotifyFetch = (url: string, init: SpotifyHttpRequest) => Promise<SpotifyHttpResponse>;

export interface SpotifyOptions {
  fetchImpl?: SpotifyFetch;
  /** Injected clock, in milliseconds. Tests pass a fixed one. */
  now?: () => number;
  /** Overrides the environment. */
  config?: SpotifyConfig;
  /** Overrides `SPOTIFY_TOKEN_KEY`. Tests pass a generated one. */
  tokenKey?: string;
  /** How long a Spotify call may take before it is abandoned. */
  timeoutMs?: number;
  /** Renew the access token even if it is not yet due. */
  forceRefresh?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface Resolved {
  fetch: SpotifyFetch;
  now: () => number;
  config: SpotifyConfig;
  /** The raw key, needed for the actual encryption. Null when unset. */
  tokenKey: string | null;
  timeoutMs: number;
}

function resolve(options: SpotifyOptions): Resolved {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as SpotifyFetch | undefined);
  if (typeof fetchImpl !== 'function') {
    throw new SpotifyError('network', 'No fetch implementation is available in this runtime.');
  }

  const tokenKey = (options.tokenKey ?? process.env.SPOTIFY_TOKEN_KEY ?? '').trim();

  return {
    fetch: fetchImpl,
    now: options.now ?? (() => Date.now()),
    config: options.config ?? readSpotifyConfig(process.env),
    tokenKey: tokenKey.length > 0 ? tokenKey : null,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** The configuration as this process sees it. */
export function spotifyConfig(): SpotifyConfig {
  return readSpotifyConfig(process.env);
}

/** The key, or a refusal naming how to make one. */
function requireTokenKey(deps: Resolved): string {
  if (!deps.tokenKey) {
    throw new SpotifyError(
      'token_key_missing',
      'SPOTIFY_TOKEN_KEY is not set, so the Spotify connection cannot be stored securely. Generate one with: openssl rand -hex 32'
    );
  }
  return deps.tokenKey;
}

// ---------------------------------------------------------------------------
// Cryptography
// ---------------------------------------------------------------------------

/**
 * The encryption key, or a refusal.
 *
 * 32 bytes, written either as 64 hex characters or as base64. An arbitrary passphrase is
 * refused rather than stretched: silently accepting `secret123` as a 256-bit key would
 * look like encryption while providing very little of it, and the failure would be
 * invisible. `openssl rand -hex 32` is in the error message and in the documentation.
 */
function encryptionKey(rawKey: string): Buffer {
  const key = rawKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(key)) return Buffer.from(key, 'hex');

  try {
    const decoded = Buffer.from(key, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    // falls through to the refusal below
  }

  throw new SpotifyError(
    'token_key_missing',
    'SPOTIFY_TOKEN_KEY must be 32 bytes, as 64 hex characters or base64. Generate one with: openssl rand -hex 32'
  );
}

/**
 * Encrypt a token for storage.
 *
 * The output is self-describing — `v1.<iv>.<tag>.<ciphertext>` — for the same reason the
 * password format in `accounts.ts` is: the algorithm and its parameters need to be
 * changeable later without invalidating rows that were already written.
 */
export function encryptToken(plaintext: string, rawKey: string): string {
  const key = encryptionKey(rawKey);
  // 96 bits is the IV size GCM is specified for; a longer one is not more secure here.
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/**
 * Decrypt a stored token.
 *
 * A tampered or truncated value fails the GCM tag check and throws here, which is the
 * point: the alternative is returning whatever the bytes happen to decode to and handing
 * it to Spotify.
 */
export function decryptToken(stored: string, rawKey: string): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new SpotifyError('token_response_invalid', 'The stored Spotify token is not in a readable format.');
  }
  const [, ivPart, tagPart, dataPart] = parts;
  if (!ivPart || !tagPart || !dataPart) {
    throw new SpotifyError('token_response_invalid', 'The stored Spotify token is incomplete.');
  }

  const key = encryptionKey(rawKey);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    /*
     * Deliberately not surfacing the underlying error: it can distinguish a wrong key
     * from damaged data, and neither is something an administrator can act on. The fix
     * is the same — reconnect — and the message says so.
     */
    throw new SpotifyError(
      'token_response_invalid',
      'The stored Spotify token could not be read. It may have been written under a different SPOTIFY_TOKEN_KEY; reconnect Spotify to replace it.'
    );
  }
}

/** A fresh CSRF state value. 256 bits, URL-safe. */
export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

/** How a state is stored and looked up. The value itself is never written down. */
export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/** A PKCE code verifier: 43 characters of unreserved base64url, per RFC 7636. */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** The S256 challenge for a verifier. */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpotifyEventKind = 'connect' | 'refresh' | 'check' | 'disconnect' | 'error';

export interface SpotifyEventRow {
  id: number;
  kind: SpotifyEventKind;
  message: string;
  detail: string | null;
  accountId: number | null;
  createdAt: string;
}

/** The connection as stored, including ciphertext. Not for the interface. */
export interface SpotifyConnectionRow {
  id: number;
  accountId: number | null;
  spotifyUserId: string | null;
  displayName: string | null;
  email: string | null;
  product: string | null;
  country: string | null;
  scopes: string[];
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenType: string | null;
  accessExpiresAt: string | null;
  connectedAt: string | null;
  lastRefreshAt: string | null;
  lastCheckAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  disconnectedAt: string | null;
  updatedAt: string;
}

/** What the admin screen renders. Contains no token and no ciphertext. */
export interface SpotifyConnectionView {
  state: SpotifyConnectionState;
  label: string;
  configured: boolean;
  configProblem: string | null;
  redirectUri: string;
  scopes: string[];
  requestedScopes: string[];
  account: {
    spotifyUserId: string | null;
    displayName: string | null;
    email: string | null;
    product: string | null;
    country: string | null;
  } | null;
  hasRefreshToken: boolean;
  connectedAt: string | null;
  lastRefreshAt: string | null;
  lastCheckAt: string | null;
  accessExpiresAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  disconnectedAt: string | null;
  events: SpotifyEventRow[];
}

// ---------------------------------------------------------------------------
// Events — the record the admin screen reads
// ---------------------------------------------------------------------------

/**
 * Write one line of history.
 *
 * `detail` goes through `sanitiseSpotifyMessage` even though every caller in this file
 * passes it something already safe. A log that CAN leak a credential eventually does, and
 * the place to prevent that is the single function that writes the log rather than the
 * good intentions of each caller.
 */
export async function recordSpotifyEvent(
  db: Db,
  event: { kind: SpotifyEventKind; message: string; detail?: string | null; accountId?: number | null }
): Promise<void> {
  try {
    await db.query(
      `insert into spotify_event (kind, message, detail, account_id) values ($1, $2, $3, $4)`,
      [
        event.kind,
        sanitiseSpotifyMessage(event.message),
        event.detail ? sanitiseSpotifyMessage(event.detail) : null,
        event.accountId ?? null,
      ]
    );
  } catch (error) {
    /*
     * Recording history must never be the reason a flow fails. If this insert cannot
     * happen the console is the fallback — sanitised, because the console is a log too.
     */
    console.error('[spotify] could not record event:', sanitiseSpotifyMessage(error));
  }
}

export async function listSpotifyEvents(db: Db, limit = 20): Promise<SpotifyEventRow[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, kind, message, detail, account_id, created_at
       from spotify_event
      order by created_at desc, id desc
      limit $1`,
    [Math.max(1, Math.min(200, limit))]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: String(row.kind) as SpotifyEventKind,
    message: String(row.message),
    detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
    accountId: row.account_id === null || row.account_id === undefined ? null : Number(row.account_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// The authorisation attempt
// ---------------------------------------------------------------------------

export interface StartedAuthorization {
  authorizeUrl: string;
  state: string;
  expiresAt: string;
}

/**
 * Begin a connection: mint the state, keep the verifier, and build the URL to send the
 * administrator to.
 *
 * The returned `state` is the only moment the plaintext state exists outside the
 * administrator's browser. It is not logged and not stored — only its hash is.
 */
export async function startSpotifyAuthorization(
  db: Db,
  input: {
    accountId: number;
    /** A path on this site, never an absolute URL. */
    returnTo?: string | null;
  },
  options: SpotifyOptions = {}
): Promise<StartedAuthorization> {
  const deps = resolve(options);
  const { config } = deps;

  /*
   * Each missing piece names itself. A deployment with no client id has not set Spotify up
   * at all, while one that has the credentials but no token key is a different and more
   * specific problem — tokens could not be stored securely — and an administrator reading
   * "not configured" for that would go looking in the wrong place.
   */
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new SpotifyError('not_configured', config.problem ?? 'Spotify is not configured.');
  }
  // Checked up front rather than at the end of the flow: discovering that tokens cannot be
  // stored AFTER the administrator has authorised would waste their consent and leave a
  // live grant that cannot be used.
  requireTokenKey(deps);
  if (config.problem) {
    /*
     * What is left is a configuration that is present but unusable. In practice that is the
     * redirect URI: a plain-HTTP callback in production. It gets its own code rather than
     * "not configured", because the fix is different — the variables are all set, and one of
     * them holds the wrong kind of value.
     */
    throw new SpotifyError('redirect_insecure', config.problem);
  }

  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();
  const expiresAt = new Date(deps.now() + SPOTIFY_STATE_TTL_SECONDS * 1000).toISOString();

  await db.query(
    `insert into spotify_oauth_state (state_hash, account_id, code_verifier, redirect_uri, return_to, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      hashOAuthState(state),
      input.accountId,
      codeVerifier,
      config.redirectUri,
      safeReturnPath(input.returnTo),
      expiresAt,
    ]
  );

  // Opportunistic housekeeping: an attempt nobody completed is not worth keeping, and
  // this is the only moment the table is guaranteed to be touched.
  await db.query(`delete from spotify_oauth_state where expires_at < now() - interval '1 day'`);

  return {
    authorizeUrl: buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      state,
      codeChallenge: codeChallengeS256(codeVerifier),
    }),
    state,
    expiresAt,
  };
}

/**
 * Only ever a path on this site.
 *
 * A `return_to` that could be an absolute URL would turn the callback — a URL an attacker
 * can cause a browser to visit — into an open redirect. Rejecting anything that is not a
 * single-slash path is the whole defence, and it is cheaper than an allowlist that has to
 * be maintained.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length === 0 || path.length > 300) return null;
  // `//evil.com` and `https://evil.com` both start a new authority; `/admin` does not.
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.includes('\\') || path.includes('\n') || path.includes('\r')) return null;
  return path;
}

export interface ConsumedAuthorization {
  accountId: number;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string | null;
}

/**
 * Validate the state Spotify handed back, and spend it.
 *
 * The order matters and is the security property. The row is read first only to find out
 * WHY a state is unacceptable, so the administrator gets a real message; the row is then
 * spent by a single conditional UPDATE, which is what actually enforces single use. Two
 * callbacks arriving at once cannot both succeed, because only one UPDATE can match
 * `consumed_at is null`.
 *
 * `accountId` is required, not optional. The state names the administrator who started
 * the flow, and a callback arriving with a different session — or none — is refused. That
 * is the requirement that the state belong to the initiating session, and it is enforced
 * here rather than in the route so no future caller can forget it.
 */
export async function consumeSpotifyAuthorization(
  db: Db,
  input: { state: string; accountId: number | null },
  options: SpotifyOptions = {}
): Promise<ConsumedAuthorization> {
  const deps = resolve(options);

  const state = (input.state ?? '').trim();
  if (state.length === 0 || state.length > 200) {
    throw new SpotifyError('state_invalid', 'The authorisation response carried no usable state.');
  }

  const stateHash = hashOAuthState(state);

  const row = await db.one<Record<string, unknown>>(
    `select account_id, code_verifier, redirect_uri, return_to, expires_at, consumed_at
       from spotify_oauth_state where state_hash = $1`,
    [stateHash]
  );

  if (!row) {
    throw new SpotifyError(
      'state_invalid',
      'This authorisation response does not match any connection this site started. Start again from the Spotify settings page.'
    );
  }
  if (row.consumed_at !== null && row.consumed_at !== undefined) {
    throw new SpotifyError(
      'state_consumed',
      'This authorisation response has already been used. Start again from the Spotify settings page.'
    );
  }
  if (Date.parse(String(row.expires_at)) <= deps.now()) {
    throw new SpotifyError(
      'state_expired',
      'This connection attempt took too long and is no longer valid. Start again from the Spotify settings page.'
    );
  }
  if (input.accountId === null) {
    throw new SpotifyError('state_mismatch', 'Sign in to Ozikoro and start the Spotify connection again.');
  }
  if (Number(row.account_id) !== input.accountId) {
    // Not consumed, deliberately: the administrator who started this flow may still be
    // mid-redirect, and a refusal here must not burn their attempt.
    throw new SpotifyError(
      'state_mismatch',
      'This Spotify connection was started by a different administrator. Sign in as that account, or start again.'
    );
  }

  const spent = await db.one<Record<string, unknown>>(
    `update spotify_oauth_state
        set consumed_at = now()
      where state_hash = $1 and consumed_at is null and expires_at > now() and account_id = $2
      returning code_verifier, redirect_uri, return_to`,
    [stateHash, input.accountId]
  );

  if (!spent) {
    // The checks above passed a moment ago, so this is the concurrent case.
    throw new SpotifyError(
      'state_consumed',
      'This authorisation response has already been used. Start again from the Spotify settings page.'
    );
  }

  return {
    accountId: input.accountId,
    codeVerifier: String(spent.code_verifier),
    redirectUri: String(spent.redirect_uri),
    returnTo: spent.return_to === null || spent.return_to === undefined ? null : String(spent.return_to),
  };
}

// ---------------------------------------------------------------------------
// Talking to Spotify
// ---------------------------------------------------------------------------

/** Read an error body without ever letting its contents escape unsanitised. */
async function failureFrom(
  response: SpotifyHttpResponse,
  code: SpotifyErrorCode,
  fallback: string
): Promise<SpotifyError> {
  let body: unknown = null;
  try {
    const text = await response.text();
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        // A non-JSON body is a proxy's error page or a truncated response. Kept short
        // and sanitised, because the alternative is HTML in the admin screen.
        body = text.slice(0, 500);
      }
    }
  } catch {
    body = null;
  }

  const described = body === null ? fallback : sanitiseSpotifyMessage(body);
  return new SpotifyError(code, described);
}

interface TokenRequestInput {
  grantType: 'authorization_code' | 'refresh_token';
  code?: string;
  codeVerifier?: string;
  refreshToken?: string;
  redirectUri?: string;
  context: 'exchange' | 'refresh';
}

async function requestTokens(input: TokenRequestInput, deps: Resolved): Promise<SpotifyTokenSet> {
  const { config } = deps;
  if (!config.clientId || !config.clientSecret) {
    throw new SpotifyError('not_configured', config.problem ?? 'Spotify is not configured.');
  }
  const code: SpotifyErrorCode = input.context === 'refresh' ? 'refresh_failed' : 'exchange_failed';

  const body = new URLSearchParams();
  body.set('grant_type', input.grantType);
  if (input.grantType === 'authorization_code') {
    if (input.code) body.set('code', input.code);
    if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
    if (input.redirectUri) body.set('redirect_uri', input.redirectUri);
  } else if (input.refreshToken) {
    body.set('refresh_token', input.refreshToken);
  }

  /*
   * The client credentials go in the Authorization header, not the body. Spotify accepts
   * both; the header keeps the secret out of the request body, which is the part a proxy
   * or an over-eager logger is most likely to record.
   */
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64');

  let response: SpotifyHttpResponse;
  try {
    response = await deps.fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch (error) {
    throw new SpotifyError('network', `Could not reach Spotify: ${sanitiseSpotifyMessage(error)}`);
  }

  if (!response.ok) {
    throw await failureFrom(response, code, input.context === 'refresh' ? 'refresh_failed' : 'exchange_failed');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new SpotifyError('token_response_invalid', 'Spotify returned a token response that could not be read.');
  }

  return parseTokenResponse(payload, { now: deps.now(), context: input.context });
}

/** Exchange an authorisation code for tokens. The client secret never leaves the server. */
export async function exchangeCodeForTokens(
  input: { code: string; codeVerifier: string; redirectUri: string },
  options: SpotifyOptions = {}
): Promise<SpotifyTokenSet> {
  return requestTokens(
    {
      grantType: 'authorization_code',
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      context: 'exchange',
    },
    resolve(options)
  );
}

/** Trade a refresh token for a new access token. */
export async function refreshAccessToken(
  refreshToken: string,
  options: SpotifyOptions = {}
): Promise<SpotifyTokenSet> {
  return requestTokens({ grantType: 'refresh_token', refreshToken, context: 'refresh' }, resolve(options));
}

export interface SpotifyProfile {
  id: string | null;
  displayName: string | null;
  email: string | null;
  product: string | null;
  country: string | null;
}

/** `GET /me` — who this access token belongs to. */
export async function fetchSpotifyProfile(
  accessToken: string,
  options: SpotifyOptions = {}
): Promise<SpotifyProfile> {
  const deps = resolve(options);

  let response: SpotifyHttpResponse;
  try {
    response = await deps.fetch(`${SPOTIFY_API_ORIGIN}/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch (error) {
    throw new SpotifyError('network', `Could not reach Spotify: ${sanitiseSpotifyMessage(error)}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new SpotifyError('api_unauthorised', 'Spotify refused the access token.');
  }
  if (!response.ok) {
    throw await failureFrom(response, 'api_failed', 'Spotify could not read the account.');
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await response.text()) as Record<string, unknown>;
  } catch {
    throw new SpotifyError('api_failed', 'Spotify returned a profile that could not be read.');
  }

  const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
  return {
    id: str(payload.id),
    displayName: str(payload.display_name),
    email: str(payload.email),
    // Spotify sends `product` as "premium"/"free"; informational here.
    product: str(payload.product),
    country: str(payload.country),
  };
}

// ---------------------------------------------------------------------------
// The stored connection
// ---------------------------------------------------------------------------

function normaliseConnection(row: Record<string, unknown>): SpotifyConnectionRow {
  const iso = (value: unknown): string | null =>
    value === null || value === undefined ? null : new Date(String(value)).toISOString();
  const str = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);

  return {
    id: Number(row.id),
    accountId: row.account_id === null || row.account_id === undefined ? null : Number(row.account_id),
    spotifyUserId: str(row.spotify_user_id),
    displayName: str(row.display_name),
    email: str(row.email),
    product: str(row.product),
    country: str(row.country),
    // `text[]` arrives as a JS array from both drivers; a null or malformed value becomes
    // an empty list rather than a crash on the admin screen.
    scopes: Array.isArray(row.scopes) ? row.scopes.map((s) => String(s)) : [],
    accessTokenEnc: str(row.access_token_enc),
    refreshTokenEnc: str(row.refresh_token_enc),
    tokenType: str(row.token_type),
    accessExpiresAt: iso(row.access_expires_at),
    connectedAt: iso(row.connected_at),
    lastRefreshAt: iso(row.last_refresh_at),
    lastCheckAt: iso(row.last_check_at),
    lastError: str(row.last_error),
    lastErrorAt: iso(row.last_error_at),
    disconnectedAt: iso(row.disconnected_at),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

const CONNECTION_COLUMNS = `id, account_id, spotify_user_id, display_name, email, product, country, scopes,
  access_token_enc, refresh_token_enc, token_type, access_expires_at, connected_at, last_refresh_at,
  last_check_at, last_error, last_error_at, disconnected_at, updated_at`;

/** The stored row, ciphertext included. Internal; the interface uses `spotifyConnectionView`. */
export async function readSpotifyConnectionRow(db: Db): Promise<SpotifyConnectionRow | null> {
  const row = await db.one<Record<string, unknown>>(
    `select ${CONNECTION_COLUMNS} from spotify_connection where id = 1`
  );
  return row ? normaliseConnection(row) : null;
}

/** True when a live, usable authorisation is held. */
function isLive(connection: SpotifyConnectionRow | null): connection is SpotifyConnectionRow {
  if (!connection) return false;
  return (
    connection.disconnectedAt === null &&
    (connection.accessTokenEnc !== null || connection.refreshTokenEnc !== null)
  );
}

/**
 * Remember a completed authorisation.
 *
 * `on conflict (id) do update` because the connection is a singleton: reconnecting must
 * replace the previous grant rather than accumulate a second one. Every field is written,
 * including clearing `disconnected_at` and `last_error`, so a reconnect is a clean slate
 * rather than a new grant still showing the old failure.
 *
 * `connected_at` is only ever set here. It is NOT touched by a token renewal — a refresh
 * must not rewrite the date the administrator actually connected, or the admin screen
 * would report that the connection is minutes old forever.
 */
export async function saveSpotifyConnection(
  db: Db,
  input: { accountId: number; tokens: SpotifyTokenSet; profile: SpotifyProfile },
  options: SpotifyOptions = {}
): Promise<void> {
  const deps = resolve(options);
  const key = requireTokenKey(deps);

  const grantedScopes =
    input.tokens.scopes.length > 0
      ? input.tokens.scopes
      : deps.config.scopes.length > 0
        ? deps.config.scopes
        : [...DEFAULT_SPOTIFY_SCOPES];

  await db.query(
    `insert into spotify_connection (
       id, account_id, spotify_user_id, display_name, email, product, country, scopes,
       access_token_enc, refresh_token_enc, token_type, access_expires_at,
       connected_at, last_refresh_at, last_check_at, last_error, last_error_at, disconnected_at, updated_at
     ) values (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), now(), null, null, null, now())
     on conflict (id) do update set
       account_id        = excluded.account_id,
       spotify_user_id   = excluded.spotify_user_id,
       display_name      = excluded.display_name,
       email             = excluded.email,
       product           = excluded.product,
       country           = excluded.country,
       scopes            = excluded.scopes,
       access_token_enc  = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc,
       token_type        = excluded.token_type,
       access_expires_at = excluded.access_expires_at,
       connected_at      = now(),
       last_refresh_at   = now(),
       last_check_at     = now(),
       last_error        = null,
       last_error_at     = null,
       disconnected_at   = null,
       updated_at        = now()`,
    [
      input.accountId,
      input.profile.id,
      input.profile.displayName,
      input.profile.email,
      input.profile.product,
      input.profile.country,
      grantedScopes,
      encryptToken(input.tokens.accessToken, key),
      input.tokens.refreshToken !== null ? encryptToken(input.tokens.refreshToken, key) : null,
      input.tokens.tokenType,
      input.tokens.expiresAt,
    ]
  );
}

/**
 * Replace only the tokens, after a renewal.
 *
 * Separated from `saveSpotifyConnection` so a refresh cannot rewrite the facts of the
 * connection: when it was made, who made it, what was granted, and when it was last
 * positively checked are all left exactly as they were. A refresh response that omits the
 * refresh token keeps the stored one, because discarding it would delete the only means of
 * renewing ever again.
 */
export async function updateSpotifyTokens(
  db: Db,
  input: { tokens: SpotifyTokenSet },
  options: SpotifyOptions = {}
): Promise<void> {
  const deps = resolve(options);
  const key = requireTokenKey(deps);

  await db.query(
    `update spotify_connection
        set access_token_enc  = $1,
            refresh_token_enc = coalesce($2, refresh_token_enc),
            token_type        = $3,
            access_expires_at = $4,
            last_refresh_at   = now(),
            updated_at        = now()
      where id = 1`,
    [
      encryptToken(input.tokens.accessToken, key),
      input.tokens.refreshToken !== null ? encryptToken(input.tokens.refreshToken, key) : null,
      input.tokens.tokenType,
      input.tokens.expiresAt,
    ]
  );
}

/** Record a failure against the connection, sanitised, without touching the tokens. */
export async function recordSpotifyFailure(
  db: Db,
  input: { message: string; detail?: string | null; kind?: SpotifyEventKind; accountId?: number | null }
): Promise<void> {
  const message = sanitiseSpotifyMessage(input.message);
  await db.query(
    `update spotify_connection set last_error = $1, last_error_at = now(), updated_at = now() where id = 1`,
    [message]
  );
  await recordSpotifyEvent(db, {
    kind: input.kind ?? 'error',
    message,
    detail: input.detail ?? null,
    accountId: input.accountId ?? null,
  });
}

/** Clear a stored failure after something succeeded. */
export async function clearSpotifyFailure(db: Db): Promise<void> {
  await db.query(
    `update spotify_connection set last_error = null, last_error_at = null, updated_at = now() where id = 1`
  );
}

/**
 * A valid access token, refreshed first if it is close to expiring.
 *
 * This is the function the podcast workflow will call, and the behaviour it guarantees is
 * the requirement: an expired access token is renewed from the stored refresh token
 * without the administrator being asked to reconnect. Reconnecting is required only when
 * the refresh token itself is refused — the one case Spotify makes unavoidable.
 */
export async function getValidAccessToken(db: Db, options: SpotifyOptions = {}): Promise<string> {
  const deps = resolve(options);
  const key = requireTokenKey(deps);

  const connection = await readSpotifyConnectionRow(db);
  if (!isLive(connection)) {
    throw new SpotifyError('not_connected', 'Spotify is not connected.');
  }

  const stale = refreshDue(connection.accessExpiresAt, {
    now: deps.now(),
    skewSeconds: SPOTIFY_REFRESH_SKEW_SECONDS,
  });

  if (connection.accessTokenEnc && !stale && !options.forceRefresh) {
    return decryptToken(connection.accessTokenEnc, key);
  }

  if (!connection.refreshTokenEnc) {
    throw new SpotifyError(
      'not_connected',
      'The Spotify access token has expired and no refresh token is stored. Reconnect Spotify.'
    );
  }

  const refreshToken = decryptToken(connection.refreshTokenEnc, key);

  let tokens: SpotifyTokenSet;
  try {
    tokens = await refreshAccessToken(refreshToken, options);
  } catch (error) {
    const failure = asSpotifyError(error, 'refresh_failed');
    /*
     * A refused refresh grant is terminal: Spotify has revoked the authorisation, or the
     * token was issued to a different app. Recording it matters more than usual, because
     * this is the failure an administrator would otherwise first notice as "publishing
     * stopped working" with nothing on screen to explain it.
     */
    await recordSpotifyFailure(db, {
      message: 'Spotify refused to renew the connection. Reconnect Spotify to restore it.',
      detail: failure.message,
      accountId: connection.accountId,
    });
    throw new SpotifyError('refresh_failed', failure.message);
  }

  await updateSpotifyTokens(db, { tokens }, options);
  await clearSpotifyFailure(db);
  await recordSpotifyEvent(db, {
    kind: 'refresh',
    message: 'The Spotify access token was renewed automatically.',
    accountId: connection.accountId,
  });

  return tokens.accessToken;
}

/**
 * Confirm the connection still works, and refresh the account details.
 *
 * This is what the admin screen's "Check now" button calls, and what gives "last
 * successful check" a meaning: the connection was not merely stored, it was proved against
 * Spotify a moment ago.
 */
export async function checkSpotifyConnection(db: Db, options: SpotifyOptions = {}): Promise<SpotifyProfile> {
  const accessToken = await getValidAccessToken(db, options);
  const profile = await fetchSpotifyProfile(accessToken, options);

  await db.query(
    `update spotify_connection
        set spotify_user_id = coalesce($1, spotify_user_id),
            display_name    = coalesce($2, display_name),
            email           = coalesce($3, email),
            product         = coalesce($4, product),
            country         = coalesce($5, country),
            last_check_at   = now(),
            last_error      = null,
            last_error_at   = null,
            updated_at      = now()
      where id = 1`,
    [profile.id, profile.displayName, profile.email, profile.product, profile.country]
  );

  await recordSpotifyEvent(db, {
    kind: 'check',
    message: `Connection checked successfully${profile.displayName ? ` as ${profile.displayName}` : ''}.`,
  });

  return profile;
}

/**
 * Disconnect.
 *
 * Spotify publishes no token-revocation endpoint — it is an open feature request on the
 * Web API tracker (spotify/web-api#600) — so this cannot call one, and inventing a URL
 * that does not exist would be worse than saying so. What it does instead is destroy the
 * only copy Ozikoro holds: the ciphertext is cleared, so the tokens are gone and the
 * connection is dead from this side immediately. The grant that remains on Spotify's side
 * is inert without a refresh token, and the admin screen points the administrator at
 * Spotify's own app-permissions page to remove it there as well if they want to.
 */
export async function disconnectSpotify(
  db: Db,
  input: { accountId: number | null; reason?: string }
): Promise<void> {
  const existing = await readSpotifyConnectionRow(db);
  const wasAccount = existing?.displayName ?? existing?.spotifyUserId ?? null;

  await db.query(
    `update spotify_connection
        set access_token_enc  = null,
            refresh_token_enc = null,
            token_type        = null,
            access_expires_at = null,
            scopes            = '{}',
            last_error        = null,
            last_error_at     = null,
            disconnected_at   = now(),
            updated_at        = now()
      where id = 1`
  );

  await recordSpotifyEvent(db, {
    kind: 'disconnect',
    message: input.reason ?? `Spotify disconnected${wasAccount ? ` (was ${wasAccount})` : ''}.`,
    detail:
      'Stored access and refresh tokens were deleted. The authorisation stays listed on the Spotify account ' +
      'until it is removed at spotify.com/account/apps.',
    accountId: input.accountId,
  });
}

// ---------------------------------------------------------------------------
// What the admin screen reads
// ---------------------------------------------------------------------------

/**
 * Everything the Spotify settings screen needs, in one read, with no token in it.
 *
 * Composed here rather than in the page so that "what state is this connection in" is
 * answered in one place, by the same code the tests exercise, rather than re-derived in
 * JSX where it cannot be checked.
 */
export async function spotifyConnectionView(db: Db, options: SpotifyOptions = {}): Promise<SpotifyConnectionView> {
  const deps = resolve(options);
  const { config } = deps;

  const [row, events] = await Promise.all([readSpotifyConnectionRow(db), listSpotifyEvents(db, 20)]);

  const live = isLive(row);
  const state = connectionState({
    configured: config.problem === null,
    connected: live,
    expiresAt: row?.accessExpiresAt ?? null,
    hasRefreshToken: Boolean(row?.refreshTokenEnc),
    lastError: live ? (row?.lastError ?? null) : null,
    now: deps.now(),
  });

  return {
    state,
    label: connectionStateLabel(state),
    configured: config.problem === null,
    configProblem: config.problem,
    // Safe to show: this is a public callback address, not a credential.
    redirectUri: config.redirectUri ?? '',
    scopes: row?.scopes ?? [],
    requestedScopes: config.scopes.length > 0 ? config.scopes : [...DEFAULT_SPOTIFY_SCOPES],
    account: row
      ? {
          spotifyUserId: row.spotifyUserId,
          displayName: row.displayName,
          email: row.email,
          product: row.product,
          country: row.country,
        }
      : null,
    hasRefreshToken: Boolean(row?.refreshTokenEnc),
    connectedAt: row?.connectedAt ?? null,
    lastRefreshAt: row?.lastRefreshAt ?? null,
    lastCheckAt: row?.lastCheckAt ?? null,
    accessExpiresAt: row?.accessExpiresAt ?? null,
    lastError: row?.lastError ?? null,
    lastErrorAt: row?.lastErrorAt ?? null,
    disconnectedAt: row?.disconnectedAt ?? null,
    events,
  };
}

// ---------------------------------------------------------------------------
// The callback, as a decision rather than a route
// ---------------------------------------------------------------------------

/** Where the administrator lands after the callback, and what they are told. */
export interface SpotifyCallbackOutcome {
  ok: boolean;
  /** A path on this site. Never absolute, so the callback cannot be an open redirect. */
  redirectPath: string;
  /** The safe, human-readable sentence for the settings screen. */
  message: string;
  /** Present only when the failure came from this integration's own vocabulary. */
  errorCode?: SpotifyErrorCode;
  /** Present on success. Contains no token. */
  connection?: SpotifyProfile;
}

export interface SpotifyCallbackInput {
  /** The query string Spotify appended, including its own `error` on a refusal. */
  params: URLSearchParams;
  /** The account presenting the callback, from the session cookie. May be null. */
  accountId: number | null;
  /** Where to send them on success. Defaults to `/admin/spotify`. */
  successPath?: string;
  /** Where to send them on failure. Defaults to `/admin/spotify`. */
  failurePath?: string;
}

/** The sentence shown when Spotify reports the administrator refused the consent screen. */
const DENIED_MESSAGE =
  'Spotify access was not granted. Nothing was changed — you can try again whenever you are ready.';

/**
 * Everything the callback route needs to decide, in one testable place.
 *
 * The route that calls this is deliberately left with nothing but: read the session, run
 * this, redirect. All the branching lives here because here it can be exercised against a
 * scripted Spotify and a real database, without standing up a server — which is the
 * difference between "the callback has tests" and "the callback has a comment saying it
 * works".
 *
 * It never throws for an expected failure: a denied authorisation, a stale state, a
 * refused exchange and an unreachable Spotify all come back as an outcome with a safe
 * message and a path to redirect to. A thrown error would reach the operator as a stack
 * trace in a log and reach the administrator as a failed request, and neither is what
 * should happen when someone presses Cancel on Spotify's consent screen.
 */
export async function completeSpotifyCallback(
  db: Db,
  input: SpotifyCallbackInput,
  options: SpotifyOptions = {}
): Promise<SpotifyCallbackOutcome> {
  const deps = resolve(options);
  const successPath = safeReturnPath(input.successPath) ?? '/admin/spotify';
  const failurePath = safeReturnPath(input.failurePath) ?? '/admin/spotify';

  const fail = (message: string, errorCode?: SpotifyErrorCode): SpotifyCallbackOutcome => ({
    ok: false,
    redirectPath: failurePath,
    message,
    ...(errorCode ? { errorCode } : {}),
  });

  /*
   * Spotify's refusal comes first and is not an exceptional case: it is a documented
   * response to the administrator pressing Cancel, and it must read like one. The state is
   * still spent below when it is present, so a denied attempt cannot be replayed.
   */
  const providerError = (input.params.get('error') ?? '').trim();
  if (providerError.length > 0) {
    const message = providerError === 'access_denied' ? DENIED_MESSAGE : `Spotify refused the request: ${providerError}`;
    await recordSpotifyEvent(db, {
      kind: 'error',
      message,
      // Sanitised inside recordSpotifyEvent; the value came from a query string.
      detail: input.params.get('error_description'),
      accountId: input.accountId,
    });
    // Spend the state if it is valid, purely so it cannot be reused. A failure here is
    // irrelevant: the attempt is already over.
    const state = (input.params.get('state') ?? '').trim();
    if (state.length > 0) {
      try {
        await consumeSpotifyAuthorization(db, { state, accountId: input.accountId }, options);
      } catch {
        // Intentionally ignored.
      }
    }
    return fail(message, providerError === 'access_denied' ? 'access_denied' : 'api_failed');
  }

  const code = (input.params.get('code') ?? '').trim();
  const state = (input.params.get('state') ?? '').trim();

  if (code.length === 0) {
    return fail('Spotify did not return an authorisation code. Start again from this page.', 'state_invalid');
  }

  let grant: ConsumedAuthorization;
  try {
    grant = await consumeSpotifyAuthorization(db, { state, accountId: input.accountId }, options);
  } catch (error) {
    const failure = asSpotifyError(error, 'state_invalid');
    // A bad state is not written to spotify_connection: there is no connection to blame,
    // and a stranger's callback should not be able to put a message on the admin screen.
    await recordSpotifyEvent(db, {
      kind: 'error',
      message: failure.message,
      detail: `Rejected state (${failure.code}).`,
      accountId: input.accountId,
    });
    return fail(failure.message, failure.code);
  }

  /*
   * The redirect URI used for the exchange is the one recorded when the attempt began,
   * not the currently configured one. Spotify requires it to be identical to the value
   * sent to the authorise endpoint, and the stored one is that value by construction.
   */
  try {
    const tokens = await exchangeCodeForTokens(
      { code, codeVerifier: grant.codeVerifier, redirectUri: grant.redirectUri },
      options
    );

    if (deps.config.redirectUri && deps.config.redirectUri !== grant.redirectUri) {
      // Not fatal, but worth a line: it means SPOTIFY_REDIRECT_URI changed mid-flight and
      // the Dashboard may now be out of step with the deployment.
      await recordSpotifyEvent(db, {
        kind: 'error',
        message: 'The configured Spotify redirect URI changed during this connection attempt.',
        detail: `Started with ${grant.redirectUri}, now ${deps.config.redirectUri}.`,
        accountId: grant.accountId,
      });
    }

    const profile = await fetchSpotifyProfile(tokens.accessToken, options);
    await saveSpotifyConnection(db, { accountId: grant.accountId, tokens, profile }, options);

    await recordSpotifyEvent(db, {
      kind: 'connect',
      message: `Spotify connected successfully${profile.displayName ? ` as ${profile.displayName}` : ''}.`,
      accountId: grant.accountId,
    });

    const destination = safeReturnPath(grant.returnTo) ?? successPath;
    return {
      ok: true,
      redirectPath: destination,
      message: 'Spotify connected successfully.',
      connection: profile,
    };
  } catch (error) {
    const failure = asSpotifyError(error, 'exchange_failed');
    /*
     * The message stored and shown is the sanitised one, and the raw body never is. The
     * only failure that reaches here with a token-shaped value in it is Spotify's own
     * error description, and `sanitiseSpotifyMessage` has already been applied inside
     * `failureFrom`.
     */
    await recordSpotifyFailure(db, {
      message: 'The Spotify connection could not be completed.',
      detail: failure.message,
      accountId: grant.accountId,
    });
    return fail(failure.message, failure.code);
  }
}

// ---------------------------------------------------------------------------
// The seam the publishing workflow will use
// ---------------------------------------------------------------------------

/**
 * Call the Spotify Web API with a valid access token.
 *
 * Written now, before there is a caller, because it is the piece the future podcast
 * workflow needs and because getting it right is what makes the connection reusable rather
 * than single-purpose.
 *
 * A 401 is retried exactly once, after a forced refresh: an access token can be revoked
 * between the expiry check and the call, and a second 401 after a successful refresh means
 * the grant itself is gone rather than the token. The retry forces the refresh rather than
 * re-reading, because a token that just failed is not made valid by being read again.
 *
 * It returns the status and the parsed body rather than throwing on 4xx, so a caller
 * publishing an episode can decide for itself what a 429 means instead of unwinding.
 */
export async function spotifyApiCall(
  db: Db,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
  options: SpotifyOptions = {}
): Promise<{ status: number; body: unknown }> {
  const deps = resolve(options);
  if (!path.startsWith('/')) {
    throw new SpotifyError('api_failed', 'A Spotify API path must start with "/".');
  }

  const url = new URL(`${SPOTIFY_API_ORIGIN}${path}`);
  for (const [name, value] of Object.entries(init.query ?? {})) url.searchParams.set(name, value);

  const send = async (token: string): Promise<SpotifyHttpResponse> => {
    try {
      return await deps.fetch(url.toString(), {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
    } catch (error) {
      throw new SpotifyError('network', `Could not reach Spotify: ${sanitiseSpotifyMessage(error)}`);
    }
  };

  let response = await send(await getValidAccessToken(db, options));

  if (response.status === 401) {
    response = await send(await getValidAccessToken(db, { ...options, forceRefresh: true }));
    if (response.status === 401) {
      throw new SpotifyError(
        'api_unauthorised',
        'Spotify refused the connection. Reconnect Spotify to restore it.'
      );
    }
  }

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
  }

  return { status: response.status, body };
}
