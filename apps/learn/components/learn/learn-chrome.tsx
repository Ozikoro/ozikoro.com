import Link from 'next/link';
import { NavMenu } from '@/components/nav-menu';
import { learnHref, type LearnHostInfo } from '@/lib/learn-host';

/**
 * The header and footer for Ozituma Learn.
 *
 * The learn subdomain gets its own chrome rather than the dictionary's. That is
 * not decoration: a learner arriving at learn.ozituma.com is not looking for a
 * dictionary of twenty languages, and putting the full dictionary navigation in
 * front of them would make the course feel like a subsection of a reference work
 * rather than the thing they came to do.
 *
 * What stays is one clear way back to the dictionary, because the course links
 * every vocabulary item to its entry and a learner who follows one should not
 * land somewhere that has lost the thread.
 */

const DICTIONARY_URL = process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com';

export function LearnHeader({
  info,
  signedIn,
  canReview,
}: {
  info: LearnHostInfo;
  signedIn: boolean;
  /**
   * Whether this account may work the §5.3 content queue.
   *
   * Passed in rather than derived, so the header does no database work of its own and the layout
   * stays the one place that reads the session.
   */
  canReview: boolean;
}) {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href={learnHref(info, '/')} className="brand">
          <span className="brand-mark" aria-hidden="true">
            ọ
          </span>
          <span className="brand-name">Ozituma</span>
          <span className="brand-label">Learn</span>
        </Link>
        <NavMenu>
          <Link href={learnHref(info, '/')}>Courses</Link>
          {/*
            Today comes first among the working surfaces, because it is the one a returning learner
            should be sent to. It is also the only entry that carries state — the number due — and a
            learner with eight words waiting should be able to see that without opening the page.
          */}
          {signedIn ? <Link href={learnHref(info, '/plan')}>Today</Link> : null}
          {/*
            Practice is next, not last. It is the surface that works for everyone — the courses cannot
            publish until a linguist and two native reviewers are named (§18 #4) — so putting it
            behind "Igbo" would bury the one thing an anonymous visitor can actually do.
          */}
          <Link href={learnHref(info, '/practice')}>Practice</Link>
          <Link href={learnHref(info, '/igbo')}>Igbo</Link>
          {/*
            The lookup comes BEFORE the outbound dictionary link. A learner who wants to check a word
            should stay here; the link out is for the full entry with its dialects and sources.
          */}
          <Link href={learnHref(info, '/tutor')}>Tutor</Link>
          <a href={DICTIONARY_URL}>Dictionary</a>
          {signedIn ? <Link href={learnHref(info, '/progress')}>Progress</Link> : null}
          {/*
            Review appears only for staff. A learner seeing an item they cannot open is a
            dead end, and the queue is an internal working surface rather than a feature.
          */}
          {canReview ? <Link href={learnHref(info, '/review')}>Review</Link> : null}
          {/*
            Account settings live on the dictionary, because that is where the account pages are and
            it is the SAME account — one `account` row, one password. Sending a learner to a second
            account page here would imply two accounts, which is the thing this arrangement exists to
            avoid.
          */}
          {signedIn ? (
            <a href={`${DICTIONARY_URL}/account`}>Your account</a>
          ) : (
            <Link href={learnHref(info, '/signin')}>Sign in</Link>
          )}
        </NavMenu>
      </div>
    </header>
  );
}

export function LearnFooter({ info }: { info: LearnHostInfo }) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <strong className="footer-heading">Ozituma Learn</strong>
            <p style={{ margin: '0.35rem 0 0' }}>
              Courses in African languages, built on the{' '}
              <a href={DICTIONARY_URL} rel="noopener">
                Ozituma dictionary
              </a>
              . Every word you meet here has an entry you can read, hear and check.
            </p>
          </div>
          <div>
            <strong className="footer-heading">Courses</strong>
            <p style={{ margin: '0.35rem 0 0' }}>
              <Link href={learnHref(info, '/igbo')}>Igbo for beginners</Link>
              <br />
              <Link href={learnHref(info, '/')}>All courses</Link>
            </p>
          </div>
          <div>
            <strong className="footer-heading">The dictionary</strong>
            <p style={{ margin: '0.35rem 0 0' }}>
              <a href={DICTIONARY_URL}>Look up a word</a>
              <br />
              <a href={`${DICTIONARY_URL}/practice`}>Practice</a>
              <br />
              <a href={`${DICTIONARY_URL}/docs`}>Public API</a>
            </p>
          </div>
          <div>
            <strong className="footer-heading">Ozikoro</strong>
            <p style={{ margin: '0.35rem 0 0' }}>
              <a href="https://ozikoro.com" rel="noopener">
                The archive
              </a>
              <br />
              <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>
            </p>
          </div>
        </div>
        <p className="footer-note">
          © {new Date().getFullYear()} Ozikoro. Ozikoro keeps the history and the archive; the
          words live at ozituma.com, and they are taught here.
        </p>
      </div>
    </footer>
  );
}
