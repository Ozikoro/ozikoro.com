/**
 * `/privacy` — the data-controller notice Ozi Ikoro Limited published, served in full.
 *
 * ── WHAT THIS PAGE WAS, AND WHY IT IS NOT THAT ANY MORE ───────────────────────────────────────────────
 *
 * This route used to carry the archive's own statement about personal data — the tables it writes, the
 * services it calls, the cookies it sets — under a heading reading *"This is a statement of fact, not a legal
 * notice"*, and a paragraph saying *"Ozi Ikoro Limited has not supplied a data-controller notice for Ozikoro,
 * and this archive does not write one on its behalf."*
 *
 * **It was written because the notice was believed not to exist. It did.** The company's own WordPress site
 * has held a Privacy Policy all along: `wpc9_posts` row 477, slug `privacy-policy`, 615 words across eleven
 * numbered sections. It was imported into this archive as the record slugged `privacy-policy` (record 1055),
 * published — and then, because `/privacy-policy/` is a permanent redirect to this address, **every reader who
 * followed the record's own address arrived at a page saying no notice had been supplied.** The owner
 * reported exactly that: *"on the main ozikoro wordpress, it has terms, and privacy, why is it telling me on
 * the about page that terms and privacy has not been supplied?"*
 *
 * So this page serves the notice. **It is reproduced rather than summarised and rather than rewritten** — a
 * substitute policy is the one thing this route must never produce, and the page that used to be here was a
 * substitute.
 *
 * ── WHERE IT COMES FROM, AND WHAT IS DONE TO IT ───────────────────────────────────────────────────────
 *
 * The body is read from `ozikoro_article` — the imported record — and passes through the same two functions
 * every other stored record passes through at the render boundary: **`prepareArchiveHtml`**, the sanitiser
 * (which also moves the record's own headings into this site's outline), and **`rewriteBodyImages`**, so a
 * WordPress media address becomes this archive's own `/media/…` path. **Neither changes a word of the
 * notice.** The record itself is untouched: same id, same slug, same `published` status, same address.
 *
 * ── AND THE ADDRESSES ─────────────────────────────────────────────────────────────────────────────────
 *
 * `/privacy/` is canonical and is what every footer links. `/privacy-policy/` keeps working as a permanent
 * redirect to it, so the address the record was published at still resolves rather than 404ing; the record's
 * own published address is not withdrawn by serving its content here.
 *
 * A React route using the design's own classes, like `/about` and `/terms`. **`public/design/` is untouched,
 * and the deliverable draws no `privacy.html`** — measured, not assumed: `screens/` holds no such file, which
 * is why this address was built as a route in the first place.
 */
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { mediaUrlResolver, prepareArchiveHtml, rewriteBodyImages, slugVariants } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'The privacy policy published by Ozi Ikoro Limited: the information the site collects, how it is used, cookies and tracking, retention, security, and how to reach the publisher. Reproduced in full from the company’s own notice.',
  alternates: { canonical: 'https://ozikoro.com/privacy' },
  robots: { index: true, follow: true },
};

/** The slug the importer preserved from WordPress page 477. This is the record, and it is not renamed. */
const NOTICE_SLUG = 'privacy-policy';

export default async function PrivacyPage() {
  const db = await getDb();

  /*
   * THE RECORD, READ RATHER THAN QUOTED. `slugVariants` is used because the importer preserves the slug as
   * WordPress published it, and a percent-encoded form would otherwise be a second row this query missed —
   * the same reason `getArticleBySlug` reads through it. The `is_page = true` clause is what makes this the
   * published page rather than an archive record with the same slug.
   */
  const record = await db.one<{ id: number; slug: string; title: string; body_html: string | null }>(
    `select id, slug, title, body_html
       from ozikoro_article
      where status = 'published' and is_page = true and slug = any($1::text[])`,
    [slugVariants(NOTICE_SLUG)]
  );

  /*
   * The two render-boundary functions, applied in the order every stored body is: sanitise and normalise,
   * then point the images at this archive's own media route.
   */
  let content = '';
  if (record) {
    const resolveImage = await mediaUrlResolver(db);
    content = rewriteBodyImages(prepareArchiveHtml(record.body_html ?? ''), resolveImage);
  }

  return (
    <>
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">The institution</p>
          <h1>Privacy</h1>
          <p className="lede">
            The privacy policy published by Ozi Ikoro Limited, reproduced in full. It is the company&rsquo;s
            own notice rather than a summary written for this archive.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="prose">
          {record ? (
            <>
              <p className="provenance">
                <strong>{record.title}</strong> — published by Ozi Ikoro Limited on its own WordPress site at{' '}
                <code>/privacy-policy/</code>, imported into this archive as record {record.id}, and reproduced
                here unaltered. That address is a permanent redirect to this page.
              </p>
              <div dangerouslySetInnerHTML={{ __html: content }} />
            </>
          ) : (
            /*
             * A MISSING ROW IS NOT A MISSING POLICY. The distinction matters here more than anywhere else on
             * the site: the sentence this page replaced claimed the notice had not been supplied, and it was
             * false. So the empty state names the fault as a read and invents nothing.
             */
            <div className="provenance section" aria-labelledby="notice-unread">
              <p className="eyebrow">The state of this notice</p>
              <h2 id="notice-unread">The notice is held, but could not be read here.</h2>
              <p>
                Ozi Ikoro Limited published a privacy policy and it is held in this archive as the record
                slugged <code>{NOTICE_SLUG}</code>, which is what this page serves. This deployment could not
                read that row, so what is missing is the read rather than the policy.{' '}
                <strong>No substitute notice is written here</strong>, because an invented one would be worse
                than this sentence, and this page has already been wrong about the notice once.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
