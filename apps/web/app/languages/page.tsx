import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listLanguages } from '@ozituma/db/repository';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Languages',
  description:
    'Every African language Ozituma serves, with an honest count of how much dictionary content exists for each.',
};

export default async function LanguagesPage() {
  const db = await getDb();
  const [languages, current] = await Promise.all([listLanguages(db), getCurrentAccount()]);

  /*
   * What a signed-out reader may see of a language that is not live.
   *
   * The owner, 2026-09-28: "don't show any data available to them unless they're registered
   * users. so basically, registered users can see all the languages that are not live yet or
   * coming soon or registered, so they can see the words there and maybe be able to add or
   * edit."
   *
   * So tier 1 — the languages that are actually live — is public in full. Everything else is
   * named, because the project's coverage should be honest about what it intends to carry,
   * and holds its content back until someone has an account. The count is part of the content:
   * "Yoruba, 4,365 words" invites a reader to browse material that is still being checked.
   */
  const signedIn = current !== null;
  const maySee = (tier: number) => signedIn || tier === 1;

  const byTier = new Map<number, typeof languages>();
  for (const language of languages) {
    const bucket = byTier.get(language.tier) ?? [];
    bucket.push(language);
    byTier.set(language.tier, bucket);
  }

  const TIER_LABELS: Record<number, { title: string; blurb: string }> = {
    1: { title: 'Available now', blurb: 'Searched and read like any other entry here.' },
    2: { title: 'In preparation', blurb: 'Priority languages, being prepared for the dictionary.' },
    3: { title: 'Registered', blurb: 'Recognised languages, waiting their turn.' },
  };

  return (
    <div className="wrap">
      <h1>Languages</h1>
      <p className="hero-lede">
        Ozituma is built to carry many languages, so bringing one in is a matter of doing the work
        on that language rather than reworking the dictionary. We list every recognised language
        with its real word
        count, because a dictionary that overstates its coverage is worse than one that admits it.
      </p>

      {[1, 2, 3].map((tier) => {
        const bucket = byTier.get(tier) ?? [];
        if (bucket.length === 0) return null;
        return (
          <section key={tier} style={{ marginTop: '2.5rem' }}>
            <h2>{TIER_LABELS[tier]?.title ?? `Tier ${tier}`}</h2>
            <p className="muted" style={{ fontSize: '0.92rem' }}>
              {TIER_LABELS[tier]?.blurb}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Language</th>
                  <th>Endonym</th>
                  <th>Code</th>
                  <th style={{ textAlign: 'right' }}>Words</th>
                  <th style={{ textAlign: 'right' }}>Dialects</th>
                  <th style={{ textAlign: 'right' }}>Speakers (approx.)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bucket.map((language) => (
                  <tr key={language.code}>
                    <td>
                      <strong>{language.name}</strong>
                    </td>
                    <td>{language.nativeName}</td>
                    <td className="mono">{language.code}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {maySee(language.tier) ? language.wordCount.toLocaleString() : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {maySee(language.tier) ? language.dialectCount || '—' : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {language.speakerCount ? `${(language.speakerCount / 1_000_000).toFixed(1)}M` : '—'}
                    </td>
                    <td>
                      {maySee(language.tier) && language.wordCount > 0 ? (
                        <Link href={`/?language=${language.urlSlug}`}>Browse →</Link>
                      ) : (
                        <span className="muted">{language.tier === 1 ? 'Coming' : 'Coming soon'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {!signedIn ? (
        <p className="muted" style={{ marginTop: '1.5rem' }}>
          <Link href="/signin">Sign in</Link> or <Link href="/join">create an account</Link> to see
          what has been gathered for the languages still in preparation, and to add to them.
        </p>
      ) : null}

      <section style={{ marginTop: '3rem' }}>
        <h2>Contributing a language</h2>
        <p>
          Every language here is carried by people who speak it. If yours is listed and has little
          or nothing in it yet, that is where help is worth most: send words, meanings, the
          varieties they are said in, and recordings.
        </p>
        <p>
          <Link href="/contribute">Contribute a word</Link> ·{' '}
          <Link href="/docs">API access for developers</Link>
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          A language becomes live once its entries have been checked. Contributions are accepted
          against the languages that are live today; the others open as they are finished.
        </p>
      </section>

      <section style={{ marginTop: '2.5rem' }}>
        <h2>API access</h2>
        <p>
          Every language shares one API. Pass <code className="mono">?language=&lt;code&gt;</code> to
          any endpoint. <Link href="/docs">Read the API documentation →</Link>
        </p>
      </section>
    </div>
  );
}
