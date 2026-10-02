/**
 * The Igbo calendar and the four-day market week.
 *
 * THE ANCHOR IS A DEMONSTRATION, AND THIS PAGE SAYS SO ABOVE THE ANSWER
 *
 * The brief is explicit: *"The market-day conversion uses a demonstration anchor (1 January 2026 = Orie). It
 * must be clearly labelled as requiring community verification and must never be presented as universal —
 * communities can use different anchors. Keep the community/source context visible."*
 *
 * **The design's own `market-days.js` does not say that.** It holds the anchor as two bare constants
 * (`Date.UTC(2026,0,1)`, `anchorIndex = 1`) and paints the result into every `[data-market-day]` element with
 * no qualification at all. So this page keeps the conversion and adds what the design omits: the anchor is
 * stated, its status is stated, and it is stated **before** the day it produces rather than in a footnote.
 *
 * That matters because a four-day cycle anchored at one date is wrong for any community using a different
 * one, and a reader has no way to tell from the output alone. **The anchor is not a fact about Igbo
 * calendrical practice; it is this archive's demonstration of one, and the page says exactly that.**
 *
 * SERVER-RENDERED, WITH THE FORMS AS PLAIN GETS
 *
 * The brief requires reading and search to work without JavaScript, and the design already builds this screen
 * from forms — a date lookup and an upcoming-day tool — so every view here is a URL: `?date=YYYY-MM-DD` for a
 * lookup, `?day=Orie` for the ten next occurrences, `?year=2026` for the full-year view. Each is bookmarkable
 * and citable, and the design's month grid is drawn on the server rather than in the browser.
 *
 * The full-year view is behind its own query parameter rather than shown by default, because the brief asks
 * for an opt-in and because a year of four-day cycles is a lot of page for someone who wanted today's date.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Igbo Calendar',
  description:
    'Today in the four-day Igbo market week, a date lookup and the next occurrences of Eke, Orie/Oye, Afọ/Afor and Nkwọ/Nkwor — with the demonstration anchor stated.',
  alternates: { canonical: 'https://ozikoro.com/igbo-calendar' },
  openGraph: {
    title: 'Igbo Calendar — Ozikoro',
    description: 'Gregorian date and the four-day cycle.',
    type: 'article',
  },
};

/** The cycle, with the naming variants the design lists. Order matters: it is the sequence, not a set. */
const CYCLE: Array<{ n: string; names: string[] }> = [
  { n: '01', names: ['Eke'] },
  { n: '02', names: ['Orie', 'Oye'] },
  { n: '03', names: ['Afọ', 'Afor'] },
  { n: '04', names: ['Nkwọ', 'Nkwor'] },
];

const DAYS = ['Eke', 'Orie', 'Afọ', 'Nkwọ'] as const;
type Day = (typeof DAYS)[number];

/**
 * The demonstration anchor, in one place and named as a demonstration.
 *
 * 1 January 2026 is taken to be Orie. `anchorIndex` is its position in `DAYS`, so Orie is 1 and the mapping is
 * fixed from there. **Both constants are the design's own**, kept identical so this page and the design's
 * script cannot disagree — the difference between them is the disclosure, not the arithmetic.
 */
const ANCHOR_ISO = '2026-01-01';
const ANCHOR_INDEX = 1;

const MS_PER_DAY = 86_400_000;

function marketDayFor(date: Date): Day {
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const anchor = Date.UTC(2026, 0, 1);
  const delta = Math.round((utc - anchor) / MS_PER_DAY);
  const index = ((ANCHOR_INDEX + delta) % 4 + 4) % 4;
  const day = DAYS[index];
  // Unreachable: the modulo yields 0–3 and DAYS has four entries. Thrown rather than defaulted, because a
  // silent fallback to "Eke" would print a wrong market day rather than fail — and this page exists to be
  // careful about exactly that.
  if (!day) throw new Error(`market day index out of range: ${index}`);
  return day;
}

/** Parse `YYYY-MM-DD` strictly; anything else is not a date this page will guess at. */
function parseIso(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const FORMAT = new Intl.DateTimeFormat('en-NG', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

/** The ten next dates on which `wanted` falls, starting from `from`. */
function nextTen(wanted: Day, from: Date): Date[] {
  const found: Date[] = [];
  const cursor = new Date(from.getTime());
  while (found.length < 10) {
    if (marketDayFor(cursor) === wanted) found.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return found;
}

export default async function IgboCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; day?: string; year?: string }>;
}) {
  const params = await searchParams;
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const looked = parseIso(params.date);
  const wanted = DAYS.find((d) => d.toLowerCase() === (params.day ?? '').toLowerCase());
  const yearWanted = /^\d{4}$/.test(params.year ?? '') ? Number(params.year) : null;

  // The month grid for the month being shown: the looked-up date's month, or this month.
  const shown = looked ?? todayUtc;
  const year = shown.getUTCFullYear();
  const month = shown.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leadingBlanks = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;

  return (
    <>
      <section className="sx-igbo-cal-hero">
        <div className="wrap">
          <div>
            <p className="eyebrow">Gregorian date + four-day cycle</p>
            <h1>Igbo Calendar</h1>
            <p className="lede">
              Check today, look up another date, or follow Eke, Orie/Oye, Afọ/Afor and Nkwọ/Nkwor across a
              month or a full year.
            </p>
          </div>
          <div className="sx-date-orbit">
            <p className="eyebrow">Today</p>
            <b data-market-day>{marketDayFor(todayUtc)}</b>
            <span data-modern-date>{FORMAT.format(todayUtc)}</span>
          </div>
        </div>
      </section>

      {/* THE DISCLOSURE, ABOVE EVERY ANSWER ON THE PAGE. */}
      <section className="wrap section">
        <p className="sx-notice">
          <b>The four-day cycle here is a demonstration and needs community verification.</b> It is calculated
          from one anchor — <b>1 January 2026 taken as Orie</b> — and <b>communities can and do use different
          anchors</b>, so a date this page calls Orie may be another day where you are. Nothing here is
          presented as universal, and the archive will carry a verified community calendar once one is
          supplied rather than replacing this one by default.
        </p>

        <div className="sx-market-week">
          {CYCLE.map((entry) => (
            <article key={entry.n}>
              <span>{entry.n}</span>
              {/* The design's heading carries both spellings, which is why the parity check looks for
                  "Orie Oye" rather than "Orie": the variants are the point of the row. */}
              <h2>{entry.names.join(' ')}</h2>
            </article>
          ))}
        </div>

        <div className="sx-lookup-grid">
          <form className="sx-date-lookup" method="get" action="/igbo-calendar">
            <p className="eyebrow">Date lookup</p>
            <h2>Find its market day</h2>
            <label htmlFor="date">Look up a date</label>
            <input id="date" name="date" type="date" defaultValue={isoOf(shown)} />
            <button className="btn btn-gold" type="submit">
              Look up
            </button>
          </form>

          <form className="sx-upcoming-tool" method="get" action="/igbo-calendar">
            <p className="eyebrow">Plan ahead</p>
            <h2>Next ten market days</h2>
            <label htmlFor="day">Next ten occurrences of</label>
            <select id="day" name="day" defaultValue={wanted ?? 'Orie'}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Show
            </button>
          </form>
        </div>

        {looked ? (
          <div className="notice">
            <b>{marketDayFor(looked)}</b> — {FORMAT.format(looked)}. Calculated from the demonstration anchor
            above.
          </div>
        ) : null}

        {wanted ? (
          <section className="section">
            <h2>The next ten {wanted} days</h2>
            <ol>
              {nextTen(wanted, todayUtc).map((d) => (
                <li key={isoOf(d)}>
                  <b>{wanted}</b> <span>{FORMAT.format(d)}</span>
                </li>
              ))}
            </ol>
            <p className="muted">
              On the demonstration anchor. A different anchor moves every date in this list.
            </p>
          </section>
        ) : null}

        {/* The design names this section and gives its header a heading of its own. */}
        <section className="sx-month-section">
          <header>
            <div>
              <p className="eyebrow">Month view</p>
              <h2>Market-day month</h2>
            </div>
            <div className="row">
              <span className="muted small">
                {new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(shown)}
              </span>
            </div>
          </header>
          <div className="sx-igbo-month" data-calendar-grid>
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <div key={`blank-${i}`} className="is-empty" aria-hidden="true" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = new Date(Date.UTC(year, month, i + 1));
              return (
                <div key={isoOf(d)} data-market={marketDayFor(d)}>
                  <span>{i + 1}</span>
                  <b>{marketDayFor(d)}</b>
                </div>
              );
            })}
          </div>
          <p className="muted">
            Showing {month + 1}/{year}. Use the lookup above to move to another month.
          </p>
        </section>

        {/*
          The design's closing note on this screen, and the one that matters most: the anchor is a
          demonstration and a community's own reckoning is what governs. It is stated as a section of its
          own rather than a footnote, because a reader who takes the cycle as universal has been misled by
          the page rather than by their own reading.
        */}
        <section className="section">
          <h2>Community context matters</h2>
          <p>
            The four-day cycle here is calculated from one anchor — 1 January 2026 taken as Orie — and
            communities can and do reckon it differently. A day this page calls Orie may be another day where
            you are. The archive will carry a verified community calendar once one is supplied, and this
            demonstration will not be presented as it in the meantime.
          </p>
        </section>

        <section className="section">
          <h2>Full year</h2>
          {yearWanted ? (
            <>
              <p className="muted">
                {yearWanted}, on the demonstration anchor. Every date below is one anchor away from being
                wrong.
              </p>
              <div data-year-grid>
                {Array.from({ length: 12 }, (_, m) => {
                  const count = new Date(Date.UTC(yearWanted, m + 1, 0)).getUTCDate();
                  const name = new Intl.DateTimeFormat('en-NG', { month: 'long', timeZone: 'UTC' }).format(
                    new Date(Date.UTC(yearWanted, m, 1))
                  );
                  return (
                    <article key={name}>
                      <h3>{name}</h3>
                      <div>
                        {Array.from({ length: count }, (_, i) => {
                          const d = new Date(Date.UTC(yearWanted, m, i + 1));
                          return (
                            <span key={isoOf(d)} data-market={marketDayFor(d)}>
                              <b>{i + 1}</b>
                              <small>{marketDayFor(d)}</small>
                            </span>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p>
              A full year of the cycle is a long page, so it is shown only when asked for.{' '}
              <Link className="btn" href={`/igbo-calendar?year=${year}`}>
                View full year {year}
              </Link>
            </p>
          )}
        </section>
      </section>
    </>
  );
}
