import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Offline · Ozituma Learn',
  robots: { index: false, follow: false },
};

/**
 * The offline fallback.
 *
 * Served by the service worker when a navigation fails, so a learner who taps a link with no
 * connection sees this rather than the browser's own error page. That matters more than it sounds:
 * a browser error tells them the SITE is broken, and the correct thing to do — go back, keep
 * reviewing, sync later — is not something they can infer from it.
 *
 * Statically rendered on purpose. A page whose job is to render when the server is unreachable must
 * not itself need the server.
 */
export default function OfflinePage() {
  return (
    <div className="wrap wrap-narrow">
      <section className="learn-hero">
        <p className="learn-eyebrow">Offline</p>
        <h1 className="learn-hero-title">No connection</h1>
        <p className="hero-lede">
          The pages you have already visited and the recordings in your downloaded packs are still
          here. Anything you answer is saved on this device and sent the moment you reconnect.
        </p>
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">What still works</h2>
        <ul className="learn-review-list">
          <li className="learn-review-item">
            <span className="learn-review-prompt">Today&rsquo;s review</span>
            <span className="learn-review-answer">
              If the queue was loaded while you had a connection, the words are here. Answers are
              queued.
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">Downloaded packs</span>
            <span className="learn-review-answer">
              Audio you downloaded plays from this device rather than from the network.
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">Everything else</span>
            <span className="learn-review-answer">
              Needs a connection. Nothing is lost — it will be here when you are.
            </span>
          </li>
        </ul>

        <div className="learn-actions">
          <Link className="button" href="/plan">
            Go to today&rsquo;s review
          </Link>
        </div>
      </section>
    </div>
  );
}
