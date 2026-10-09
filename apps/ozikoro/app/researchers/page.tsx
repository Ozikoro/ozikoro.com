/**
 * The researchers' directory — the people who wrote the archive.
 *
 * WHAT THE LOGIC WAS, AND WHAT IT IS NOW (round 310).
 *
 * The owner's report: *"it seems to be showing only the researchers profile, and it's just one."* Both
 * halves were true and they were the same fault. The page defined a researcher as **"an account that
 * has chosen a public research profile"** — `listResearchers`, reading `ozikoro_member.is_public` —
 * and exactly one account has ever done that, so the page rendered one card. There was nothing wrong
 * with the query. **The definition was wrong for the page.** The archive's researchers are the people
 * whose byline is on the record: eleven contributors account for all 1,051 published records, the same
 * eleven `/about/` lists, and they were invisible here.
 *
 * So the directory now answers both questions and keeps them apart:
 *
 *   1. `writers` — every `ozikoro_contributor` with at least one published, non-page record, with
 *      that count, linking to `/author/<slug>/` which already lists their work. This is the same
 *      `records > 0` rule and the same counts `fillAbout` uses on `/about/`, and the biography line
 *      below is its wording, **so the two pages cannot disagree about the same people.**
 *   2. `profiles` — published research profiles. A profile is an ADDITIONAL thing (institution,
 *      interests, publications) and it is shown as itself. **The archive does not record which byline
 *      a profile belongs to**: `ozikoro_contributor.account_id` is set only when an editor approves a
 *      claim, and no contributor has one, so the owner's profile and the `nze` byline that shares his
 *      name are two rows this page will not join on a matching name. It says so, offers `/claims/`,
 *      and merges the two onto one entry by itself the moment that claim is approved — because the
 *      record changed, not because this page was edited.
 *
 * `ozikoro_contributor` holds sixteen rows and eleven of them have published records. **`/about/`
 * reports the same eleven, and its filter is the right one**: a byline with no published record is a
 * name the archive holds no work for, and listing it would be presenting a person the archive cannot
 * show anything about. The other five are not hidden by a rule that is wrong; they have nothing
 * published yet, and they join this page the moment they do.
 *
 * Nothing on this page is invented. Names, biographies, counts, institutions and interests are read
 * from the record; a portrait is shown only where the author uploaded one, and where none was uploaded the
 * entry carries a monogram rather than a stock face.
 *
 * THE PARAGRAPH THAT USED TO END THAT SENTENCE SAID THE OPPOSITE, AND IT WAS WRONG. It read *"portraits are
 * monogram initials, as `/about/` does, because no author has supplied a photograph"*. The WordPress usermeta
 * table, which the archive holds in its own SQL dump, carries a `sabox-profile-image` for six of the eleven
 * people below — the field the live site's author box reads — and every one of those files is in this
 * archive's media store. The REST import read `avatar_urls` instead, which is Gravatar and answers one grey
 * silhouette for everybody, so the real portraits were in the building and never on the page. **The claim was
 * not a design decision; it was a missing query.** The research-directory backfill carries the portraits.
 *
 * The search box reads exactly the three things its label promises — name, institution and research
 * interest — which the note above it states.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listResearchDirectory, sameOriginPortrait } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Researchers',
  description:
    'The people who wrote the Ozikoro archive, and the research profiles published beside their work.',
  alternates: { canonical: 'https://ozikoro.com/researchers' },
};

/** `IE` from `Idenze Ezeme`. Two letters, and the same monogram `/about/` draws. */
function initials(name: string): string {
  return name.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/** `1051` -> `1,051`. The archive counts in en-GB, as the rest of the site does. */
function n(value: number): string {
  return value.toLocaleString('en-GB');
}

/** The role line the profile route prints, so a profile reads the same here as on its own page. */
function roleLine(person: { headline: string | null; institution: string | null; department: string | null }): string {
  if (person.headline) return person.headline;
  if (person.institution) {
    return `${person.department ? `${person.department}, ` : ''}${person.institution}`;
  }
  return 'Independent researcher';
}

export default async function ResearchersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 200) || null;

  const db = await getDb();
  const { writers, profiles, totals } = await listResearchDirectory(db, { search: query, limit: 200 });

  const matched = writers.length + profiles.length;
  const withoutBio = totals.writers - totals.writersWithBio;
  const withoutPortrait = totals.writers - totals.writersWithPortrait;
  const unlinkedProfiles = Math.max(totals.profiles - totals.profilesOnWriters, 0);

  /*
   * THE COUNTS ARE THE POINT. "11 people wrote records" and "1 profile has been published" are facts
   * about two different tables, and the page must not let a reader take one for the other — that
   * conflation is what produced the fault this page is fixing. Both are counted over the WHOLE
   * directory, never over a filtered page, so a search cannot change what the archive says about itself.
   */
  const bylinePhrase =
    totals.recordsByWriters === totals.records
      ? `${n(totals.records)} published ${totals.records === 1 ? 'record' : 'records'}`
      : `${n(totals.recordsByWriters)} of the archive's ${n(totals.records)} published records`;

  const writersSentence =
    totals.writers === 0
      ? 'No published record in this archive carries a byline yet.'
      : `${n(totals.writers)} ${totals.writers === 1 ? 'person' : 'people'} wrote ${bylinePhrase} in this archive.`;

  /*
   * THE TWO GAPS ARE TWO NUMBERS, BECAUSE THEY ARE TWO DIFFERENT SIZES.
   *
   * `/about/` used to carry this sentence as well, and it was wrong there in a way that turned out to be a
   * fact about the record: it said **no author had uploaded a portrait**, when six of the eleven had, in the
   * WordPress usermeta table the REST import never read. The counts stay here, on the directory, where a
   * reader is asking exactly this question — but they say what the record holds rather than what the archive
   * has "on file", and the portrait count is its own number because it is not the biography count.
   */
  const bioSentence =
    totals.writers === 0
      ? ''
      : `${totals.writersWithBio === 1 ? 'One has' : `${n(totals.writersWithBio)} have`} a biography; ` +
        `the other ${withoutBio === 1 ? 'one is' : `${n(withoutBio)} are`} named by the work alone.`;

  const portraitSentence =
    totals.writers === 0 || totals.writersWithPortrait === totals.writers
      ? ''
      : `${totals.writersWithPortrait === 1 ? 'One has' : `${n(totals.writersWithPortrait)} have`} supplied a ` +
        `portrait; the other ${withoutPortrait === 1 ? 'one appears' : `${n(withoutPortrait)} appear`} as a monogram.`;

  const profilePhrase =
    totals.profiles === 0
      ? 'No research profile has been published here yet.'
      : `${n(totals.profiles)} research ${totals.profiles === 1 ? 'profile has' : 'profiles have'} been published here as well` +
        (totals.profilesOnWriters > 0
          ? `, ${n(totals.profilesOnWriters)} of them linked by the record to a byline above`
          : '') +
        (unlinkedProfiles > 0
          ? `. The archive does not record which byline ${
              totals.profilesOnWriters > 0
                ? `the other ${n(unlinkedProfiles)} ${unlinkedProfiles === 1 ? 'belongs' : 'belong'}`
                : unlinkedProfiles === 1
                  ? 'it belongs'
                  : 'they belong'
            } to — a name is not proof — so ${unlinkedProfiles === 1 ? 'it is' : 'they are'} listed separately rather than joined by a guess`
          : '') +
        '.';

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">The research network</p>
        <h1>Researchers</h1>
        <p className="lede">
          Everyone who wrote what is in this archive, in the order of how much of it they wrote. A
          research profile is a separate and additional thing — an institution, research interests and
          publications, published by the person themselves — and it is shown as itself where it exists.
        </p>
      </header>

      <p className="small muted" role="status">
        <strong>{writersSentence}</strong>{' '}
        {bioSentence ? `${bioSentence} ` : ''}
        {portraitSentence ? `${portraitSentence} ` : ''}
        {profilePhrase}{' '}
        {unlinkedProfiles > 0 ? (
          <>
            A byline is claimed by its owner and approved by an editor.{' '}
            <Link href="/claims/">Claim your byline</Link>.
          </>
        ) : null}
      </p>

      <form className="search section" method="get" action="/researchers" role="search">
        <label className="small" htmlFor="q">Search by name, institution or interest</label>
        <div className="row">
          <input id="q" name="q" type="search" defaultValue={query ?? ''} />
          <button className="btn btn-ink" type="submit">Search</button>
        </div>
        {/*
          WHAT THE BOX READS, SAID PLAINLY. Institutions and research interests live on a research
          profile, so a contributor who has not published one is found by name alone — and a reader
          who searched for an institution and found nobody should know that rather than conclude the
          person is not here. The records' own words are searched at /search, not here.
        */}
        <p className="small muted" style={{ marginTop: 'var(--s-3)' }}>
          Names come from the byline. Institutions and research interests come from a published research
          profile, so a person who has not published one is found by name alone. To search the records
          themselves, use <Link href={query ? `/search?q=${encodeURIComponent(query)}` : '/search'}>the archive search</Link>.
        </p>
      </form>

      {query ? (
        <p className="small muted" role="status">
          {matched === 0
            ? `Nothing in the directory matches “${query}”.`
            : `${n(matched)} ${matched === 1 ? 'entry matches' : 'entries match'} “${query}”.`}{' '}
          <Link href="/researchers/">Clear the search</Link>.
        </p>
      ) : null}

      {totals.writers === 0 && totals.profiles === 0 && !query ? (
        <div className="empty section">
          <p className="eyebrow">Nothing here yet</p>
          <p>
            The directory fills from the record rather than from invented people: it lists the people
            whose byline is on a published record, and the research profiles their owners have chosen to
            publish. There are none yet — the design&rsquo;s example profiles were demonstrations, and
            the archive does not present those as people.
          </p>
          <p className="small">
            <Link href="/publications">See the research</Link> in the meantime.
          </p>
        </div>
      ) : null}

      {query && matched === 0 ? (
        <div className="empty section">
          <p className="eyebrow">Nothing matches</p>
          <p>
            No byline, institution or research interest in this directory matches “{query}”. The search
            covers those three things and not the text of the records —{' '}
            <Link href={`/search?q=${encodeURIComponent(query)}`}>the archive search</Link> reads the
            records themselves.
          </p>
          <p className="small">
            <Link href="/researchers/">Show everyone in the directory</Link>.
          </p>
        </div>
      ) : null}

      {writers.length > 0 ? (
        <section className="section">
          <p className="eyebrow">Archive contributors</p>
          <h2>The people who wrote the archive</h2>
          <div className="grid-3 section">
            {writers.map((w) => (
              <article className="entry" key={`w-${w.slug}`}>
                <div className="profile-head">
                  {sameOriginPortrait(w.avatarUrl) ? (
                    /*
                     * The author's own portrait, from the archive's media store — and only when THIS SITE
                     * can serve it. Measured here: one byline row still carries a `secure.gravatar.com`
                     * `d=mm` address, which this site's CSP (`img-src 'self' data: https://i.ytimg.com`)
                     * refuses — so an unguarded `<img>` drew a broken box, not a stock face. The guard makes
                     * it fall through to the monogram below.
                     */
                    <img className="avatar" src={sameOriginPortrait(w.avatarUrl)!} alt={`Portrait of ${w.name}`} loading="lazy" />
                  ) : (
                    <p
                      className="avatar"
                      role="img"
                      aria-label={`Monogram for ${w.name}: no portrait has been supplied`}
                    >
                      {initials(w.name)}
                    </p>
                  )}
                  <div>
                    <h3><Link href={`/author/${w.slug}/`}>{w.name}</Link></h3>
                    <p className="small muted">
                      {n(w.records)} {w.records === 1 ? 'record' : 'records'} in the archive
                    </p>
                  </div>
                </div>

                {/* The wording `/about/` uses for the same people, so the two pages agree. */}
                <p className="small muted" style={{ marginTop: 'var(--s-3)' }}>
                  {w.bio?.trim()
                    ? `${w.bio.trim().slice(0, 240)}${w.bio.trim().length > 240 ? '…' : ''}`
                    : 'No biography has been supplied. Named here by the work alone.'}
                </p>

                {/*
                  A PROFILE IS MARKED WHERE THE RECORD LINKS ONE, and nowhere else. There is no
                  "no profile" badge: the archive holds no statement about a person who supplied none,
                  and a badge would turn a silence into a claim.
                */}
                {w.hasProfile && w.accountId !== null ? (
                  <div style={{ marginTop: 'var(--s-3)' }}>
                    <p className="small">
                      <Link className="chip chip-source" href={`/researchers/${w.accountId}/`}>
                        Research profile
                      </Link>{' '}
                      {roleLine(w)}
                    </p>
                    {w.researchInterests.length > 0 ? (
                      <div className="chips" style={{ marginTop: 'var(--s-2)' }}>
                        {w.researchInterests.slice(0, 4).map((i) => (
                          <span className="chip" key={i}>{i}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <p className="small">
                  <Link href={`/author/${w.slug}/`}>Read their records</Link>
                </p>
              </article>
            ))}
          </div>
          {!query && writers.length < totals.writers ? (
            <p className="small muted">
              Showing the first {n(writers.length)} of {n(totals.writers)}.
            </p>
          ) : null}
        </section>
      ) : null}

      {profiles.length > 0 ? (
        <section className="section">
          <p className="eyebrow">Research profiles</p>
          <h2>Profiles published on Ozikoro</h2>
          <p className="small muted">
            A research profile is a CV and a calling card: the institution, the interests, the
            publications. It is published by the person themselves, and it is not the same thing as a
            byline — the archive keeps the two apart until a claim joins them.
          </p>
          <div className="grid-3 section">
            {profiles.map((p) => (
              <article className="entry" key={`p-${p.accountId}`}>
                <div className="profile-head">
                  {/*
                    ⚠️ **THIS DREW A MONOGRAM FOR EVERY PROFILE, EVEN ONE WITH A PICTURE.** `DirectoryProfile`
                    carried no `avatarUrl`, so a person who had uploaded a portrait on `/account/` appeared here
                    as their initials — on the same page that drew real portraits for the writers beside them, and
                    one click from their own profile page. The picture is read from `account.avatar_url` now; the
                    monogram remains the answer for the much commoner case of no picture set, and it is never a
                    stock face.
                  */}
                  {sameOriginPortrait(p.avatarUrl) ? (
                    <img className="avatar" src={sameOriginPortrait(p.avatarUrl)!} alt={`Portrait of ${p.name}`} loading="lazy" />
                  ) : (
                    <p
                      className="avatar"
                      role="img"
                      aria-label={`Monogram for ${p.name}: no portrait has been supplied`}
                    >
                      {initials(p.name)}
                    </p>
                  )}
                  <div>
                    <h3><Link href={`/researchers/${p.accountId}/`}>{p.name}</Link></h3>
                    <p className="small muted">{roleLine(p)}</p>
                  </div>
                </div>
                {p.researchInterests.length > 0 ? (
                  <div className="chips" style={{ marginTop: 'var(--s-3)' }}>
                    {p.researchInterests.slice(0, 4).map((i) => (
                      <span className="chip" key={i}>{i}</span>
                    ))}
                  </div>
                ) : null}
                <p className="small muted" style={{ marginTop: 'var(--s-3)' }}>
                  No byline is linked to this profile yet. The archive credits no record to it until the
                  claim is granted.
                </p>
                <p className="small">
                  <Link href={`/researchers/${p.accountId}/`}>See the profile</Link>
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
