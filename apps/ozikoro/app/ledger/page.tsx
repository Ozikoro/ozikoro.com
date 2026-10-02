/**
 * Public ledger — everyone who keeps this archive alive.
 *
 * THE DESIGN IS ALREADY HONEST, AND THIS GOES ONE STEP FURTHER
 *
 * The screen shows four statistics as em-dashes captioned "awaiting verified figures", and labels every
 * supporter "Example Supporter A", "Example Elder B" and so on. Those labels are correct on a demonstration.
 * **On the live site they would be fake donors**, which the brief forbids in as many words: *"do not create
 * fake researchers, papers, events, towns, coordinates, archaeology records, licences or donors just to fill
 * the screens."*
 *
 * So this page keeps the design's structure — the hero, the four statistics, the notice, the sections, the
 * allocation bars — and **carries no names, no amounts and no dates**, because there are none to carry. Every
 * section states what it will hold and that it is empty. The brief calls a town filed with nothing, and a
 * researcher with no publications, features rather than gaps; a ledger with no entries yet is the same kind
 * of page.
 *
 * The design's own consent rule is kept verbatim in substance: supporters appear with their consent, and
 * anyone can give anonymously.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Public ledger',
  description:
    'The record of everyone who keeps the Ozikoro archive alive — donors, sponsors, researchers, knowledge holders, translators, photographers and volunteers. No entries yet.',
  alternates: { canonical: 'https://ozikoro.com/ledger' },
  openGraph: {
    title: 'Public ledger — Ozikoro',
    description: 'The record of everyone who keeps this archive alive.',
    type: 'article',
  },
};

/**
 * The four figures the design draws, as em-dashes with the design's own caption.
 *
 * They are `null` rather than zero: **zero would be a claim** — it would say nobody has given, when what is
 * true is that no verified figure has been supplied. The difference matters on a page whose whole subject is
 * what can be verified.
 */
const STATS: Array<{ value: string | null; label: string }> = [
  { value: null, label: 'Total received (awaiting verified figures)' },
  { value: null, label: 'Records contributed' },
  { value: null, label: 'Volunteer hours' },
  { value: null, label: 'Communities represented' },
];

/** The five sections the design names, as anchors. Each is empty, and each says so. */
const SECTIONS: Array<{ id: string; label: string; heading: string; body: string }> = [
  {
    id: 'honour',
    label: 'Roll of honour',
    heading: 'Roll of honour',
    body:
      'This is where supporters, knowledge holders, translators, photographers and volunteers will be ' +
      'named. Nobody is listed yet, and nobody will be listed without their consent — a gift can be ' +
      'anonymous, and an anonymous one will be recorded as anonymous rather than left out.',
  },
  {
    id: 'donations',
    label: 'Donations',
    heading: 'Donations',
    body:
      'No donations have been recorded. The payment account is not connected yet, so the donate page ' +
      'says so rather than accepting money it cannot account for.',
  },
  {
    id: 'knowledge',
    label: 'Knowledge contributions',
    heading: 'Knowledge contributions',
    body:
      'Contributions of words, records and corrections will appear here with the same provenance they ' +
      'carry in the archive. None has been recorded on this ledger yet.',
  },
  {
    id: 'volunteers',
    label: 'Volunteers',
    heading: 'Volunteers',
    body:
      'Hours given to reading, checking, recording and translating will be recorded here. No hours are ' +
      'recorded yet.',
  },
  {
    id: 'funds',
    label: 'Where funds go',
    heading: 'Where funds go',
    body:
      'An allocation breakdown will be published here once there is money to allocate and figures that ' +
      'have been checked. This page will not show a proportion it cannot substantiate.',
  },
];

export default function LedgerPage() {
  return (
    <>
      <section className="sx-pg-hero">
        <div className="wrap">
          <p className="eyebrow">Public ledger</p>
          <h1>Everyone who keeps this archive alive.</h1>
          <p className="lede">
            Money is only one kind of gift. This ledger records donors, sponsors, researchers, knowledge
            holders, translators, photographers and volunteers — and it is empty, because nothing has been
            recorded yet.
          </p>
          <div className="sx-stats">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <b>{stat.value ?? '—'}</b>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap section">
        <p className="sx-notice">
          <b>Nothing is listed yet.</b> There are no supporters, amounts or dates to show, so this page shows
          none rather than examples. Supporters will appear with their consent, and anyone can give
          anonymously.
        </p>

        <nav className="sx-tabs" aria-label="Ledger sections">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.label}
            </a>
          ))}
        </nav>

        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="section">
            <h2>{section.heading}</h2>
            <p className="muted">{section.body}</p>
          </section>
        ))}

        <h2>How to appear here</h2>
        <p className="muted">
          A gift of money, a record, a correction, a translation or time all count the same way on this
          ledger. Both the donate page and the contribute form say plainly whether they are open before you
          use them.
        </p>
        <p>
          <Link className="btn btn-gold" href="/donate">
            Support the archive
          </Link>{' '}
          <Link className="btn" href="/contribute">
            Contribute a record
          </Link>{' '}
          <Link className="btn" href="/about">
            About Ozi Ikoro
          </Link>
        </p>
      </section>
    </>
  );
}
