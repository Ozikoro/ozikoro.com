/**
 * Clan-towns — the register, and the one screen that narrows it.
 *
 * THE OWNER'S OWN DESIGN FOR THIS SCREEN, IN HIS WORDS
 *
 * *"you built an entirely different clans page, but no, that is not what i want. add them all to the
 * /towns page, and maybe rename it to /clan-towns to accommodate both. **there's a reason the towns
 * section have an option to select ethnicities, clans, tribes, and towns**"*
 *
 * So this page carries **two controls, doing two different jobs**, and both are wanted:
 *
 *   1. **The design's own search box** — `towns.html` draws
 *      `<form class="search" action="towns.html" method="get">` with a `sr-only` label for `#tq`, an
 *      `<input id="tq" name="q" type="search" placeholder="Find a town or community">` and a
 *      `<button class="btn btn-gold">Find</button>`. It finds a place **by name**, and it is reproduced
 *      here line for line. The owner's complaint was that this was missing: *"i was mad about the search
 *      bar not looking exactly as the demo."*
 *   2. **The register's four-step finder** — Ethnicity, Division, Tribe or clan, Town. It narrows by the
 *      register's own hierarchy: a people, then a division within it, then an entry inside that, then a
 *      town inside that. **It was the owner's instruction for this section and he has confirmed it with
 *      his reason** — the sentence quoted above — so it stays, and it is not in the delivered design:
 *      `sx-reg-finder`, `sx-reg-steps`, `sx-reg-search` and `sx-reg-levels` are in **none of the 52
 *      files** under `design/calm-comfort-construct/public/design/`, and `globals.css` holds their only
 *      definitions. An earlier comment on this page claimed they were copied from the design's
 *      `towns.html`; that was false, and saying so plainly is the point of this paragraph.
 *
 * **THE TWO ARE WIRED THROUGH THE SAME GET, IN BOTH DIRECTIONS.** Neither form can silently discard the
 * other's answer: the design's form carries the four levels as hidden inputs, and the finder carries the
 * typed name as a hidden input. Submitting either keeps everything the reader has already chosen.
 *
 * ── THE ADDRESS: /clan-towns/ IS THE CANONICAL ONE ────────────────────────────────────────────────
 *
 * The owner: *"maybe rename it to /clan-towns to accommodate both."* So `/clan-towns/` is the page, and
 * `/towns`, `/towns/` and `/towns.html` are **301s to it** — the same treatment the deliverable's own
 * `.html` file names get in `middleware.ts`, and one hop rather than two because the rule is placed
 * before the `DESIGN_FILES` branch. The deliverable's own links say `towns.html`, and the design is
 * inviolable, so `designScreenLinks` resolves that name to `/clan-towns/` at serve time — **17
 * references across 14 design files**, measured.
 *
 * ── AND `/clans/` IS NOT A SECOND REGISTER ───────────────────────────────────────────────────────
 *
 * It was: the same 188 published rows out of the same `listPlaces`, filtered by kind instead of by the
 * four levels, with its own cards, its own note and its own finder. Two pages for one thing is what the
 * owner rejected, so `/clans/` is a 301 to this page and its filters — `kind`, `tribe`, `region` — are
 * accepted here, so an address that used to work still filters. The register's per-entry pages
 * (`/clans/<slug>/`), its divisions (`/clans/tribes/`) and its regions (`/clans/regions/`) are not the
 * register index and are left where they are.
 *
 * ── FROM REAL DATA ───────────────────────────────────────────────────────────────────────────────
 *
 * Every entry is a published row in `clan`, with the region it is recorded in. Nothing here is a sample:
 * the design's own screen lists Igbodo, Amai, Akumazi and Abbi as demonstration values, and this page
 * lists the 188 entries the archive actually holds. 124 of them are clans, 37 single towns, 17 sections,
 * 7 confederations, 2 kingdoms and 1 an "other grouping", which is why the counts and notes here say
 * *entries* and not *communities*: a section or a confederation is not a community, and this is the one
 * page that must keep the words apart.
 *
 * ── 18 TO A PAGE, IN THE ADDRESS, WITH EVERY CONTROL CARRIED THROUGH ─────────────────────────────
 *
 * The owner asked for "18 per page, with an option to continue by clicking next". The page number travels
 * in `?page=` — the idiom `/watch/` established — and the pager is the archive index's own markup
 * (`archive-index.html`): the count on the left, the two controls on the right. `pageHref` copies the
 * whole query and replaces only `page`, so **the name search and all four levels survive a page turn**;
 * an unavailable control is an inert `<span>`, never an `href="#"`. A page past the end is an honest end
 * state rather than an empty grid, which is the same choice `/watch/` made.
 *
 * ── THE CARD'S PHOTOGRAPH, AND WHICH RECORD IT COMES FROM ────────────────────────────────────────
 *
 * `towns.html` draws every card as `<a href><img …><span><small><strong><em></span></a>` — a photograph
 * behind a dark gradient, with the region, the name and the call to action over it, and **nothing else**.
 * The photograph is read from the archive rather than chosen: `PlaceSummary.imageKey` is the featured
 * media of a published record linked to the entry through `ozikoro_article_entity`.
 *
 * **THE RECORD'S TITLE MUST NAME EXACTLY ONE PUBLISHED ENTRY, AND THIS ONE.** A record's featured media is
 * its own photograph of its own subject, and one record can be linked to several entries, so drawing it
 * on every linked card is how one picture came to stand for two places. Measured:
 * `/igbodo-a-community-formed-by-convergence/` is linked to BOTH Igbodos — `igbodo`, a *section* in
 * Enugu, and `igbodo-northern-ika`, the Ika *town* in Delta — and its `11219-obi-of-igbodo.jpg`, which is
 * the Ika town's obi, was therefore drawn on the Enugu section's card too. **Its title names two published
 * entries, so it is not evidence for either card and both Igbodos are drawn without a picture** rather
 * than the wrong one being shown; an entry the archive holds no photograph of its own for is drawn without
 * one, which is the design's own empty state.
 *
 * **THE CARD SAYS NOTHING THE DESIGN DOES NOT DRAW.** An earlier round added `· photograph from “…”` to
 * the `<small>` line on the cards whose record names more than one thing. It was true and it is not in
 * `towns.html`, so it is gone: the card is the photograph, the region, the name and the call to action.
 * The `alt` stays the design's empty string — the image is decorative, and the record's name is visible
 * text rather than something only a screen reader receives.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  getPlaceFacets,
  getRegisterCascade,
  listPlaces,
  mediaPath,
  placeKindLabel,
  placeKindSingular,
  PLACE_KINDS,
} from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Clans, towns & communities',
  description:
    'The places the archive holds: choose a people, a division, a clan or a town to narrow the register, or search a name, and read the histories, photographs and records connected to each one.',
  alternates: { canonical: 'https://ozikoro.com/clan-towns' },
  openGraph: {
    title: 'Clans, towns & communities — Ozikoro',
    description: 'The clan register: 188 places, with their histories, photographs and records.',
    type: 'website',
  },
};

/** Eighteen entries to a page, which is the number the owner asked for. */
const PAGE_SIZE = 18;

/** Everything this page's address can carry. */
interface RegisterQuery {
  /** The design's search box, `#tq`. */
  q: string;
  /** The finder's four steps, in the register's own words. */
  ethnic: string;
  division: string;
  clan: string;
  town: string;
  /** The folds from `/clans/`: its kind filterbar and its divisions and regions pages. */
  kind: string;
  tribe: string;
  region: string;
  page: number;
}

/** One address for one view of the register, so every filtered page is a link and a citation. */
function pageHref(active: RegisterQuery, page: number): string {
  const params = new URLSearchParams();
  for (const key of ['q', 'ethnic', 'division', 'clan', 'town', 'kind', 'tribe', 'region'] as const) {
    if (active[key]) params.set(key, active[key]);
  }
  params.set('page', String(page));
  return `/clan-towns?${params.toString()}`;
}

export default async function ClanTownsPage({
  searchParams,
}: {
  searchParams: Promise<Partial<Record<keyof RegisterQuery, string>>>;
}) {
  const params = await searchParams;
  const rawKind = (params.kind ?? '').trim();
  /*
   * `kind` is validated against the register's own vocabulary rather than trusted, which is what `/clans/`
   * did before its index folded in here. A kind the register does not file would otherwise run a filter
   * that matches nothing and show the "nothing matches" state, which reads as "the register does not hold
   * this" when the truth is "that is not a thing it files".
   */
  const kind = PLACE_KINDS.some((k) => k.key === rawKind) ? rawKind : '';
  const requested = Math.trunc(Number(params.page ?? 1));
  const page = Number.isFinite(requested) ? Math.max(1, requested) : 1;

  const db = await getDb();
  /*
   * THE FINDER FIRST, because the register's answer decides what the filter may be: `selection` is the
   * address's four values resolved against what the register has published, and it is what both the boxes
   * and the listing are rendered from. One reading, so a box cannot say "Any division" over a list
   * filtered by a division.
   */
  const cascade = await getRegisterCascade(db, {
    ethnic: params.ethnic,
    division: params.division,
    clan: params.clan,
    town: params.town,
  });
  const { selection } = cascade;
  const defaultEthnic = cascade.ethnicGroups[0]?.value ?? '';

  const active: RegisterQuery = {
    q: (params.q ?? '').trim(),
    ethnic: selection.ethnic,
    division: selection.division,
    clan: selection.clan,
    town: selection.town,
    kind,
    tribe: (params.tribe ?? '').trim(),
    region: (params.region ?? '').trim(),
    page,
  };

  const [register, facets] = await Promise.all([
    listPlaces(db, {
      kind: kind || null,
      // The ethnicity step always carries a value — the design's select has no "any people" option and
      // opens on the first published one — so it narrows only when it is not that default, which is the
      // day a second people is published and choosing one really does narrow the list.
      ethnic: selection.ethnic && selection.ethnic !== defaultEthnic ? selection.ethnic : null,
      tribe: selection.division || active.tribe || null,
      slug: selection.clan || null,
      town: selection.town || null,
      region: active.region || null,
      search: active.q || null,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getPlaceFacets(db),
  ]);

  const filtered = Boolean(
    active.q ||
      kind ||
      selection.division ||
      selection.clan ||
      selection.town ||
      active.tribe ||
      active.region ||
      (selection.ethnic && selection.ethnic !== defaultEthnic)
  );
  /*
   * HOW MANY PUBLISHED ENTRIES THE SELECTED PEOPLE HOLDS — WHICH MAY BE NONE.
   *
   * The finder's list is the register's full list of peoples rather than the peoples it holds (see
   * `DESIGN_PEOPLES` in `places.ts`), so the first option's count is not evidence that the chosen one
   * has any. The empty state below reads this to tell "no entry is filed under this people" apart from
   * "the search found nothing", which are different answers.
   */
  const ethnicHolds = cascade.ethnicGroups.find((g) => g.value === selection.ethnic)?.count ?? 0;

  const composition = facets.kinds
    .map((k) => `${k.count} ${k.count === 1 ? placeKindSingular(k.kind) : placeKindLabel(k.kind).toLowerCase()}`)
    .join(', ');

  const totalPages = Math.max(1, Math.ceil(register.total / PAGE_SIZE));
  const beyond = register.total > 0 && page > totalPages;
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, register.total);

  /*
   * THE HIDDEN INPUTS THAT KEEP THE OTHER CONTROL'S ANSWER.
   *
   * The design's form submits `q`; the finder submits the four levels. Each carries the other as hidden
   * fields, so neither submission throws away what the reader already chose. They are built here rather
   * than written twice so the two forms cannot drift.
   */
  const levelFields = (
    <>
      {selection.ethnic ? <input type="hidden" name="ethnic" value={selection.ethnic} /> : null}
      {selection.division ? <input type="hidden" name="division" value={selection.division} /> : null}
      {selection.clan ? <input type="hidden" name="clan" value={selection.clan} /> : null}
      {selection.town ? <input type="hidden" name="town" value={selection.town} /> : null}
      {kind ? <input type="hidden" name="kind" value={kind} /> : null}
      {active.tribe ? <input type="hidden" name="tribe" value={active.tribe} /> : null}
      {active.region ? <input type="hidden" name="region" value={active.region} /> : null}
    </>
  );

  return (
    <>
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">Places in the archive</p>
          <h1>Clans, towns &amp; communities</h1>
          <p className="lede">
            Choose a people, a division, a clan or a town to narrow the register, or search for a name.
            Either way you reach the histories, photographs, recordings and records connected to a place.
          </p>
          {/*
            THE DESIGN'S OWN SEARCH BOX, LINE FOR LINE — `towns.html`. The label is `sr-only`, the input is
            `#tq` with the design's own placeholder, and the button is the design's gold `Find` with no
            `type` attribute, because a button inside a form submits by default and that is what the design
            draws. The four levels travel with it as hidden fields.
          */}
          <form className="search" action="/clan-towns" method="get">
            <label className="sr-only" htmlFor="tq">
              Find a town
            </label>
            <input
              id="tq"
              name="q"
              type="search"
              defaultValue={active.q}
              placeholder="Find a town or community"
            />
            <button className="btn btn-gold">Find</button>
            {levelFields}
          </form>
          {/*
            THE REGISTER'S FOUR-STEP FINDER — the owner's own instruction for this section, and not in the
            delivered design. Each level offers only what sits inside the level above it, computed from
            what the address has already said; the typed name travels with it as a hidden field.
          */}
          <form
            id="register-finder"
            className="sx-reg-finder"
            action="/clan-towns"
            method="get"
            role="search"
            aria-label="Narrow the register"
          >
            <input type="hidden" name="q" value={active.q} />
            {kind ? <input type="hidden" name="kind" value={kind} /> : null}
            {active.tribe ? <input type="hidden" name="tribe" value={active.tribe} /> : null}
            {active.region ? <input type="hidden" name="region" value={active.region} /> : null}
            <ol className="sx-reg-steps">
              <li>
                <label htmlFor="f-ethnic">
                  <b>1</b> Ethnicity
                </label>
                <select id="f-ethnic" name="ethnic" defaultValue={selection.ethnic}>
                  {cascade.ethnicGroups.map((group) => (
                    <option key={group.value} value={group.value}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </li>
              <li>
                <label htmlFor="f-division">
                  <b>2</b> Division
                </label>
                <select id="f-division" name="division" defaultValue={selection.division}>
                  <option value="">Any division</option>
                  {cascade.divisions.map((division) => (
                    <option key={division.value} value={division.value}>
                      {division.label}
                    </option>
                  ))}
                </select>
              </li>
              <li>
                <label htmlFor="f-clan">
                  <b>3</b> Tribe or clan
                </label>
                <select id="f-clan" name="clan" defaultValue={selection.clan}>
                  <option value="">Any tribe or clan</option>
                  {cascade.clans.map((clan) => (
                    <option key={clan.value} value={clan.value} className="oz-igbo" lang="ig">
                      {clan.label}
                    </option>
                  ))}
                </select>
              </li>
              <li>
                <label htmlFor="f-town">
                  <b>4</b> Town
                </label>
                <select id="f-town" name="town" defaultValue={selection.town}>
                  <option value="">Any town</option>
                  {cascade.towns.map((town) => (
                    <option key={town.value} value={town.value} className="oz-igbo" lang="ig">
                      {town.label}
                    </option>
                  ))}
                </select>
              </li>
            </ol>
            <div className="sx-reg-search">
              <span className="small" style={{ color: 'var(--on-night-muted)' }}>
                Narrow by the register&rsquo;s own levels
              </span>
              <button className="btn btn-gold" type="submit">
                Find
              </button>
              {/* The design's Reset cleared the boxes through a script; a link clears them for everyone. */}
              <Link className="btn btn-quiet" href="/clan-towns">
                Reset
              </Link>
            </div>
          </form>
        </div>
      </section>

      <section className="wrap section" aria-labelledby="levels-h">
        <div className="sx-reg-levels">
          <h2 id="levels-h" className="sr-only">
            How the register is organised
          </h2>
          <div>
            <b>Ethnicity</b>
            <p>A people sharing a language and identity, such as Igbo or Ijaw.</p>
          </div>
          <div>
            <b>Division</b>
            <p>A regional grouping within a people — Northern, Western, Riverine Igbo and others.</p>
          </div>
          <div>
            <b>Tribe or clan</b>
            <p>
              The level below a division — <span className="oz-igbo" lang="ig">Ika</span>,{' '}
              <span className="oz-igbo" lang="ig">Enuani</span>,{' '}
              <span className="oz-igbo" lang="ig">Ngwa</span>,{' '}
              <span className="oz-igbo" lang="ig">Ụ̀mụ̀nrì</span> — including confederations and
              sections.
            </p>
          </div>
          <div>
            <b>Town</b>
            <p>The communities recorded inside each clan, each with its own histories.</p>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 'var(--s-4)' }}>
          Calling both a division and the level below it a “tribe” leads readers to think one people are
          several. The register keeps the words apart.
        </p>
      </section>

      <section className="wrap section">
        {beyond ? (
          <div className="empty section">
            <p className="eyebrow">Past the end</p>
            <h2>There is no page {page}.</h2>
            <p>
              {filtered
                ? `Those filters match ${register.total} ${register.total === 1 ? 'entry' : 'entries'}`
                : `The register holds ${register.total} published ${register.total === 1 ? 'entry' : 'entries'}`}
              , in {totalPages} {totalPages === 1 ? 'page' : 'pages'}. This one does not exist, so the
              register is not drawn as an empty grid.
            </p>
            <p>
              <Link className="btn" href={pageHref(active, 1)}>
                Page 1
              </Link>{' '}
              {totalPages > 1 ? (
                <Link className="btn" href={pageHref(active, totalPages)}>
                  Page {totalPages}, the last
                </Link>
              ) : null}
            </p>
          </div>
        ) : register.data.length === 0 ? (
          <div className="empty section">
            <p className="eyebrow">Nothing filed</p>
            <h2>
              {/*
                A PEOPLE THE REGISTER HOLDS NOTHING UNDER IS TOLD APART FROM A SEARCH THAT FAILED.
                The list of peoples is the register's full list rather than the peoples it happens to
                hold — the owner's instruction, so a reader can ask for a people whose entry has not
                been filed yet — so "?ethnic=Kanuri" is a real address that resolves and matches
                nothing. The generic sentence underneath ("a name may be spelled differently … or the
                entry may not be filed yet") is true of a search and misleads here: nothing was
                misspelled, and there is no near match. So the people is named, and the count it is
                absent from is given, which is the same shape `/archive/` uses when a filter matches
                nothing because no record carries that value.
              */}
              {active.q
                ? `No entry matches “${active.q}”.`
                : selection.ethnic && ethnicHolds === 0
                  ? `The register holds no ${selection.ethnic} entry yet.`
                  : 'Nothing in the register matches those filters.'}
            </h2>
            <p>
              {active.q ? (
                <>
                  The register holds {facets.total} published entries and none of them matches. A name may
                  be spelled differently in the records — the survey printed some names the way an officer
                  heard them, and the towns write them another way — or the entry may not be filed yet.
                </>
              ) : selection.ethnic && ethnicHolds === 0 ? (
                <>
                  All {facets.total} published entries are filed under another people, so nothing is hidden
                  by a filter: {selection.ethnic} is offered so a reader can ask, and an entry appears here
                  the day one is filed. The towns, clans and histories come first and the register reads
                  them.
                </>
              ) : (
                <>
                  The register holds {facets.total} published entries and none of them matches. A name may
                  be spelled differently in the records — the survey printed some names the way an officer
                  heard them, and the towns write them another way — or the entry may not be filed yet.
                </>
              )}
            </p>
            <p>
              <Link className="btn" href="/clan-towns">
                Show every entry
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="sx-town-grid">
              {register.data.map((entry) => (
                <Link key={entry.slug} href={`/town/${entry.slug}/`}>
                  {/*
                    The design's own `<img>` slot, filled only where the archive links a photograph to
                    this place — a record whose title names this entry and no other published entry.
                    An entry with none is drawn without one rather than given a stand-in: the card's
                    words carry the whole meaning and a borrowed picture would be worse than an absent
                    one. `alt=""` is the design's, so a decorative image makes no claim — the record's
                    name below is visible text instead.
                  */}
                  {entry.imageKey ? (
                    <img src={mediaPath(entry.imageKey)} alt="" loading="lazy" />
                  ) : null}
                  <span>
                    <small>{entry.region ?? 'Region not recorded'}</small>
                    <strong className="oz-igbo" lang="ig">
                      {entry.name}
                    </strong>
                    <em>View connected records →</em>
                  </span>
                </Link>
              ))}
            </div>

            {/*
              THE ARCHIVE INDEX'S OWN PAGER, from `archive-index.html`: the count on the left, the two
              controls on the right, in a `nav.row` labelled "Pagination". `btn-quiet` rather than
              `btn-ghost`, because that is what the design draws on a light page. Both controls are real
              links to real GETs carrying the name search and all four levels; neither needs a script.
            */}
            <nav
              className="row"
              style={{ marginTop: 'var(--s-6)', justifyContent: 'space-between' }}
              aria-label="Pagination"
            >
              <span className="small muted">
                Showing {first}–{last} of {register.total}{' '}
                {register.total === 1 ? 'entry' : 'entries'} · page {page} of {totalPages}
              </span>
              <span className="row">
                {page > 1 ? (
                  <Link className="btn btn-quiet btn-sm" href={pageHref(active, page - 1)} rel="prev">
                    ← Previous
                  </Link>
                ) : (
                  <span className="btn btn-quiet btn-sm" aria-disabled="true" style={{ opacity: 0.45 }}>
                    ← Previous
                  </span>
                )}
                {page < totalPages ? (
                  <Link className="btn btn-quiet btn-sm" href={pageHref(active, page + 1)} rel="next">
                    Next →
                  </Link>
                ) : (
                  <span className="btn btn-quiet btn-sm" aria-disabled="true" style={{ opacity: 0.45 }}>
                    Next →
                  </span>
                )}
              </span>
            </nav>

            <p className="sx-source-note sx-light-note">
              {filtered
                ? `${register.total} of ${facets.total} entries match. `
                : `All ${facets.total} entries the archive holds. `}
              {composition}. Every one is a row in the archive&rsquo;s own database, which the dictionary
              and the academy read as well — an entry filed without a region says so rather than being
              given one, and an entry with no towns recorded says that too. The register&rsquo;s{' '}
              <Link href="/clans/tribes">six divisions</Link> and its{' '}
              <Link href="/clans/regions">regions</Link> are listed in full.
            </p>
          </>
        )}
      </section>
    </>
  );
}
