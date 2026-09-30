import type { Metadata } from 'next';
import { LookupRunner } from '@/components/learn/lookup-runner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Look up an Igbo word · Ozituma Learn',
  description:
    'Search the Ozituma dictionary without an Igbo keyboard. Tone marks and the dotted vowels are optional.',
};

/**
 * Dictionary lookup.
 *
 * A server component wrapping a client runner, because the only interactive part is the box itself.
 * The dictionary's origin is resolved here, on the server, and passed down — a client component
 * cannot read a non-`NEXT_PUBLIC_` variable, and reading it there would produce `undefined/word/…`.
 *
 * The `q` parameter is accepted so a lookup can be linked to and shared, which is also what lets the
 * dictionary's own pages send a learner here with a word already in the box.
 */
export default async function LookupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialQuery = typeof params.q === 'string' ? params.q.slice(0, 100) : '';

  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Dictionary</p>
        <h1 className="learn-hero-title">Look up a word</h1>
        <p className="hero-lede">
          The same entries as{' '}
          <a href={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}>ozituma.com</a>, searchable
          from here without leaving what you were doing. Type Igbo or English — and type it however
          your keyboard allows.
        </p>
      </section>

      <section className="learn-section">
        <LookupRunner
          dictionaryUrl={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}
          initialQuery={initialQuery}
        />
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">About the search</h2>
        <div className="learn-about-grid">
          <div>
            <h3 className="learn-about-heading">Tone marks are optional</h3>
            <p>
              Igbo writes tone, and tone changes meaning — <em>ákwá</em> is an egg and <em>àkwà</em>{' '}
              is a bed. Searching for <strong>akwa</strong> finds both. The marks are shown on every
              result, because seeing them is how you learn them; they are simply not a prerequisite
              for finding the word.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">The dotted letters too</h3>
            <p>
              ị, ọ, ụ and ṅ are matched the same way, so typing <strong>oku</strong> finds{' '}
              <strong>ọkụ</strong>. This is not a shortcut: a learner on a phone keyboard that has no
              Igbo layout would otherwise be unable to search at all.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">It tells you why something matched</h3>
            <p>
              A result that matched a spelling variant, a dialect form or a meaning rather than the
              word itself says so. Being shown a word you did not type, with no explanation, reads as
              a broken search.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">It is the same dictionary</h3>
            <p>
              Results come from the dictionary&rsquo;s own search — the same index, the same ranking,
              the same records. Nothing here is a copy, so the two cannot drift apart.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
