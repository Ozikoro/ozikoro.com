import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getPersonName, relatedPersonNames, DEFAULT_LANGUAGE } from '@ozituma/db/repository';
import { getLanguage, languageCodeFromSlug, regionDisplay } from '@ozituma/core';
import { VariantDisclosure, VarietyFormDisclosure } from '@/components/variants';
import { getCurrentAccount } from '@/lib/session';
import { AudioButton } from '@/components/audio-button';

export const dynamic = 'force-dynamic';

interface NamePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ language?: string }>;
}

async function resolve(query: { language?: string }) {
  const language = languageCodeFromSlug(query.language ?? '') ?? DEFAULT_LANGUAGE;
  const languageDef = getLanguage(language);
  return { language, languageName: languageDef?.name ?? language };
}

export async function generateMetadata({ params, searchParams }: NamePageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { language } = await resolve(query);
  const db = await getDb();
  const name = await getPersonName(db, decodeURIComponent(slug), language);

  if (!name) return { title: 'Name not found' };

  const origin = name.origins.map(regionDisplay).join(', ');

  return {
    title: `${name.name} — ${name.meaning ?? 'Igbo name'}`,
    description:
      `${name.name}${name.meaning ? `: ${name.meaning}` : ''}.` +
      (origin ? ` A name borne in ${origin}.` : '') +
      ` An Igbo personal name in the Ozituma name dictionary.`,
    openGraph: {
      title: `${name.name} — Ozituma name dictionary`,
      description: name.meaning ?? undefined,
      type: 'article',
    },
  };
}

export default async function NamePage({ params, searchParams }: NamePageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { language, languageName } = await resolve(query);

  const db = await getDb();
  const name = await getPersonName(db, decodeURIComponent(slug), language);
  if (!name) notFound();

  const currentAccount = await getCurrentAccount();

  const related = await relatedPersonNames(db, {
    id: name.id,
    meaning: name.meaning,
    language: name.language,
  });

  return (
    <div className="wrap wrap-narrow">
      <p style={{ margin: '0 0 1.25rem' }}>
        <Link href="/names" className="muted" style={{ fontSize: '0.92rem' }}>
          ← The Name Dictionary
        </Link>
      </p>

      <article>
        <header className="entry-header">
          <div className="entry-title-row">
            <h1 className="entry-title">{name.name}</h1>
          </div>

          <div className="entry-meta">
            <span>personal name</span>
            <span>{languageName}</span>
          </div>

          <p className="dialect-badge">{name.gender}</p>

          {/*
            Two disclosures, in the order a reader needs them: the spellings of
            this name in Igbo, then the forms it takes in the neighbouring
            varieties. Presented exactly as the dialect material is on a word
            entry — same toggle, same chips — because the owner asked for name
            variants to read like dialect variants.
          */}
          {/*
            The recording, beside the name the way it sits beside a headword on an entry page.
            A name is a word said aloud, and the spelling does not tell a reader how it is said.
          */}
          {(() => {
            const [clip] = name.audio;
            if (!clip) return null;
            return (
              <>
                <p className="voice-label">Voice recording</p>
                <p style={{ margin: 0, fontSize: '0.95rem' }}>
                  <AudioButton src={clip.url} label={`Play the recording of ${name.name}`} />
                  {clip.speaker ? `recorded by ${clip.speaker}` : 'play'}
                </p>
              </>
            );
          })()}

          <VariantDisclosure variants={name.variants} noun="variants" />
          <VarietyFormDisclosure forms={name.varietyForms} />

          {/*
            The name in Ndebe, beside the variants because it belongs with them:
            it is another way of writing this name, not another name. The object
            does the same job it does on a word entry.

            68 of 2,879 names have no value, and the reason is the syllabary
            rather than the name: Ndebe has no body for `ŋ`, so a name spelled
            with it cannot be written and is left blank rather than approximated.
          */}
          {name.ndebe ? (
            <div style={{ marginTop: '0.9rem' }}>
              <p className="voice-label">Ndebe script</p>
              <p className="script-sign" lang="und-Ndebe">
                {name.ndebe}
              </p>
            </div>
          ) : null}
        </header>

        <section className="entry-section" aria-label="Meaning">
          <h2>Meaning</h2>
          {name.meaning ? (
            <ol className="sense-list">
              <li className="sense">
                <span className="sense-number" aria-hidden="true">
                  1.
                </span>
                <div className="sense-body">
                  <p className="sense-gloss">{name.meaning}</p>
                </div>
              </li>
            </ol>
          ) : (
            <p className="muted">No meaning has been recorded for this name yet.</p>
          )}
        </section>

        {/*
          Origin is where the name is BORNE, not where we found it.

          The owner was explicit about this, and the distinction is the whole
          reason the column is a closed vocabulary: "Nsukka" is an origin, and
          the name of a website we collected from is not. A name used right
          across Igboland, or one whose regional concentration nobody has
          documented, carries no origin at all — and then this section does not
          render. An absent Origin is the honest answer, not a hole to fill.
        */}
        {name.origins.length > 0 ? (
          <section className="entry-section entry-section-rule" aria-label="Origin">
            <h2>Origin</h2>
            <p className="name-fact-value">
              {name.origins.map(regionDisplay).join(' · ')}
            </p>
          </section>
        ) : null}

        {/*
          Correcting a name, for anyone signed in — the same rule the proverb page follows, which
          the owner asked for here: "on the name page, i need you to make it editable for
          contributors and users, just like you made the proverbs page."

          A proposal, not an edit: an editor reads it and only an approval changes the name. What
          the entry said before is recorded on the way through, because the owner corrects names
          often and each correction should be traceable.
        */}
        <section className="entry-section entry-section-rule" aria-label="Pronunciation">
          <h2>{name.audio.length > 0 ? 'Add another pronunciation' : 'Add a pronunciation'}</h2>
          {currentAccount ? (
            <>
              <p className="muted" style={{ fontSize: '0.88rem', margin: '0 0 0.7rem' }}>
                Submitting as{' '}
                <strong>
                  {currentAccount.account.displayName ?? currentAccount.account.email}
                </strong>
                , and your name will be shown as the speaker of this recording.
              </p>
              {/*
                The recorder takes a word id on the dictionary side because a recording there hangs
                off a word. A name is not a word, so this form is the file-and-microphone path only
                until the audio submission route learns about names; the recorder itself is the same
                component, so the waveform and the empty-recording check come with it.
              */}
              <p className="muted" style={{ fontSize: '0.88rem' }}>
                Recordings of names are being wired into the submission queue next. Until then,
                write to us with a recording and we will add it.
              </p>
            </>
          ) : (
            <p>
              <Link href="/signin">Sign in</Link> or <Link href="/join">create an account</Link> to
              record a pronunciation.
            </p>
          )}
        </section>

        <section className="entry-section entry-section-rule" aria-label="Propose an edit">
          <h2>Propose an edit</h2>
          {currentAccount ? (
            <>
              <p className="muted" style={{ fontSize: '0.88rem', margin: '0 0 0.7rem' }}>
                Submitting as{' '}
                <strong>
                  {currentAccount.account.displayName ?? currentAccount.account.email}
                </strong>
                . An editor reads every proposal before it is published.
              </p>
              <form
                action="/api/contributions"
                method="post"
                style={{ display: 'grid', gap: '0.6rem', maxWidth: '38rem' }}
              >
                <input type="hidden" name="kind" value="name_edit" />
                <input type="hidden" name="language" value={language} />
                <input type="hidden" name="nameId" value={name.id} />
                <input type="hidden" name="previousName" value={name.name} />
                <input type="hidden" name="previousMeaning" value={name.meaning ?? ''} />
                <input type="hidden" name="previousGender" value={name.gender} />
                {name.variants.map((variant, index) => (
                  <input
                    key={variant}
                    type="hidden"
                    name="previousVariants"
                    value={variant}
                    id={`prev-variant-${index}`}
                  />
                ))}

                <label htmlFor="edit-name" style={{ fontSize: '0.85rem' }}>
                  The name
                </label>
                <input
                  id="edit-name"
                  name="name"
                  className="search-input"
                  defaultValue={name.name}
                  maxLength={120}
                />

                <label htmlFor="edit-name-meaning" style={{ fontSize: '0.85rem' }}>
                  Its meaning
                </label>
                <textarea
                  id="edit-name-meaning"
                  name="meaning"
                  className="search-input"
                  rows={3}
                  defaultValue={name.meaning ?? ''}
                  maxLength={1000}
                />

                <label htmlFor="edit-gender" style={{ fontSize: '0.85rem' }}>
                  Gender
                </label>
                <select
                  id="edit-gender"
                  name="gender"
                  className="search-input"
                  defaultValue={name.gender}
                >
                  <option value="unisex">unisex</option>
                  <option value="male">male</option>
                  <option value="female">female</option>
                </select>

                <label htmlFor="edit-variants" style={{ fontSize: '0.85rem' }}>
                  Variants, separated by commas
                </label>
                <input
                  id="edit-variants"
                  name="variants"
                  className="search-input"
                  defaultValue={name.variants.join(', ')}
                  maxLength={600}
                />

                <label htmlFor="edit-name-note" style={{ fontSize: '0.85rem' }}>
                  Why (optional)
                </label>
                <input
                  id="edit-name-note"
                  name="note"
                  className="search-input"
                  maxLength={1000}
                  placeholder="What is wrong with it as it stands?"
                />

                <div>
                  <button className="button" type="submit">
                    Propose this edit
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p>
              <Link href="/signin">Sign in</Link> or <Link href="/join">create an account</Link> to
              propose an edit. An editor reads every proposal before anything changes.
            </p>
          )}
        </section>

        {related.length > 0 ? (
          <section className="entry-section" aria-label="Related names">
            <h2>Related names</h2>
            <p className="muted" style={{ fontSize: '0.88rem', margin: '0 0 0.7rem' }}>
              Names whose meaning shares a word with this one.
            </p>
            <ul className="relation-chips">
              {related.map((other) => (
                <li key={other.id}>
                  <Link className="relation-chip" href={`/names/${encodeURIComponent(other.slug)}`}>
                    {other.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </div>
  );
}
