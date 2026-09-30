import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { listLanguages } from '@ozituma/db/repository';
import { listSuggestions } from '@ozituma/db/contributions';
import { listTribes } from '@ozituma/db/clans';
import { requireLanguage } from '@ozituma/core';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contribute',
  description:
    'Add a word, a clan, a name or a proverb to Ozituma, or suggest a correction to an entry.',
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

  const [languages, mine, divisions] = await Promise.all([
    listLanguages(db),
    listSuggestions(db, { submittedBy: current.account.id, limit: 20 }),
    // The divisions of Igboland, so the clan form offers the real six rather than a free-text box
    // somebody has to guess the spelling of.
    listTribes(db),
  ]);

  // Only languages with content are offered, so a contribution cannot land in a
  // language where nobody will ever review it.
  const available = languages.filter((l) => l.wordCount > 0);
  const defaultLanguage = available[0]?.code ?? 'ibo';
  const defaultName = available[0] ? requireLanguage(available[0].code).name : 'Igbo';
  // The varieties already recorded for it, so a recording can say which one it is in. Read after
  // the default language is known, because it is read FOR that language.
  const dialects = await db.rows<{ code: string; name: string }>(
    `select code, name from dialect where language_code = $1 and is_active order by name`,
    [defaultLanguage]
  );

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
            <h2>Add a name</h2>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              An Igbo personal name, with the meaning the family gives it. A name is unisex unless
              the name itself is stated to be male or female.
            </p>
            <form method="post" action="/api/contributions" style={{ display: 'grid', gap: '0.85rem' }}>
              <input type="hidden" name="kind" value="new_name" />
              <input type="hidden" name="language" value={defaultLanguage} />

              <div>
                <label htmlFor="nameName">Name</label>
                <input
                  id="nameName"
                  name="name"
                  required
                  maxLength={120}
                  spellCheck={false}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Chidiebube"
                />
              </div>

              <div>
                <label htmlFor="nameMeaning">What it means</label>
                <input
                  id="nameMeaning"
                  name="meaning"
                  maxLength={600}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. God is wonderful"
                />
              </div>

              <div>
                <label htmlFor="nameGender">Gender</label>
                <select id="nameGender" name="gender" className="search-input" style={{ width: '100%' }}>
                  <option value="unisex">Unisex</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                  Choose male or female only if a source says so — father and mother in a name are
                  not gender signals.
                </p>
              </div>

              <div>
                <label htmlFor="nameVariants">Other spellings (optional)</label>
                <input
                  id="nameVariants"
                  name="variants"
                  maxLength={600}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="short forms or other spellings, separated by commas"
                />
              </div>

              <div>
                <label htmlFor="nameOrigins">Where the name is borne (optional)</label>
                <input
                  id="nameOrigins"
                  name="origins"
                  maxLength={600}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="towns or clans, separated by commas"
                />
              </div>

              <div>
                <label htmlFor="nameNote">Note for the reviewer (optional)</label>
                <textarea
                  id="nameNote"
                  name="note"
                  rows={2}
                  maxLength={1000}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                  placeholder="Where does this name come from? Who bears it?"
                />
              </div>

              <div>
                <button className="button" type="submit">
                  Submit the name
                </button>
              </div>
            </form>
          </section>

          <section className="section">
            <h2>Add a dialect or variety</h2>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              A variety of Igbo the dictionary does not record yet. Once it is here, a spelling or a
              recording can be filed under it.
            </p>
            <form method="post" action="/api/contributions" style={{ display: 'grid', gap: '0.85rem' }}>
              <input type="hidden" name="kind" value="new_dialect" />
              <input type="hidden" name="language" value={defaultLanguage} />

              <div>
                <label htmlFor="dialectName">Name of the variety</label>
                <input
                  id="dialectName"
                  name="name"
                  required
                  maxLength={120}
                  spellCheck={false}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Ọnịcha"
                />
              </div>

              <div>
                <label htmlFor="dialectCode">Short code</label>
                <input
                  id="dialectCode"
                  name="code"
                  required
                  maxLength={24}
                  spellCheck={false}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Onicha"
                />
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                  Letters, digits, spaces, hyphens or underscores. This is the handle the record
                  files spellings and recordings under.
                </p>
              </div>

              <div>
                <label htmlFor="dialectNative">Name in the variety itself (optional)</label>
                <input
                  id="dialectNative"
                  name="nativeName"
                  maxLength={120}
                  className="search-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label htmlFor="dialectRegion">Where it is spoken (optional)</label>
                <input
                  id="dialectRegion"
                  name="region"
                  maxLength={120}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="a town, a local government area, a state"
                />
              </div>

              <div>
                <label htmlFor="dialectNote">Note for the reviewer (optional)</label>
                <textarea
                  id="dialectNote"
                  name="note"
                  rows={2}
                  maxLength={1000}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                />
              </div>

              <div>
                <button className="button" type="submit">
                  Submit the variety
                </button>
              </div>
            </form>
          </section>

          <section className="section">
            <h2>Add a voice recording</h2>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              Say the word and upload the recording. Name the entry it belongs to — the word must
              already be in the dictionary, so add it first if it is not.
            </p>
            <form
              method="post"
              action="/api/audio"
              encType="multipart/form-data"
              style={{ display: 'grid', gap: '0.85rem' }}
            >
              <input type="hidden" name="language" value={defaultLanguage} />

              <div>
                <label htmlFor="audioHeadword">The word being said</label>
                <input
                  id="audioHeadword"
                  name="headword"
                  required
                  maxLength={120}
                  spellCheck={false}
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. ụlọ"
                />
              </div>

              <div>
                <label htmlFor="audioFile">The recording</label>
                <input
                  id="audioFile"
                  name="file"
                  type="file"
                  accept="audio/*"
                  required
                  className="search-input"
                  style={{ width: '100%' }}
                />
                <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                  A sound file under two minutes. If you have a microphone, your browser can record
                  one for you and put it in this box.
                </p>
              </div>

              <div>
                <label htmlFor="audioDialect">Which variety is it said in? (optional)</label>
                <select
                  id="audioDialect"
                  name="dialectCode"
                  className="search-input"
                  style={{ width: '100%' }}
                >
                  <option value="">Not stated</option>
                  {dialects.map((dialect) => (
                    <option key={dialect.code} value={dialect.code}>
                      {dialect.name} ({dialect.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="audioNote">Note for the reviewer (optional)</label>
                <textarea
                  id="audioNote"
                  name="provenanceNote"
                  rows={2}
                  maxLength={1000}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                  placeholder="Who is speaking? Where is this said?"
                />
              </div>

              <div>
                <button className="button" type="submit">
                  Submit the recording
                </button>
              </div>
            </form>
          </section>

          <section className="section">
            <h2>Add a proverb</h2>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              An ilu, with its English if you have one. A proverb submitted without an English is
              still useful — it will be paired up later.
            </p>
            <form method="post" action="/api/contributions" style={{ display: 'grid', gap: '0.85rem' }}>
              <input type="hidden" name="kind" value="new_proverb" />
              <input type="hidden" name="language" value={defaultLanguage} />

              <div>
                <label htmlFor="proverbText">The proverb</label>
                <textarea
                  id="proverbText"
                  name="text"
                  required
                  rows={2}
                  maxLength={600}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                  placeholder="e.g. Ọ bụ nwayọọ ka e ji aracha ọfe dị ọkụ"
                />
              </div>

              <div>
                <label htmlFor="proverbTranslation">What it means in English (optional)</label>
                <textarea
                  id="proverbTranslation"
                  name="translation"
                  rows={2}
                  maxLength={600}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                />
              </div>

              <div>
                <label htmlFor="proverbNote">Note for the reviewer (optional)</label>
                <textarea
                  id="proverbNote"
                  name="note"
                  rows={2}
                  maxLength={1000}
                  className="search-input"
                  style={{ width: '100%', fontFamily: 'inherit' }}
                  placeholder="Where did you hear it? Which town says it this way?"
                />
              </div>

              <div>
                <button className="button" type="submit">
                  Submit the proverb
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

      {/*
        A clan is not a thing inside a language, so this form sits outside the language check: it is
        the one contribution that can be made on a site with no dictionary in it at all.
      */}
      <section className="section">
        <h2>Add a clan or a town</h2>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          A clan, town or grouping that is not in the registry yet. Say where it is today — its
          state, its local government area, its towns — and what is known of it.
        </p>
        <form method="post" action="/api/contributions" style={{ display: 'grid', gap: '0.85rem' }}>
          <input type="hidden" name="kind" value="new_clan" />

          <div>
            <label htmlFor="clanName">Name</label>
            <input
              id="clanName"
              name="name"
              required
              maxLength={120}
              spellCheck={false}
              className="search-input"
              style={{ width: '100%' }}
              placeholder="e.g. Ozubulu"
            />
          </div>

          <div>
            <label htmlFor="clanKind">What it is</label>
            <select id="clanKind" name="entryKind" className="search-input" style={{ width: '100%' }}>
              <option value="clan">Clan</option>
              <option value="town">Town</option>
              <option value="section">Section</option>
              <option value="confederation">Confederation of clans</option>
              <option value="kingdom">Kingdom</option>
              <option value="other">Something else</option>
            </select>
          </div>

          <div>
            <label htmlFor="clanDivision">Division of Igboland (optional)</label>
            <select id="clanDivision" name="division" className="search-input" style={{ width: '100%' }}>
              <option value="">Not sure</option>
              {divisions.map((division) => (
                <option key={division.slug} value={division.name}>
                  {division.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="clanStates">State or states today</label>
            <input
              id="clanStates"
              name="states"
              maxLength={300}
              className="search-input"
              style={{ width: '100%' }}
              placeholder="e.g. Anambra"
            />
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
              Separated by commas. The present-day state, not a colonial division.
            </p>
          </div>

          <div>
            <label htmlFor="clanLgas">Local government areas (optional)</label>
            <input
              id="clanLgas"
              name="lgas"
              maxLength={400}
              className="search-input"
              style={{ width: '100%' }}
              placeholder="e.g. Ekwusigo, Nnewi North"
            />
          </div>

          <div>
            <label htmlFor="clanTowns">Towns and villages in it (optional)</label>
            <textarea
              id="clanTowns"
              name="towns"
              rows={3}
              maxLength={6000}
              className="search-input"
              style={{ width: '100%', fontFamily: 'inherit' }}
              placeholder={'One per line, or separated by commas'}
            />
          </div>

          <div>
            <label htmlFor="clanOrigin">Summary (optional)</label>
            <input
              id="clanOrigin"
              name="origin"
              maxLength={600}
              className="search-input"
              style={{ width: '100%' }}
              placeholder="one or two sentences for the index card"
            />
          </div>

          <div>
            <label htmlFor="clanDescription">Description (optional)</label>
            <textarea
              id="clanDescription"
              name="description"
              rows={5}
              maxLength={6000}
              className="search-input"
              style={{ width: '100%', fontFamily: 'inherit' }}
              placeholder={'Leave a blank line between paragraphs'}
            />
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
              A summary or a description is needed — a reviewer must have something to check.
            </p>
          </div>

          <div>
            <label htmlFor="clanNote">Note for the reviewer (optional)</label>
            <textarea
              id="clanNote"
              name="note"
              rows={2}
              maxLength={1000}
              className="search-input"
              style={{ width: '100%', fontFamily: 'inherit' }}
              placeholder="Where does this account come from?"
            />
          </div>

          <div>
            <button className="button" type="submit">
              Submit the entry
            </button>
          </div>
        </form>
      </section>

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
