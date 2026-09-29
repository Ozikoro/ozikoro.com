import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getQueueStats, listSuggestions } from '@ozituma/db/contributions';
import { getStorage } from '@ozituma/db/storage';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Review queue',
  description: 'Editorial review queue for Ozituma dictionary contributions.',
  robots: { index: false, follow: false },
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; id?: string; detail?: string; error?: string; status?: string }>;
}) {
  const current = await getCurrentAccount();
  if (!current) redirect('/signin?error=Sign+in+to+review.');
  if (!current.canReview) {
    // Plain refusal rather than a redirect, so an authenticated non-editor is
    // told they lack the role instead of being bounced somewhere confusing.
    return (
      <div className="wrap wrap-narrow">
        <h1>Review queue</h1>
        <div className="notice notice-warn">
          <strong>You do not have access to the review queue.</strong>
          <p style={{ margin: '0.4rem 0 0' }}>
            Reviewing requires the <code className="mono">editor</code> or{' '}
            <code className="mono">admin</code> role. You can still contribute —{' '}
            <Link href="/contribute">submit a word</Link> and an editor will review it.
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const db = await getDb();
  const status = (params.status ?? 'pending') as 'pending' | 'approved' | 'rejected' | 'merged';

  const [queue, stats] = await Promise.all([
    listSuggestions(db, { status, limit: 50 }),
    getQueueStats(db),
  ]);

  return (
    <div className="wrap">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}>Review queue</h1>
        <span style={{ marginLeft: 'auto', fontSize: '0.9rem' }}>
          <Link href="/contribute">My contributions</Link>
        </span>
      </div>

      <p className="muted" style={{ fontSize: '0.9rem' }}>
        Signed in as <strong>{current.account.displayName ?? current.account.email}</strong> (
        {current.account.role}). Approving a submission writes it into the published dictionary.
      </p>

      {params.done ? (
        <div className="notice" style={{ margin: '1rem 0' }}>
          <strong>
            Submission #{params.id} {params.done === 'approve' ? 'approved' : 'rejected'}.
          </strong>
          {params.detail ? <p style={{ margin: '0.4rem 0 0' }}>{params.detail}</p> : null}
        </div>
      ) : null}

      {params.error ? (
        <div className="notice notice-warn" role="alert" style={{ margin: '1rem 0' }}>
          {params.error}
        </div>
      ) : null}

      <ul className="hero-stats" style={{ margin: '1.25rem 0 1.5rem' }}>
        <li>
          <strong>{stats.pending}</strong>
          <span>pending</span>
        </li>
        <li>
          <strong>{stats.approved + stats.merged}</strong>
          <span>published</span>
        </li>
        <li>
          <strong>{stats.rejected}</strong>
          <span>not accepted</span>
        </li>
        <li>
          <strong>{stats.contributors}</strong>
          <span>contributors</span>
        </li>
      </ul>

      <nav className="site-nav" style={{ marginBottom: '1.25rem', gap: '1rem' }}>
        {(['pending', 'approved', 'merged', 'rejected'] as const).map((option) => (
          <Link
            key={option}
            href={`/review?status=${option}`}
            style={{
              fontWeight: option === status ? 700 : 400,
              color: option === status ? 'var(--indigo)' : undefined,
            }}
          >
            {option}
          </Link>
        ))}
      </nav>

      {queue.data.length === 0 ? (
        <p className="muted">Nothing {status}.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {queue.data.map((suggestion) => {
            const payload = suggestion.payload;
            const headword = typeof payload.headword === 'string' ? payload.headword : null;
            const definitions = Array.isArray(payload.definitions)
              ? (payload.definitions as unknown[]).filter((d): d is string => typeof d === 'string')
              : [];
            const example = payload.example as { text?: string; translation?: string } | null;
            const note = typeof payload.note === 'string' ? payload.note : null;
            /*
             * A proverb edit is a before/after, so the reviewer sees the two texts
             * side by side rather than a payload dump. Approving it replaces the
             * proverb and records the old wording in proverb_revision; rejecting
             * it changes nothing.
             */
            const isProverbEdit = suggestion.kind === 'proverb_edit';
            const isWordEdit = suggestion.kind === 'word_edit';
            const isNameEdit = suggestion.kind === 'name_edit';
            const isClanEdit = suggestion.kind === 'clan_edit';
            /*
             * A proposed edit to an entry or a name is shown the same way a proverb edit is:
             * before and after, so the reviewer is comparing two texts rather than reading a
             * payload. The fields differ, so the rows are built per kind.
             */
            const editRows: Array<[string, string, string]> = isWordEdit
              ? [
                  [
                    'Headword',
                    typeof payload.previousHeadword === 'string' ? payload.previousHeadword : '',
                    typeof payload.headword === 'string' ? payload.headword : '',
                  ],
                  [
                    'Meanings',
                    typeof payload.previousMeanings === 'string' ? payload.previousMeanings : '',
                    typeof payload.meanings === 'string' ? payload.meanings : '',
                  ],
                ]
              : isClanEdit
                ? [
                    ['Name', String(payload.previousName ?? ''), String(payload.name ?? '')],
                    [
                      'States',
                      Array.isArray(payload.previousStates) ? (payload.previousStates as string[]).join(', ') : '',
                      Array.isArray(payload.states) ? (payload.states as string[]).join(', ') : '',
                    ],
                    [
                      'Local government areas',
                      Array.isArray(payload.previousLgas) ? (payload.previousLgas as string[]).join(', ') : '',
                      Array.isArray(payload.lgas) ? (payload.lgas as string[]).join(', ') : '',
                    ],
                    [
                      'Towns',
                      Array.isArray(payload.previousTowns) ? (payload.previousTowns as string[]).join(', ') : '',
                      Array.isArray(payload.towns) ? (payload.towns as string[]).join(', ') : '',
                    ],
                    [
                      'Summary',
                      String(payload.previousOrigin ?? ''),
                      String(payload.origin ?? ''),
                    ],
                    [
                      'Description',
                      Array.isArray(payload.previousDescription)
                        ? (payload.previousDescription as string[]).join('\n\n')
                        : '',
                      Array.isArray(payload.description) ? (payload.description as string[]).join('\n\n') : '',
                    ],
                  ]
                : isNameEdit
                ? [
                    [
                      'Name',
                      typeof payload.previousName === 'string' ? payload.previousName : '',
                      typeof payload.name === 'string' ? payload.name : '',
                    ],
                    [
                      'Meaning',
                      typeof payload.previousMeaning === 'string' ? payload.previousMeaning : '',
                      typeof payload.meaning === 'string' ? payload.meaning : '',
                    ],
                    [
                      'Gender',
                      typeof payload.previousGender === 'string' ? payload.previousGender : '',
                      typeof payload.gender === 'string' ? payload.gender : '',
                    ],
                    [
                      'Variants',
                      Array.isArray(payload.previousVariants)
                        ? (payload.previousVariants as string[]).join(', ')
                        : '',
                      Array.isArray(payload.variants)
                        ? (payload.variants as string[]).join(', ')
                        : '',
                    ],
                  ]
                : [];
            const previousText = typeof payload.previousText === 'string' ? payload.previousText : null;
            const nextText = typeof payload.text === 'string' ? payload.text : null;
            const nextTranslation =
              typeof payload.translation === 'string' ? payload.translation : null;
            const selfSubmission = suggestion.submittedBy === current.account.id;

            return (
              <div className="card" key={suggestion.id}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0 }}>
                    {isProverbEdit
                      ? nextText ?? `Proverb edit #${suggestion.id}`
                      : headword ?? `Submission #${suggestion.id}`}
                  </h3>
                  <span className="chip">{suggestion.kind.replace(/_/g, ' ')}</span>
                  <span className="chip chip-pos">{suggestion.languageCode ?? '—'}</span>
                  <span className="muted" style={{ fontSize: '0.83rem', marginLeft: 'auto' }}>
                    #{suggestion.id} · {new Date(suggestion.submittedAt).toLocaleString()}
                  </span>
                </div>

                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0' }}>
                  Submitted by {suggestion.submittedByName ?? 'unknown'}
                  {/*
                    The direct link, which is what the owner asked for: "I can easily see the direct
                    link to the edited words, names, proverbs or anything edited by the
                    contributors." Opening the page is the first thing a reviewer does, and hunting
                    for the entry by hand is how the queue wastes their time.
                  */}
                  {suggestion.target ? (
                    <>
                      {' · '}
                      <Link href={suggestion.target.url}>
                        Open the {suggestion.target.what}: {suggestion.target.label}
                      </Link>
                    </>
                  ) : suggestion.targetWordId ? (
                    ` · targets entry ${suggestion.targetWordId}`
                  ) : null}
                </p>

                {editRows.length > 0 ? (
                  <table className="table" style={{ margin: '0.6rem 0' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '22%' }} />
                        <th>As it stands</th>
                        <th>Proposed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editRows.map(([label, before, after]) => (
                        <tr key={label}>
                          <th scope="row" style={{ textAlign: 'left', fontWeight: 500 }}>
                            {label}
                          </th>
                          <td style={{ whiteSpace: 'pre-wrap' }}>{before || '—'}</td>
                          <td style={{ whiteSpace: 'pre-wrap' }}>
                            {after || '—'}
                            {after !== before ? (
                              <span className="chip chip-dialect" style={{ marginLeft: '0.4rem' }}>
                                changed
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {definitions.length > 0 ? (
                  <ol className="definition-list">
                    {definitions.map((definition, index) => (
                      <li key={index}>{definition}</li>
                    ))}
                  </ol>
                ) : null}

                {isProverbEdit ? (
                  <div style={{ marginTop: '0.6rem', display: 'grid', gap: '0.5rem' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem' }} className="muted">
                      As it stands
                    </p>
                    <p className="mono" style={{ margin: 0 }}>
                      {previousText ?? '(unchanged)'}
                    </p>
                    <p style={{ margin: 0, fontSize: '0.85rem' }} className="muted">
                      Proposed
                    </p>
                    <p className="mono" style={{ margin: 0 }}>
                      {nextText ?? '(unchanged)'}
                    </p>
                    {nextTranslation ? (
                      <p style={{ margin: 0 }}>
                        <strong>English as proposed:</strong> {nextTranslation}
                      </p>
                    ) : (
                      <p style={{ margin: 0 }} className="muted">
                        No English in the proposal; the existing one is left alone.
                      </p>
                    )}
                    {note ? (
                      <p style={{ margin: 0 }}>
                        <strong>Why:</strong> {note}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {payload.partOfSpeech && !isProverbEdit ? (
                  <p style={{ fontSize: '0.9rem' }}>
                    <strong>Grammar:</strong> <span className="mono">{String(payload.partOfSpeech)}</span>
                  </p>
                ) : null}

                {/* A recording must be listened to before it can be judged, so the
                    player is inline in the queue rather than behind a link. */}
                {suggestion.kind === 'audio' && typeof payload.storageKey === 'string' ? (
                  <div style={{ margin: '0.75rem 0' }}>
                    <audio
                      controls
                      preload="none"
                      src={getStorage().publicUrl(payload.storageKey)}
                      style={{ width: '100%', maxWidth: '24rem' }}
                    >
                      Your browser does not support audio playback.
                    </audio>
                    <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                      {typeof payload.mimeType === 'string' ? payload.mimeType : 'audio'}
                      {typeof payload.byteSize === 'number'
                        ? ` · ${Math.round(payload.byteSize / 1024)} KB`
                        : ''}
                      {typeof payload.durationMs === 'number'
                        ? ` · ${(payload.durationMs / 1000).toFixed(1)}s`
                        : ''}
                      {typeof payload.dialectCode === 'string' && payload.dialectCode
                        ? ` · ${payload.dialectCode}`
                        : ''}
                    </p>
                    {suggestion.targetWordId ? (
                      <p style={{ fontSize: '0.9rem', margin: '0.4rem 0 0' }}>
                        Pronounces entry{' '}
                        <Link href={`/api/v1/words/${suggestion.targetWordId}`}>
                          #{suggestion.targetWordId}
                        </Link>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {example?.text ? (
                  <div className="example">
                    <div className="example-igbo">{example.text}</div>
                    {example.translation ? (
                      <div className="example-en">{example.translation}</div>
                    ) : null}
                  </div>
                ) : null}

                {note ? (
                  <p style={{ fontSize: '0.9rem' }}>
                    <strong>Contributor note:</strong> {note}
                  </p>
                ) : null}

                {suggestion.reviewNote && suggestion.status !== 'pending' ? (
                  <p style={{ fontSize: '0.9rem' }} className="muted">
                    <strong>Decision note:</strong> {suggestion.reviewNote} —{' '}
                    {suggestion.reviewedByName ?? 'unknown'}
                  </p>
                ) : null}

                {suggestion.status === 'pending' ? (
                  selfSubmission ? (
                    <div className="notice notice-warn" style={{ fontSize: '0.9rem' }}>
                      This is your own submission, so you cannot review it. Ask another editor.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.9rem' }}>
                      <form
                        method="post"
                        action={`/api/review/${suggestion.id}`}
                        style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
                      >
                        <div style={{ flex: '1 1 18rem' }}>
                          <label htmlFor={`note-${suggestion.id}`}>Review note (optional)</label>
                          <input
                            id={`note-${suggestion.id}`}
                            name="note"
                            maxLength={400}
                            className="search-input"
                            style={{ width: '100%' }}
                            placeholder="What did you check?"
                          />
                        </div>
                        <button className="button" type="submit" name="decision" value="approve">
                          Approve &amp; publish
                        </button>
                        <button
                          className="button button-secondary"
                          type="submit"
                          name="decision"
                          value="reject"
                        >
                          Reject
                        </button>
                      </form>
                    </div>
                  )
                ) : (
                  <p style={{ marginTop: '0.75rem' }}>
                    <span className="chip chip-common">{suggestion.status}</span>
                    {suggestion.reviewedAt ? (
                      <span className="muted" style={{ fontSize: '0.83rem', marginLeft: '0.6rem' }}>
                        reviewed {new Date(suggestion.reviewedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
