import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listClans, listEthnicGroups, listTribes, suggestClanNames } from '@ozituma/db/clans';
import './clans.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The Clan Registry',
  description:
    'The clans of the Igbo world, by division: where each one is, which part of Igboland it belongs to, and the towns inside it.',
  openGraph: {
    title: 'The Clan Registry — Ozituma',
    description: 'Every Igbo person belongs to a place. Here are the clans and their towns.',
  },
};

interface ClansPageProps {
  searchParams: Promise<{ tribe?: string; kind?: string; people?: string; q?: string }>;
}

/**
 * What an entry can be, and what to call it.
 *
 * The registry was assembled from a colonial survey, which tabulated the groups a
 * division was administered through; the owner read it and said plainly that some
 * of what it called a clan is a town. A check against Igbo usage agreed: of 203
 * entries, 37 are single towns and 27 are administrative sections. They are not
 * deleted — each holds material worth keeping — so each is labelled for what it
 * is, and the filter lets a reader see only the clans if that is what they want.
 */
const KINDS: { key: string; label: string; singular: string }[] = [
  { key: '', label: 'Everything', singular: 'entry' },
  { key: 'clan', label: 'Clans', singular: 'clan' },
  { key: 'confederation', label: 'Confederations', singular: 'confederation' },
  { key: 'section', label: 'Sections', singular: 'section' },
  { key: 'town', label: 'Towns', singular: 'town' },
  { key: 'other', label: 'Other groupings', singular: 'grouping' },
];

function kindLabel(kind: string): string {
  return KINDS.find((k) => k.key === kind)?.singular ?? 'entry';
}

/**
 * A link to this page with the filters the reader has set, plus the one being changed.
 *
 * Every chip used to build its own URL, and they disagreed. The division chips carried
 * nothing but the division, so choosing one silently threw away the kind and the search
 * term. Worse, the kind chips re-added the CURRENT kind before setting the new one:
 * "Everything" is the chip with no kind, so its URL came out identical to the page the
 * reader was already on — the button did nothing at all, every time. That is the bug the
 * owner reported: "when selecting clans or sections, the buttons stops working."
 *
 * So there is one function. `patch` sets a filter, and a key with an empty value removes
 * it, which is what makes "Everything" and "All nations" work.
 */
function filterHref(
  current: { q: string; tribe: string; kind: string; people: string },
  patch: Partial<{ q: string; tribe: string; kind: string; people: string }>
): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.tribe) params.set('tribe', next.tribe);
  if (next.kind) params.set('kind', next.kind);
  if (next.people) params.set('people', next.people);
  const query = params.toString();
  return query ? `/clans?${query}` : '/clans';
}

export default async function ClansPage({ searchParams }: ClansPageProps) {
  const query = await searchParams;
  const tribeSlug = (query.tribe ?? '').trim();
  const kind = (query.kind ?? '').trim();
  const people = (query.people ?? '').trim();
  const term = (query.q ?? '').trim();

  const db = await getDb();
  const [tribes, clans, peoples] = await Promise.all([
    listTribes(db),
    listClans(db, {
      tribe: tribeSlug || undefined,
      kind: kind || undefined,
      ethnicGroup: people || undefined,
      query: term || undefined,
    }),
    listEthnicGroups(db),
  ]);
  /*
   * Names close to what was typed, but only when nothing was found. Searching
   * "Umuleri" has to land on the entry that prints "Umuleru", or a reader
   * concludes the registry does not know their town.
   */
  const suggestions =
    term && clans.total === 0 ? await suggestClanNames(db, term) : [];
  const active = tribes.find((t) => t.slug === tribeSlug) ?? null;
  const filters = { q: term, tribe: tribeSlug, kind, people };
  const total = tribes.reduce((sum, t) => sum + t.clanCount, 0);

  return (
    <div className="clans-page">
      <main className="clans-main">
        <p className="clans-eyebrow">Layer 1 · Registry</p>
        <h1 className="clans-title">The Clan Registry</h1>
        <p className="clans-lede">
          Every Igbo person belongs to a place. Here are the groups of the Igbo world — the clans,
          and the confederations, sections and towns the sources file beside them. Each entry says
          which it is; the filter shows one kind at a time.
        </p>

          {/*
            The filter is by DIVISION — the six regional divisions of Igboland. The
            list used to hold five of them plus Isu, which is a tribe of Southern
            Igbo and not a division at all; the owner caught it: "Isu tribe is part
            of Southern Igbo region, so remove it from being among the list of
            these."
          */}
        {tribes.length > 0 ? (
          <div className="clans-filters" aria-label="Filter by division">
            <Link
              href={filterHref(filters, { tribe: '' })}
              className={tribeSlug === '' ? 'clans-chip clans-chip-on' : 'clans-chip'}
              aria-current={tribeSlug === '' ? 'true' : undefined}
            >
              All of Igboland
              <span className="clans-chip-count">{total}</span>
            </Link>
            {tribes.map((tribe) => (
              <Link
                key={tribe.id}
                href={filterHref(filters, { tribe: tribe.slug })}
                className={tribe.slug === tribeSlug ? 'clans-chip clans-chip-on' : 'clans-chip'}
                aria-current={tribe.slug === tribeSlug ? 'true' : undefined}
              >
                {tribe.name}
                <span className="clans-chip-count">{tribe.clanCount}</span>
              </Link>
            ))}
          </div>
        ) : null}

        {/*
          The peoples that are READY, not every people the registry will eventually hold.
...
          This row listed fifteen names whether or not there was material behind them, so a
          reader was offered thirteen peoples whose entries are still one model's word. The
          owner's ruling: "Any Ethnicity that is not ready, dont make it visible yet." The
          list comes from the data, so a people appears the moment its entries are checked.
        */}
        {peoples.length > 1 ? (
          <div className="clans-filters" aria-label="Filter by nation">
            {[{ ethnicGroup: '', count: 0 }, ...peoples].map((nation) => (
              <Link
                key={nation.ethnicGroup || 'all-nations'}
                href={filterHref(filters, { people: nation.ethnicGroup })}
                className={people === nation.ethnicGroup ? 'clans-chip clans-chip-on' : 'clans-chip'}
                aria-current={people === nation.ethnicGroup ? 'true' : undefined}
              >
                {nation.ethnicGroup || 'All nations'}
              </Link>
            ))}
          </div>
        ) : null}

        {/*
          The search box. The owner: "on the clan section, please, one should be able to search, just
          like other sections like name, and dictionary." It searches the name, other names, state,
          local government area, summary and towns, so a reader can arrive with any of them.
        */}
        <form className="clan-search" action="/clans" method="get" role="search">
          <label htmlFor="clan-q" className="visually-hidden">
            Search clans and towns
          </label>
          <input
            id="clan-q"
            type="search"
            name="q"
            defaultValue={term}
            placeholder="Search a clan, a town, a state or a local government area…"
            className="search-input"
          />
          {tribeSlug ? <input type="hidden" name="tribe" value={tribeSlug} /> : null}
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {people ? <input type="hidden" name="people" value={people} /> : null}
          <button className="button" type="submit">
            Search
          </button>
        </form>

        {term ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            {clans.total === 1 ? '1 entry' : `${clans.total} entries`} matching “{term}”.{' '}
            <Link href={filterHref(filters, { q: '' })}>Clear the search</Link>
          </p>
        ) : null}

        <div className="clans-filters" aria-label="Filter by kind">
          {KINDS.map((option) => (
            <Link
              key={option.key || 'all'}
              href={filterHref(filters, { kind: option.key })}
              className={kind === option.key ? 'clans-chip clans-chip-on' : 'clans-chip'}
              aria-current={kind === option.key ? 'true' : undefined}
            >
              {option.label}
            </Link>
          ))}
        </div>

        {active?.note ? <p className="clans-note">{active.note}</p> : null}

        {clans.data.length > 0 ? (
          <ul className="clans-grid">
            {clans.data.map((clan) => (
              <li key={clan.id}>
                <Link className="clans-card" href={`/clans/${clan.slug}`}>
                  <div className="clans-card-head">
                    <h2 className="clans-name">{clan.name}</h2>
                    {clan.region ? <span className="clans-region">{clan.region}</span> : null}
                  </div>
                  <p className="clans-kind">
                    {clan.ethnicGroup !== 'Igbo' ? `${clan.ethnicGroup} · ` : ''}
                    {kindLabel(clan.kind)}
                    {/*
                      The division, always. Six names in the registry are borne by
                      more than one entry — Isu by three, and Onicha, Uburu, Igbodo,
                      Abaja and Umuhu by two — because the brackets that used to
                      separate them are gone at the owner's instruction. The division
                      and the state are what tell a reader which one they are looking
                      at, so the division belongs on every card rather than only in
                      the filter.
                    */}
                    {clan.tribe ? ` · ${clan.tribe}` : ''}
                    {clan.parent ? ` · part of ${clan.parent.name}` : ''}
                    {/* Why this card is in the results, when it is a town that
                        brought the reader here — see the note on ClanSummary. */}
                    {term && clan.matchedTown && !clan.name.toLowerCase().includes(term.toLowerCase())
                      ? ` · includes ${clan.matchedTown}`
                      : ''}
                  </p>
                  {clan.originSummary ? <p className="clans-summary">{clan.originSummary}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="clans-empty">
            {suggestions.length > 0 ? (
              <>
                <p>
                  Nothing under <strong>{term}</strong> exactly. The closest names in the registry:
                </p>
                <ul className="clans-grid">
                  {suggestions.map((hit) => (
                    <li key={`${hit.kind}-${hit.slug}-${hit.name}`}>
                      <Link className="clans-card" href={`/clans/${hit.slug}`}>
                        <div className="clans-card-head">
                          <h2 className="clans-name">{hit.name}</h2>
                          <span className="clans-region">{hit.kind === 'town' ? 'town' : 'entry'}</span>
                        </div>
                        <p className="clans-kind">
                          {hit.kind === 'town' ? `a town in ${hit.clanName}` : kindLabel(hit.kind)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>The registry is being written. Clans are added as the sources for them are read.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
