/**
 * /admin/audio — the review surface for AI narration, and the place a credit is authorised.
 *
 * WHY A PAGE IN THE ADMIN AREA RATHER THAN A FILLED DESIGN SCREEN
 *
 * `design-screen` fills the handed-over screens from `public/design/`, and **that directory is inviolable**:
 * a screen that is not in `FILLED` is served exactly as the design has it, example content and all. The
 * editor's dashboard there is a dashboard for holding roles and reading the archive, and the work it shows is
 * not this work. So the audio queue is its own page under `/admin`, built from the same Tailwind-free
 * primitives the rest of the back office uses (`Card`, `Head`, `Notices`, `AtAGlance`) and the existing CSS
 * classes — **the design files are not touched, and the two surfaces stay separate on purpose.**
 *
 * WHAT IT SHOWS, AND WHY IN THIS ORDER
 *
 *   1. PROPOSALS. A script, its character count and its cost, with NO audio — because nothing has been
 *      rendered. **These are the decisions that save money**, so they are first. Declining one costs nothing,
 *      and that is stated on the page rather than implied.
 *   2. RENDERED TAKES awaiting a listen, with a player and a raw download. Approving one is what makes the
 *      player appear on the article; before that the article carries no panel at all.
 *   3. CORRECTIONS. A take that was rejected, with the corrected script that has to be rendered again.
 *
 * THE SPENDING BUTTON IS NOT SHOWN TO SOMEONE WHO MAY NOT PRESS IT.
 *
 * Approving a render needs `manage_ai_corpus` — the capability that already gates the AI spend, held by the
 * administrator and the owner. The page reads the viewer's capabilities and, where they do not have it, says
 * who does rather than offering a button that would be refused. **That is presentation, not authorisation**:
 * the route checks the same capability again, and a hidden button has never been a permission.
 */
import { getDb } from '@ozituma/db/client';
import {
  allowanceFrom,
  EXTERNAL_AUDIO_LABELS,
  EXTERNAL_AUDIO_SERVICES,
  listEpisodeAudioSettings,
  listNarrationQueue,
  narrationCounts,
  narrationDelayMinutes,
  narrationMaxAgeHours,
  type NarrationQueueItem,
} from '@ozikoro/platform';
import { configured, subscription } from '@/lib/elevenlabs';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed — no credits spent',
  pending_review: 'Rendered — awaiting a listen',
  corrections: 'Corrections requested',
  published: 'Published',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  failed: 'Failed',
  draft: 'Draft',
  approved: 'Approved',
};

/** `9:04` or `1:02:11`, the form a person reads a duration in. */
function clock(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-GB'));

/** The spoken words themselves. **The approver must read the script, not a summary of it.** */
function Script({ item }: { item: NarrationQueueItem }) {
  const script = item.script ?? '';
  return (
    <details style={{ marginTop: '0.6rem' }}>
      <summary className="mono" style={{ cursor: 'pointer' }}>
        Read the spoken script ({num(item.characters ?? script.length)} characters)
      </summary>
      <pre
        className="mono"
        style={{
          whiteSpace: 'pre-wrap',
          maxHeight: '22rem',
          overflow: 'auto',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius)',
          padding: '0.85rem',
          marginTop: '0.5rem',
        }}
      >
        {script || 'The script is not loaded for this row.'}
      </pre>
    </details>
  );
}

function ReturnTo() {
  return <input type="hidden" name="returnTo" value="/admin/audio/" />;
}

export default async function AudioReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; info?: string }>;
}) {
  const notices = await searchParams;
  const { account, capabilities } = await requireCapabilityOrRedirect('review_audio', '/admin/audio/');

  const db = await getDb();
  const [queue, counts, audioSettings] = await Promise.all([
    listNarrationQueue(db, { limit: 100, includeScript: true }),
    narrationCounts(db),
    listEpisodeAudioSettings(db, 60),
  ]);

  const proposals = queue.filter((q) => q.status === 'proposed');
  const rendered = queue.filter((q) => q.status === 'pending_review');
  const corrections = queue.filter((q) => q.status === 'corrections');

  // Whether this viewer may authorise the charge. The route checks it again; this only decides what is offered.
  const maySpend = capabilities.has('manage_ai_corpus');
  const ready = configured();

  let allowance = null;
  try {
    allowance = allowanceFrom(await subscription());
  } catch {
    allowance = null;
  }

  const outstandingCredits = proposals.reduce((sum, p) => sum + (p.estimatedCredits ?? p.characters ?? 0), 0);

  return (
    <>
      <Head title="Audio review">
        <a className="btn btn--sm" href="/admin">
          Overview
        </a>
      </Head>

      <Notices saved={notices.saved} error={notices.error} info={notices.info} />

      {!ready ? (
        <div className="notice notice--info">
          <div>
            <p className="notice__title">Narration is not configured on this deployment</p>
            <p className="notice__body">
              There is no ElevenLabs key or voice set, so nothing can be rendered. Proposals can still be read,
              declined and edited — they cost nothing either way. Set <span className="mono">ELEVENLABS_API_KEY</span>{' '}
              and <span className="mono">ELEVENLABS_VOICE_ID_OWN</span> to enable rendering.
            </p>
          </div>
        </div>
      ) : null}

      <Card title="Where this stands">
        <AtAGlance
          rows={[
            ['Waiting for your decision', `${proposals.length} proposal(s)`],
            ['Cost if every one is approved', `${outstandingCredits.toLocaleString('en-GB')} credits (estimate)`],
            ['Rendered, awaiting a listen', `${rendered.length}`],
            ['Corrections requested', `${corrections.length}`],
            [
              'ElevenLabs allowance',
              allowance
                ? `${num(allowance.remaining)} left of ${num(allowance.limit)} on the ${allowance.tier} tier (${num(allowance.used)} used)`
                : 'Not readable — the API did not answer, so no figure is shown rather than a guess',
            ],
            ['Live on articles', STATUS_LABEL.published],
          ]}
        />
        <p className="help">
          Nothing in the first list has been rendered. A proposal is a script, a character count and a cost, and
          approving or declining it spends nothing. The credits are spent only when a render is authorised
          {maySpend ? ' — which this account may do.' : ', which needs the “manage ai corpus” permission an administrator or the owner holds.'}
        </p>
      </Card>

      <Card title={`Proposals awaiting a decision (${proposals.length})`}>
        {proposals.length === 0 ? (
          <p className="help">
            Nothing is waiting. A published record is proposed for narration automatically a few minutes after it
            goes live, or on the next sweep — see the bottom of this page.
          </p>
        ) : (
          <ul className="history">
            {proposals.map((item) => (
              <li key={item.episodeId}>
                <div className="history__when">
                  Proposed {item.proposedAt ? new Date(item.proposedAt).toISOString().slice(0, 16).replace('T', ' ') : 'recently'}
                  {' · '}
                  {item.voice === 'generic' ? 'a stock narrator' : 'your trained voice'}
                </div>
                <p className="history__what">
                  <strong>{item.title}</strong> · {num(item.characters)} characters · about{' '}
                  {num(item.estimatedCredits)} credits · roughly {clock(item.durationSeconds)} read aloud
                </p>
                <p className="history__detail">
                  <a href={`/${item.articleSlug}/`}>View the record</a>
                  {item.decisionNote ? ` · ${item.decisionNote}` : ''}
                </p>

                <Script item={item} />

                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  {maySpend ? (
                    <form method="post" action="/api/podcast/approve-proposal" className="actions">
                      <ReturnTo />
                      <input type="hidden" name="slug" value={item.slug} />
                      <button className="btn btn--primary" type="submit">
                        Approve and render ({num(item.estimatedCredits)} credits)
                      </button>
                    </form>
                  ) : (
                    <p className="help">
                      Rendering needs the “manage ai corpus” permission. An administrator or the owner authorises
                      the charge; you can still decline this proposal.
                    </p>
                  )}

                  <form method="post" action="/api/podcast/decline-proposal" className="actions">
                    <ReturnTo />
                    <input type="hidden" name="slug" value={item.slug} />
                    <input
                      name="note"
                      type="text"
                      maxLength={500}
                      placeholder="Why not, for the record (optional)"
                      style={{ minWidth: '16rem' }}
                    />
                    <button className="btn btn--danger" type="submit">
                      Decline — spends nothing
                    </button>
                  </form>
                </div>

                <details style={{ marginTop: '0.5rem' }}>
                  <summary className="mono" style={{ cursor: 'pointer' }}>
                    Edit the script before deciding
                  </summary>
                  <form method="post" action="/api/podcast/review" style={{ marginTop: '0.5rem' }}>
                    <ReturnTo />
                    <input type="hidden" name="action" value="correct" />
                    <input type="hidden" name="slug" value={item.slug} />
                    <textarea
                      name="script"
                      rows={12}
                      defaultValue={item.script ?? ''}
                      style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                    />
                    <p className="help">
                      Saving writes a new revision and never overwrites the proposed one. It still has to be
                      approved and rendered afterwards.
                    </p>
                    <p className="actions">
                      <button className="btn" type="submit">
                        Save as a new revision
                      </button>
                    </p>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Rendered — awaiting a listen (${rendered.length})`}>
        {rendered.length === 0 ? (
          <p className="help">No rendered take is waiting. Approving a proposal puts one here.</p>
        ) : (
          <ul className="history">
            {rendered.map((item) => (
              <li key={item.episodeId}>
                <div className="history__when">
                  Rendered {item.updatedAt ? new Date(item.updatedAt).toISOString().slice(0, 16).replace('T', ' ') : ''}
                  {' · '}
                  {clock(item.durationSeconds)} · {num(item.characters)} characters · version{' '}
                  {item.voice === 'generic' ? 'stock narrator' : 'your trained voice'}
                </div>
                <p className="history__what">
                  <strong>{item.title}</strong>
                </p>
                <p className="history__detail">
                  <a href={`/${item.articleSlug}/`}>View the record — it shows NO player until this is approved</a>
                </p>

                {item.storageKey ? (
                  <p style={{ marginTop: '0.6rem' }}>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio controls preload="none" src={`/media/${item.storageKey}`} style={{ width: '100%' }} />
                  </p>
                ) : null}

                <p className="actions" style={{ marginTop: '0.6rem' }}>
                  <a className="btn" href={`/api/podcast/download/${item.slug}`}>
                    Download the raw MP3
                  </a>
                  <span className="help">
                    This is the manual route to Spotify: its API cannot upload an episode, it ingests the feed at
                    /podcast/feed.xml, which lists published episodes only.
                  </span>
                </p>

                <Script item={item} />

                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  <form method="post" action="/api/podcast/review" className="actions">
                    <ReturnTo />
                    <input type="hidden" name="action" value="publish" />
                    <input type="hidden" name="slug" value={item.slug} />
                    <button className="btn btn--primary" type="submit">
                      Approve — publish to the article
                    </button>
                  </form>
                </div>

                <details style={{ marginTop: '0.5rem' }}>
                  <summary className="mono" style={{ cursor: 'pointer' }}>
                    Reject with corrections
                  </summary>
                  <form method="post" action="/api/podcast/review" style={{ marginTop: '0.5rem' }}>
                    <ReturnTo />
                    <input type="hidden" name="action" value="reject" />
                    <input type="hidden" name="slug" value={item.slug} />
                    <textarea
                      name="script"
                      rows={10}
                      defaultValue={item.script ?? ''}
                      style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                    />
                    <input
                      name="note"
                      type="text"
                      maxLength={500}
                      placeholder="What is wrong with the take (optional)"
                      style={{ minWidth: '22rem', marginTop: '0.5rem' }}
                    />
                    <p className="help">
                      The words above are saved as a NEW revision and the current recording is kept, so the
                      rejected take can be returned to. The episode leaves the review queue and waits to be
                      rendered again.
                    </p>
                    <p className="actions">
                      <button className="btn btn--danger" type="submit">
                        Reject and save the corrections
                      </button>
                    </p>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {corrections.length > 0 ? (
        <Card title={`Corrections waiting to be rendered again (${corrections.length})`}>
          <ul className="history">
            {corrections.map((item) => (
              <li key={item.episodeId}>
                <div className="history__when">
                  {item.decidedAt ? new Date(item.decidedAt).toISOString().slice(0, 16).replace('T', ' ') : 'Corrected'}
                </div>
                <p className="history__what">
                  <strong>{item.title}</strong> · {num(item.characters)} characters · about{' '}
                  {num(item.estimatedCredits)} credits
                </p>
                {item.decisionNote ? <p className="history__detail">{item.decisionNote}</p> : null}
                <Script item={item} />
                {maySpend ? (
                  <form method="post" action="/api/podcast/approve-proposal" className="actions" style={{ marginTop: '0.6rem' }}>
                    <ReturnTo />
                    <input type="hidden" name="slug" value={item.slug} />
                    <button className="btn btn--primary" type="submit">
                      Render the corrected script ({num(item.estimatedCredits)} credits)
                    </button>
                  </form>
                ) : (
                  <p className="help">Rendering needs the “manage ai corpus” permission.</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Where the audio lives — our own file, or a link to somewhere else">
        <p className="help">
          The owner’s instruction: <em>“there should be an option to add spotify audio link, instead of my own
          generated link. all these are options.”</em> Recording a link here spends nothing — no render is made
          and ElevenLabs is not called — but it IS a publication: the episode becomes live on the article. It
          therefore needs the same <span className="mono">review_audio</span> permission, and every change is
          written to <span className="mono">ozikoro_audit</span> with your account.
        </p>
        <p className="help">
          The address is fetched once, when you save it. A 404 refuses the save; the content type decides
          whether it is a file or a page. <strong>A page cannot be a podcast enclosure</strong>, so a Spotify
          episode link replaces the player on the article and leaves the feed’s enclosure on our own file where
          we have one — and, where we have none, the episode is left out of the feed rather than listed
          unplayable. Each row below states which of those the feed will do.
        </p>

        {audioSettings.length === 0 ? (
          <p className="help">No episode exists yet. A proposal has to exist before a link can be recorded against it.</p>
        ) : (
          <ul className="history">
            {audioSettings.map((item) => (
              <li key={item.episodeId}>
                <div className="history__when">
                  {STATUS_LABEL[item.status] ?? item.status}
                  {item.externalService ? ` · audio on ${EXTERNAL_AUDIO_LABELS[item.externalService]}` : ' · audio held here'}
                  {item.externalUrl ? ' · link recorded' : ''}
                </div>
                <p className="history__what">
                  <strong>{item.title}</strong>
                </p>
                <p className="history__detail">
                  <a href={`/${item.articleSlug}/`}>View the record</a>
                  {item.storageKey ? ` · our file: ${item.storageKey}` : ' · this archive holds no file'}
                </p>
                {item.externalUrl ? (
                  <p className="history__detail">
                    External: <span className="mono">{item.externalUrl}</span>
                    {item.externalDirectAudio === true ? ' — a directly playable file.' : ' — a page, not a file.'}
                    {item.externalCheckNote ? ` ${item.externalCheckNote}` : ''}
                  </p>
                ) : null}
                <p className="history__detail">
                  Feed:{' '}
                  {item.feed.kind === 'external'
                    ? 'the enclosure points at the external file.'
                    : item.feed.kind === 'ours'
                      ? 'the enclosure stays on the copy this archive holds.'
                      : item.feed.reason}
                </p>

                <form method="post" action="/api/podcast/external-audio" style={{ marginTop: '0.6rem' }}>
                  <ReturnTo />
                  <input type="hidden" name="slug" value={item.slug} />
                  <input
                    name="url"
                    type="url"
                    defaultValue={item.externalUrl ?? ''}
                    placeholder="https://open.spotify.com/episode/…"
                    style={{ width: '100%', maxWidth: '38rem' }}
                  />
                  <div className="actions" style={{ marginTop: '0.4rem' }}>
                    <label className="field" style={{ margin: 0 }}>
                      <span className="help">Service</span>
                      <select name="service" defaultValue={item.externalService ?? 'spotify'}>
                        {EXTERNAL_AUDIO_SERVICES.map((s) => (
                          <option key={s} value={s}>
                            {EXTERNAL_AUDIO_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <span className="help">Who is speaking</span>
                      <select name="narrator" defaultValue={item.narratorKind}>
                        <option value="human">Read by a person</option>
                        <option value="synthetic_own_voice">Synthetic, the author’s cloned voice</option>
                        <option value="synthetic_generic">Synthetic, a stock voice</option>
                      </select>
                    </label>
                    <label className="field" style={{ margin: 0, flex: 1 }}>
                      <span className="help">Note for the record (optional)</span>
                      <input name="note" type="text" maxLength={500} style={{ minWidth: '16rem' }} />
                    </label>
                    <button className="btn btn--primary" type="submit">
                      Save the link and publish
                    </button>
                  </div>
                  <p className="help">
                    Saving publishes the episode with the approval recorded against your account. Nothing is
                    rendered and no credit is spent. Leaving the address empty removes the link.
                  </p>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Catch up now">
        <p className="help">
          Proposes narration for published records that went live more than {narrationDelayMinutes()} minutes ago
          and less than {narrationMaxAgeHours()} hours ago, and that have no episode and no proposal. It is
          idempotent: running it twice proposes nothing the second time, and it can never render or spend.
        </p>
        <form method="post" action="/api/podcast/sweep" className="actions" style={{ marginTop: '0.75rem' }}>
          <ReturnTo />
          <label className="field" style={{ margin: 0 }}>
            <span className="help">How many at most</span>
            <input name="limit" type="number" min={1} max={200} defaultValue={5} style={{ width: '6rem' }} />
          </label>
          <button className="btn" type="submit">
            Sweep for newly published records
          </button>
        </form>
        <p className="help" style={{ marginTop: '0.75rem' }}>
          There is no scheduler in this codebase, so this is not automatic yet. The cron entry is
          <span className="mono"> node scripts/narration-review.ts sweep</span>, which does the same work with no
          server running.
        </p>
      </Card>

      <Card title="Everything the archive holds" quiet>
        <AtAGlance
          rows={counts.map((c) => [STATUS_LABEL[c.status] ?? c.status, num(c.count)])}
        />
        <p className="help">
          Read as {account.account.displayName ?? account.account.email}. Every decision on this page is recorded
          in <span className="mono">ozikoro_episode_transition</span> with the account that made it.
        </p>
      </Card>
    </>
  );
}
