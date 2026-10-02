/**
 * The African Cultural Calendar.
 *
 * NO EVENT IS VERIFIED, SO NO DATE IS CLICKABLE
 *
 * The design's own screen says two things that settle this page: it is headed *"October 2026 · demonstration
 * month"*, and its instruction is *"Gold dates have events. **Plain dates are not clickable.**"* The brief adds
 * that *"sample events stay labelled until verified data is supplied."*
 *
 * **The archive has no event records at all** — measured: there is no event table, and the only `%event%`
 * tables are `learn_xp_event` and `spotify_event`, which belong to the academy and to Spotify. So **every date
 * on this page is a plain date**, which is the design's own non-interactive state rather than a degraded one.
 *
 * The design's sample events — a festival in October, with an organiser, a place and a verification badge —
 * are **not reproduced**. The brief forbids creating events to fill a screen, and a calendar is the worst place
 * to do it: a wrong date is a reader travelling, or waiting, on the wrong day.
 *
 * WHAT THE PAGE DOES SHOW
 *
 * The filters the design draws (region, country, event type) as real labelled controls with nothing to filter,
 * the instruction that plain dates are not clickable, and the submission route by which a verified event
 * arrives. When records exist, the same grid gains buttons on the dates that have them and nothing else
 * changes — which is what the design's two states describe.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'African Cultural Calendar',
  description:
    'Events across Africa by date, region and type, with their organiser, place and verification status. No event has been verified yet.',
  alternates: { canonical: 'https://ozikoro.com/cultural-calendar' },
  openGraph: {
    title: 'African Cultural Calendar — Ozikoro',
    description: 'Culture, place and time.',
    type: 'website',
  },
};

/** The filters the design draws. Real controls, and nothing behind them yet. */
const REGIONS = ['All African regions', 'West Africa', 'East Africa', 'Central Africa', 'North Africa', 'Southern Africa'];
const COUNTRIES = ['All countries', 'Nigeria', 'Ghana', 'Kenya'];
const TYPES = ['All events', 'Festival', 'Commemoration', 'Exhibition', 'Community gathering'];

/** The month this page draws. Named as a demonstration in the heading, as the design names it. */
const MONTH_LABEL = 'October 2026 · demonstration month';
const DAYS_IN_MONTH = 31;
/** 1 October 2026 is a Thursday; the grid starts on Monday. */
const LEADING_BLANKS = 3;

export default function CulturalCalendarPage() {
  const cells: Array<{ day: number } | null> = [
    ...Array.from({ length: LEADING_BLANKS }, () => null),
    ...Array.from({ length: DAYS_IN_MONTH }, (_, i) => ({ day: i + 1 })),
  ];

  return (
    <>
      <section className="sx-cultural-hero">
        <div className="wrap">
          <p className="eyebrow">Culture, place and time</p>
          <h1>African Cultural Calendar</h1>
          <p className="lede">
            Choose a highlighted day to see its events, organiser, place and verification status. No event has
            been verified yet, so no day is highlighted.
          </p>
          <div className="row">
            <a className="btn btn-gold" href="#calendar">
              See event dates
            </a>
            <Link className="btn" href="/igbo-calendar">
              Open Igbo calendar
            </Link>
          </div>
        </div>
      </section>

      <section className="wrap section" id="calendar">
        <div className="sx-calendar-intro">
          <div>
            <p className="eyebrow">{MONTH_LABEL}</p>
            <h2>Events by date</h2>
          </div>
          <p>
            <strong>Dates with a verified event become buttons. Every other date is plain and not clickable</strong>{' '}
            — that is the design&rsquo;s own instruction, and it is a rule rather than a style: a date that looks
            pressable and does nothing is worse than one that plainly is not.
          </p>
        </div>

        <form className="sx-calendar-filters" method="get" action="/cultural-calendar">
          <label>
            Region
            <select name="region" defaultValue={REGIONS[0]}>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Country
            <select name="country" defaultValue={COUNTRIES[0]}>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Event type
            <select name="type" defaultValue={TYPES[0]}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input name="date" type="date" />
          </label>
          <button className="btn" type="submit">
            Search events
          </button>
        </form>

        <p className="sx-notice">
          <b>No event on this calendar has been verified.</b> The archive holds no event records, so nothing is
          listed and no date is interactive. Events appear here only with a source and a verification status
          recorded against them — a date that cannot be checked does not go on a calendar people travel by.
        </p>

        <div className="sx-event-layout">
          <div className="sx-cultural-calendar">
            {/* The design gives the grid a header of its own carrying the month, separate from the intro's
                "Events by date" heading above it. */}
            <header>
              <p className="eyebrow">The month</p>
              <h2>{MONTH_LABEL.replace(' · demonstration month', '')}</h2>
            </header>
            <div className="sx-weekdays" aria-hidden="true">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div data-calendar-grid>
              {cells.map((cell, i) =>
                cell ? (
                  // PLAIN, and deliberately not a button: no event is recorded for any date this month.
                  <div key={cell.day} className="is-empty" data-plain="true">
                    <span>{cell.day}</span>
                  </div>
                ) : (
                  <div key={`blank-${i}`} className="is-empty" aria-hidden="true" />
                )
              )}
            </div>
          </div>

          <aside className="sx-event-day-panel">
            <p className="eyebrow">Selected date</p>
            <time>{MONTH_LABEL}</time>
            <h2>Choose a highlighted date</h2>
            <p className="muted">
              Selecting a date would show its events, organiser, place and verification status. There is nothing
              to select.
            </p>
            <p className="muted">
              <b>Verification status</b> is recorded per event and shown with it, so a reader can tell an event
              confirmed by an organiser from one submitted and not yet checked.
            </p>
          </aside>
        </div>

        <section className="section">
          <h2>Submit an event</h2>
          <p className="muted">
            An event is added when its date, organiser, place and a source are supplied together, and it is
            published once that source has been checked. A submission is a record with an author, not an
            anonymous listing.
          </p>
          <p>
            <Link className="btn btn-gold" href="/submit">
              Submit an event for review
            </Link>{' '}
            <Link className="btn" href="/cite">
              How to cite a record
            </Link>
          </p>
        </section>
      </section>
    </>
  );
}
