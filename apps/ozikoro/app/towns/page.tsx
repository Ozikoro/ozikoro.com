/**
 * Towns & communities — the places the archive holds records about.
 *
 * FROM REAL DATA. Every entry on this page is a published row in `clan`, with the region it is recorded
 * in. Nothing here is a sample: the design's own screen lists Igbodo, Amai, Akumazi and Abbi as
 * demonstration values, and this page lists the 188 entries the archive actually holds instead. The
 * brief's rule is that prototype values from the design screens are never real data, so the design
 * supplies the layout and the archive supplies the contents.
 *
 * A TOWN IS NOT A CLAN, AND THIS PAGE DOES NOT PRETEND THEY ARE THE SAME
 *
 * The archive's unit is the clan, and a clan may hold several towns — `clan_town` records 995 of those
 * relationships. This page lists the entries the records are filed under — 124 of the 188 are clans, 37
 * are single towns, 17 sections, 7 confederations, 2 kingdoms and 1 an "other grouping" — and says so
 * rather than labelling them towns when the distinction matters.
 *
 * THE REGISTER'S FINDER, COPIED FROM THE DESIGN'S `towns.html`
 *
 * The owner's instruction was to take the finder from the design's own towns screen — "from the search
 * bar to under it" — and nothing else from that page. So what is here is the design's, reproduced:
 * `<form id="register-finder" class="sx-reg-finder">` with `role="search"` and the same aria-label, the
 * same four numbered steps in the same `<ol class="sx-reg-steps">` with the same `f-ethnic`,
 * `f-division`, `f-clan`, `f-town` ids and names, the same `<div class="sx-reg-search">` holding the
 * `sr-only` "Search by name" label, the `f-q` search input with its "Or type a clan, town or region"
 * placeholder, the `Find` button as `btn btn-gold`, and — after the hero — the same
 * `<section class="wrap section">` of four definitions under `sx-reg-levels`, ending in the same note
 * about keeping *division* and *tribe* apart. The words are the design's words, unchanged.
 *
 * Four things are the page's rather than the design's, and each is a consequence of this being a real
 * form over a real database rather than a demonstration with a script:
 *
 *   1. **Reset is a link, not a button.** The design has
 *      `<button class="btn btn-quiet" type="button" id="f-reset">Reset</button>`, which clears the boxes
 *      through `towns-finder.js`. A `type="button"` button with no script does nothing, and this page has
 *      to work with JavaScript off, so the same word in the same class is `<Link className="btn
 *      btn-quiet" href="/towns">` — clearing every step by returning to the unfiltered register. The
 *      `f-reset` id went with the script that used it.
 *   2. **A division submits its slug, not its name.** The design's options carry no `value`, so its form
 *      would post `division=Northern+Igbo`. `tribe.slug` is what the register keys on and what
 *      `/clans` already puts in its addresses, so the value is the slug and the label is still the
 *      design's name.
 *   3. **The boxes are server-rendered from the current selection.** The design's selects are filled by
 *      script. With JavaScript off, the current selection is what the address says, so each select
 *      renders its value as selected and the search box renders the current `q`. A filtered register is
 *      therefore a bookmarkable, citable address and nothing on the page needs a script.
 *   4. **The steps cascade on the server.** The design's script narrowed each step as the one above it
 *      changed. Here each step offers only what sits inside the steps above it, computed from the
 *      selection in the address — so the narrowing happens on Find rather than on change. That is the
 *      honest cost of no script, and it is why the Find button is the thing that moves the register.
 *
 * THE STEPS OFFER WHAT THE REGISTER HOLDS, NOT WHAT THE DESIGN'S LIST SAYS
 *
 * The design's ethnicity select lists seven peoples — Igbo, Ijaw, Efik, Ibibio, Idoma, Yoruba, Edo —
 * because the screen is a demonstration and its own note, which the owner asked not to be copied, says
 * "Other ethnicities appear in the finder so their entries have a home when material arrives". The
 * register holds rows for all seven and 21 more peoples besides, but only Igbo is published: of its 228
 * rows, migration 0022 published the 188 Igbo ones and left every other people held back until its
 * material is checked. A select is therefore drawn from what the register has published, which today is
 * the single option the owner names when he describes this control — "Ethnicity / Igbo" — and which
 * gains Ijaw, Edo and the rest on its own the day one of their entries is published, with no change
 * here. The alternative, the design's seven fixed values, would offer six filters that can only lead to
 * an empty page, and `getPlaceFacets` in `@ozikoro/platform` records why the register does not do that:
 * a filter with nothing behind it is a dead end, not a feature.
 *
 * HOW THE FILTERING WORKS, SERVER-SIDE
 *
 * `getRegisterCascade` in `packages/ozikoro/src/places.ts` reads the published register and derives the
 * four levels from it, and it also resolves the four values in the address against that reading. The
 * page then hands the resolved selection to `listPlaces`, which turns it into one WHERE clause over
 * `clan`:
 *
 *   * Ethnicity → `c.ethnic_group = $n`
 *   * Division  → `t.slug = $n` (the `tribe` join)
 *   * Tribe or clan → `c.slug = $n`
 *   * Town      → `exists (select 1 from clan_town ctf where ctf.clan_id = c.id and ctf.name = $n)`
 *   * Search    → the register's own search, unchanged: name, slug, aliases, states, LGAs, the origins
 *                 text, the division's name, the parent entry's name, and the name of any town inside it.
 *
 * A value the register cannot resolve is dropped rather than passed through, which is what `/clans` does
 * with a `kind` it does not file — a filter that matches nothing would read as "the register does not
 * hold this" when the truth is "that is not one of the words the register uses". The reasoning, and the
 * per-level detail, is in `getRegisterCascade`.
 *
 * This page used to write its own SQL over `clan`. `places.ts` records that as the one gap left when the
 * register arrived — "four copies of the same query is four places for `published = true` to be
 * forgotten" — so the listing now comes from `listPlaces` like every other data-driven page here. The
 * order changes with it: entries are listed by division and then by the register's own position, rather
 * than by region, which is the order `/clans` lists them in.
 *
 * ONE THING LEFT ALONE, AND ONE THING THE OWNER THEN ASKED FOR
 *
 * The results are still the cards this page already had: the region, the name, and "View connected
 * records". The owner asked for the finder and its explainer and for nothing else from the design's
 * screen, so the cards were not touched — not even to carry the kind, which `/clans` puts on its cards
 * and which is the more precise word for the 64 of the 188 entries that are not clans. The two sentences
 * under the grid changed only where the filters made them untrue: they say *entries* rather than
 * *communities*, because a section or a confederation is not a community, and they report a filtered
 * count instead of the register's whole one when the register is narrowed. The name on each card also
 * gained `.oz-igbo` and `lang="ig"`, which is the owner's standing rule for Igbo text and what `/clans`
 * and `/clans/[slug]` already do with the same name.
 *
 * ── AND THE HALF OF THE CARD THAT WAS MISSING: THE DESIGN'S PHOTOGRAPH ──────────────────────────
 *
 * The owner then asked why this page does not show "like the demo", and the answer was measurable.
 * `towns.html` draws every card as `<a href><img …><span><small><strong><em></span></a>` — a photograph
 * behind a dark gradient, with the region, the name and the call to action over it — and the served page
 * drew the same `<a><span>…</span></a>` **with no `<img>` at all**. `.sx-town-grid > a` is
 * `min-height:20rem` with `background: var(--night)` and an `:after` gradient written to sit over a
 * picture, so 188 cards rendered as 188 near-black boxes: the same markup, the same words, and not the
 * design's card.
 *
 * The photograph is read from the archive, not chosen: `PlaceSummary.imageKey` is the featured media of
 * a published record linked to the entry through `ozikoro_article_entity`. **75 of the 190 published
 * entries have one; the other 115 are drawn exactly as this page drew them before** — no stand-in, no
 * borrowed picture — which is the same rule `renderTown` has followed on the design screen since it was
 * written and the same rule the town hero follows when the register holds no photograph for a place.
 * The `alt` is the design's own empty string, so a decorative picture adds no claim a screen reader
 * would read as one.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getRegisterCascade, listPlaces, mediaPath } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Towns & communities',
  description:
    'Places in the archive. Choose a community to see its connected histories, photographs, recordings and records together.',
  alternates: { canonical: 'https://ozikoro.com/towns' },
  openGraph: {
    title: 'Towns & communities — Ozikoro',
    description: 'Places in the archive, with their connected histories and records.',
    type: 'website',
  },
};

/** Everything the finder's address can carry, plus the name search. */
interface TownsSearchParams {
  q?: string;
  ethnic?: string;
  division?: string;
  clan?: string;
  town?: string;
}

export default async function TownsPage({
  searchParams,
}: {
  searchParams: Promise<TownsSearchParams>;
}) {
  const params = await searchParams;
  const query = (params.q ?? '').trim();

  const db = await getDb();

  /*
   * The finder first, because the register's answer decides what the filter may be: `selection` is the
   * address's values resolved against what the register has published, and it is what both the boxes and
   * the listing are rendered from. One reading, so a box cannot say "Any division" over a list filtered
   * by a division.
   */
  const cascade = await getRegisterCascade(db, {
    ethnic: params.ethnic,
    division: params.division,
    clan: params.clan,
    town: params.town,
  });
  const { selection } = cascade;

  const register = await listPlaces(db, {
    ethnic: selection.ethnic || null,
    tribe: selection.division || null,
    slug: selection.clan || null,
    town: selection.town || null,
    search: query || null,
    limit: 400,
  });

  /*
   * Whether the reader is looking at a narrowed register or the whole of it.
   *
   * Ethnicity is left out of this on purpose: step 1 always carries a value — the design's select has no
   * "any people" option and opens on Igbo — so counting it would have every page, filtered or not, claim
   * to be a filtered one. It is counted when it is not the register's default, which is the day a second
   * people is published and choosing one really does narrow the list.
   */
  const defaultEthnic = cascade.ethnicGroups[0]?.value ?? '';
  const narrowed =
    query !== '' ||
    selection.division !== '' ||
    selection.clan !== '' ||
    selection.town !== '' ||
    selection.ethnic !== defaultEthnic;

  return (
    <>
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">Places in the archive</p>
          <h1>Towns &amp; communities</h1>
          <p className="lede">
            Choose a community to see its connected histories, photographs, recordings and records
            together.
          </p>
          {/*
            The register's finder, reproduced from the design's `towns.html` — see the note at the head of
            this file for what is the design's and what this page had to add to make it a working GET form.
          */}
          <form
            id="register-finder"
            className="sx-reg-finder"
            action="/towns"
            method="get"
            role="search"
            aria-label="Find in the register"
          >
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
                    /*
                      An entry's name is an Igbo name, so it carries the owner's rule — `.oz-igbo` and
                      `lang="ig"` — exactly as the name on a card does. `class` on an `<option>` is valid
                      and the language is what a screen reader reads; the face may or may not be applied
                      by the platform's own select control, and that is the control's business.
                    */
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
              <label className="sr-only" htmlFor="f-q">
                Search by name
              </label>
              <input
                id="f-q"
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Or type a clan, town or region"
              />
              <button className="btn btn-gold" type="submit">
                Find
              </button>
              {/* The design's Reset clears the boxes through a script; a link clears them for everyone. */}
              <Link className="btn btn-quiet" href="/towns">
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
        {register.data.length === 0 ? (
          <div className="empty section">
            <p className="eyebrow">Nothing filed</p>
            <h2>
              {query
                ? `No entry matches “${query}”.`
                : 'Nothing in the register matches those filters.'}
            </h2>
            <p>
              The register holds {cascade.publishedTotal} published entries and none of them matches. A
              name may be spelled differently in the records — the survey printed some names the way an
              officer heard them, and the towns write them another way — or the entry may not be filed
              yet.
            </p>
            <p>
              <Link className="btn" href="/towns">
                Show every entry
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="sx-town-grid">
              {register.data.map((entry) => (
                <Link key={entry.slug} href={`/town/${entry.slug}/`}>
                  {/* The design's own `<img>` slot, filled only where the archive links a photograph to
                      this place. An entry with none is drawn without one rather than given a stand-in:
                      the card's words carry the whole meaning and a borrowed picture would be worse than
                      an absent one. `alt=""` is the design's, so a decorative image makes no claim. */}
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
            <p className="sx-source-note sx-light-note">
              {narrowed
                ? `${register.data.length} of ${cascade.publishedTotal} entries match.`
                : `All ${cascade.publishedTotal} entries the archive holds.`}{' '}
              Records come from the archive&rsquo;s clan register; an entry filed without a region says so
              rather than being given one.
            </p>
          </>
        )}
      </section>
    </>
  );
}
