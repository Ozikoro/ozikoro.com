import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { accountDashboard } from '@ozituma/db/dashboard';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

/*
 * The contributor's overview, to the design.
 *
 * The design reframes this screen around accumulation: not "submitted" but what was accepted, what
 * is waiting, and what came back with a reason you can act on. It also gives this page and
 * /contribute/submissions separate jobs — this is your standing and recent decisions; that is the
 * complete, filterable record.
 *
 * Every figure is counted live. Zero renders as zero — there is no decorative placeholder here, and
 * the empty states are the design's.
 */

const KIND_LABEL: Record<string, string> = {
  new_word: 'Word', edit_word: 'Word', word_edit: 'Word', new_definition: 'Word',
  new_example: 'Word', audio: 'Recording', correction: 'Correction', dialect: 'Dialect',
  new_dialect: 'Dialect', proverb_edit: 'Proverb', new_proverb: 'Proverb',
  name_edit: 'Name', new_name: 'Name', clan_edit: 'Clan', new_clan: 'Clan',
};

/**
 * What to call a submission on this screen.
 *
 * The record stores a payload whose shape depends on the kind, so the title is read from whichever
 * key the kind uses and falls back to the kind's own name. Nothing is invented: if the payload
 * carries no title, the entry shows its kind rather than a made-up word.
 */
function titleOf(s: { kind: string; payload: Record<string, unknown> }): string {
  const p = s.payload ?? {};
  for (const key of ['headword', 'name', 'text', 'proverb', 'spelling', 'clanName', 'title']) {
    const v = p[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return KIND_LABEL[s.kind] ?? 'Entry';
}

/** One line under the title, when the payload carries one. */
function glossOf(s: { payload: Record<string, unknown> }): string | null {
  const p = s.payload ?? {};
  for (const key of ['meaning', 'definition', 'english', 'translation', 'gloss', 'note']) {
    const v = p[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 160);
  }
  const meanings = p['meanings'];
  if (Array.isArray(meanings) && typeof meanings[0] === 'string') return String(meanings[0]).slice(0, 160);
  return null;
}

function stateOf(status: string): { label: string; badge: string } {
  if (status === 'approved' || status === 'merged' || status === 'published') {
    return { label: status === 'merged' ? 'Merged' : 'Accepted', badge: 'badge--accepted' };
  }
  if (status === 'rejected') return { label: 'Refused', badge: 'badge--refused' };
  return { label: 'Pending', badge: 'badge--pending' };
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const params = await searchParams;
  const current = await getCurrentAccount();
  const db = await getDb();
  const data = await accountDashboard(db, current!.account.id);

  const name = current!.account.displayName ?? current!.account.email;
  const first = name.split(/[\s@]/)[0]!;
  const accepted = data.contributions.approved + data.contributions.merged;
  const pending = data.contributions.pending;
  const refused = data.contributions.rejected;
  const total = data.contributions.total;

  // The meter is drawn from real counts, and only when there is something to draw.
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const recent = data.contributions.recent.slice(0, 4);

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__kicker">Ndeewo</p>
          <h1 className="page-header__title">{greeting()}, {first}</h1>
          <p className="page-header__lede">
            {total === 0
              ? 'Nothing sent yet. Every entry in this dictionary came from somebody who knew the word.'
              : `${total} ${total === 1 ? 'entry' : 'entries'} of yours are in the record. Here is where each stands, and what is waiting for you.`}
          </p>
        </div>
        <div className="page-header__actions">
          <Link className="btn btn--primary" href="/contribute/word">Add a word</Link>
          <Link className="btn" href="/contribute/submissions">Your submissions</Link>
        </div>
      </header>

      {params.submitted ? (
        <div className="notice notice--success" role="status">
          <div>
            <p className="notice__title">Sent for review</p>
            <p className="notice__body">
              Your entry is with the editors. <Link href="/contribute/submissions">See it in your submissions</Link>.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid--4">
        <div className="stat">
          <span className="stat__label">Accepted</span>
          <span className="stat__value">{accepted.toLocaleString()}</span>
          <span className="stat__meta">published in the record</span>
        </div>
        <div className={`stat${pending > 0 ? ' stat--attention' : ''}`}>
          <span className="stat__label">Awaiting review</span>
          <span className="stat__value">{pending.toLocaleString()}</span>
          <span className="stat__meta">{pending > 0 ? 'with the editors' : 'nothing waiting'}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Needs your edit</span>
          <span className="stat__value">{refused.toLocaleString()}</span>
          <span className="stat__meta">{refused > 0 ? 'refused with a reason' : 'none refused'}</span>
        </div>
        <div className={`stat${data.recordings.total === 0 ? ' stat--zero' : ''}`}>
          <span className="stat__label">Recordings</span>
          <span className="stat__value">{data.recordings.total.toLocaleString()}</span>
          <span className="stat__meta">
            {data.recordings.total === 0
              ? 'none sent yet'
              : `${data.recordings.published.toLocaleString()} published`}
          </span>
        </div>
      </div>

      <div className="grid grid--aside u-mt">
        <div>
          {current!.canReview ? (
            <section className="panel" aria-labelledby="queue-h">
              <div className="panel__head">
                <h2 className="panel__title" id="queue-h">Waiting on you as editor</h2>
                <div className="panel__actions">
                  <Link className="btn btn--sm" href="/review">Open the queue</Link>
                </div>
              </div>
              <div className="panel__body">
                <p className="u-sm u-muted" style={{ marginTop: 0 }}>
                  You have reviewed {data.reviewed.toLocaleString()} {data.reviewed === 1 ? 'entry' : 'entries'}.
                  Anything sent by others is waiting in the queue.
                </p>
              </div>
            </section>
          ) : null}

          <section className="panel" aria-labelledby="recent-h">
            <div className="panel__head">
              <h2 className="panel__title" id="recent-h">What became of your last entries</h2>
              <div className="panel__actions">
                <Link className="btn btn--sm" href="/contribute/submissions">Full list</Link>
              </div>
            </div>
            {recent.length === 0 ? (
              <div className="panel__body">
                <div className="empty">
                  <p className="empty__title">Nothing sent yet</p>
                  <p className="empty__body">
                    Your contributions and every decision on them will appear here.
                  </p>
                  <Link className="btn btn--primary" href="/contribute/word">Add your first word</Link>
                </div>
              </div>
            ) : (
              <ul className="panel__body panel__body--flush" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {recent.map((s) => {
                  const state = stateOf(String(s.status));
                  const gloss = glossOf(s);
                  return (
                    <li className="entry" key={s.id}>
                      <div className="entry__main">
                        <h3 className="entry__title"><span className="igbo">{titleOf(s)}</span></h3>                        {s.status === 'rejected' && s.reviewNote ? (
                          <p className="entry__gloss">refused — &ldquo;{s.reviewNote}&rdquo;</p>
                        ) : gloss ? (
                          <p className="entry__gloss">{gloss}</p>
                        ) : null}
                        <p className="entry__meta">
                          <span>{KIND_LABEL[String(s.kind)] ?? 'Entry'}</span>
                          {s.reviewedByName ? <span>{s.reviewedByName}</span> : null}
                          <span>{String(s.submittedAt).slice(0, 10)}</span>
                        </p>
                      </div>
                      <div className="entry__side">
                        <span className={`badge ${state.badge}`}>{state.label}</span>
                        {String(s.status) === 'rejected' ? (
                          <Link className="btn btn--sm" href="/contribute/submissions">Edit and resend</Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside>
          <section className="panel" aria-labelledby="standing-h">
            <div className="panel__head">
              <h2 className="panel__title" id="standing-h">Your standing</h2>
            </div>
            <div className="panel__body">
              {total === 0 ? (
                <p className="u-sm u-muted" style={{ marginTop: 0 }}>
                  Nothing sent yet, so there is nothing to stand on. That changes with one word.
                </p>
              ) : (
                <>
                  <p className="u-sm u-muted" style={{ marginTop: 0 }}>
                    {total} sent in total.
                  </p>
                  <div
                    className="meter"
                    role="img"
                    aria-label={`${accepted} accepted, ${pending} pending, ${refused} refused of ${total} submissions`}
                  >
                    <div style={{ display: 'flex', height: '100%' }}>
                      <div className="meter__fill meter__fill--accepted" style={{ width: `${pct(accepted)}%` }} />
                      <div className="meter__fill meter__fill--pending" style={{ width: `${pct(pending)}%` }} />
                      <div className="meter__fill meter__fill--refused" style={{ width: `${pct(refused)}%` }} />
                    </div>
                  </div>
                  <p className="meter-legend">
                    <span><span className="meter-legend__dot" style={{ background: 'var(--green)' }} />{accepted} accepted</span>
                    <span><span className="meter-legend__dot" style={{ background: 'var(--ochre)' }} />{pending} pending</span>
                    <span><span className="meter-legend__dot" style={{ background: 'var(--red)' }} />{refused} refused</span>
                  </p>
                </>
              )}
            </div>
            <div className="panel__foot"><Link href="/contribute/profile">Your public profile</Link></div>
          </section>

          <section className="panel" aria-labelledby="start-h">
            <div className="panel__head">
              <h2 className="panel__title" id="start-h">Start something</h2>
            </div>
            <div className="panel__body">
              <p className="u-sm u-muted" style={{ marginTop: 0 }}>
                Each of these is a short, guided task.
              </p>
              <div className="u-flex">
                <Link className="btn btn--sm" href="/contribute/word">Word</Link>
                <Link className="btn btn--sm" href="/contribute/name">Name</Link>
                <Link className="btn btn--sm" href="/contribute/proverb">Proverb</Link>
                <Link className="btn btn--sm" href="/contribute/clan">Clan</Link>
                <Link className="btn btn--sm" href="/contribute/dialect">Dialect</Link>
                <Link className="btn btn--sm" href="/contribute/recording">Recording</Link>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
