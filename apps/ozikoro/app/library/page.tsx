/**
 * The reader's own library — what they saved, what they follow, and what they have read.
 *
 * WHY THIS PAGE EXISTS
 *
 * The reader's dashboard has drawn *Saved histories*, *Followed topics* and *Reading history* as three of
 * its four modules since the design was handed over. Until migration `0060_ozikoro_library.sql` **two of
 * the three had no table at all**, so the honest thing the dashboard could serve was a label saying the
 * feature was not built — which is what the owner found and reported: *"even 'Saved histories — Not built
 * yet / Followed topics — Not built yet / Reading history — Not' are not working."*
 *
 * This is the destination the three labels now point at. It is the reader's own page: it shows nobody
 * else's, it is gated on being signed in, and every row can be removed by the person it belongs to.
 *
 * WHY ONE PAGE AND NOT THREE ROUTES
 *
 * The three lists answer one question — *what is mine here* — and the design draws them as three modules
 * of one workspace. Three routes would mean three gates, three headers and three chances for the counts
 * in the dashboard's metrics row to disagree with the lists they count. The anchors `#saved`,
 * `#following` and `#history` are what the dashboard's three labels point at, so each label still lands
 * on its own list.
 *
 * WHY THE ROWS CAN BE REMOVED BUT NOT EDITED
 *
 * A save has no folder, note or tag, because the design draws no control for one. **A column nothing can
 * write is a promise dressed as a schema**, and an "edit" link here would lead to a form that does not
 * exist. Removal is offered because it is the reader's own row and it is one button.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listFollowedTopics, listReadingHistory, listSaved, listTopics } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your library',
  description: 'What you have saved, the series you follow, and what you have been reading.',
  robots: { index: false, follow: false },
};

/** `2026-10-06T09:12:04.000Z` -> `6 October 2026`. The archive counts and dates in en-GB. */
function day(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;
  /*
   * GATED ON `read`, WHICH EVERY ROLE HOLDS. This is the reader's own page, so the gate is "there is
   * somebody signed in" rather than a capability — requiring a named capability would invent an authority
   * that does not exist, exactly as `/api/follows` records for following.
   */
  const guard = await requireCapabilityOrRedirect('read', '/library/');
  const accountId = guard.account.account.id;

  const db = await getDb();
  const [saved, following, history, series] = await Promise.all([
    listSaved(db, { accountId }),
    listFollowedTopics(db, accountId),
    listReadingHistory(db, { accountId }),
    /*
     * EVERY SERIES THE ARCHIVE HAS, so a reader can start following one from here.
     *
     * WHY THE LIST IS ON THIS PAGE AND NOT ONLY ON A SERIES PAGE: **a series page is not reachable by
     * clicking anywhere on the site** — the design's own Topics screen links each series to
     * `/archive-index?topic=<slug>`, the filtered archive, and the application's `/topics/<slug>/` route
     * that carries the Follow control is therefore an orphan. Measured before this block existed: no page
     * on the site linked to it. Putting the control where the reader already is (this page) is what makes
     * *Followed topics* a feature rather than a table nobody can write to.
     */
    listTopics(db),
  ]);
  const followedTopicIds = new Set(following.map((follow) => follow.topicId));

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">Your workspace</p>
        <h1>Your library</h1>
        <p className="lede">
          What you asked the archive to keep, the series you follow, and where you have been reading. All
          three are yours alone — no other reader, and no editor, can see this page.
        </p>
      </header>

      {notices.saved ? (
        <div className="notice notice--success" role="status">
          <div>
            <p className="notice__body">{notices.saved}</p>
          </div>
        </div>
      ) : null}
      {notices.error ? (
        <div className="notice notice--error" role="alert">
          <div>
            <p className="notice__body">{notices.error}</p>
          </div>
        </div>
      ) : null}

      {/* ── SAVED ────────────────────────────────────────────────────────────────────────────────── */}
      <section className="section" id="saved">
        <div className="panel__head">
          <h2 className="panel__title">Saved histories</h2>
          <p className="small muted">{saved.length === 0 ? 'Nothing saved' : `${saved.length} saved`}</p>
        </div>

        {saved.length === 0 ? (
          <div className="empty section">
            <p className="eyebrow">Nothing saved yet</p>
            <p>
              A record you save appears here, and stays until you remove it. Open a series from the list
              below and each of its records carries a <strong>Save this history</strong> button.
            </p>
          </div>
        ) : (
          <ul className="stack">
            {saved.map((row) => (
              <li key={row.articleId} className="row" style={{ justifyContent: 'space-between', gap: 'var(--s-3)' }}>
                <span>
                  <Link href={`/${row.slug}/`}>{row.title}</Link>{' '}
                  <span className="small muted">saved {day(row.at)}</span>
                </span>
                <form method="post" action="/api/library">
                  <input type="hidden" name="action" value="unsave" />
                  <input type="hidden" name="articleId" value={row.articleId} />
                  <input type="hidden" name="returnTo" value="/library/#saved" />
                  <button className="btn btn-quiet btn-sm" type="submit">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── FOLLOWING ────────────────────────────────────────────────────────────────────────────── */}
      <section className="section" id="following">
        <div className="panel__head">
          <h2 className="panel__title">Followed topics</h2>
          <p className="small muted">
            {following.length === 0 ? 'Following nothing' : `${following.length} series`}
          </p>
        </div>

        {following.length === 0 ? (
          <div className="empty section">
            <p className="eyebrow">Following nothing yet</p>
            <p>
              Follow a series below and it is listed here. New records in a series you follow are the first
              thing the archive can tell you about.
            </p>
          </div>
        ) : (
          <ul className="stack">
            {following.map((follow) => (
              <li key={follow.id} className="row" style={{ justifyContent: 'space-between', gap: 'var(--s-3)' }}>
                <span>
                  {follow.topicSlug ? (
                    <Link href={`/topics/${follow.topicSlug}/`}>{follow.topicName ?? follow.topicSlug}</Link>
                  ) : (
                    <span>{follow.topicName ?? 'A series'}</span>
                  )}{' '}
                  <span className="small muted">followed {day(follow.createdAt)}</span>
                </span>
                <form method="post" action="/api/follows">
                  <input type="hidden" name="kind" value="topic" />
                  <input type="hidden" name="on" value="0" />
                  <input type="hidden" name="topicId" value={follow.topicId ?? ''} />
                  <input type="hidden" name="returnTo" value="/library/#following" />
                  <button className="btn btn-quiet btn-sm" type="submit">
                    Unfollow
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {/*
          THE SERIES THAT EXIST, WHICH IS WHERE A FOLLOW STARTS. Every series the archive holds is listed,
          each with the state it is in — **a Follow button on something already followed would be a control
          that changes nothing**, which is the shape this whole round exists to remove.
        */}
        <h3 className="section">Series in the archive</h3>
        <ul className="stack">
          {series.map((topic) => (
            <li key={topic.id} className="row" style={{ justifyContent: 'space-between', gap: 'var(--s-3)' }}>
              <span>
                <Link href={`/topics/${topic.slug}/`}>{topic.name}</Link>{' '}
                <span className="small muted">
                  {topic.articleCount.toLocaleString('en-GB')} record{topic.articleCount === 1 ? '' : 's'}
                </span>
              </span>
              <form method="post" action="/api/follows">
                <input type="hidden" name="kind" value="topic" />
                <input type="hidden" name="on" value={followedTopicIds.has(topic.id) ? '0' : '1'} />
                <input type="hidden" name="topicId" value={topic.id} />
                <input type="hidden" name="returnTo" value="/library/#following" />
                <button className={followedTopicIds.has(topic.id) ? 'btn btn-quiet btn-sm' : 'btn btn-sm'} type="submit">
                  {followedTopicIds.has(topic.id) ? 'Unfollow' : 'Follow'}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      {/* ── HISTORY ──────────────────────────────────────────────────────────────────────────────── */}
      <section className="section" id="history">
        <div className="panel__head">
          <h2 className="panel__title">Reading history</h2>
          <p className="small muted">
            {history.length === 0 ? 'Nothing read yet' : `${history.length} record${history.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {history.length === 0 ? (
          <div className="empty section">
            <p className="eyebrow">Nothing read yet</p>
            <p>
              A record you open while signed in is listed here, most recent first, so you can find your way
              back to it. Nothing is recorded for a signed-out reader.
            </p>
          </div>
        ) : (
          <ul className="stack">
            {history.map((row) => (
              <li key={row.articleId} className="row" style={{ justifyContent: 'space-between', gap: 'var(--s-3)' }}>
                <span>
                  <Link href={`/${row.slug}/`}>{row.title}</Link>{' '}
                  <span className="small muted">
                    last opened {day(row.at)}
                    {row.opens && row.opens > 1 ? ` · ${row.opens} times` : ''}
                  </span>
                </span>
                <form method="post" action="/api/library">
                  <input type="hidden" name="action" value="forget" />
                  <input type="hidden" name="articleId" value={row.articleId} />
                  <input type="hidden" name="returnTo" value="/library/#history" />
                  <button className="btn btn-quiet btn-sm" type="submit">
                    Forget
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
