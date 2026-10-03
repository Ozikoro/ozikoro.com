/**
 * /admin/pronunciation — the credit plan, and the queue of words the archive cannot say.
 *
 * WHY THE TWO THINGS ARE ON ONE PAGE
 *
 * They are the same question asked from both ends. The owner's instruction is *"how many credits it is in a
 * month, and how many audiobook/record we can use it to produce in a month"* and *"approved before it
 * produces any record, as to not waste credits"* — **the plan is what the credits are, and this queue is what
 * stops them being spent on words the archive cannot pronounce.** Putting them in two places would let an
 * editor work the queue without ever seeing that each approval is what releases a charge.
 *
 * WHY IT IS A PAGE UNDER /admin AND NOT A FILLED DESIGN SCREEN
 *
 * `apps/ozikoro/public/design/` is inviolable and is served as-is for any screen the serve-time fill does not
 * name; the handed-over dashboards have no pronunciation surface at all. So this is built from the same
 * primitives the rest of the back office uses — `Card`, `Head`, `Notices`, `AtAGlance` — and the design files
 * are not touched. See the same reasoning at the head of `/admin/audio`.
 *
 * THE COST OF THE ARCHIVE-WIDE FIGURE, WHICH IS REAL AND STATED
 *
 * "Articles of average length" needs the average, and the average needs every record's spoken script — about
 * 1.3 seconds over 1,051 records, measured on the development cluster. **It is not cached**, because a cached
 * figure is a figure that is wrong after the next publication and says nothing about when it was taken. A
 * page an editor opens a few times a day can afford a second to be right.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  GRADE_LABEL,
  articleCost,
  buildDictionaryIndex,
  buildDigest,
  dissect,
  listQueue,
  planCredits,
  pronunciationGaps,
  queueCounts,
  reconcileCharges,
  whichFit,
} from '@ozikoro/platform';
import { configured, subscription } from '@/lib/elevenlabs';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const num = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-GB');

const RATE = (n: number) => `${n.toLocaleString('en-GB')}`;

/** The evidence class, in words an editor reads rather than in the column's vocabulary. */
const KIND_LABEL: Record<string, string> = {
  human_recording: 'a person’s recording',
  respelling: 'a written respelling',
  composed: 'composed from parts — not a recording',
  dictionary_audio: 'a recording from the dictionary',
};

const STATUS_LABEL: Record<string, string> = {
  unrecorded: 'Not recorded',
  recorded: 'Recorded — awaiting approval',
  approved: 'Approved',
  rejected: 'Judged not Igbo',
};

export default async function PronunciationPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; info?: string; cost?: string }>;
}) {
  const notices = await searchParams;
  // The queue is the editors' and the owner's work; `review_audio` is the capability migration 0046 added for
  // exactly this and `mayEnterBackOffice` already admits it. The route checks it again — a hidden form is not
  // a permission.
  const { account, capabilities } = await requireCapabilityOrRedirect('review_audio', '/admin/pronunciation/');

  const db = await getDb();
  const [sub, counts, queue, reconciliation] = await Promise.all([
    subscription(),
    queueCounts(db),
    listQueue(db, { status: 'open', limit: 200 }),
    reconcileCharges(db),
  ]);

  const plan = await planCredits(db, sub);
  const blocking = queue.filter((row) => row.blocks);
  const composed = queue.filter((row) => !row.blocks);
  const digest = await buildDigest(db, { limit: 6 });

  /*
   * WHETHER A COMPOSED WORD RESTS ON ANYTHING THAT WAS EVER RECORDED, ASKED PER WORD.
   *
   * The first version of the table below printed a fixed sentence in this column — "no — every piece is a
   * spelling with no sound recorded". That happens to be true today, because the dictionary holds no
   * pronunciation of any kind at all, **and it would have gone on being printed after the first recording was
   * uploaded.** A column that asserts a fact it did not look up is the fabrication this project treats as the
   * worst output, so it is computed: `dissect` asks the dictionary about each piece and reports whether any of
   * them carries a sound.
   */
  const index = composed.length > 0 ? await buildDictionaryIndex(db) : null;
  const pieceSound = new Map<number, boolean>();
  if (index) {
    for (const row of composed) {
      const detail = await dissect(db, row.word, index);
      pieceSound.set(row.id, detail?.anyPieceHasSound ?? false);
    }
  }

  // A record's own cost, when one was asked for. **This is the owner's "see the cost before spending it".**
  const asked = (notices.cost ?? '').trim();
  const cost = asked ? await articleCost(db, asked) : null;
  const fit = asked && cost && plan.plan.known
    ? await whichFit(db, [asked], plan.plan.remaining)
    : null;

  /*
   * NARRATION WAITING ON A WORD. An episode in `proposed` whose article uses words the archive cannot say is
   * the exact situation the owner described, and the waiver is the recorded decision to narrate anyway. It
   * lives here rather than on the audio page because this is where the missing words are, and **a decision to
   * proceed despite gaps should be made in front of the gaps.**
   */
  const waiting = await db.rows<{ slug: string; title: string; status: string }>(
    `select slug, title, status from ozikoro_episode
      where status in ('proposed', 'corrections') order by updated_at desc limit 20`
  );
  const blocked: { slug: string; title: string; status: string; words: string[] }[] = [];
  for (const episode of waiting) {
    const gaps = await pronunciationGaps(db, episode.slug);
    if (gaps.blocking.length > 0) {
      blocked.push({ ...episode, words: gaps.blocking.map((g) => g.word) });
    }
  }

  const maySpend = capabilities.has('manage_ai_corpus');

  return (
    <>
      <Head title="Pronunciations and narration credits">
        <Link className="btn" href="/admin/audio">
          Audio review
        </Link>
      </Head>

      <Notices saved={notices.saved} error={notices.error} info={notices.info} />

      <Card title="The plan">
        {plan.plan.known ? (
          <AtAGlance
            rows={[
              ['Tier', plan.plan.tier],
              ['Characters a month', num(plan.plan.monthlyCharacters)],
              ['Used this period', num(plan.plan.used)],
              ['Remaining', <strong key="r">{num(plan.plan.remaining)}</strong>],
              ['Resets', plan.plan.resetsAt ?? 'the API does not report a date on this tier'],
            ]}
          />
        ) : (
          <p className="muted">{plan.plan.reason}</p>
        )}
      </Card>

      <Card title="What the allowance buys">
        <AtAGlance
          rows={[
            [
              'Records of average length a month',
              <strong key="m">
                {plan.plan.known ? `${num(plan.buys.articlesPerMonth)} records` : 'unknown, until the plan can be read'}
              </strong>,
            ],
            ['Hours of audio a month', `${num(plan.buys.hoursPerMonth)} hours`],
            [
              'The whole archive',
              plan.buys.monthsForArchive === null
                ? 'unknown, until the plan can be read'
                : `${num(plan.buys.monthsForArchive)} months (about ${(plan.buys.monthsForArchive / 12).toFixed(1)} years)`,
            ],
            ['The whole archive in credits', num(plan.buys.archiveCredits)],
          ]}
        />
        {/*
          * THE CORRECTION, ON THE PAGE RATHER THAN ONLY IN A COMMENT.
          *
          * The figure in circulation counted `body_html`, which is markup and is never sent to the API. What
          * is billed is the spoken script. **A reader who has seen the old number should be able to see why
          * this one is smaller**, so both are printed with the difference.
          */}
        <p className="muted" style={{ marginTop: '0.8rem' }}>
          Counted from {num(plan.archive.articles)} published records: <strong>{num(plan.archive.characters)}</strong>{' '}
          characters of spoken script, against <strong>{num(plan.archive.htmlCharacters)}</strong> characters
          of page markup. The markup is never sent to the API, so the earlier figure of about{' '}
          {num(plan.archive.htmlCharacters)} overstated the archive by{' '}
          {num(plan.archive.htmlCharacters - plan.archive.characters)} characters (
          {(100 - (plan.archive.characters / Math.max(1, plan.archive.htmlCharacters)) * 100).toFixed(1)}%). The
          average record is {num(plan.archive.averageCharacters)} spoken characters, not{' '}
          {num(Math.round(plan.archive.htmlCharacters / Math.max(1, plan.archive.articles)))}.
        </p>
      </Card>

      <Card title="The rate, and whether it has been checked">
        <p>
          The estimate is <strong>{reconciliation.creditsPerCharacter} credit per character</strong>.{' '}
          {reconciliation.verified ? (
            <>
              It has been checked against <strong>{num(reconciliation.measuredRenders)}</strong> real render
              {reconciliation.measuredRenders === 1 ? '' : 's'}: {RATE(reconciliation.totalMeasured)} credits
              charged against an estimate of {RATE(reconciliation.totalEstimated)} —{' '}
              <strong>{reconciliation.measuredRatio?.toFixed(3)}×</strong> the estimate.
            </>
          ) : (
            <strong>It has never been checked against a real charge.</strong>
          )}
        </p>
        <p className="muted">{reconciliation.note}</p>
        {reconciliation.renders.length > 0 ? (
          <table className="table" style={{ marginTop: '0.6rem' }}>
            <thead>
              <tr>
                <th>Record</th>
                <th>Status</th>
                <th>Characters</th>
                <th>Estimated</th>
                <th>Measured</th>
                <th>Account characters</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.renders.slice(0, 12).map((render) => (
                <tr key={render.episodeId}>
                  <td>{render.title}</td>
                  <td>{render.status}</td>
                  <td>{num(render.characters)}</td>
                  <td>{num(render.estimated)}</td>
                  <td>
                    {render.measured === null ? (
                      <span className="muted">not re-read</span>
                    ) : (
                      <strong>{num(render.measured)}</strong>
                    )}
                  </td>
                  <td>
                    {render.usedBefore === null || render.usedAfter === null
                      ? '—'
                      : `${num(render.usedBefore)} → ${num(render.usedAfter)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>

      <Card title="What one record costs">
        <p className="muted">
          Enter a record’s address segment to see its character count and cost <em>before</em> anything is
          rendered. The count is the spoken script the renderer will send, not the page markup.
        </p>
        <form method="get" action="/admin/pronunciation/" className="actions" style={{ marginTop: '0.6rem' }}>
          <label>
            <span>Record</span>
            <input type="text" name="cost" defaultValue={asked} placeholder="the-record-slug" />
          </label>
          <button className="btn" type="submit">
            Cost it
          </button>
        </form>

        {asked && !cost ? (
          <p className="muted" style={{ marginTop: '0.6rem' }}>
            No published record has the address “{asked}”.
          </p>
        ) : null}

        {cost ? (
          <div style={{ marginTop: '0.8rem' }}>
            <AtAGlance
              rows={[
                ['Record', cost.title],
                ['Spoken characters', <strong key="c">{num(cost.characters)}</strong>],
                ['Credits at the estimate', <strong key="k">{num(cost.credits)}</strong>],
                ['Reading time', `about ${Math.round(cost.estimatedSeconds / 60)} minutes`],
                ['Words', num(cost.words)],
                ['Page markup, not billed', num(cost.htmlCharacters)],
                [
                  'Against what is left',
                  fit?.rows[0]?.fits ? (
                    <span key="f">
                      it fits — {num(plan.plan.known ? plan.plan.remaining : 0)} characters remain
                    </span>
                  ) : (
                    <span key="f">
                      it does not fit — {num(fit?.rows[0]?.shortfall)} characters short of what remains
                    </span>
                  ),
                ],
                [
                  'Episode',
                  cost.episode
                    ? `${cost.episode.status}${cost.episode.estimatedCredits === null ? '' : ` · estimated ${num(cost.episode.estimatedCredits)}`}${cost.episode.measuredCredits === null ? '' : ` · charged ${num(cost.episode.measuredCredits)}`}`
                    : 'no episode yet — a proposal spends nothing',
                ],
              ]}
            />
          </div>
        ) : null}
      </Card>

      <Card title="Narration waiting on a word the archive cannot say">
        {blocked.length === 0 ? (
          <p className="muted">
            No proposal is blocked by a missing pronunciation. Every Igbo word in the records waiting to be
            narrated can be said, or has been approved.
          </p>
        ) : (
          <>
            <p className="muted">
              These are proposals the render refuses, because a word in the record has no approved
              pronunciation. Approve the words below, or decide to narrate anyway — which is recorded on the
              episode, with your name.
            </p>
            <ul className="plain">
              {blocked.map((episode) => (
                <li key={episode.slug} style={{ marginTop: '0.7rem' }}>
                  <strong>{episode.title}</strong>{' '}
                  <span className="muted">
                    ({episode.status}) — needs {episode.words.join(', ')}
                  </span>
                  {maySpend ? (
                    <form
                      method="post"
                      action="/api/admin/pronunciation"
                      className="actions"
                      style={{ marginTop: '0.4rem' }}
                    >
                      <input type="hidden" name="action" value="waive" />
                      <input type="hidden" name="slug" value={episode.slug} />
                      <input type="hidden" name="returnTo" value="/admin/pronunciation/" />
                      <label>
                        <span>Why narrate it anyway</span>
                        <input type="text" name="note" placeholder="Recorded on the episode" />
                      </label>
                      <button className="btn btn--danger" type="submit">
                        Approve narration despite the gaps
                      </button>
                    </form>
                  ) : (
                    <p className="muted">
                      Deciding to narrate despite the gaps needs the “manage ai corpus” permission, which this
                      account does not have. An administrator or the owner can.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title={`Words the archive cannot say (${num(counts.blocking)} blocking)`}>
        {blocking.length === 0 ? (
          <p className="muted">
            Nothing is waiting. Every Igbo word the archive has found so far can be pronounced, or is marked
            as composed from parts.
          </p>
        ) : (
          <>
            <p className="muted">
              Ordered by how many records need them, because a word forty records use is worth a person’s
              time and one a single draft uses may not be. **A word here blocks its records’ narration** — that
              is the rule that stops a credit being spent on a word the archive cannot say.
            </p>
            {blocking.map((row) => (
              <div key={row.id} style={{ marginTop: '1.1rem', borderTop: '1px solid var(--rule)', paddingTop: '0.8rem' }}>
                <p>
                  <strong style={{ fontSize: '1.05em' }}>{row.word}</strong>{' '}
                  <span className="muted">
                    in {num(row.articles)} record{row.articles === 1 ? '' : 's'}, {num(row.times)} time
                    {row.times === 1 ? '' : 's'} · {STATUS_LABEL[row.status] ?? row.status} ·{' '}
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </span>
                </p>
                <details>
                  <summary className="mono" style={{ cursor: 'pointer' }}>
                    The {num(row.articles)} record{row.articles === 1 ? '' : 's'} this appears in
                  </summary>
                  <ul className="plain">
                    {row.where.map((place) => (
                      <li key={place.articleId}>
                        {place.slug ? (
                          <Link href={`/${place.slug}`}>{place.title ?? place.slug}</Link>
                        ) : (
                          `article ${place.articleId}`
                        )}
                        {place.times > 1 ? ` — ×${place.times}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>

                {/* THE UPLOAD. A real recording, or a written respelling — the owner's "upload or record". */}
                <form
                  method="post"
                  action="/api/admin/pronunciation"
                  encType="multipart/form-data"
                  style={{ marginTop: '0.6rem' }}
                >
                  <input type="hidden" name="action" value="record" />
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="returnTo" value="/admin/pronunciation/" />
                  <div className="actions">
                    <label>
                      <span>Audio recording</span>
                      <input type="file" name="audio" accept="audio/*" />
                    </label>
                    <label>
                      <span>Or a respelling (IPA, or how it sounds)</span>
                      <input type="text" name="respelling" placeholder="as the speaker writes it" />
                    </label>
                    <label>
                      <span>Who is speaking</span>
                      <input type="text" name="speakerName" placeholder="a name, if it is not you" />
                    </label>
                    <button className="btn btn--primary" type="submit">
                      Save the recording
                    </button>
                  </div>
                </form>

                <div className="actions" style={{ marginTop: '0.4rem' }}>
                  <form method="post" action="/api/admin/pronunciation">
                    <input type="hidden" name="action" value="approve" />
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="returnTo" value="/admin/pronunciation/" />
                    <button className="btn btn--primary" type="submit" disabled={!row.audioUrl && !row.respelling}>
                      Approve this pronunciation
                    </button>
                  </form>
                  <form method="post" action="/api/admin/pronunciation">
                    <input type="hidden" name="action" value="reject" />
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="returnTo" value="/admin/pronunciation/" />
                    <label>
                      <span>Judged not Igbo — why</span>
                      <input type="text" name="note" placeholder="an English word, a misspelling, …" />
                    </label>
                    <button className="btn btn--danger" type="submit">
                      Not an Igbo word
                    </button>
                  </form>
                </div>

                {!row.audioUrl && !row.respelling ? (
                  <p className="muted" style={{ marginTop: '0.3rem' }}>
                    Approving is refused until there is a recording or a respelling — an approval with nothing
                    behind it would tell the narration a word can be said when nothing says how.
                  </p>
                ) : null}
              </div>
            ))}
          </>
        )}
      </Card>

      <Card title={`Sayable from parts, and worth improving (${num(composed.length)})`}>
        {composed.length === 0 ? (
          <p className="muted">
            Dissection has not rescued any word yet. When a word is not in the dictionary but splits into
            pieces that are, it appears here — usable, marked as composed, and never presented as recorded.
          </p>
        ) : (
          <>
            <p className="muted">
              These words are not in the dictionary, but every piece of them is, so they <strong>do not block a
              render</strong> — they are spoken from a composition and labelled as composed. A real recording
              would be better evidence, so they are listed here to be improved, not demanded.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Pieces</th>
                  <th>Records</th>
                  <th>A piece carries a sound</th>
                </tr>
              </thead>
              <tbody>
                {composed.map((row) => (
                  <tr key={row.id}>
                    <td>{row.word}</td>
                    <td className="mono">{row.composedOf?.join(' + ') ?? '—'}</td>
                    <td>{num(row.articles)}</td>
                    <td>
                      {pieceSound.get(row.id)
                        ? 'yes — a piece has a recording or a respelling'
                        : 'no — every piece is a spelling with no sound recorded'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card title="Tell the admins and the editors">
        <p className="muted">
          One digest, not one message per word. It lists the words that <strong>block</strong> a render, in
          order of how many records need them, with the records they appear in and a link to this queue. It
          goes to every active account that holds “review audio”, read from the capability table rather than
          from a list of role names.
        </p>
        <p className="muted">
          Prepared now: <strong>{digest.subject}</strong> ({num(digest.total)} word
          {digest.total === 1 ? '' : 's'}).
        </p>
        <details style={{ marginTop: '0.5rem' }}>
          <summary className="mono" style={{ cursor: 'pointer' }}>
            Read the message before it is sent
          </summary>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 'var(--radius)', padding: '0.85rem' }}>
            {digest.text}
          </pre>
        </details>
        <div className="actions" style={{ marginTop: '0.6rem' }}>
          <form method="post" action="/api/admin/pronunciation">
            <input type="hidden" name="action" value="digest" />
            <input type="hidden" name="dryRun" value="1" />
            <input type="hidden" name="returnTo" value="/admin/pronunciation/" />
            <button className="btn" type="submit">
              Check who it would reach
            </button>
          </form>
          <form method="post" action="/api/admin/pronunciation">
            <input type="hidden" name="action" value="digest" />
            <input type="hidden" name="returnTo" value="/admin/pronunciation/" />
            <button className="btn btn--primary" type="submit">
              Send the digest to the admins and editors
            </button>
          </form>
        </div>
        {!configured() ? (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            ElevenLabs is not configured on this deployment, so the plan above is unknown. The queue and the
            digest work without it.
          </p>
        ) : null}
      </Card>

      <Card title="How a word is judged, and what each grade means" quiet>
        <p className="muted">
          The finder decides with evidence rather than with a list, and it says which evidence it used. A word
          carrying a diacritic is Igbo; a word in the dictionary that is not an ordinary English word is Igbo; a
          multi-word headword that is present in the text makes its words Igbo; a word whose pieces are all
          known is composed; a word built from a morpheme and a known stem is probable. **A dictionary hit that
          is also an English word is reported separately and not counted**, because `were`, `be`, `cell`
          and `engine` are all published Igbo headwords.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Grade</th>
              <th>What it means</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6].map((grade) => (
              <tr key={grade}>
                <td>{grade}</td>
                <td>{GRADE_LABEL[grade]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          Signed in as {account.account.email}. Approvals are recorded against you in the audit trail, including when
          you approve a recording you made yourself.
        </p>
      </Card>
    </>
  );
}
