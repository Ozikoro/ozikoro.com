import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getProverb, proverbNeighbours, DEFAULT_LANGUAGE } from '@ozituma/db/repository';
import { getLanguage, languageCodeFromSlug } from '@ozituma/core';
import { SearchForm } from '@/components/dictionary';
import { getCurrentAccount } from '@/lib/session';
import './../proverbs.css';

export const dynamic = 'force-dynamic';

interface ProverbPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ language?: string; suggested?: string; edit?: string }>;
}

async function load(id: string, languageSlug: string | undefined) {
  const language = languageCodeFromSlug(languageSlug ?? '') || DEFAULT_LANGUAGE;
  const numeric = Number(id);
  // The id is the only address a proverb has: unlike a headword it has no
  // canonical spelling to build a slug from, and a slug derived from the folded
  // text would collide the moment two proverbs differ only in their tone marks.
  if (!Number.isInteger(numeric) || numeric <= 0) return { proverb: null, language };
  const db = await getDb();
  const proverb = await getProverb(db, numeric, language);
  return { proverb, language };
}

export async function generateMetadata({ params, searchParams }: ProverbPageProps): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { proverb } = await load(id, query.language);
  if (!proverb) return { title: 'Proverb not found' };

  const trimmed = proverb.text.length > 90 ? `${proverb.text.slice(0, 87)}…` : proverb.text;
  return {
    title: trimmed,
    description: proverb.translation
      ? `${proverb.text} — ${proverb.translation}`
      : `${proverb.text}. An Igbo proverb on Ozituma, linked to the entries for the words it holds.`,
  };
}

export default async function ProverbPage({ params, searchParams }: ProverbPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { proverb, language } = await load(id, query.language);
  if (!proverb) notFound();

  const current = await getCurrentAccount();
  const db = await getDb();
  const neighbours = await proverbNeighbours(db, proverb.id, language);
  const languageDef = getLanguage(language);

  return (
    <div className="proverbs-page">
      <main className="prov-one">
        <Link className="prov-back" href="/proverbs">
          <ArrowLeftIcon />
          Proverbs
        </Link>

        <div className="prov-head">
          <p className="prov-eyebrow">
            Ilu Igbo
            {proverb.theme ? ` · ${proverb.theme}` : ''}
          </p>
          <h1 className="prov-one-title">{proverb.text}</h1>
        </div>

        <dl className="prov-facts">
          {proverb.literal ? (
            <div>
              <dt>Literal translation</dt>
              <dd className="prov-literal">“{proverb.literal}”</dd>
            </div>
          ) : null}

          <div>
            <dt>Meaning</dt>
            {/*
              A meaning is shown, or the proverb is shown without one.

              There is deliberately no third state. This page used to print a reading it
              had itself labelled uncertain — "[uncertain] Whoever walks himself into the
              muck..." with a paragraph underneath explaining that the Igbo was corrupt
              and the reading was the best that could be established. Publishing a claim
              and a disclaimer in the same breath is not honesty; it is a claim with an
              escape clause, and the owner's answer to it was "remove them, instead of
              giving false information". Anything not settled enough to state plainly is
              not stated, and the paragraph below says so without dressing it up.
            */}
            {proverb.translation ? (
              <dd className="prov-meaning">
                {proverb.equivalent ? (
                  <>
                    <span>“{proverb.equivalent}”</span>{' '}
                  </>
                ) : null}
                {proverb.translation}
              </dd>
            ) : (
              <dd className="prov-meaning">
                No English rendering of this proverb has been recorded yet. It is shown in Igbo
                alone rather than given a drafted one.
              </dd>
            )}
          </div>

          {proverb.usage ? (
            <div>
              <dt>The wisdom behind it</dt>
              <dd className="prov-wisdom">{proverb.usage}</dd>
            </div>
          ) : null}
        </dl>

        {proverb.theme ? (
          <Link className="prov-more" href={`/proverbs?theme=${encodeURIComponent(proverb.theme)}`}>
            More on {proverb.theme.toLowerCase()}
            <ArrowRightIcon />
          </Link>
        ) : null}

        {proverb.words.length > 0 ? (
          <section className="entry-section" style={{ marginTop: '3rem' }} aria-label="Words in this proverb">
            <p className="entry-label">Words in this proverb</p>
            <ul className="relation-chips">
              {proverb.words.map((word) => (
                <li key={word.id}>
                  <Link
                    className="relation-chip"
                    href={`/word/${language}/${encodeURIComponent(word.slug)}`}
                  >
                    {word.headword}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0.6rem 0 0' }}>
              Every one of these is an entry in the {languageDef?.name ?? language} dictionary.
            </p>
          </section>
        ) : null}

        <nav className="proverb-neighbours" aria-label="More proverbs" style={{ marginTop: '2.5rem' }}>
          {neighbours.previous ? (
            <Link href={`/proverbs/${neighbours.previous.id}`}>
              <span className="proverb-neighbour-label">Previous</span>
              <span className="proverb-neighbour-text">
                {neighbours.previous.text.length > 64
                  ? `${neighbours.previous.text.slice(0, 61)}…`
                  : neighbours.previous.text}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {neighbours.next ? (
            <Link href={`/proverbs/${neighbours.next.id}`} style={{ textAlign: 'right' }}>
              <span className="proverb-neighbour-label">Next</span>
              <span className="proverb-neighbour-text">
                {neighbours.next.text.length > 64
                  ? `${neighbours.next.text.slice(0, 61)}…`
                  : neighbours.next.text}
              </span>
            </Link>
          ) : (
            <span />
          )}
        </nav>

        {/*
          Editing is open to any signed-in account, and nothing an account proposes
          goes live on its own: the proposal lands in the review queue and an
          editor compares the two texts before either is published. That is the
          owner's rule, and it is also what stops a proverb being quietly
          rewritten by whoever happened to be logged in — a single word changes
          the sense of an entire saying.
        */}
        {current ? (
          <section className="section" style={{ marginTop: '2.5rem' }}>
            <h2>Propose an edit</h2>
            {query.suggested ? (
              <p className="notice" style={{ marginTop: '0.75rem' }}>
                Thank you — that edit is queued as submission #{query.suggested}. An editor reads it
                before anything here changes.
              </p>
            ) : null}
            <form
              action="/api/contributions"
              method="post"
              style={{ marginTop: '1rem', display: 'grid', gap: '0.6rem' }}
            >
              <input type="hidden" name="kind" value="proverb_edit" />
              <input type="hidden" name="language" value={language} />
              <input type="hidden" name="exampleId" value={proverb.id} />
              <input type="hidden" name="previousText" value={proverb.text} />
              <label htmlFor="proverb-text" style={{ fontSize: '0.85rem' }}>
                The proverb in Igbo
              </label>
              <textarea
                id="proverb-text"
                name="text"
                className="search-input"
                rows={2}
                defaultValue={proverb.text}
                maxLength={600}
              />
              <label htmlFor="proverb-translation" style={{ fontSize: '0.85rem' }}>
                Its meaning in English
              </label>
              <textarea
                id="proverb-translation"
                name="translation"
                className="search-input"
                rows={3}
                defaultValue={proverb.translation ?? ''}
                maxLength={600}
              />
              <label htmlFor="proverb-note" style={{ fontSize: '0.85rem' }}>
                Why (optional)
              </label>
              <input
                id="proverb-note"
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
              <p className="card-meta" style={{ margin: 0 }}>
                Signed in as {current.account.displayName ?? current.account.email}. Your proposal
                is queued for an editor and credited to you if it is accepted.
              </p>
            </form>
          </section>
        ) : (
          <p className="card-meta" style={{ marginTop: '2rem' }}>
            <Link href="/signin">Sign in</Link> to propose an edit to this proverb. An editor reads
            every proposal before it is published.
          </p>
        )}

        <section className="section" style={{ marginTop: '2.5rem' }}>
          <h2>Look up a word</h2>
          <SearchForm />
        </section>
      </main>
    </div>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
