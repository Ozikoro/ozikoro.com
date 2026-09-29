import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { listLanguages } from '@ozituma/db/repository';
import { listSuggestions } from '@ozituma/db/contributions';
import { requireLanguage } from '@ozituma/core';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contribute',
  description: 'Add a word, a meaning or a correction to the Ozituma dictionary.',
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Awaiting review', className: 'chip' },
  approved: { label: 'Published', className: 'chip chip-common' },
  merged: { label: 'Merged into an existing entry', className: 'chip chip-common' },
  rejected: { label: 'Not accepted', className: 'chip' },
};

export default async function ContributePage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; error?: string; welcome?: string }>;
}) {
  const current = await getCurrentAccount();
  if (!current) redirect('/signin?error=Sign+in+to+contribute.');

  const params = await searchParams;
  const db = await getDb();

  const [languages, mine] = await Promise.all([
    listLanguages(db),
    listSuggestions(db, { submittedBy: current.account.id, limit: 20 }),
  ]);

  // Only languages with content are offered, so a contribution cannot land in a
  // language where nobody will ever review it.
  const available = languages.filter((l) => l.wordCount > 0);
  const defaultLanguage = available[0]?.code ?? 'ibo';
  const defaultName = available[0] ? requireLanguage(available[0].code).name : 'Igbo';

  return (
    <div className="wrap wrap-narrow">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}>Contribute</h1>
        <span style={{ marginLeft: 'auto', fontSize: '0.9rem' }}>
          {current.canReview ? <Link href="/review">Review queue →</Link> : null}
        </span>
      </div>

      <p className="hero-lede">
        Signed in as <strong>{current.account.displayName ?? current.account.email}</strong>. Every
        submission is reviewed by an editor before it appears in the dictionary.
      </p>

      {params.welcome ? (
        <div className="notice" style={{ marginBottom: '1.25rem' }}>
          Welcome. Your account is ready — add your first word below.
        </div>
      ) : null}

      {params.submitted ? (
        <div className="notice notice-warn" style={{ marginBottom: '1.25rem' }}>
          <strong>Thank you — submission #{params.submitted} received.</strong>
          <p style={{ margin: '0.4rem 0 0' }}>
            An editor will review it. You will see the decision in your submissions below.
          </p>
        </div>
      ) : null}

      {params.error ? (
        <div className="notice notice-warn" role="alert" style={{ marginBottom: '1.25rem' }}>
          {params.error}
        </div>
      ) : null}

      {available.length === 0 ? (
        <div className="notice notice-warn">
          No language has any entries yet, so there is nothing to contribute against safely.
        </div>
      ) : (
        <>
          <section className="section">
            <h2>Add a word</h2>
            <form method="post" action="/api/contributions" style={{ display: 'grid', gap: '0.85rem' }}>
              <input type="hidden" name="kind" value="new_word" />

              <div>
                <label htmlFor="language">Language</label>
                <select id="language" name="language" className="search-input" style={{ width: '100%' }}>
                  {available.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.name} ({language.nativeName})
                    </option>
                  ))}
                </select>
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                  Currently only {defaultName} accepts contributions, because reviewed entries need
                  someone who can check them.
                </p>
              </div>

              <div>
                <label htmlFor="headword">Word or phrase</label>
                <input
                  id="headword"
                  name="headword"
                  required
                  maxLength={120}
                  spellCheck={false}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. ọ̀dị́nàlà"
                />
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                  Include diacritics if you can. If you cannot type them, plain letters are still
                  searchable — someone will add the correct spellings.
                </p>
              </div>

              <div>
                <label htmlFor="definitions">Meanings in English</label>
                <textarea
                  id="definitions"
                  name="definitions"
                  required
                  rows={4}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                  placeholder={'One meaning per line\nhouse\nhome'}
                />
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                  One meaning per line. Put the most common meaning first.
                </p>
              </div>

              <div>
                <label htmlFor="partOfSpeech">Grammar category (optional)</label>
                <input
                  id="partOfSpeech"
                  name="partOfSpeech"
                  maxLength={20}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. NNC"
                />
              </div>

              <div>
                <label htmlFor="example">Example sentence (optional)</label>
                <input id="example" name="example" maxLength={500} className="search-input" style={{ width: '100%' }} />
              </div>

              <div>
                <label htmlFor="exampleTranslation">Example translation (optional)</label>
                <input
                  id="exampleTranslation"
                  name="exampleTranslation"
                  maxLength={500}
                  className="search-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label htmlFor="note">Note for the reviewer (optional)</label>
                <textarea
                  id="note"
                  name="note"
                  rows={2}
                  maxLength={1000}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                  placeholder="Where did this come from? Which dialect or town uses it?"
                />
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                  Saying where a word is used helps an editor verify it, and is the difference
                  between an entry being accepted and left pending.
                </p>
              </div>

              <div>
                <button className="button" type="submit">
                  Submit for review
                </button>
              </div>
            </form>
          </section>

          <section className="section">
            <h2>Suggest a correction</h2>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              Spotted something wrong in an existing entry? Open the entry and use the link at the
              bottom, or describe it here.
            </p>
            <form method="post" action="/api/contributions" style={{ display: 'grid', gap: '0.85rem' }}>
              <input type="hidden" name="kind" value="correction" />
              <input type="hidden" name="language" value={defaultLanguage} />
              <div>
                <label htmlFor="correctionHeadword">Entry</label>
                <input
                  id="correctionHeadword"
                  name="headword"
                  maxLength={120}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="the headword you are correcting"
                />
              </div>
              <div>
                <label htmlFor="correctionNote">What is wrong, and what should it say?</label>
                <textarea
                  id="correctionNote"
                  name="note"
                  required
                  rows={3}
                  maxLength={1000}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                />
              </div>
              <div>
                <button className="button button-secondary" type="submit">
                  Submit correction
                </button>
              </div>
            </form>
          </section>
        </>
      )}

      <section className="section">
        <h2>Your submissions</h2>
        {mine.data.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Submission</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Reviewer note</th>
              </tr>
            </thead>
            <tbody>
              {mine.data.map((suggestion) => {
                const status = STATUS_LABELS[suggestion.status] ?? {
                  label: suggestion.status,
                  className: 'chip',
                };
                const headword =
                  typeof suggestion.payload.headword === 'string'
                    ? suggestion.payload.headword
                    : `#${suggestion.id}`;
                return (
                  <tr key={suggestion.id}>
                    <td>
                      <strong>{headword}</strong>
                      <br />
                      <span className="muted" style={{ fontSize: '0.83rem' }}>
                        {suggestion.kind.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <span className={status.className}>{status.label}</span>
                    </td>
                    <td className="muted" style={{ fontSize: '0.85rem' }}>
                      {new Date(suggestion.submittedAt).toLocaleDateString()}
                    </td>
                    <td className="muted" style={{ fontSize: '0.85rem' }}>
                      {suggestion.reviewNote ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <form method="post" action="/api/auth/signout" style={{ marginTop: '2rem' }}>
        <button className="button button-secondary" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}
