/**
 * /admin/spotify — the Spotify connection.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * It answers four questions an administrator actually has, in the order they ask them:
 *
 *   1. Is Ozikoro connected to Spotify?
 *   2. If so, to which account, and since when?
 *   3. If not, what do I have to do about it?
 *   4. If it broke, what happened?
 *
 * So it shows a status rather than a boolean, names the connected account instead of saying
 * "connected", states the exact callback address so it can be checked against the Spotify
 * Developer Dashboard, and keeps the recent history visible rather than in a log file nobody
 * opens.
 *
 * WHAT IT NEVER SHOWS
 *
 * No access token, no refresh token, no ciphertext, no client secret, and no raw OAuth error.
 * `spotifyConnectionView` in `@ozikoro/platform` is written so that the object it returns
 * cannot contain one, and this page renders that object. The error text comes from messages
 * that were sanitised on the way into the database, not on the way out of it.
 *
 * WHY THE BUTTONS ARE FORMS
 *
 * Connect, Check and Disconnect all change state, so all three are POST forms with a submit
 * button. A GET link that started an authorisation could be triggered by any image tag on any
 * page on the internet, and a link that disconnected an account could be triggered the same way.
 */
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { spotifyConnectionView, type SpotifyEventRow } from '@ozikoro/platform';
import { requireAdministratorOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Spotify',
  robots: { index: false, follow: false },
};

/**
 * A timestamp an administrator can trust.
 *
 * Rendered in UTC and labelled as such rather than in the server's local zone. The server may be
 * in a different timezone from the reader, and "last checked 04:12" without a zone is exactly the
 * kind of ambiguity that wastes an afternoon when a token's expiry matters.
 */
function when(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  })} UTC`;
}

const KIND_LABEL: Record<SpotifyEventRow['kind'], string> = {
  connect: 'Connected',
  refresh: 'Renewed',
  check: 'Checked',
  disconnect: 'Disconnected',
  error: 'Problem',
};

function history(events: SpotifyEventRow[]) {
  if (events.length === 0) {
    return <p className="help">Nothing has happened yet.</p>;
  }
  return (
    <ul className="history">
      {events.map((event) => (
        <li key={event.id}>
          <div className="history__when">
            {when(event.createdAt)} · {KIND_LABEL[event.kind]}
          </div>
          <p className="history__what">{event.message}</p>
          {event.detail ? <p className="history__detail">{event.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    disconnected?: string;
    checked?: string;
    as?: string;
    error?: string;
    welcome?: string;
  }>;
}) {
  const params = await searchParams;

  /*
   * The page's own guard, FIRST. The connection screen states the callback address and the granted scopes,
   * and every endpoint that changes it already requires an administrator or the owner — **so the page that
   * shows it must ask the same question**, and the layout's guard does not stop this page rendering before it
   * redirects. See `requireAdministratorOrRedirect`.
   */
  await requireAdministratorOrRedirect('/admin/spotify');

  const db = await getDb();
  const view = await spotifyConnectionView(db);

  /*
   * The success sentence the requirement names, shown verbatim. `connected=1` is set by the
   * callback redirect and by nothing else, so this cannot appear for a flow that did not finish.
   */
  const saved = params.connected
    ? 'Spotify connected successfully.'
    : params.disconnected
      ? 'Spotify has been disconnected. The stored access and refresh tokens are gone.'
      : params.checked
        ? `The connection was checked successfully${params.as ? ` as ${params.as}` : ''}.`
        : undefined;

  const badgeClass =
    view.state === 'connected'
      ? 'badge badge--on'
      : view.state === 'connected_expiring'
        ? 'badge badge--on'
        : view.state === 'connected_unrefreshable' || view.state === 'error'
          ? 'badge badge--error'
          : view.state === 'not_configured'
            ? 'badge badge--warn'
            : 'badge badge--off';

  const accountRows: [string, React.ReactNode][] = [
    ['Status', <span key="status" className={badgeClass}>{view.label}</span>],
    ['Spotify account', view.account?.displayName ?? view.account?.spotifyUserId ?? 'not known yet'],
    ['Account email', view.account?.email ?? 'not shared by Spotify'],
    ['Plan', view.account?.product ?? 'not known yet'],
    ['Country', view.account?.country ?? 'not known yet'],
    ['Connected', when(view.connectedAt)],
    ['Access token', `renewed ${when(view.lastRefreshAt)}, expires ${when(view.accessExpiresAt)}`],
    ['Last successful check', when(view.lastCheckAt)],
    [
      'Renewal',
      view.hasRefreshToken
        ? 'Automatic. An expired access token is renewed without reconnecting.'
        : 'No refresh token is held, so the access token cannot be renewed.',
    ],
  ];

  return (
    <>
      <Head title="Spotify">
        <a className="btn btn--sm" href="/admin">
          Back to administration
        </a>
      </Head>

      <Notices saved={saved} error={params.error} />

      {view.configProblem ? (
        <div className="notice notice--info">
          <div>
            <p className="notice__title">Configuration</p>
            <p className="notice__body">{view.configProblem}</p>
          </div>
        </div>
      ) : null}

      <Card title="Connection">
        <AtAGlance rows={accountRows} />

        {view.lastError ? (
          <div className="notice notice--error" role="alert" style={{ marginTop: '1.25rem' }}>
            <div>
              <p className="notice__title">Last error</p>
              <p className="notice__body">{view.lastError}</p>
              <p className="notice__body">
                <span className="history__when">{when(view.lastErrorAt)}</span>
              </p>
            </div>
          </div>
        ) : null}

        <div className="actions" style={{ marginTop: '1.25rem' }}>
          {/*
            The connect button is disabled while the environment is incomplete, because pressing
            it would only produce the same configuration message again. The reason is stated in
            the notice above rather than hidden behind a dead control.
          */}
          <form method="post" action="/api/spotify/connect">
            <button className="btn btn--primary" type="submit" disabled={!view.configured}>
              {view.state === 'disconnected' || view.state === 'not_configured'
                ? 'Connect Spotify'
                : 'Reconnect Spotify'}
            </button>
          </form>

          <form method="post" action="/api/spotify/check">
            <button className="btn" type="submit" disabled={!view.configured || !view.account}>
              Check now
            </button>
          </form>

          {view.account ? (
            <form method="post" action="/api/spotify/disconnect">
              <button className="btn btn--danger" type="submit">
                Disconnect
              </button>
            </form>
          ) : null}
        </div>
      </Card>

      <Card title="What Ozikoro is allowed to do">
        <p>
          The connection asks Spotify for exactly what it needs to identify the account and nothing
          else, so it cannot read a library, change a playlist or start playback.
        </p>
        <AtAGlance
          rows={[
            ['Requested', view.requestedScopes.join(', ') || 'none'],
            [
              'Granted',
              view.scopes.length > 0 ? view.scopes.join(', ') : 'not known until the first check',
            ],
          ]}
        />
        <p className="help">
          What Spotify actually granted is recorded from its own response rather than assumed from
          what was asked, because the consent screen can be edited.
        </p>
      </Card>

      <Card title="The callback address">
        <p>
          This is the address registered with the Spotify Developer Dashboard, and the two must
          match exactly, character for character. A mismatch is the most common reason a connection
          fails, and Spotify reports it as an invalid redirect URI rather than as a wrong address.
        </p>
        <p className="mono">{view.redirectUri || 'not set'}</p>
        <p className="help">
          It comes from <code>SPOTIFY_REDIRECT_URI</code>, which defaults to the production address.
          A development or staging environment sets its own value and must add that address to the
          Dashboard as well.
        </p>
      </Card>

      <Card title="Disconnecting, and what it does not do">
        <p>
          Disconnecting deletes the stored access and refresh tokens. That is the only copy Ozikoro
          holds, so the connection stops working immediately.
        </p>
        <p>
          It does not remove the authorisation from your Spotify account, because Spotify publishes
          no endpoint for that. The grant that remains cannot be used without a refresh token, but
          if you want it gone from your account too, remove Ozikoro at{' '}
          <a href="https://www.spotify.com/account/apps" rel="noopener noreferrer" target="_blank">
            spotify.com/account/apps
          </a>
          .
        </p>
      </Card>

      <Card title="History">{history(view.events)}</Card>

      <Card title="What this is not yet" quiet>
        <p>
          This is the secure connection, not a publishing integration. It gives Ozikoro an
          authorised Spotify account and a way to keep it authorised; it does not publish anything.
        </p>
        <p>
          The intended workflow — an article becomes a podcast script, then audio, then metadata,
          then an episode on Spotify — needs a distribution mechanism chosen separately, because
          Spotify&rsquo;s authorisation does not include an audio upload capability. The connection
          is built so that step can be added without redoing this one.
        </p>
      </Card>
    </>
  );
}
