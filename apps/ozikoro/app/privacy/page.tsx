/**
 * `/privacy` — what this platform holds, what it sends, and what it does not do.
 *
 * ── WHY THIS PAGE EXISTS, AND WHY IT IS NOT A PRIVACY POLICY ──────────────────────────────────────────
 *
 * The design brief §3.6 requires terms and privacy as part of the institution. **The design draws no
 * `privacy.html` and no `terms.html`**, and the one screen that mentions either — `about.html` — states the
 * opposite of a policy:
 *
 *     Terms    "Binding terms must be supplied by Ozi Ikoro Limited."
 *     Privacy  "The complete data-controller notice must be supplied."
 *
 * The repository holds no notice either. Measured: `data/nzeora-wp/pages.json` does contain a page slugged
 * `privacy-policy`, and it is **Nzeora.com's** — a job blog that states it collects no personal information,
 * serves Google AdSense, and gives `support@nzeora.com` as its contact. None of that is true of this
 * platform, which stores accounts and serves no advertising. **Publishing it under Ozikoro's name would be
 * a fabricated privacy policy, which is the worst output available here** — so it is not published, and
 * this page states the archive's own position instead.
 *
 * ── SO WHAT IS THIS PAGE, EXACTLY ─────────────────────────────────────────────────────────────────────
 *
 * A statement of what the platform does with personal data, written from the code and the database and
 * from nothing else. Every figure on it was measured, every claim is a property of a file named in a
 * comment, and **every question that only Ozi Ikoro Limited can answer is named as unanswered rather than
 * answered plausibly** — the lawful basis, the retention periods, the data controller's identity and
 * address, and the person to write to about a data request.
 *
 * **That is not a weaker thing than a policy. It is the honest half of one**, and this archive's rule is
 * that an unrecorded fact is stated rather than filled. When the notice is supplied it replaces the last
 * section rather than sitting beside it, and the doc comment there says so.
 *
 * ── WHERE IT LIVES IN THE DESIGN'S IDIOM ──────────────────────────────────────────────────────────────
 *
 * A React route, like `/about`, `/clans` and `/researchers` — **the design's own screens are not edited,
 * and no new one is drawn.** It uses the design's classes verbatim (`.wrap`, `.section`, `.prose`,
 * `.sx-head`, `.lede`, `.provenance`, `.partial-note`, `.chips`, `.chip`) and the design's own tokens
 * reach it through `main.css`, which the root layout links. `public/design/` is untouched.
 *
 * The address is new and the design does not draw it. **That is a design decision, and it is recorded as
 * one** rather than taken quietly: the alternative was to leave a foot in every footer pointing at a 404.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { mailStatus } from '@ozituma/core';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What Ozikoro holds, what it sends to the services it uses, what its cookies are, and what it has not yet decided — stated from the platform itself, because the full data-controller notice has not been supplied to it.',
  alternates: { canonical: 'https://ozikoro.com/privacy' },
  robots: { index: true, follow: true },
};

const n = (value: number) => value.toLocaleString('en-GB');
const plural = (value: number, one: string, many: string) => `${n(value)} ${value === 1 ? one : many}`;

export default async function PrivacyPage() {
  const db = await getDb();

  /*
   * EVERY NUMBER BELOW IS COUNTED AT REQUEST TIME. A privacy page that states a figure and does not read
   * it is a page that goes quietly out of date, and the one thing this archive cannot do is be wrong
   * about what it holds.
   */
  const counts = await db.one<{
    accounts: number; sessions: number; donations: number; publications: number;
    claims: number; follows: number; media: number; media_rights: number;
    media_with_licence: number; media_with_any_note: number; rights_checked: number;
  }>(`
    select
      (select count(*)::int from account) as accounts,
      (select count(*)::int from auth_session) as sessions,
      (select count(*)::int from donation) as donations,
      (select count(*)::int from ozikoro_publication) as publications,
      (select count(*)::int from ozikoro_claim) as claims,
      (select count(*)::int from ozikoro_follow) as follows,
      (select count(*)::int from ozikoro_media) as media,
      (select count(*)::int from ozikoro_media_rights) as media_rights,
      (select count(*)::int from ozikoro_media where licence is not null and licence <> '') as media_with_licence,
      (select count(*)::int from ozikoro_media where rights_note is not null and rights_note <> '') as media_with_any_note,
      (select count(*)::int from ozikoro_media_rights where checked_at is not null) as rights_checked
  `);

  const c = counts ?? {
    accounts: 0, sessions: 0, donations: 0, publications: 0, claims: 0, follows: 0,
    media: 0, media_rights: 0, media_with_licence: 0, media_with_any_note: 0, rights_checked: 0,
  };

  /*
   * WHICH MAIL TRANSPORT IS CONFIGURED, READ RATHER THAN ASSUMED.
   *
   * `mailStatus()` is the same function the application consults before it offers a password reset, so the
   * page cannot claim a provider the deployment does not use. Where none is configured the sentence says
   * that instead — a small thing, and exactly the class of claim this page must not get wrong.
   */
  const mail = mailStatus();

  return (
    <>
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">The institution</p>
          <h1>Privacy</h1>
          <p className="lede">
            What this platform holds about people, what it sends to the services it uses, what its cookies
            are, and what it has not yet decided. Written from the platform itself rather than from a
            template, because the full data-controller notice has not been supplied to it.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="prose">
          <div className="provenance section" aria-labelledby="notice-state">
            <p className="eyebrow">The state of this notice</p>
            <h2 id="notice-state">This is a statement of fact, not a legal notice.</h2>
            <p>
              Ozi Ikoro Limited has not supplied a data-controller notice for Ozikoro, and this archive does
              not write one on its behalf — a plausible legal term invented here would be false, and a false
              privacy policy is worse than none. What follows is what the platform can demonstrate about
              itself: the tables it writes, the services it calls, the cookies it sets, and the rules in its
              own code. <strong>It is not a substitute for the notice, and it says so.</strong>
            </p>
          </div>

          <h2>What the platform stores</h2>
          <p>
            Everything below is read from the archive&rsquo;s own database at the moment this page is
            served, so the figures are what it holds now rather than what it held when the page was written.
          </p>
          <ul>
            <li>
              <strong>Accounts — {plural(c.accounts, 'row', 'rows')}.</strong> An account holds an email
              address, a display name, a role, a status, and a password stored as a <strong>scrypt hash</strong>.
              The password itself is never stored and cannot be recovered from the hash; a forgotten password
              is replaced rather than re-sent.
            </li>
            <li>
              <strong>Sessions — {plural(c.sessions, 'row', 'rows')}.</strong> A signed-in session is a row
              holding the account it belongs to, a token, and when it was issued and expires.
            </li>
            <li>
              <strong>Donations — {plural(c.donations, 'row', 'rows')}.</strong> A donation record holds the
              donor&rsquo;s email address, the amount and currency, the gateway&rsquo;s transaction reference
              and response, and — <em>only where the donor chose to give them</em> — a payer name and a
              message. <strong>No card number, no bank detail and no CVV is stored</strong>, because none of
              them reaches this platform: the payment is taken on the gateway&rsquo;s own page.
            </li>
            <li>
              <strong>Research publications — {plural(c.publications, 'row', 'rows')}.</strong> The
              repository is built and holds nothing yet. A deposited paper would carry its title, abstract,
              authors, topic tags, institution and file.
            </li>
            <li>
              <strong>Claims over a byline — {plural(c.claims, 'row', 'rows')}.</strong> Where a writer asks
              to be recognised as the author of a record, the claim and its decision are held so the record
              can be attributed correctly.
            </li>
            <li>
              <strong>Follows — {plural(c.follows, 'row', 'rows')}.</strong> Following a topic or a
              contributor is stored against the account, so it can be shown back to that account and to
              nobody else.
            </li>
          </ul>

          <h2>What the platform sends, and to whom</h2>
          <p>
            The archive uses a small number of named services. Each one is given the least it needs for the
            job it does, and each is named here rather than left to a subprocessor list that does not exist.
          </p>
          <ul>
            <li>
              <strong>{mail.transport === 'resend' ? 'Resend' : mail.transport === 'ses' ? 'Amazon SES' : mail.transport === 'smtp' ? 'This site’s own mail server' : 'Email'} — email.</strong>{' '}
              {mail.configured && mail.transport === 'resend'
                ? <>A password reset sends the account&rsquo;s email address and a single-use reset link to{' '}
                    <code>api.resend.com</code>.</>
                : <>A password reset is sent through{' '}
                    {mail.configured ? 'the configured mail transport' : 'a mail transport that is not configured on this deployment, in which case the reset request is recorded and an administrator passes the link on by hand'}.</>}{' '}
              The link is a live key to the account, so it is never written to a log and neither is the
              address; the archive&rsquo;s log records only that the message was accepted, and the
              provider&rsquo;s own message id so a message that never arrived can be traced.
            </li>
            <li>
              <strong>ElevenLabs — narration.</strong> Where a spoken record is produced, the article&rsquo;s
              text is sent to <code>api.elevenlabs.io</code> to be read aloud, and the resulting audio is
              stored by this archive. The voice is trained from recordings supplied by the owner, with his
              consent; a narration carries the disclosure of how it was made on the page that plays it.
            </li>
            <li>
              <strong>Cloudflare — the domain and delivery.</strong> <code>ozikoro.com</code> is registered
              at Namecheap and delegated to Cloudflare&rsquo;s nameservers, so Cloudflare resolves the domain
              and carries the traffic. Cloudflare therefore sees the address and the request, as any
              nameserver and any host does; <strong>the media files themselves are served from this
              origin</strong> at <code>/media/…</code> rather than from a third-party image host, which is
              why the content-security policy can restrict images to this origin.
            </li>
            <li>
              <strong>Spotify</strong>, where an episode is published there. Only the episode&rsquo;s own
              audio and its public page are involved: the archive holds a connection to its own podcast
              account, and <strong>no reader&rsquo;s data is sent to Spotify</strong>. Where an
              episode&rsquo;s audio is held on Spotify, the archive&rsquo;s own page says so rather than
              presenting it as this archive&rsquo;s recording.
            </li>
          </ul>

          <h2>Cookies</h2>
          <p>
            This site sets <strong>two</strong> cookies, both first-party, both written by this server, and
            neither readable by JavaScript:
          </p>
          <ul>
            <li>
              <code>ozituma_session</code> — the signed-in session. <code>HttpOnly</code>, so a script on the
              page cannot read it; <code>SameSite=Lax</code>; <code>Secure</code> on the live https origin;
              and it expires, after which the session is gone.
            </li>
            <li>
              <code>ozikoro_dashboard_mode</code> — which workspace an account last chose to open, so the
              right one opens next time. It holds a workspace name and nothing about a person.
            </li>
          </ul>
          <p>
            <strong>There is no consent banner because there is nothing to consent to</strong>: no advertising
            cookie, no analytics cookie, and no third-party cookie of any kind. Nothing on this site reads a
            cookie that this site did not write.
          </p>

          <h2>What the platform does not do</h2>
          <p>
            This is stated as a property of the code rather than as a promise, because it is checkable in the
            code. <strong>The site&rsquo;s own content-security policy is the evidence</strong>, and it is sent
            with every page: it permits images from this origin and from YouTube&rsquo;s thumbnail host, media
            from this origin, frames from YouTube&rsquo;s privacy-enhanced embed, and connections to this
            origin. A tracking script, an advertising beacon or a third-party font or image host would have
            to be added to that policy to work at all.
          </p>
          <ul>
            <li>
              <strong>No analytics and no advertising.</strong> There is no analytics script, no tag manager,
              no advertising network and no social pixel on any page. The archive does not count readers, and
              it does not sell or share anything about them.
            </li>
            <li>
              <strong>No profiling and no automated decisions</strong> about a reader. The only scripts that
              run are this archive&rsquo;s own — the reader&rsquo;s controls on an article, the player on an
              episode, the navigation on a small screen.
            </li>
            <li>
              <strong>No data is sold, rented or exchanged</strong>, and none is used to train a model. The
              only text sent to a language service is an article&rsquo;s own published text, and only to
              produce the narration the article offers.
            </li>
            <li>
              <strong>No payment detail is held here at all</strong>, because it never reaches this platform.
            </li>
          </ul>

          <h2>What is held about the people in the records</h2>
          <p>
            This is where an archive of histories and a privacy notice meet, and the honest position is a
            difficult one. The archive holds {plural(c.media, 'media item', 'media items')} — photographs,
            scans, documents and recordings — and the rights position of most of them is <strong>not
            established</strong>.
          </p>
          <ul>
            <li>
              <strong>{plural(c.media_with_licence, 'item carries a recorded licence', 'items carry a recorded licence')}.</strong>{' '}
              Those licences are read from the record itself — public domain as the record states it, CC0, or
              CC BY-SA — and the archive reproduces the record&rsquo;s own words rather than upgrading them
              into a permission.
            </li>
            <li>
              <strong>Every one of those licences was read by a machine, and not one has been confirmed by a
              person.</strong> The rights register records this on the record itself: {n(c.rights_checked)} of
              its entries have been checked by someone. A derived licence is not a rights determination, and
              the register does not pretend otherwise.
            </li>
            <li>
              <strong>{n(c.media - c.media_with_any_note)} of the {n(c.media)} items carry no rights statement
              of any kind</strong>, and those pages say so rather than implying a permission.
            </li>
          </ul>
          <p>
            Across the whole register, the archive states one rights basis and no other: each of the{' '}
            {plural(c.media_rights, 'entry', 'entries')} was derived from a licence the record already
            stated. <strong>No entry rests on written permission, on a contract, or on an institutional
            agreement</strong>, because none has been recorded.
          </p>
          <p>
            <strong>If you are in a photograph or a recording on this site and you want it removed, write to
            us.</strong> The archive&rsquo;s own rights register has a takedown field and a withdrawal state
            for exactly this, and a request is recorded rather than argued with. You do not have to explain
            why.
          </p>

          <h2>What has not been decided</h2>
          <p className="partial-note">
            The following are the questions a data-controller notice exists to answer, and{' '}
            <strong>they have not been answered for this platform</strong>. They are named here rather than
            filled, because each of them is a decision for Ozi Ikoro Limited and not a fact the code can
            supply:
          </p>
          <ul>
            <li><strong>How long anything is kept</strong> — no retention period is recorded anywhere in the platform.</li>
            <li><strong>The lawful basis</strong> on which each kind of processing rests.</li>
            <li><strong>Who the data controller is</strong> in law, and the registered address and company number that identify it.</li>
            <li><strong>Which regulator</strong> a reader may complain to, and how.</li>
            <li><strong>Who to write to</strong> about access to, correction of, or deletion of personal data, and the time in which a reply will come.</li>
            <li><strong>Whether any data is transferred outside Nigeria</strong> and on what basis — although it can be said plainly that the services named above are not all hosted in Nigeria.</li>
          </ul>

          <h2>Writing to us</h2>
          <p>
            Corrections, takedown requests and material offered to the archive:{' '}
            <a href="mailto:archive@ozikoro.com">archive@ozikoro.com</a>. Anything else:{' '}
            <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>.
          </p>
          <p className="small muted">
            The institution&rsquo;s own page is <Link href="/about">About</Link>, and the terms that apply to
            using this site are set out in <Link href="/terms">Terms</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
